"use client";

import { useEffect, useRef, useState } from "react";
import { Game } from "./Game";
import {
  BookJobClient,
  BookJobClientError,
  cancelAndClear,
  createBrowserIdentity,
  driveBookJob,
  loadResumableJob,
  RESUMABLE_JOB_KEY,
  saveResumableJob,
  type BookJobStatusResponse,
  type ResumableBookJob,
} from "./book-job-client";
import { isGamePackage, type GamePackage } from "./game-package";
import type { PublicBookJobStage } from "./lib/book-pipeline/contracts";

const LIBRARY_KEY = "design-book-rpg-library:v1";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? (process.env.NODE_ENV === "development" ? "1x00000000000000000000AA" : "");

const PIPELINE_STAGES: Array<{ stage: PublicBookJobStage; label: string }> = [
  { stage: "uploading", label: "Secure upload" },
  { stage: "preparing", label: "Prepare source" },
  { stage: "waiting_for_ocr", label: "Read scanned pages" },
  { stage: "reading_source", label: "Read book pages" },
  { stage: "extracting_evidence", label: "Extract evidence" },
  { stage: "building_learning_arc", label: "Build learning arc" },
  { stage: "inspecting_visuals", label: "Inspect key visuals" },
  { stage: "assembling_quests", label: "Assemble quest evidence" },
  { stage: "generating_game", label: "Write the game" },
  { stage: "verifying_game", label: "Verify every quest" },
  { stage: "ready", label: "Ready to play" },
];

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: { sitekey: string; callback(token: string): void; "expired-callback"(): void; "error-callback"(): void; theme: "dark" }): string;
      remove(widgetId: string): void;
      reset(widgetId: string): void;
    };
  }
}

function loadGames(): GamePackage[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LIBRARY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isGamePackage) : [];
  } catch { return []; }
}

function messageFor(error: unknown): string {
  if (!(error instanceof BookJobClientError)) return error instanceof Error ? error.message : "The book could not be transformed.";
  const messages: Record<string, string> = {
    identity_quota_reached: "This browser or network has reached its limit of 5 attempts in 24 hours.",
    global_capacity_reached: "Today’s 20-book capacity has been reached. Please try again tomorrow.",
    active_job_exists: "This browser already has a book in progress. Finish or cancel it first.",
    turnstile_failed: "The verification challenge expired. Please complete it again.",
    manual_retry_required: "The provider result was uncertain. Review the status, then retry this same job.",
    generation_disabled: "Book generation is temporarily paused.",
    invalid_game: "The result did not pass local validation and was not saved.",
  };
  return messages[error.code] ?? error.message;
}

function Turnstile({ onToken }: { onToken(token: string): void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !container.current) return;
    let widgetId = "";
    let cancelled = false;
    const render = () => {
      if (cancelled || widgetId || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
        theme: "dark",
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[src^="https://challenges.cloudflare.com/turnstile/"]');
    if (existing) existing.addEventListener("load", render, { once: true });
    else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render, { once: true });
      document.head.appendChild(script);
    }
    render();
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [onToken]);
  if (!TURNSTILE_SITE_KEY) return <p className="challenge-warning">Verification is not configured. Generation is unavailable.</p>;
  return <div className="turnstile-field" ref={container} aria-label="Human verification" />;
}

function JobProgress({ job, status, onRetry, onCancel }: { job: ResumableBookJob; status: BookJobStatusResponse | null; onRetry(): void; onCancel(): void }) {
  const stage = status?.stage ?? job.stage;
  const current = PIPELINE_STAGES.findIndex((item) => item.stage === stage);
  const interrupted = stage === "interrupted";
  return (
    <section className="job-progress" aria-live="polite" aria-labelledby="job-progress-title">
      <div className="job-progress-heading">
        <div><span className="eyebrow">Book in progress</span><h3 id="job-progress-title">{interrupted ? "Your work is paused" : PIPELINE_STAGES[current]?.label ?? "Preparing your book"}</h3></div>
        <span className="job-state">{interrupted ? "Needs attention" : "Processing"}</span>
      </div>
      <p className="generation-filename" title={job.filename}>{job.filename}</p>
      <ol className="job-stage-list" aria-label="Generation stages">
        {PIPELINE_STAGES.map((item, index) => (
          <li key={item.stage} className={index < current ? "is-complete" : index === current ? "is-current" : ""}>
            <span>{String(index + 1).padStart(2, "0")}</span><strong>{item.label}</strong>
          </li>
        ))}
      </ol>
      {status?.progress?.completedUnits !== undefined && <p className="job-counter">Completed unit {status.progress.completedUnits}{status.progress.totalUnits ? ` of ${status.progress.totalUnits}` : ""}</p>}
      {interrupted && <p className="job-interruption">{status?.error?.message ?? "The job can resume safely from its last completed stage."}</p>}
      {job.stage === "uploading" && <p className="job-interruption">The upload was interrupted before the source was secured. Cancel this job and choose the PDF again.</p>}
      <div className="job-actions">
        {interrupted && <button className="button button-primary" type="button" onClick={onRetry}>Retry this stage <span aria-hidden="true">→</span></button>}
        <button className="text-button text-button-light" type="button" onClick={onCancel}>Cancel and remove temporary files</button>
      </div>
    </section>
  );
}

