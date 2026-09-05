import { isGamePackage, type GamePackage } from "./game-package";
import type { PublicBookJobStage } from "./lib/book-pipeline/contracts";
import type { RenderRequest } from "./lib/book-pipeline/visual-agent/schema";
import type { ExtractionPageRequest } from "./lib/book-pipeline/extraction/stage";
import { mapConcurrent } from "./lib/book-pipeline/parallel";
import { BrowserOperationError, browserOperation, waitUntilVisible } from "./browser-operations";

export type BookJobAdvanceResult = { outcome: string; completedBatches?: number; totalBatches?: number; verifiedQuests?: number; totalQuests?: number; renderRequests?: RenderRequest[]; sourceFingerprint?: string; request?: ExtractionPageRequest; requests?: ExtractionPageRequest[]; maxPages?: number };

export const RESUMABLE_JOB_KEY = "playable-books-active-job:v1";
export const BROWSER_IDENTITY_KEY = "playable-books-browser-identity:v1";
export const OCR_RECHECK_MS = 15_000;
// End the browser wait before the hosted request window can cancel the Worker.
// The durable stage lease and paid-call journal make the following status
// recheck safe even when the original response never reaches the browser.
export const ADVANCE_TIMEOUT_MS = 90_000;
export const PREPARATION_WAVE_SIZE = 32;

export type ResumableBookJob = {
  jobId: string;
  capabilityToken: string;
  filename: string;
  stage: PublicBookJobStage;
};

export type BookJobStatusResponse = {
  jobId: string;
  stage: PublicBookJobStage;
  resumeStage?: PublicBookJobStage;
  recoverable: boolean;
  progress?: { completedUnits?: number; totalUnits?: number; unit?: "pages" | "quests" };
  error?: { code: string; message: string } | null;
  game?: unknown;
};

export type BookPreparationProgress = { completedPages: number; totalPages: number };

async function withNetworkDeadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new DOMException("The request took too long.", "TimeoutError")), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class BookJobClientError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "BookJobClientError";
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } } & T;
  if (!response.ok) throw new BookJobClientError(body.error?.code ?? "request_failed", body.error?.message ?? "The request could not be completed.", response.status);
  return body;
}

export function createBrowserIdentity(storage: Pick<Storage, "getItem" | "setItem">): string {
  const existing = storage.getItem(BROWSER_IDENTITY_KEY);
  if (existing && existing.length >= 16) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  storage.setItem(BROWSER_IDENTITY_KEY, value);
  return value;
}

