"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { PrintShop } from "../print-shop/PrintShop";
import { QUESTS } from "../print-shop/model";
import { matchesFixture, newReplay, replayProgress, REPLAY_DURATION_MS, REPLAY_SAVE_KEY, REPLAY_STAGES, restoreReplay, type Replay } from "./replay";
import styles from "./DemoLibrary.module.css";

const MisfitGame = lazy(() => import("../Game").then(module => ({ default: module.Game })));
const subscribeHydration = () => () => {};
export function DemoLibrary() {
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  return hydrated ? <DemoSession /> : <main className={styles.library}><p role="status">Opening your book library…</p></main>;
}
function DemoSession() {
  const [replay, setReplay] = useState<Replay | null>(() => { try { return restoreReplay(localStorage.getItem(REPLAY_SAVE_KEY), Date.now()); } catch { return null; } });
  const [now, setNow] = useState(() => Date.now());
  const [screen, setScreen] = useState<"library" | "misfit" | "print-shop">("library");
  const showScreen = useCallback((next: "library" | "misfit" | "print-shop") => {
    setScreen(next); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }, []);
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [storageNotice, setStorageNotice] = useState("");
  const attempt = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const autoOpen = useRef(!!replay && !replayProgress(replay, now).complete);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!replay) return;
    const timer = window.setInterval(() => {
      const time = Date.now(); setNow(time);
      if (replayProgress(replay, time).complete) {
        window.clearInterval(timer);
        if (autoOpen.current) { autoOpen.current = false; showScreen("print-shop"); }
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [replay, showScreen]);
  const progress = replayProgress(replay, now);
  function store(next: Replay | null) {
    try { if (next) localStorage.setItem(REPLAY_SAVE_KEY, JSON.stringify(next)); else localStorage.removeItem(REPLAY_SAVE_KEY); setStorageNotice(""); }
    catch { setStorageNotice("Replay progress stays in this tab because browser storage is unavailable."); }
    setNow(Date.now()); setReplay(next);
  }
  async function start(selectedFile: File | null = file) {
    if (checking || replay) return;
    const currentAttempt = ++attempt.current;
    setChecking(true); setError("");
    try {
      if (selectedFile && !await matchesFixture(selectedFile)) {
        if (mounted.current && currentAttempt === attempt.current) setError("This replay is prepared for the supplied Robin Williams PDF. Select that file, or clear the selection to use the prepared book.");
        return;
      }
      if (mounted.current && currentAttempt === attempt.current) { autoOpen.current = true; store(newReplay(Date.now())); }
    } catch { if (mounted.current && currentAttempt === attempt.current) setError("The PDF could not be checked. Clear the file selection to rehearse with the prepared book."); }
    finally { if (mounted.current && currentAttempt === attempt.current) setChecking(false); }
  }
  function resetReplay() { attempt.current++; autoOpen.current = false; setChecking(false); setError(""); store(null); }
  const status = progress.complete ? "The Last Print Shop is ready" : replay ? REPLAY_STAGES[progress.stage] : "Choose a design book to begin";
  if (screen !== "library") return <div className={styles.playing}>
    {replay && screen === "misfit" && <aside className={styles.backgroundStatus} aria-label="Second book progress"><span>Demo replay · {progress.percent}%</span><strong>{status}</strong><button onClick={() => showScreen(progress.complete ? "print-shop" : "library")}>{progress.complete ? "Open your new game →" : "Back to library"}</button></aside>}
    {screen === "misfit" ? <Suspense fallback={<p className={styles.loading} role="status">Opening The City of Misfit Things…</p>}><MisfitGame onExit={() => showScreen("library")} /></Suspense> : <PrintShop onExit={() => showScreen("library")} />}
  </div>;
  return <main className={styles.library}>
    <header className={styles.header}><Link className={styles.wordmark} href="/">muses</Link><span>Books you can play.</span><Link href="/">Open the generator →</Link></header>
    <div className={styles.intro}><p className={styles.eyebrow}>Your playable library</p><h1>Read the idea.<br />Try it in the world.</h1><p>Turn a design book into a place to practise.<br />Make a choice, see what changes, and take the lesson with you.</p></div>
    <div className={styles.columns}>
      <section className={styles.create} aria-labelledby="create-title"><p className={styles.eyebrow}>Create another game</p><h2 id="create-title">A book. A new world.</h2><div className={styles.sourceBook}><span className={styles.bookNumber}>02</span><div><strong>The Non-Designer’s<br />Design Book</strong><p>Robin Williams · fourth edition</p></div></div>
      {!replay ? <><label className={styles.fileLabel}>Upload the design book<input ref={fileInput} type="file" accept="application/pdf,.pdf" disabled={checking} onChange={event => { attempt.current++; const selected = event.target.files?.[0] ?? null; setFile(selected); setError(""); if (selected) void start(selected); }} /></label><p className={styles.fileNote}>Select your PDF to start. The prepared 3D game opens after a short loading sequence.</p>{file && <button className={styles.lightButton} disabled={checking} onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }}>Use prepared book instead</button>}<button className={styles.createButton} disabled={checking} onClick={() => void start()}>{checking ? "Checking the book…" : "Try the prepared book →"}</button>{error && <p className={styles.error} role="alert">{error}</p>}</> : <div className={styles.progressPanel}><div className={styles.progressLabel}><strong>{progress.complete ? "Your game is ready" : "Creating your game"}</strong><span>{progress.percent}%</span></div><progress aria-label="Prepared game replay" value={progress.percent} max={100} /><ol>{REPLAY_STAGES.map((stage, index) => <li key={stage} className={progress.complete || index < progress.stage ? styles.done : index === progress.stage ? styles.current : ""}><span>{progress.complete || index < progress.stage ? "✓" : `0${index + 1}`}</span>{stage}</li>)}</ol><p role="status">{progress.complete ? "Five print orders are ready in your library." : "Play Misfit Things while your next book takes shape."}</p></div>}
      {storageNotice && <p className={styles.error} role="status">{storageNotice}</p>}<p className={styles.disclosure}>Demo replay using a prepared game. The progress is staged; no live generation runs.</p><details className={styles.rehearsal}><summary>Rehearsal controls</summary><p>The replay takes 12 seconds and opens the game automatically. Game progress is saved separately.</p>{replay && !progress.complete && <button className={styles.lightButton} onClick={() => store(newReplay(Date.now() - REPLAY_DURATION_MS))}>Reveal prepared game now</button>}<button className={styles.lightButton} onClick={resetReplay}>Reset replay</button></details></section>
      <section className={styles.books} aria-labelledby="books-title"><div className={styles.sectionTitle}><h2 id="books-title">On your shelf</h2><span>{progress.complete ? "2 games" : "1 game"}</span></div>
        <article className={styles.bookGame}><div className={styles.misfitCover} aria-hidden="true"><span>THE DESIGN OF<br />EVERYDAY THINGS</span><div className={styles.doorDrawing}><i /><b /></div><strong>The City of<br />Misfit Things</strong><small>EVERY OBJECT TELLS A STORY.</small></div><div className={styles.gameInfo}><p className={styles.eyebrow}>Don Norman / interactive museum</p><h3>The City of Misfit Things</h3><p>A city of objects that invite the wrong action. Explore, repair, and discover why everyday design matters.</p><span>Six exhibits · saved progress</span><button onClick={() => showScreen("misfit")}>Enter the city →</button></div></article>
        {progress.complete ? <article className={styles.bookGame}><div className={styles.printCover} aria-hidden="true"><span>THE NON-DESIGNER’S<br />DESIGN BOOK</span><div className={styles.typeDrawing}>Aa<span>•</span></div><strong>The Last<br />Print Shop</strong><small>MAKE THE TOWN MAKE SENSE.</small></div><div className={styles.gameInfo}><p className={styles.eyebrow}>Robin Williams / 3D workshop</p><h3>The Last Print Shop</h3><p>Opening night is almost here. Rescue the town’s menus, notices, and tickets—one principle at a time.</p><span>Five 3D print stations · saved progress</span><button onClick={() => showScreen("print-shop")}>Open the print shop →</button></div></article> : <div className={styles.waiting}><span>02</span><p>{replay ? "A new world is taking shape." : "Your next design book belongs here."}</p></div>}
      </section>
    </div>
    <section id="how-it-works" className={styles.explanation}><p className={styles.eyebrow}>From a design idea to a playable decision</p><h2>How a book becomes a game.</h2><p>Start with the idea, choose a situation where it matters, then let the player change something and see the result. Each order in this prepared adaptation follows that path.</p><div className={styles.mapping}>{QUESTS.map((quest, index) => <article key={quest.id}><span>0{index + 1} / PDF {quest.pages}</span><h3>{quest.id === "final" ? "Put it together" : quest.id}</h3><p>{quest.takeaway}</p><strong>{quest.title}</strong><p>{quest.id === "proximity" ? "Change spacing on a café menu. A visible pause separates each dish, so the queue can order without help." : quest.id === "alignment" ? "Move three poster blocks onto a shared edge. The notice becomes one connected invitation." : quest.id === "repetition" ? "Carry one type and ink treatment across a ticket, flyer, and sign. Visitors recognise the festival." : quest.id === "contrast" ? "Change headline size, weight, and ink. A passer-by notices the event before its supporting details." : "Combine all four principles in the programme. The town gets one coherent guide to its evening."}</p></article>)}</div><details className={styles.authoring}><summary>What was prepared for this demo?</summary><p>This game was written and built in advance from the supplied fourth-edition PDF. The scenes, characters, and printed examples are original. The replay demonstrates the intended creation experience; its timing and workshop mechanics are prepared, rather than produced live by the current image-based generator.</p><p>The reusable Playable Books skill guides source reading, quest design, interactive experiments, separate saves, and verification. The book’s ideas determine the game’s setting and actions.</p><p>The 3D architecture, movement, and narration come from the existing Misfit Things project. Its movement controller credits the MIT-licensed <a href="https://github.com/SamG-Coder/ThreeMuseum">ThreeMuseum</a> source. Additional editor patterns reviewed: <a href="https://github.com/dostevskii/grid-system">Grid System</a> for data-driven print layouts, <a href="https://github.com/daybrush/moveable">Moveable</a> for alignment guides, and <a href="https://konvajs.org/docs/posts/canvas-undo-redo.html">Konva’s undo guide</a> for history stored as application data.</p></details></section>
    <footer className={styles.footer}>muses · Learn design by doing.<a href="/print-shop">Direct print-shop rehearsal →</a></footer>
  </main>;
}
