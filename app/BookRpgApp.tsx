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
  type BookPreparationProgress,
  type ResumableBookJob,
} from "./book-job-client";
import { hasRequiredVisualQuests as hasPlayableVisuals, type GamePackage } from "./game-package";
import { loadGameLibrary, saveLibraryGame, removeLibraryGame } from "./game-library";
import type { PublicBookJobStage } from "./lib/book-pipeline/contracts";
import { overallPipelineProgress, pipelineUnitLabel } from "./pipeline-progress";

type VisualPageRendererModule = typeof import("./visual-page-renderer");
let visualPageRendererModulePromise: Promise<VisualPageRendererModule> | undefined;

function loadVisualPageRendererModule() {
  visualPageRendererModulePromise ??= import("./visual-page-renderer");
  return visualPageRendererModulePromise;
}

const PIPELINE_STAGES: Array<{ stage: PublicBookJobStage; label: string }> = [
  { stage: "uploading", label: "Uploading your book" },
  { stage: "preparing", label: "Opening your PDF" },
  { stage: "waiting_for_ocr", label: "Reading scanned pages" },
  { stage: "reading_source", label: "Reading your book" },
  { stage: "extracting_evidence", label: "Finding the key ideas" },
  { stage: "building_learning_arc", label: "Choosing what you’ll practice" },
  { stage: "inspecting_visuals", label: "Choosing illustrations" },
  { stage: "assembling_quests", label: "Planning your quests" },
  { stage: "generating_game", label: "Creating your adventure" },
  { stage: "verifying_game", label: "Checking answers against your book" },
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


function messageFor(error: unknown): string {
  if (!(error instanceof BookJobClientError)) return error instanceof Error ? error.message : "The book could not be transformed.";
  const messages: Record<string, string> = {
    identity_quota_reached: "You’ve reached the upload limit for this browser or shared network. Each attempt becomes available again 24 hours after it was used. You can still play your saved games below.",
    global_capacity_reached: "Today’s 20-book capacity has been reached. Please try again tomorrow.",
    active_job_exists: "This browser already has a book in progress. Finish or cancel it first.",
    turnstile_failed: "The verification challenge expired. Please complete it again.",
    manual_retry_required: "We couldn’t confirm that the last step finished. Your progress is saved. Choose Try again to continue.",
    generation_disabled: "Book generation is temporarily paused.",
    invalid_game: "We couldn’t save a playable game from this result. Please try again.",
  };
  return messages[error.code] ?? error.message;
}

function Turnstile({ onToken, siteKey }: { onToken(token: string): void; siteKey: string }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey || !container.current) return;
    let widgetId = "";
    let cancelled = false;
    const render = () => {
      if (cancelled || widgetId || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
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
  }, [onToken, siteKey]);
  if (!siteKey) return <p className="challenge-warning">Verification is not configured. Generation is unavailable.</p>;
  return <div className="turnstile-field" ref={container} aria-label="Human verification" />;
}