export async function fingerprintFile(file: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function loadResumableJob(storage: Pick<Storage, "getItem">): ResumableBookJob | null {
  try {
    const value = JSON.parse(storage.getItem(RESUMABLE_JOB_KEY) ?? "null") as Partial<ResumableBookJob> | null;
    return value && typeof value.jobId === "string" && typeof value.capabilityToken === "string" && typeof value.filename === "string" && typeof value.stage === "string"
      ? value as ResumableBookJob
      : null;
  } catch { return null; }
}

export function saveResumableJob(storage: Pick<Storage, "setItem">, job: ResumableBookJob): void {
  storage.setItem(RESUMABLE_JOB_KEY, JSON.stringify({ jobId: job.jobId, capabilityToken: job.capabilityToken, filename: job.filename, stage: job.stage }));
}

export class BookJobClient {
  // Browser fetch must not receive the client instance as its `this` receiver.
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args), private readonly origin = "") {}

  private headers(job: ResumableBookJob, mutation = false): HeadersInit {
    return { authorization: `Bearer ${job.capabilityToken}`, ...(mutation ? { "content-type": "application/json" } : {}) };
  }

  private async uploadJson(job: ResumableBookJob, path: string, body: unknown, signal = new AbortController().signal, phase = "Uploading a prepared image"): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        signal.throwIfAborted();
        await browserOperation({ signal, phase, milliseconds: 30_000,
          run: async (attemptSignal) => parseResponse(await this.fetcher(`${this.origin}${path}`, {
            method: "PUT", headers: this.headers(job, true), body: JSON.stringify(body), signal: attemptSignal,
          })),
        });
        return;
      } catch (error) {
        if (signal.aborted) throw error;
        const retryable = error instanceof TypeError || error instanceof BrowserOperationError || (error instanceof BookJobClientError && [429, 502, 503, 504].includes(error.status)) || (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name));
        if (!retryable || attempt === 2) throw error;
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  async create(input: { file: File; rightsConfirmed: true; browserToken: string; turnstileToken: string }): Promise<ResumableBookJob> {
    const response = await this.fetcher(`${this.origin}/api/book-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: input.file.name, mimeType: "application/pdf", byteSize: input.file.size, sourceFingerprint: await fingerprintFile(input.file), browserToken: input.browserToken, turnstileToken: input.turnstileToken, rightsConfirmed: input.rightsConfirmed }),
    });
    const created = await parseResponse<{ jobId: string; capabilityToken: string }>(response);
    return { ...created, filename: input.file.name, stage: "uploading" };
  }

  async upload(job: ResumableBookJob, file: File): Promise<void> {
    await parseResponse<Record<string, never>>(await this.fetcher(`${this.origin}/api/book-jobs/${encodeURIComponent(job.jobId)}/source`, { method: "PUT", headers: { authorization: `Bearer ${job.capabilityToken}`, "content-type": "application/pdf" }, body: file }));
  }

  async status(job: ResumableBookJob): Promise<BookJobStatusResponse> {
    return parseResponse(await this.fetcher(`${this.origin}/api/book-jobs/${encodeURIComponent(job.jobId)}`, { headers: this.headers(job) }));
  }

  async advance(job: ResumableBookJob, retryConfirmed = false): Promise<BookJobAdvanceResult> {
    return parseResponse(await withNetworkDeadline(this.fetcher(`${this.origin}/api/book-jobs/${encodeURIComponent(job.jobId)}/advance`, {
      method: "POST", headers: this.headers(job, true), body: JSON.stringify({ retryConfirmed }), signal: AbortSignal.timeout(ADVANCE_TIMEOUT_MS),
    }), ADVANCE_TIMEOUT_MS));
  }

  async uploadVisualAsset(job: ResumableBookJob, asset: unknown, signal?: AbortSignal): Promise<void> {
    await this.uploadJson(job, `/api/book-jobs/${encodeURIComponent(job.jobId)}/visual-assets`, asset, signal);
  }

  async initializeExtraction(job: ResumableBookJob, manifest: { sourceFingerprint: string; pageCount: number }, signal = new AbortController().signal): Promise<void> {
    await browserOperation({ signal, phase: "Saving the PDF page count", milliseconds: 30_000,
      run: async (attemptSignal) => parseResponse(await this.fetcher(`${this.origin}/api/book-jobs/${encodeURIComponent(job.jobId)}/extraction`, { method: "POST", headers: this.headers(job, true), body: JSON.stringify(manifest), signal: attemptSignal })),
    });
  }

  async uploadExtractionAsset(job: ResumableBookJob, asset: unknown, signal?: AbortSignal): Promise<void> {
    const page = asset && typeof asset === "object" && "pageIndex" in asset && typeof asset.pageIndex === "number" ? asset.pageIndex + 1 : undefined;
    await this.uploadJson(job, `/api/book-jobs/${encodeURIComponent(job.jobId)}/extraction`, asset, signal, page ? `Uploading PDF page ${page}` : "Uploading a prepared page");
  }

  async skipExtractionAsset(job: ResumableBookJob, request: ExtractionPageRequest, sourceFingerprint: string, signal?: AbortSignal): Promise<void> {
    await this.uploadJson(job, `/api/book-jobs/${encodeURIComponent(job.jobId)}/extraction`, {
      sourceFingerprint, pageIndex: request.pageIndex, revision: request.revision,
      nativeText: "", orderReliable: false, images: [], skipped: true,
    }, signal);
  }

  async acknowledge(job: ResumableBookJob): Promise<void> {
    const response = await this.fetcher(`${this.origin}/api/book-jobs/${encodeURIComponent(job.jobId)}/acknowledge`, { method: "POST", headers: this.headers(job, true), body: "{}" });
    if (!response.ok) await parseResponse(response);
  }

  async cancel(job: ResumableBookJob): Promise<void> {
    const response = await this.fetcher(`${this.origin}/api/book-jobs/${encodeURIComponent(job.jobId)}`, { method: "DELETE", headers: this.headers(job, true), body: "{}" });
    if (!response.ok) await parseResponse(response);
  }
}

export function nextJobAction(status: BookJobStatusResponse, now: number, lastAdvanceAt: number): "advance" | "wait" | "pause" | "complete" | "clear" {
  if (status.stage === "ready") return "complete";
  if (["cancelled", "capacity_reached", "failed", "cleaned"].includes(status.stage)) return "clear";
  if (status.stage === "interrupted") return "pause";
  if (status.stage === "waiting_for_ocr" && now - lastAdvanceAt < OCR_RECHECK_MS) return "wait";
  return "advance";
}

export async function persistValidGameThenAcknowledge(input: { status: BookJobStatusResponse; job: ResumableBookJob; saveGame(game: GamePackage): void | Promise<void>; acknowledge(job: ResumableBookJob): Promise<void>; clear(): void }): Promise<GamePackage> {
  if (!isGamePackage(input.status.game)) throw new BookJobClientError("invalid_game", "The generated game failed local validation.", 502);
  await input.saveGame(input.status.game);
  await input.acknowledge(input.job);
  input.clear();
  return input.status.game;
}

export async function cancelAndClear(input: { job: ResumableBookJob; cancel(job: ResumableBookJob): Promise<void>; storage: Pick<Storage, "removeItem">; clear(): void }): Promise<void> {
  try { await input.cancel(input.job); }
  finally {
    input.storage.removeItem(RESUMABLE_JOB_KEY);
    input.clear();
  }
}

export async function driveBookJob(input: {
  job: ResumableBookJob;
  client: Pick<BookJobClient, "status" | "advance" | "acknowledge">;
  signal: AbortSignal;
  onStatus(status: BookJobStatusResponse): void;
  saveGame(game: GamePackage): void | Promise<void>;
  clear(): void;
  sleep?(milliseconds: number, signal: AbortSignal): Promise<void>;
  now?(): number;
  renderAssets?(requests: RenderRequest[], sourceFingerprint: string): Promise<void>;
  prepareExtractionManifest?(sourceFingerprint: string, maxPages: number): Promise<void>;
  prepareExtractionPage?(request: ExtractionPageRequest, sourceFingerprint: string): Promise<void>;
  onPreparationProgress?(progress: BookPreparationProgress): void;
}): Promise<"complete" | "paused" | "cleared" | "aborted"> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((milliseconds, signal) => new Promise<void>((resolve) => {
    const finish = () => { window.clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = window.setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  }));
  let lastAdvanceAt = 0;
  let preparation: Promise<void> | undefined;
  let preparationError: unknown;
  let connectionRecoveries = 0;
  const automaticPaidRecoveries = new Set<string>();
  const prepared = new Set<string>();
  const preparationFailures = new Map<string, unknown>();
  let preparationTotal = 0;
  const automaticallyRecover = async (status: BookJobStatusResponse) => {
    if (status.error?.code !== "manual_retry_required") return false;
    const stage = status.resumeStage ?? "unknown";
    if (automaticPaidRecoveries.has(stage)) return false;
    automaticPaidRecoveries.add(stage);
    await input.client.advance(input.job, true);
    lastAdvanceAt = now();
    await sleep(0, input.signal);
    return true;
  };
  try {
  while (!input.signal.aborted) {
    if (preparationError) throw preparationError;
    let progressed = false;
    let status: BookJobStatusResponse;
    try { status = await input.client.status(input.job); }
    catch (error) {
      if (!(error instanceof TypeError) || ++connectionRecoveries > 2) throw error;
      await sleep(500, input.signal);
      continue;
    }
    if (input.signal.aborted) return "aborted";
    input.onStatus(status);
    const action = nextJobAction(status, now(), lastAdvanceAt);
    if (action === "complete") {
      await persistValidGameThenAcknowledge({ status, job: input.job, saveGame: input.saveGame, acknowledge: (job) => input.client.acknowledge(job), clear: input.clear });
      return "complete";
    }
    if (action === "pause") {
      // The server journals every paid call and admits at most one confirmed
      // retry for the same operation. Use that bounded recovery automatically
      // so a transient hosted timeout does not make the learner babysit a job.
      // A second interruption still pauses for explicit operator review.
      if (await automaticallyRecover(status)) continue;
      return "paused";
    }
    if (action === "clear") {
      input.clear();
      if (status.stage === "failed" || status.stage === "capacity_reached") throw new BookJobClientError(status.error?.code ?? "job_failed", status.error?.message ?? "This book could not be processed safely.", 422);
      return "cleared";
    }
    if (action === "advance") {
      let advanced: BookJobAdvanceResult;
      try { advanced = await input.client.advance(input.job); }
      catch (error) {
        if (input.signal.aborted) return "aborted";
        // A lost HTTP response is not permission to repeat a paid provider call.
        // Re-read status first: the server's stage ownership/journal determines
        // whether work is waiting, completed, replayable, or needs explicit retry.
        if ((error instanceof TypeError || (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name))) && ++connectionRecoveries <= 2) {
          await sleep(500, input.signal);
          continue;
        }
        if (error instanceof BookJobClientError && error.status === 409) {
          const latest = await input.client.status(input.job);
          if (input.signal.aborted) return "aborted";
          input.onStatus(latest);
          if (latest.stage === "interrupted") {
            if (await automaticallyRecover(latest)) continue;
            return "paused";
          }
        }
        throw error;
      }
      lastAdvanceAt = now();
      progressed = !["waiting", "inactive"].includes(advanced.outcome);
      if (input.signal.aborted) return "aborted";
      if (advanced.outcome === "awaiting_extraction_manifest") {
        if (!input.prepareExtractionManifest || !advanced.sourceFingerprint || !advanced.maxPages) throw new BookJobClientError("source_file_needed", "Select the same PDF to continue reading it.", 409);
        await input.prepareExtractionManifest(advanced.sourceFingerprint, advanced.maxPages);
      }
      if (advanced.outcome === "awaiting_extraction_assets") {
        const requests = advanced.requests ?? (advanced.request ? [advanced.request] : []);
        if (!input.prepareExtractionPage || !requests.length || requests.length > 300 || !advanced.sourceFingerprint) throw new BookJobClientError("source_file_needed", "Select the same PDF to continue reading it.", 409);
        // Keep preparing subsequent pages while the server reads ready groups.
        // A stale missing-assets response must not render an uploaded page again.
        if (!advanced.requests) {
          // Legacy extraction is cursor-driven and must finish this page first.
          await input.prepareExtractionPage(requests[0], advanced.sourceFingerprint);
        } else if (!preparation) {
          const key = (request: ExtractionPageRequest) => `${request.pageIndex}:${request.revision}`;
          const missing = requests.filter((request) => !prepared.has(key(request)));
          const remaining = missing.filter((request) => !preparationFailures.has(key(request)));
          if (!remaining.length && missing.length) throw preparationFailures.get(key(missing[0]));
          preparationTotal = Math.max(preparationTotal, prepared.size + remaining.length);
          input.onPreparationProgress?.({ completedPages: prepared.size, totalPages: preparationTotal });
          // Persist progress in bounded waves. This lets the server confirm each
          // group instead of making one slow/bad page hold hundreds of uploads.
          const wave = remaining.slice(0, PREPARATION_WAVE_SIZE);
          if (wave.length) preparation = mapConcurrent(wave, 8, async (request) => {
            if (input.signal.aborted) return;
            await waitUntilVisible(input.signal);
            // The renderer and uploader own separate, cancellable phase deadlines.
            // A queued render must not spend its timeout waiting behind other pages.
            try { await input.prepareExtractionPage!(request, advanced.sourceFingerprint!); }
            catch (error) {
              if (!input.signal.aborted) preparationFailures.set(key(request), error);
              return;
            }
            if (input.signal.aborted) return;
            prepared.add(key(request));
            input.onPreparationProgress?.({ completedPages: prepared.size, totalPages: preparationTotal });
          }).then(() => { preparation = undefined; }, (error) => { preparationError = error; preparation = undefined; });
          // Re-enter the durable stage after each wave so confirmed uploads are
          // resumable and the UI never waits on a single all-pages barrier.
          await preparation;
          if (preparationError) throw preparationError;
        }
      }
      if (advanced.outcome === "awaiting_assets") {
        if (!input.renderAssets || !advanced.renderRequests || !advanced.sourceFingerprint) throw new BookJobClientError("source_file_needed", "Select the same PDF to continue inspecting its images.", 409);
        await input.renderAssets(advanced.renderRequests, advanced.sourceFingerprint);
      }
    }
    // Yield to the browser after useful work, but only back off when waiting.
    // A fixed per-step sleep added minutes to otherwise healthy book jobs.
    await sleep(preparation ? 500 : progressed ? 0 : status.stage === "waiting_for_ocr" ? 5_000 : 1_200, input.signal);
  }
  return "aborted";
  } finally {
    // Renderer ownership belongs to the caller; do not let it be destroyed
    // while an already-started page preparation still uses the document.
    await preparation;
  }
}