export function BookRpgApp() {
  const [games, setGames] = useState<GamePackage[]>([]);
  const [selected, setSelected] = useState<GamePackage | "example" | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [activeJob, setActiveJob] = useState<ResumableBookJob | null>(null);
  const [jobStatus, setJobStatus] = useState<BookJobStatusResponse | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [driveVersion, setDriveVersion] = useState(0);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const clientRef = useRef(new BookJobClient());
  const sourceFile = useRef<File | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setGames(loadGames());
      setActiveJob(loadResumableJob(window.localStorage));
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const job = activeJob;
    if (!hydrated || !job || job.stage === "uploading") return;
    const controller = new AbortController();
    let rendererPromise: Promise<Awaited<ReturnType<typeof import("./visual-page-renderer").createVisualPageRenderer>>> | undefined;
    const rendererFor = async (fingerprint: string) => {
      if (!sourceFile.current) throw new Error("Select the same PDF below to continue processing it.");
      const file = sourceFile.current;
      rendererPromise ??= import("./visual-page-renderer").then(({ createVisualPageRenderer }) => createVisualPageRenderer(file));
      const renderer = await rendererPromise;
      if (renderer.fingerprint !== fingerprint) throw new Error("Select the same PDF used for this job.");
      return renderer;
    };
    void driveBookJob({
      job,
      client: clientRef.current,
      signal: controller.signal,
      prepareExtractionManifest: async (fingerprint, maxPages) => {
        const renderer = await rendererFor(fingerprint);
        if (renderer.pageCount > maxPages) throw new Error(`This PDF exceeds the ${maxPages}-page limit.`);
        if (!controller.signal.aborted) await clientRef.current.initializeExtraction(job, { sourceFingerprint: fingerprint, pageCount: renderer.pageCount });
      },
      prepareExtractionPage: async (request, fingerprint) => {
        const renderer = await rendererFor(fingerprint);
        if (controller.signal.aborted) return;
        const asset = await renderer.prepareExtraction(request, fingerprint);
        if (!controller.signal.aborted) await clientRef.current.uploadExtractionAsset(job, asset);
      },
      renderAssets: async (requests, fingerprint) => {
        const renderer = await rendererFor(fingerprint);
        for (const request of requests) {
          if (controller.signal.aborted) return;
          const asset = await renderer.render(request, fingerprint);
          if (controller.signal.aborted) return;
          await clientRef.current.uploadVisualAsset(job, asset);
        }
      },
      onStatus: (status) => {
        setJobStatus(status);
        saveResumableJob(window.localStorage, { ...job, stage: status.stage });
      },
      saveGame: (game) => {
        setGames((current) => {
          const next = [game, ...current.filter((item) => item.id !== game.id)];
          window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
          return next;
        });
        setSelected(game);
      },
      clear: () => {
        window.localStorage.removeItem(RESUMABLE_JOB_KEY);
        setActiveJob(null);
        setJobStatus(null);
      },
    }).catch((jobError) => { if (!controller.signal.aborted) setError(messageFor(jobError)); })
      .finally(async () => { const renderer = await rendererPromise?.catch(() => undefined); await renderer?.destroy(); });
    return () => controller.abort();
  }, [hydrated, activeJob, driveVersion]);

  const saveGames = (next: GamePackage[]) => {
    setGames(next);
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
  };

  const createGame = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Choose a PDF book to continue."); return; }
    sourceFile.current = file;
    if (!turnstileToken) { setError("Complete the verification challenge first."); return; }
    setIsStarting(true);
    setError("");
    let created: ResumableBookJob | null = null;
    try {
      created = await clientRef.current.create({ file, rightsConfirmed: true, browserToken: createBrowserIdentity(window.localStorage), turnstileToken });
      saveResumableJob(window.localStorage, created);
      setActiveJob(created);
      await clientRef.current.upload(created, file);
      const uploaded = { ...created, stage: "preparing" as const };
      saveResumableJob(window.localStorage, uploaded);
      setActiveJob(uploaded);
    } catch (startError) {
      if (created) {
        await clientRef.current.cancel(created).catch(() => undefined);
        window.localStorage.removeItem(RESUMABLE_JOB_KEY);
        setActiveJob(null);
      }
      setError(messageFor(startError));
    } finally { setIsStarting(false); }
  };

  const cancelJob = async () => {
    if (!activeJob) return;
    try {
      await cancelAndClear({
        job: activeJob,
        cancel: (job) => clientRef.current.cancel(job),
        storage: window.localStorage,
        clear: () => { setActiveJob(null); setJobStatus(null); },
      });
    } catch (cancelError) { setError(`${messageFor(cancelError)} Temporary cleanup will be retried automatically.`); }
  };

  const retryJob = async () => {
    if (!activeJob) return;
    setError("");
    try {
      if (jobStatus?.error?.code === "manual_retry_required" && !window.confirm("The previous model request may already have been charged. Retry it once within the remaining budget?")) return;
      await clientRef.current.advance(activeJob, true);
      setJobStatus(null);
      setDriveVersion((value) => value + 1);
    } catch (retryError) { setError(messageFor(retryError)); }
  };

  if (selected === "example") return <Game key="example" onExit={() => setSelected(null)} />;
  if (selected) return <Game key={selected.id} game={selected} onExit={() => setSelected(null)} />;

  return (
    <main className="library-shell" aria-busy={!hydrated || isStarting}>
      <header className="library-header"><div className="brand-mark"><span>Design learning lab</span><strong>Playable Books</strong></div><span className="intro-edition">Book → decisions → practice</span></header>
      <section className="library-hero">
        <div><span className="eyebrow">For designers who learn by doing</span><h1>Turn what you read into design decisions.</h1><p>Upload a PDF you have permission to use. We’ll find its strongest lessons, turn them into practical choices, and point every quest back to its source pages.</p></div>
        <div className="library-process" aria-label="Generation process"><span><strong>01</strong> Upload</span><span><strong>02</strong> Build</span><span><strong>03</strong> Practice</span></div>
      </section>
      <div className="library-grid">
        <section className="upload-panel" aria-labelledby="upload-title">
          <span className="eyebrow">Start here</span><h2 id="upload-title">Create a game from your book</h2>
          {activeJob ? <JobProgress job={activeJob} status={jobStatus} onRetry={() => void retryJob()} onCancel={() => void cancelJob()} /> : (
            <>
              <form onSubmit={createGame}>
                <label className="file-field"><span>PDF book</span><input ref={fileRef} type="file" accept="application/pdf,.pdf" required /><small>Scanned or text PDF · maximum 50 MB and 300 pages</small></label>
                <label className="rights-field"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} required /><span>I own this book or have permission to use it.</span></label>
                <Turnstile onToken={setTurnstileToken} />
                <button className="button button-primary" type="submit" disabled={!hydrated || !rightsConfirmed || !turnstileToken || isStarting}>{isStarting ? "Securing your upload…" : "Create my learning game"}<span aria-hidden="true">→</span></button>
              </form>
              <p className="generation-note">Limit: 5 attempts per browser or network in any 24 hours; 20 jobs site-wide each UTC day.</p>
              <p className="privacy-note">New books are processed temporarily by OpenAI; older jobs may also use Mistral. Recovery files are kept for no more than 24 hours, then removed. Finished games stay only on this device.</p>
            </>
          )}
          {activeJob && <label className="file-field"><span>Resume processing with the same PDF</span><input type="file" accept="application/pdf,.pdf" onChange={(event) => { sourceFile.current = event.target.files?.[0] ?? null; if (sourceFile.current) { setError(""); setDriveVersion((v) => v + 1); } }} /><small>Keep this page open while pages and images are being prepared. Reselecting the PDF resumes this job without repeating completed extraction.</small></label>}
          <p className="form-error" role="alert" aria-live="assertive">{error}</p>
        </section>
        <section className="game-library" aria-labelledby="library-title">
          <div className="library-section-heading"><div><span className="eyebrow">Pick up where you left off</span><h2 id="library-title">Your learning games</h2></div><span>{games.length + 1} available</span></div>
          <article className="game-card game-card-featured"><div><span className="game-card-kicker">Ready-to-play example · 6 quests</span><h3>The City of Misfit Things</h3><p>Repair a museum of misleading objects and learn the principles of human-centered design.</p></div><button className="button button-yellow" type="button" onClick={() => setSelected("example")}>Play example <span>→</span></button></article>
          {games.map((game) => <article className="game-card" key={game.id}><div><span className="game-card-kicker">Made from your book · {game.quests.length} quests</span><h3>{game.title}</h3><p>{game.subtitle}</p><small>From {game.sourceTitle}</small></div><div className="game-card-actions"><button className="button button-yellow" type="button" onClick={() => setSelected(game)}>Play <span>→</span></button><button className="text-button" type="button" onClick={() => { if (window.confirm(`Remove “${game.title}” from this device?`)) saveGames(games.filter((item) => item.id !== game.id)); }}>Remove</button></div></article>)}
        </section>
      </div>
    </main>
  );
}