function JobProgress({ job, status, preparation, needsSourceFile, onSourceFile, onRetry, onCancel }: {
  job: ResumableBookJob; status: BookJobStatusResponse | null; needsSourceFile: boolean;
  preparation: BookPreparationProgress | null;
  onSourceFile(file: File): void; onRetry(): void; onCancel(): void;
}) {
  const stage = status?.stage ?? job.stage;
  const interrupted = stage === "interrupted";
  const effectiveStage = interrupted ? status?.resumeStage : stage;
  const current = PIPELINE_STAGES.findIndex((item) => item.stage === effectiveStage);
  const step = current < 0 ? -1 : current <= 1 ? 0 : current <= 6 ? 1 : current <= 8 ? 2 : 3;
  const steps = ["Upload", "Read your book", "Create quests", "Check answers"];
  const serverCompleted = status?.progress?.unit === "pages" ? status.progress.completedUnits ?? 0 : 0;
  const preparing = effectiveStage === "reading_source" && preparation && serverCompleted === 0;
  const preparationRatio = preparing && preparation.totalPages > 0 ? Math.min(1, preparation.completedPages / preparation.totalPages) : 0;
  const percent = preparing
    ? 8 + Math.round(preparationRatio * 20)
    : effectiveStage === "reading_source" && status?.progress?.unit === "pages" && status.progress.totalUnits
      ? 28 + Math.round(Math.min(1, serverCompleted / status.progress.totalUnits) * 30)
      : overallPipelineProgress(effectiveStage, status?.progress);
  const units = preparing
    ? `${preparation.completedPages} of ${preparation.totalPages} pages prepared`
    : pipelineUnitLabel(status?.progress);
  const activity = preparing
    ? preparation.completedPages < preparation.totalPages ? "Preparing pages" : "Reading prepared pages"
    : PIPELINE_STAGES[current]?.label ?? "Preparing your book";
  const progressLabel = interrupted ? `${activity} paused` : activity;
  return (
    <section className="job-progress" aria-live="polite" aria-labelledby="job-progress-title">
      <div className="job-progress-heading">
        <div><h3 id="job-progress-title">{interrupted ? "Let’s pick up where we left off" : PIPELINE_STAGES[current]?.label ?? "Preparing your book"}</h3></div>
      </div>
      <p className="generation-filename" title={job.filename}>{job.filename}</p>
      <ol className="job-stage-list" aria-label="Generation stages">
        {steps.map((label, index) => (
          <li key={label} aria-current={index === step ? "step" : undefined} className={index < step ? "is-complete" : index === step ? "is-current" : ""}>
            <span>{index < step ? "✓" : String(index + 1).padStart(2, "0")}</span><strong>{label}</strong>
          </li>
        ))}
      </ol>
      <div className="pipeline-progress">
        <div className="pipeline-progress-copy">
          <span>{progressLabel}</span>
          <strong>{units ? `${units} · ` : ""}{percent}% overall</strong>
        </div>
        <progress aria-label={`${progressLabel}, ${percent}% overall`} max={100} value={percent} />
      </div>
      <p className="generation-note">Keep this tab open while we prepare your game. This can take a few minutes.</p>
      {interrupted && <p className="job-interruption">Your completed steps are saved. Try again to continue from here.</p>}
      {needsSourceFile && (
        <label className="file-field resume-file">
          <span>Select the same PDF to resume</span>
          <input type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) onSourceFile(file); }} />
          <small>Choose {job.filename}. We’ll match it to the saved job and keep completed work.</small>
        </label>
      )}
      <div className="job-actions">
        {interrupted && <button className="button button-primary" type="button" disabled={needsSourceFile} onClick={onRetry}>Try again <span aria-hidden="true">→</span></button>}
        <button className="text-button text-button-light" type="button" onClick={onCancel}>Cancel upload</button>
      </div>
    </section>
  );
}

