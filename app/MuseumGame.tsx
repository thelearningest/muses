"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Choice, Quest } from "./game-package";
import { finishSwitchboardConsequence, restoreGameProgress, SWITCHBOARD_OUTCOMES } from "./Game";
import { MuseumWorld, type MuseumWorldHandle } from "./MuseumWorld";
import { GALLERIES } from "./museum/architecture";
import { exhibitControls, initialExhibit, reduceExhibit, type ExhibitAction } from "./museum/experiments";
import styles from "./MuseumGame.module.css";

const SAVE_KEY = "design-warden-progress:v2:city-of-misfit-things";
type Overlay = "intro" | "map" | "journal" | "pause" | "exhibit" | null;

export function MuseumGame({ quests, onExit, guidedView }: { quests: Quest[]; onExit?: () => void; guidedView: ReactNode }) {
  const maxXp = useMemo(() => quests.reduce((sum, quest) => sum + quest.xp, 0), [quests]);
  const [progress, setProgress] = useState(() => restoreGameProgress(null, quests, maxXp, true));
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [states, setStates] = useState(() => GALLERIES.map((gallery) => initialExhibit(gallery.kind)));
  const [overlay, setOverlay] = useState<Overlay>("intro");
  const [nearby, setNearby] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [guided, setGuided] = useState(false);
  const world = useRef<MuseumWorldHandle>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const completed = useMemo(() => quests.map((quest) => progress.completed.includes(quest.id)), [quests, progress.completed]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(SAVE_KEY);
        if (saved) setProgress(restoreGameProgress(JSON.parse(saved), quests, maxXp, true));
      } catch { setSaveError(true); }
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [maxXp, quests]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); }
    catch { queueMicrotask(() => setSaveError(true)); }
  }, [progress, ready]);

  useEffect(() => {
    const element = dialog.current;
    if (!element || guided) return;
    if (overlay && !element.open) element.showModal();
    if (!overlay && element.open) element.close();
  }, [overlay, guided]);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
    requestAnimationFrame(() => world.current?.focus());
  }, []);

  const act = useCallback((index: number, action: ExhibitAction) => {
    if (!GALLERIES[index]) return;
    setStates((current) => current.map((state, item) => item === index ? reduceExhibit(GALLERIES[index].kind, state, action, completed[index]) : state));
    if (index === 5 && action.type === "wrong-turn" && states[5].stops.length) {
      const destination = GALLERIES.find((gallery) => gallery.index !== 5 && !states[5].stops.includes(gallery.index))?.index ?? 0;
      world.current?.visit(destination);
      closeOverlay();
    }
    if (index === 5 && action.type === "return" && completed[5] && states[5].wrongTurn) {
      world.current?.entrance();
      closeOverlay();
    }
  }, [completed, states, closeOverlay]);

  const memoryStarted = states[2].started;
  const memoryHidden = states[2].hidden;
  const memoryRepaired = completed[2];
  useEffect(() => {
    if (!memoryStarted || memoryHidden || memoryRepaired) return;
    const timer = window.setTimeout(() => setStates((current) => current.map((state, index) => index === 2 ? reduceExhibit("memory", state, { type: "hide" }, false) : state)), 4000);
    return () => window.clearTimeout(timer);
  }, [memoryStarted, memoryHidden, memoryRepaired]);

  const openExhibit = useCallback((index: number) => {
    if (!quests[index]) return;
    setSelected(index);
    setFeedback("");
    setSelectedChoice(null);
    setOverlay("exhibit");
  }, [quests]);

  const award = () => {
    const quest = quests[selected];
    setProgress((current) => current.currentQuest !== selected || current.phase !== "repair" ? current : ({
      ...current,
      phase: "reward",
      xp: current.completed.includes(quest.id) ? current.xp : Math.min(maxXp, current.xp + quest.xp),
      completed: current.completed.includes(quest.id) ? current.completed : [...current.completed, quest.id],
      principles: current.principles.includes(quest.id) ? current.principles : [...current.principles, quest.id],
    }));
    setStates((current) => current.map((state, index) => index === selected ? initialExhibit(GALLERIES[index].kind) : state));
  };

  const choose = (choice: Choice, repair: boolean) => {
    setSelectedChoice(choice.id);
    if (repair && selected === 1 && (choice.id === "spatial-map" || choice.id === "manual-labels")) {
      const switchboardChoice = choice.id;
      setProgress((current) => ({ ...current, phase: "consequence", switchboardChoice }));
      setFeedback("");
      return;
    }
    setFeedback(choice.feedback);
    if (!choice.correct) return;
    if (repair) award();
    else {
      setProgress((current) => ({ ...current, phase: "repair" }));
      setSelectedChoice(null);
    }
  };

  const continueQuest = () => {
    setProgress((current) => current.phase !== "reward" ? current : current.currentQuest === quests.length - 1 ? { ...current, phase: "complete" } : { ...current, currentQuest: current.currentQuest + 1, phase: "inspect" });
    closeOverlay();
  };

  const experimentButtons = (index: number) => <div className={styles.experimentButtons}>
    {exhibitControls(GALLERIES[index].kind, states[index], completed[index]).map((control) => <button key={control.label} type="button" disabled={control.disabled} aria-pressed={control.pressed} onClick={() => act(index, control.action)}>{control.label}</button>)}
  </div>;

  const dpad = (label: string, symbol: string, forward: number, strafe: number) => <button type="button" aria-label={label}
    onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); world.current?.setMove(forward, strafe); }}
    onPointerUp={() => world.current?.setMove(0, 0)} onPointerCancel={() => world.current?.setMove(0, 0)} onLostPointerCapture={() => world.current?.setMove(0, 0)}
    onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); world.current?.setMove(forward, strafe); } }}
    onKeyUp={() => world.current?.setMove(0, 0)} onBlur={() => world.current?.setMove(0, 0)}>{symbol}</button>;

  const returnToMuseum = () => {
    try {
      const saved = localStorage.getItem(SAVE_KEY);
      setProgress(restoreGameProgress(saved ? JSON.parse(saved) : null, quests, maxXp, true));
    } catch { setSaveError(true); }
    setStates(GALLERIES.map((gallery) => initialExhibit(gallery.kind)));
    setGuided(false);
    setOverlay("intro");
  };

  if (guided) return <div className={styles.guided}><button type="button" className={styles.returnWorld} onClick={returnToMuseum}>Return to 3D museum</button>{guidedView}</div>;

  const quest = quests[selected];
  const isCurrent = selected === progress.currentQuest;
  const phase = progress.phase;
  const outcome = isCurrent && phase === "consequence" && progress.switchboardChoice ? SWITCHBOARD_OUTCOMES[progress.switchboardChoice] : null;
  const heading = overlay === "intro" ? "City of Misfit Things" : overlay === "map" ? "Find your next room" : overlay === "journal" ? "Your field journal" : overlay === "pause" ? "Take a moment" : quest.title;

  return <main className={styles.museum} aria-label="City of Misfit Things, walkable museum">
    <MuseumWorld ref={world} states={states} completed={completed} paused={overlay !== null}
      onAction={act} onNearby={setNearby} onLeave={(index) => { if (index === 2) act(index, { type: "interrupt" }); }}
      onInteract={openExhibit} onPause={() => setOverlay("pause")} onAvailability={setAvailable} />

    <header className={styles.hud}>
      <div className={styles.brand}><span>THE LIVING MUSEUM</span><strong>City of Misfit Things</strong></div>
      <div className={styles.progress}><strong>{completed.filter(Boolean).length} / 6</strong><span>exhibits repaired · {progress.xp} XP</span></div>
      <nav aria-label="Museum tools"><button type="button" onClick={() => setOverlay("map")}>Map</button><button type="button" onClick={() => setOverlay("journal")}>Journal</button><button type="button" onClick={() => setOverlay("pause")}>Pause</button>{onExit && <button type="button" onClick={onExit}>Library</button>}</nav>
    </header>

    {!overlay && <>
      <div className={styles.objective}><span>{phase === "complete" ? "MUSEUM RESTORED" : `YOUR NEXT REPAIR · ${quests[progress.currentQuest].number}`}</span><strong>{phase === "complete" ? "Keep exploring your repaired exhibits." : quests[progress.currentQuest].title}</strong></div>
      {nearby !== null && <aside className={styles.interaction} aria-label={`${GALLERIES[nearby].name} controls`}>
        <div className={styles.panelHeading}><span>{completed[nearby] ? "REPAIRED EXHIBIT" : "TRY THE EXHIBIT"}</span><strong>{GALLERIES[nearby].name}</strong></div>
        <p role="status" aria-live="polite">{states[nearby].notice}</p>
        {experimentButtons(nearby)}
        <button type="button" className={styles.primary} onClick={() => openExhibit(nearby)}>{completed[nearby] ? "Read field notes" : "Investigate & repair"}<kbd>E</kbd></button>
      </aside>}
      {states[5].wrongTurn && completed[5] && <div className={styles.returnGuide}><span>You left your planned route.</span><button type="button" onClick={() => act(5, { type: "return" })}>Return to entrance</button></div>}
      <div className={styles.navigationHint}><span>WASD / arrows to walk · Drag to look · E to investigate</span><button type="button" onClick={() => world.current?.lockLook()}>Mouse look</button></div>
      <div className={styles.dpad} aria-label="Walking controls">{dpad("Walk forward", "↑", 1, 0)}<div>{dpad("Walk left", "←", 0, -1)}{dpad("Walk backward", "↓", -1, 0)}{dpad("Walk right", "→", 0, 1)}</div></div>
      {!available && <div className={styles.unavailable}><p>The 3D view is unavailable on this device.</p><button type="button" onClick={() => setGuided(true)}>Open accessible guided view</button></div>}
    </>}

    <dialog ref={dialog} className={`${styles.dialog} ${overlay === "exhibit" ? styles.exhibitDialog : ""}`} aria-labelledby="museum-dialog-heading" onCancel={(event) => { event.preventDefault(); closeOverlay(); }}>
      <div className={styles.dialogTop}><span>{overlay === "exhibit" ? `GALLERY ${quest.number}` : "CITY OF MISFIT THINGS"}</span><button type="button" aria-label="Close panel and return to museum" onClick={closeOverlay}>×</button></div>
      <h1 id="museum-dialog-heading">{heading}</h1>
      {overlay === "intro" && <>
        <p className={styles.lead}>A museum full of things that almost work. Walk through six galleries, try the objects, and discover what a better design feels like.</p>
        <div className={styles.introSteps}><div><strong>01</strong><span>Walk into a room</span></div><div><strong>02</strong><span>Try things yourself</span></div><div><strong>03</strong><span>Repair what misleads</span></div></div>
        <p>Use WASD or arrow keys to walk. Drag to look around. Click an object to try it, or press E nearby to investigate. On a phone, use the walking pad and drag the view.</p>
        <button type="button" className={styles.primary} onClick={closeOverlay} disabled={!ready}>{ready ? progress.completed.length ? "Continue exploring" : "Enter the museum" : "Opening your journal…"}</button>
        <button type="button" className={styles.textButton} onClick={() => setGuided(true)}>Prefer a guided, accessible view?</button>
        {saveError && <p role="status">Browser saving is unavailable. You can still explore this session.</p>}
        {!available && <p role="status">3D is unavailable here. Choose the guided view to continue.</p>}
      </>}
      {overlay === "map" && <>
        <p>Every gallery is open. Follow the central hall, or use a room shortcut. Repairs follow the numbered trail.</p>
        <div className={styles.roomList}>{GALLERIES.map((gallery) => <button type="button" key={gallery.kind} onClick={() => { world.current?.visit(gallery.index); closeOverlay(); }}><span className={styles.roomNumber}>{String(gallery.index + 1).padStart(2, "0")}</span><span><strong>{gallery.name}</strong><small>{completed[gallery.index] ? "Repaired · try the new design" : gallery.index === progress.currentQuest ? "Your next repair" : "Open for exploration"}</small></span><span aria-hidden="true">↗</span></button>)}</div>
        <button type="button" onClick={() => { world.current?.entrance(); closeOverlay(); }}>Return to entrance</button>
      </>}
      {overlay === "journal" && <>
        <p>{completed.filter(Boolean).length} of 6 repairs recorded · {progress.xp} XP</p>
        {progress.completed.length === 0 ? <p>Your field journal starts with your first repair. Visit the gate in Gallery 01.</p> : <div className={styles.journal}>{quests.filter((item) => progress.completed.includes(item.id)).map((item) => <article key={item.id}><span>GALLERY {item.number}</span><h2>{item.principle.name}</h2><p>{item.principle.summary}</p>{item.id === "constellation-controls" && progress.switchboardChoice && <p>{SWITCHBOARD_OUTCOMES[progress.switchboardChoice].journal}</p>}</article>)}</div>}
      </>}
      {overlay === "pause" && <>
        <p>{saveError ? "Browser saving is unavailable; keep this session open to retain your repairs." : "Your repairs are saved in this browser."} Resume wherever you left off, or use the guided view for the same six activities without walking.</p>
        <div className={styles.pauseActions}><button type="button" className={styles.primary} onClick={closeOverlay}>Resume exploring</button><button type="button" onClick={() => setOverlay("map")}>Open museum map</button><button type="button" onClick={() => setGuided(true)}>Open guided view</button>{onExit && <button type="button" onClick={onExit}>Return to library</button>}</div>
      </>}
      {overlay === "exhibit" && <>
        <p>{quest.story}</p>
        <div className={styles.goal}><span>YOUR TASK</span><p>{quest.objective}</p></div>
        <details className={styles.experimentDetail}><summary>Try the exhibit controls</summary><p role="status" aria-live="polite">{states[selected].notice}</p>{experimentButtons(selected)}</details>
        {!isCurrent && !completed[selected] && <div className={styles.notice}><p>You can experiment here now. To record this repair, first finish Gallery {quests[progress.currentQuest].number}: {quests[progress.currentQuest].title}.</p><button type="button" onClick={closeOverlay}>Keep exploring</button></div>}
        {completed[selected] && (!isCurrent || phase === "complete") && <><h2>{quest.principle.name}</h2><p>{quest.principle.summary}</p><p className={styles.success}>Repaired and saved to your journal.</p><button type="button" className={styles.primary} onClick={closeOverlay}>Try the repaired exhibit</button></>}
        {isCurrent && phase === "inspect" && <><h2>Look closely.</h2><ul className={styles.clues}>{quest.observationTools.map((tool) => <li key={tool}>{tool}</li>)}</ul><button type="button" className={styles.primary} onClick={() => { setProgress((current) => ({ ...current, phase: "diagnose" })); setFeedback(quest.clue); }}>I’m ready to investigate</button></>}
        {isCurrent && (phase === "diagnose" || phase === "repair") && <>
          <span className={styles.stepLabel}>{phase === "diagnose" ? "OBSERVE · QUESTION 1 OF 2" : "APPLY · QUESTION 2 OF 2"}</span>
          <h2>{phase === "diagnose" ? quest.diagnosisQuestion ?? "What is causing the problem?" : quest.repairQuestion ?? "How would you fix it?"}</h2>
          <div className={styles.choices}>{(phase === "diagnose" ? quest.diagnosis : quest.repairs).map((choice) => <button type="button" key={choice.id} aria-pressed={selectedChoice === choice.id} onClick={() => choose(choice, phase === "repair")}>{choice.label}<span aria-hidden="true">→</span></button>)}</div>
        </>}
        {outcome && <><span className={styles.stepLabel}>WHAT HAPPENS NEXT</span><h2>{outcome.title}</h2><p>{outcome.story}</p><button type="button" className={styles.primary} onClick={() => { setProgress((current) => finishSwitchboardConsequence(current, maxXp)); setStates((current) => current.map((state, index) => index === 1 ? initialExhibit("switchboard") : state)); setFeedback(""); }}>{outcome.action}</button></>}
        {isCurrent && phase === "reward" && <><span className={styles.stepLabel}>REPAIR RECORDED · {quest.xp} XP</span><h2>{quest.principle.name}</h2><p>{quest.principle.summary}</p><p className={styles.success}>The room has changed. Step back in and try your repair.</p><button type="button" className={styles.primary} onClick={continueQuest}>{selected === quests.length - 1 ? "Finish the trail & explore" : "Continue the museum trail"}</button></>}
        {feedback && <p className={styles.feedback} role="status" aria-live="polite">{feedback}</p>}
      </>}
    </dialog>
  </main>;
}
