"use client";

import { useEffect, useRef, useState } from "react";
import { matchesFixture, newReplay, replayProgress, REPLAY_SAVE_KEY, REPLAY_STAGES, restoreReplay, type Replay } from "./replay";
import styles from "./PreparedBook.module.css";

export function usePreparedBookReplay(onReady: () => void) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [now, setNow] = useState(0);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");
  const attempt = useRef(0);
  const mounted = useRef(false);
  const autoOpen = useRef(false);
  const checkingFile = useRef(false);

  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => {
      if (!mounted.current) return;
      try {
        const time = Date.now();
        const saved = restoreReplay(localStorage.getItem(REPLAY_SAVE_KEY), time);
        autoOpen.current = !!saved && !replayProgress(saved, time).complete;
        setNow(time); setReplay(saved);
      } catch { setNotice("Prepared demo progress stays in this tab because browser storage is unavailable."); }
    });
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!replay) return;
    const timer = window.setInterval(() => {
      const time = Date.now(); setNow(time);
      if (replayProgress(replay, time).complete) {
        window.clearInterval(timer);
        if (autoOpen.current) { autoOpen.current = false; onReady(); }
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [replay, onReady]);

  function store(next: Replay | null) {
    try {
      if (next) localStorage.setItem(REPLAY_SAVE_KEY, JSON.stringify(next));
      else localStorage.removeItem(REPLAY_SAVE_KEY);
      setNotice("");
    } catch { setNotice("Prepared demo progress stays in this tab because browser storage is unavailable."); }
    setNow(Date.now()); setReplay(next);
  }

  function startPrepared() {
    if (checkingFile.current) return;
    autoOpen.current = true;
    void import("../print-shop/PrintShop");
    store(newReplay(Date.now()));
  }

  async function selectFile(file: File): Promise<boolean> {
    if (checkingFile.current) return false;
    const currentAttempt = ++attempt.current;
    checkingFile.current = true; setChecking(true); setNotice("");
    try {
      const matched = await matchesFixture(file);
      if (!mounted.current || attempt.current !== currentAttempt) return false;
      if (matched) {
        autoOpen.current = true;
        void import("../print-shop/PrintShop");
        store(newReplay(Date.now()));
      }
      return matched;
    } catch {
      if (mounted.current && attempt.current === currentAttempt) setNotice("The PDF could not be checked. Select it again, or use the prepared demo below.");
      return false;
    } finally {
      checkingFile.current = false;
      if (mounted.current && attempt.current === currentAttempt) setChecking(false);
    }
  }

  function reset() {
    attempt.current++; autoOpen.current = false; setChecking(false); store(null);
  }

  const progress = replayProgress(replay, now);
  return { replay, progress, checking, notice, running: !!replay && !progress.complete, selectFile, startPrepared, reset };
}

export function PreparedBookProgress({ percent, stage, onCancel }: { percent: number; stage: number; onCancel(): void }) {
  return <section className="job-progress" aria-labelledby="prepared-progress-title">
    <div className="job-progress-heading"><h3 id="prepared-progress-title">{REPLAY_STAGES[stage]}</h3></div>
    <p className="generation-filename">The Non-Designer’s Design Book · Robin Williams</p>
    <ol className="job-stage-list" aria-label="Prepared game stages">{REPLAY_STAGES.map((label, index) => <li key={label} aria-current={index === stage ? "step" : undefined} className={index < stage ? "is-complete" : index === stage ? "is-current" : ""}><span>{index < stage ? "✓" : `0${index + 1}`}</span><strong>{label}</strong></li>)}</ol>
    <div className="pipeline-progress"><div className="pipeline-progress-copy"><span>Creating your game</span><strong>{percent}% overall</strong></div><progress aria-label="Prepared game replay" max={100} value={percent} /></div>
    <p className="generation-note" role="status">The 3D print shop opens automatically when it is ready.</p>
    <p className="generation-note">Demo replay using a prepared game. Loading is staged; no live generation runs.</p>
    <div className="job-actions"><button className="text-button text-button-light" onClick={onCancel}>Cancel prepared demo</button></div>
  </section>;
}

export function PreparedBookBanner({ percent, complete, onLibrary, onOpen }: { percent: number; complete: boolean; onLibrary(): void; onOpen(): void }) {
  return <aside className={styles.banner} aria-label="Second book progress"><span>Prepared demo · {percent}%</span><strong>{complete ? "The Last Print Shop is ready" : "Your next design book is taking shape"}</strong><button onClick={complete ? onOpen : onLibrary}>{complete ? "Open your new game →" : "Back to library"}</button></aside>;
}
