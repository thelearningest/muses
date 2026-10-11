"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Choice, Quest } from "./game-package";
import { finishSwitchboardConsequence, restoreGameProgress, SWITCHBOARD_OUTCOMES } from "./Game";
import { MuseumWorld, type MuseumWorldHandle } from "./MuseumWorld";
import { GALLERIES } from "./museum/architecture";
import { EXHIBIT_INTRODUCTIONS, exhibitControls, initialExhibit, reduceExhibit, type ExhibitAction } from "./museum/experiments";
import { MuseumNarration } from "./narration/MuseumNarration";
import { NARRATION_SAMPLES } from "./narration/catalog.mjs";
import { getGalleryNarration } from "./narration/gallery.mjs";
import styles from "./MuseumGame.module.css";

const SAVE_KEY = "design-warden-progress:v2:city-of-misfit-things";
const AUDIO_PREFERENCE_KEY = "design-warden-audio:v1";
type Overlay = "intro" | "map" | "journal" | "pause" | "exhibit" | null;

export function MuseumGame({ quests, onExit, guidedView }: { quests: Quest[]; onExit?: () => void; guidedView: ReactNode }) {
  const maxXp = useMemo(() => quests.reduce((sum, quest) => sum + quest.xp, 0), [quests]);
  const [progress, setProgress] = useState(() => restoreGameProgress(null, quests, maxXp, true));
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [states, setStates] = useState(() => GALLERIES.map((gallery) => initialExhibit(gallery.kind)));
  const [originalDesign, setOriginalDesign] = useState(() => GALLERIES.map(() => false));
  const [overlay, setOverlayState] = useState<Overlay>("intro");
  const [nearby, setNearby] = useState<number | null>(null);
  const [nearbyOptionsOpen, setNearbyOptionsOpen] = useState(false);
  const setOverlay = useCallback((next: Overlay) => {
    if (next !== null) setNearbyOptionsOpen(false);
    setOverlayState(next);
  }, []);
  const arriveAtObject = useCallback((index: number | null) => {
    setNearby(index);
    setNearbyOptionsOpen(false);
  }, []);
  const [selected, setSelected] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [guided, setGuided] = useState(false);
  const music = useRef<HTMLAudioElement | null>(null);
  const musicWanted = useRef(true);
  const speaking = useRef(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicError, setMusicError] = useState<string | null>(null);
  const world = useRef<MuseumWorldHandle>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const completed = useMemo(() => quests.map((quest) => progress.completed.includes(quest.id)), [quests, progress.completed]);
  const repairedDesign = useMemo(() => completed.map((done, index) => done && !originalDesign[index]), [completed, originalDesign]);
  const encounterIndex = ready && !guided && overlay === null && nearby !== null && !completed[nearby] && !progress.encounters?.includes(quests[nearby].id) ? nearby : null;

  const duckMusic = useCallback((isSpeaking: boolean) => {
    speaking.current = isSpeaking;
    if (music.current) music.current.volume = isSpeaking ? 0.40 : 0.60;
  }, []);

  const playMusic = useCallback(() => {
    const audio = music.current;
    if (!audio) return;
    setMusicError(null);
    void audio.play().catch((error: unknown) => {
      if (music.current !== audio || !musicWanted.current) return;
      if (!(error instanceof Error) || (error.name !== "NotAllowedError" && error.name !== "AbortError")) {
        setMusicError("Music could not load. Try Play music again.");
      }
    });
  }, []);

  useEffect(() => {
    if (guided) return;
    const audio = new Audio("/audio/unsolved-investigation.mp3");
    audio.loop = true;
    audio.volume = speaking.current ? 0.40 : 0.60;
    music.current = audio;
    try { musicWanted.current = localStorage.getItem(AUDIO_PREFERENCE_KEY) !== "off"; } catch { /* Keep the session preference. */ }
    audio.onplaying = () => setMusicPlaying(true);
    audio.onpause = () => setMusicPlaying(false);
    audio.onerror = () => {
      setMusicPlaying(false);
      setMusicError("Music could not load. Try Play music again.");
    };
    const retryMusic = (event: Event) => {
      if (!event.isTrusted || !musicWanted.current || !audio.paused || audio.error || document.hidden) return;
      if (event.target instanceof Element && event.target.closest("[data-music-control]")) return;
      if (event instanceof KeyboardEvent && (event.repeat || event.key === "Escape" || event.ctrlKey || event.metaKey || event.altKey)) return;
      playMusic();
    };
    const visibilityChanged = () => {
      if (document.hidden) audio.pause();
      else if (musicWanted.current) playMusic();
    };
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setMusicPlaying(false);
      setMusicError(null);
      if (musicWanted.current && !document.hidden) playMusic();
    });
    document.addEventListener("pointerdown", retryMusic);
    document.addEventListener("keydown", retryMusic);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      cancelled = true;
      document.removeEventListener("pointerdown", retryMusic);
      document.removeEventListener("keydown", retryMusic);
      document.removeEventListener("visibilitychange", visibilityChanged);
      audio.onplaying = audio.onpause = audio.onerror = null;
      music.current = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [guided, playMusic]);

  const toggleMusic = () => {
    const audio = music.current;
    if (!audio) return;
    musicWanted.current = audio.paused;
    try { localStorage.setItem(AUDIO_PREFERENCE_KEY, musicWanted.current ? "on" : "off"); } catch { /* Music still works without storage. */ }
    if (musicWanted.current) {
      if (audio.error) audio.load();
      playMusic();
    } else audio.pause();
  };
  const musicControl = <>
    <button type="button" className={styles.musicToggle} data-music-control aria-pressed={musicPlaying}
      aria-label={musicPlaying ? "Mute music" : "Play music"} title={musicPlaying ? "Mute music" : "Play music"} onClick={toggleMusic}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        {musicPlaying ? <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></> : <><path d="m16 9 5 6" /><path d="m21 9-5 6" /></>}
      </svg>
    </button>
    {musicError && <span role="status">{musicError}</span>}
  </>;

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
    if ((overlay || encounterIndex !== null) && !element.open) {
      element.showModal();
      if (encounterIndex !== null) element.querySelector<HTMLButtonElement>("[data-encounter-action]")?.focus();
    }
    if (!overlay && encounterIndex === null && element.open) element.close();
  }, [overlay, guided, encounterIndex]);

  const closeOverlay = useCallback(() => {
    if (encounterIndex !== null) {
      const id = quests[encounterIndex].id;
      setProgress((current) => ({ ...current, encounters: [...new Set([...(current.encounters ?? []), id])] }));
    }
    setOverlay(null);
    requestAnimationFrame(() => world.current?.focus());
  }, [encounterIndex, quests, setOverlay]);

  const act = useCallback((index: number, action: ExhibitAction) => {
    if (!GALLERIES[index]) return;
    setStates((current) => current.map((state, item) => item === index ? reduceExhibit(GALLERIES[index].kind, state, action, repairedDesign[index]) : state));
    if (index === 5 && action.type === "wrong-turn" && states[5].stops.length) {
      const destination = GALLERIES.find((gallery) => gallery.index !== 5 && !states[5].stops.includes(gallery.index))?.index ?? 0;
      world.current?.visit(destination);
      closeOverlay();
    }
    if (index === 5 && action.type === "return" && repairedDesign[5] && states[5].wrongTurn) {
      world.current?.entrance();
      closeOverlay();
    }
  }, [repairedDesign, states, closeOverlay]);

  const memoryStarted = states[2].started;
  const memoryHidden = states[2].hidden;
  const memoryRepaired = repairedDesign[2];
  useEffect(() => {
    if (!memoryStarted || memoryHidden || memoryRepaired) return;
    const timer = window.setTimeout(() => setStates((current) => current.map((state, index) => index === 2 ? reduceExhibit("memory", state, { type: "hide" }, false) : state)), 4000);
    return () => window.clearTimeout(timer);
  }, [memoryStarted, memoryHidden, memoryRepaired]);

  const openExhibit = useCallback((index: number) => {
    if (!quests[index]) return;
    setSelected(index);
    setSelectedChoice(null);
    setOverlay("exhibit");
  }, [quests, setOverlay]);

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
        return;
    }
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

  const toggleDesign = (index: number) => {
    if (!completed[index]) return;
    setNearbyOptionsOpen(false);
    setOriginalDesign((current) => current.map((original, item) => item === index ? !original : original));
    setStates((current) => current.map((state, item) => item === index ? initialExhibit(GALLERIES[index].kind) : state));
  };

  const experimentButtons = (index: number) => <>
    {completed[index] && <>
      <p>{originalDesign[index] ? "Trying the original design." : "Trying the repaired design."} Your XP and journal are saved.</p>
      <button type="button" onClick={() => toggleDesign(index)}>{originalDesign[index] ? "Try repaired design" : "Try original design"}</button>
    </>}
    <div className={styles.experimentButtons}>
      {exhibitControls(GALLERIES[index].kind, states[index], repairedDesign[index]).map((control) => <button key={control.label} type="button" disabled={control.disabled} aria-pressed={control.pressed} onClick={() => act(index, control.action)}>{control.label}</button>)}
    </div>
  </>;

  const dpad = (label: string, symbol: string, forward: number, strafe: number) => <button type="button" aria-label={label}
    onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); world.current?.setMove(forward, strafe); }}
    onPointerUp={() => world.current?.setMove(0, 0)} onPointerCancel={() => world.current?.setMove(0, 0)} onLostPointerCapture={() => world.current?.setMove(0, 0)}
    onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); world.current?.setMove(forward, strafe); } }}
    onKeyUp={() => world.current?.setMove(0, 0)} onBlur={() => world.current?.setMove(0, 0)}>{symbol}</button>;

  const resetMuseum = () => {
    if (!window.confirm("Reset the museum? This clears your saved XP, repairs, and journal and starts you at the entrance.")) return;
    const freshProgress = restoreGameProgress(null, quests, maxXp, true);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(freshProgress));
      setSaveError(false);
    } catch { setSaveError(true); }
    setProgress(freshProgress);
    setStates(GALLERIES.map((gallery) => initialExhibit(gallery.kind)));
    setOriginalDesign(GALLERIES.map(() => false));
    setSelected(0);
    setSelectedChoice(null);
    setNearby(null);
    world.current?.setMove(0, 0);
    world.current?.entrance();
    setOverlay("intro");
  };

  const returnToMuseum = () => {
    try {
      const saved = localStorage.getItem(SAVE_KEY);
      setProgress(restoreGameProgress(saved ? JSON.parse(saved) : null, quests, maxXp, true));
    } catch { setSaveError(true); }
    setStates(GALLERIES.map((gallery) => initialExhibit(gallery.kind)));
    setOriginalDesign(GALLERIES.map(() => false));
    setGuided(false);
    setOverlay("intro");
  };

  if (guided) return <div className={styles.guided}><button type="button" className={styles.returnWorld} onClick={returnToMuseum}>Return to 3D museum</button>{guidedView}</div>;

  const quest = quests[selected];
  const isCurrent = selected === progress.currentQuest;
  const phase = progress.phase;
  const outcome = isCurrent && phase === "consequence" && progress.switchboardChoice ? SWITCHBOARD_OUTCOMES[progress.switchboardChoice] : null;
  const introduction = encounterIndex === null ? null : EXHIBIT_INTRODUCTIONS[GALLERIES[encounterIndex].kind];
  const heading = introduction?.title ?? (overlay === "intro" ? "City of Misfit Things" : overlay === "map" ? "Find your next room" : overlay === "journal" ? "Your field journal" : overlay === "pause" ? "Take a moment" : quest.title);
  const narrationSample = overlay === "intro" ? NARRATION_SAMPLES.find(sample => sample.id === "welcome")
    : overlay === "exhibit" ? getGalleryNarration(quest.id, { phase: originalDesign[selected] ? "inspect" : phase, completed: repairedDesign[selected], isCurrent, consequence: progress.switchboardChoice }) : null;
  const nearbyNarration = nearby === null ? null : getGalleryNarration(quests[nearby].id, { phase: "inspect", completed: repairedDesign[nearby], isCurrent: nearby === progress.currentQuest });

  return <main className={styles.museum} aria-label="City of Misfit Things, walkable museum">
    <MuseumWorld ref={world} states={states} completed={repairedDesign} paused={overlay !== null || encounterIndex !== null}
      onAction={act} onNearby={arriveAtObject} onLeave={(index) => { if (index === 2) act(index, { type: "interrupt" }); }}
      onInteract={openExhibit} onPause={() => setOverlay("pause")} onAvailability={setAvailable} />

    <header className={styles.hud}>
      <div className={styles.brand}><span>THE LIVING MUSEUM</span><strong>City of Misfit Things</strong></div>
      <div className={styles.progress}><strong>{completed.filter(Boolean).length} / 6</strong><span>exhibits repaired · {progress.xp} XP</span></div>
      <nav aria-label="Museum tools">{musicControl}<button type="button" onClick={() => setOverlay("map")}>Map</button><button type="button" onClick={() => setOverlay("journal")}>Journal</button><button type="button" onClick={() => setOverlay("pause")}>Pause</button>{onExit && <button type="button" onClick={onExit}>Library</button>}</nav>
    </header>

    {!overlay && encounterIndex === null && <>
      <div className={styles.objective}><span>{phase === "complete" ? "MUSEUM RESTORED" : `YOUR NEXT REPAIR · ${quests[progress.currentQuest].number}`}</span><strong>{phase === "complete" ? "Keep exploring your repaired exhibits." : quests[progress.currentQuest].title}</strong></div>
      {nearby !== null && <aside className={styles.interaction} aria-label={`${GALLERIES[nearby].name} controls`}>
        <div className={styles.panelHeading}><span>{originalDesign[nearby] ? "ORIGINAL DESIGN" : completed[nearby] ? "REPAIRED EXHIBIT" : "TRY THE EXHIBIT"}</span><strong>{GALLERIES[nearby].name}</strong></div>
        <p role="status" aria-live="polite">{states[nearby].notice}</p>
        <p className={styles.interactionHint}>Try the object’s controls, then investigate.</p>
        <button type="button" className={styles.primary} onClick={() => openExhibit(nearby)}>{completed[nearby] ? "Read field notes" : "Investigate & repair"}<kbd>E</kbd></button>
        <details className={styles.moreOptions} open={nearbyOptionsOpen} onToggle={(event) => setNearbyOptionsOpen(event.currentTarget.open)}>
          <summary>More options</summary>
          {nearbyOptionsOpen && <>
            {experimentButtons(nearby)}
            {nearbyNarration && <MuseumNarration key={nearbyNarration.id} sample={nearbyNarration} onSpeakingChange={duckMusic} />}
          </>}
        </details>
      </aside>}
      {states[5].wrongTurn && repairedDesign[5] && <div className={styles.returnGuide}><span>You left your planned route.</span><button type="button" onClick={() => act(5, { type: "return" })}>Return to entrance</button></div>}
      <div className={styles.navigationHint}><span>WASD / arrows to walk · Drag to look · E to investigate</span><button type="button" onClick={() => world.current?.lockLook()}>Mouse look</button></div>
      <div className={styles.dpad} aria-label="Walking controls">{dpad("Walk forward", "↑", 1, 0)}<div>{dpad("Walk left", "←", 0, -1)}{dpad("Walk backward", "↓", -1, 0)}{dpad("Walk right", "→", 0, 1)}</div></div>
      {!available && <div className={styles.unavailable}><p>The 3D view is unavailable on this device.</p><button type="button" onClick={() => setGuided(true)}>Open accessible guided view</button></div>}
    </>}

    <dialog ref={dialog} className={`${styles.dialog} ${introduction ? styles.encounterDialog : overlay === "exhibit" ? styles.exhibitDialog : ""}`} aria-labelledby="museum-dialog-heading" onCancel={(event) => { event.preventDefault(); closeOverlay(); }}>
      <div className={styles.dialogTop}><span>{introduction ? "TRY THIS FIRST" : overlay === "exhibit" ? `GALLERY ${quest.number}` : "CITY OF MISFIT THINGS"}</span><button type="button" aria-label={introduction ? "Skip introduction" : "Close panel and return to museum"} onClick={closeOverlay}>×</button></div>
      <h1 id="museum-dialog-heading">{heading}</h1>
      {introduction && encounterIndex !== null ? <>
        <p>{introduction.instruction}</p>
        <button type="button" className={styles.primary} data-encounter-action onClick={() => { closeOverlay(); act(encounterIndex, introduction.action); }}>{introduction.label}<span aria-hidden="true">→</span></button>
      </> : narrationSample ? <MuseumNarration key={narrationSample.id} sample={narrationSample} autoPlay={overlay === "intro"} onSpeakingChange={duckMusic} extraControls={musicControl} /> : musicControl}
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
        <div className={styles.pauseActions}><button type="button" className={styles.primary} onClick={closeOverlay}>Resume exploring</button><button type="button" onClick={() => setOverlay("map")}>Open museum map</button><button type="button" onClick={() => setGuided(true)}>Open guided view</button><button type="button" onClick={resetMuseum} disabled={!ready}>Reset museum</button>{onExit && <button type="button" onClick={onExit}>Return to library</button>}</div>
      </>}
      {overlay === "exhibit" && <>
        <p>{quest.story}</p>
        <div className={styles.goal}><span>YOUR TASK</span><p>{quest.objective}</p></div>
        <details className={styles.experimentDetail}><summary>Try the exhibit controls</summary><p role="status" aria-live="polite">{states[selected].notice}</p>{experimentButtons(selected)}</details>
        {!isCurrent && !completed[selected] && <div className={styles.notice}><p>You can experiment here now. To record this repair, first finish Gallery {quests[progress.currentQuest].number}: {quests[progress.currentQuest].title}.</p><button type="button" onClick={closeOverlay}>Keep exploring</button></div>}
        {completed[selected] && (!isCurrent || phase === "complete") && <><h2>{quest.principle.name}</h2><p>{quest.principle.summary}</p><p className={styles.success}>Repaired and saved to your journal.</p><button type="button" className={styles.primary} onClick={closeOverlay}>{originalDesign[selected] ? "Try the original exhibit" : "Try the repaired exhibit"}</button></>}
        {isCurrent && phase === "inspect" && <><h2>Look closely.</h2><ul className={styles.clues}>{quest.observationTools.map((tool) => <li key={tool}>{tool}</li>)}</ul><button type="button" className={styles.primary} onClick={() => { setProgress((current) => ({ ...current, phase: "diagnose" })); }}>I’m ready to investigate</button></>}
        {isCurrent && (phase === "diagnose" || phase === "repair") && <>
          <span className={styles.stepLabel}>{phase === "diagnose" ? "OBSERVE · QUESTION 1 OF 2" : "APPLY · QUESTION 2 OF 2"}</span>
          <h2>{phase === "diagnose" ? quest.diagnosisQuestion ?? "What is causing the problem?" : quest.repairQuestion ?? "How would you fix it?"}</h2>
          <div className={styles.choices}>{(phase === "diagnose" ? quest.diagnosis : quest.repairs).map((choice) => <button type="button" key={choice.id} aria-pressed={selectedChoice === choice.id} onClick={() => choose(choice, phase === "repair")}>{choice.label}<span aria-hidden="true">→</span></button>)}</div>
        </>}
        {outcome && <><span className={styles.stepLabel}>WHAT HAPPENS NEXT</span><h2>{outcome.title}</h2><p>{outcome.story}</p><button type="button" className={styles.primary} onClick={() => { setProgress((current) => finishSwitchboardConsequence(current, maxXp)); setStates((current) => current.map((state, index) => index === 1 ? initialExhibit("switchboard") : state)); }}>{outcome.action}</button></>}
        {isCurrent && phase === "reward" && <><span className={styles.stepLabel}>REPAIR RECORDED · {quest.xp} XP</span><h2>{quest.principle.name}</h2><p>{quest.principle.summary}</p><p className={styles.success}>The room has changed. Step back in and try your repair.</p><button type="button" className={styles.primary} onClick={continueQuest}>{selected === quests.length - 1 ? "Finish the trail & explore" : "Continue the museum trail"}</button></>}
      </>}
    </dialog>
  </main>;
}