export function BookRpgApp({ turnstileSiteKey = "" }: { turnstileSiteKey?: string } = {}) {
  const [games, setGames] = useState<GamePackage[]>([]);
  const [selected, setSelected] = useState<GamePackage | "example" | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [activeJob, setActiveJob] = useState<ResumableBookJob | null>(null);
  const [jobStatus, setJobStatus] = useState<BookJobStatusResponse | null>(null);
  const [preparationProgress, setPreparationProgress] = useState<BookPreparationProgress | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [driveVersion, setDriveVersion] = useState(0);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const clientRef = useRef(new BookJobClient());
  const sourceFile = useRef<File | null>(null);

  useEffect(() => {
    const reloadKey = "playable-books:renderer-reload";
    void loadVisualPageRendererModule().then((module) => module.preloadVisualPageRenderer()).then(() => {
      window.sessionStorage.removeItem(reloadKey);
    }).catch(() => {
      visualPageRendererModulePromise = undefined;
      if (!window.sessionStorage.getItem(reloadKey)) {
        window.sessionStorage.setItem(reloadKey, "1");
        window.location.reload();
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadGameLibrary().then((saved) => {
      if (cancelled) return;
      setGames(saved);
      setActiveJob(loadResumableJob(window.localStorage));
      setHydrated(true);
    }).catch((error) => { if (!cancelled) setError(messageFor(error)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const job = activeJob;
    if (!hydrated || !job || job.stage === "uploading") return;
    const controller = new AbortController();
    let statusRequestActive = false;
    const applyStatus = (status: BookJobStatusResponse) => {
      if (controller.signal.aborted) return;
      setJobStatus(status);
      if (status.stage !== "interrupted") setError("");
      saveResumableJob(window.localStorage, { ...job, stage: status.stage });
    };
    const statusPoll = window.setInterval(() => {
      if (statusRequestActive || controller.signal.aborted) return;
      statusRequestActive = true;
      void clientRef.current.status(job).then(applyStatus).catch(() => undefined).finally(() => { statusRequestActive = false; });
    }, 1_500);
    let rendererPromise: Promise<Awaited<ReturnType<VisualPageRendererModule["createVisualPageRenderer"]>>> | undefined;
    const rendererFor = async (fingerprint: string) => {
      if (!sourceFile.current) throw new Error("Select the same PDF below to continue processing it.");
      const file = sourceFile.current;
      rendererPromise ??= loadVisualPageRendererModule().then(({ createVisualPageRenderer }) => createVisualPageRenderer(file));
      const renderer = await rendererPromise;
      if (renderer.fingerprint !== fingerprint) { sourceFile.current = null; throw new Error("That’s a different book. Choose the original PDF to continue."); }
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
        let lastRejected: BookJobClientError | undefined;
        for (const retry of [0, 1, 2, 3] as const) {
          if (controller.signal.aborted) return;
          const asset = await renderer.prepareExtraction(request, fingerprint, retry ? { retry } : undefined);
          if (controller.signal.aborted) return;
          try {
            await clientRef.current.uploadExtractionAsset(job, asset);
            return;
          } catch (error) {
            if (!(error instanceof BookJobClientError) || ![400, 413].includes(error.status) || controller.signal.aborted) throw error;
            lastRejected = error;
          }
        }
        // Batched extraction can safely abstain from one pathological page.
        // Recording the skip prevents a single rejected image from stranding
        // every other page in the book.
        if (request.compact && !controller.signal.aborted) {
          await clientRef.current.skipExtractionAsset(job, request, fingerprint);
          return;
        }
        throw lastRejected ?? new Error(`PDF page ${request.pageIndex + 1} could not be prepared.`);
      },
      onPreparationProgress: setPreparationProgress,
      renderAssets: async (requests, fingerprint) => {
        const renderer = await rendererFor(fingerprint);
        for (const request of requests) {
          if (controller.signal.aborted) return;
          const asset = await renderer.render(request, fingerprint);
          if (controller.signal.aborted) return;
          await clientRef.current.uploadVisualAsset(job, asset);
        }
      },
      onStatus: applyStatus,
      saveGame: async (game) => {
        await saveLibraryGame(game);
        setGames((current) => {
          const next = [game, ...current.filter((item) => item.id !== game.id)];
          return next;
        });
        setSelected(game);
      },
      clear: () => {
        window.localStorage.removeItem(RESUMABLE_JOB_KEY);
        setActiveJob(null);
        setJobStatus(null);
        setPreparationProgress(null);
      },
    }).catch((jobError) => { if (!controller.signal.aborted) setError(messageFor(jobError)); })
      .finally(async () => { window.clearInterval(statusPoll); const renderer = await rendererPromise?.catch(() => undefined); await renderer?.destroy(); });
    return () => { window.clearInterval(statusPoll); controller.abort(); };
  }, [hydrated, activeJob, driveVersion]);

  const removeGame = async (id: string) => {
    try { await removeLibraryGame(id); setGames((current) => current.filter((item) => item.id !== id)); }
    catch (error) { setError(messageFor(error)); }
  };

  const createGame = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Choose a PDF book to continue."); return; }
    sourceFile.current = file;
    if (!turnstileToken) { setError("Complete the verification challenge first."); return; }
    setIsStarting(true);
    setError("");
    setPreparationProgress(null);
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
        clear: () => { setActiveJob(null); setJobStatus(null); setPreparationProgress(null); },
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
      <header className="library-header"><div className="brand-mark"><span>Learn by playing</span><strong>Playable Books</strong></div><a className="library-jump" href="#library-title">Your games ↓</a></header>
      <section className="library-hero">
        <div><h1>Put your book into practice.</h1><p>Turn its key ideas into quests. Explore a problem, choose a solution, and learn why it works.</p></div>
      </section>
      <div className="library-grid">
        <section className="upload-panel" aria-labelledby="upload-title">
          <h2 id="upload-title">{activeJob ? "Your game is on its way" : "Start with a PDF"}</h2>
          {activeJob ? <JobProgress job={activeJob} status={jobStatus} preparation={preparationProgress} needsSourceFile={!sourceFile.current}
            onSourceFile={(file) => { sourceFile.current = file; setError(""); setDriveVersion((value) => value + 1); }}
            onRetry={() => void retryJob()} onCancel={() => void cancelJob()} /> : (
            <>
              <form onSubmit={createGame}>
                <label className="file-field"><span>Choose your book</span><input ref={fileRef} type="file" accept="application/pdf,.pdf" required /><small>PDF, up to 50 MB · 300 pages maximum. Scans work too.</small></label>
                <label className="rights-field"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} required /><span>I own this book or have permission to use it.</span></label>
                <Turnstile onToken={setTurnstileToken} siteKey={turnstileSiteKey} />
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="button button-primary" type="submit" disabled={!hydrated || !rightsConfirmed || !turnstileToken || isStarting}>{isStarting ? "Uploading your book…" : "Create my game"}<span aria-hidden="true">→</span></button>
                <p className="generation-note">Allow a few minutes. Keep this tab open until your game is ready.</p>
              </form>
              <details className="upload-details"><summary>Upload limits & privacy</summary><p>You can start up to 5 uploads in 24 hours per browser or shared network. The site accepts up to 20 books a day, resetting at midnight UTC.</p><p>Your book is sent to OpenAI for processing. Temporary files are removed within 24 hours; older uploads may also have used Mistral. Your finished games are saved in this browser.</p></details>
            </>
          )}
          {activeJob && error && <p className="form-error" role="alert">{error}</p>}
        </section>
        <section className="game-library" aria-labelledby="library-title">
          <div className="library-section-heading"><div><h2 id="library-title">Your games</h2><p className="library-hint">{games.length ? "Saved in this browser. Pick a game to start or continue." : "Your games will appear here. Try the demo while you choose a book."}</p></div></div>
          {games.map((game) => <article className="game-card" key={game.id}><div><span className="game-card-kicker">{game.quests.length} quests · {game.sourceTitle}</span><h3>{game.title}</h3><p>{game.subtitle}</p>{!hasPlayableVisuals(game) && <p>This older game has no visual exercises. Upload the same PDF above to create a new visual version.</p>}</div><div className="game-card-actions"><button className="button button-yellow" type="button" disabled={!hasPlayableVisuals(game)} onClick={() => setSelected(game)}>Open game <span aria-hidden="true">→</span></button><button className="text-button" type="button" aria-label={`Remove ${game.title}`} onClick={() => { if (window.confirm(`Remove “${game.title}” from this device?`)) void removeGame(game.id); }}>Remove</button></div></article>)}
          <article className="game-card game-card-featured"><div><span className="game-card-kicker">Demo · 6 quests · No upload needed</span><h3>The City of Misfit Things</h3><p>Fix everyday objects that confuse people, from misleading doors to puzzling controls.</p></div><button className="button button-secondary" type="button" onClick={() => setSelected("example")}>Try the demo <span aria-hidden="true">→</span></button></article>
        </section>
      </div>
    </main>
  );
}
