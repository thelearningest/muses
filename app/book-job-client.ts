import { isGamePackage, type GamePackage } from "./game-package";
import type { PublicBookJobStage } from "./lib/book-pipeline/contracts";
import type { RenderRequest } from "./lib/book-pipeline/visual-agent/schema";
import type { ExtractionPageRequest } from "./lib/book-pipeline/extraction/stage";
import { mapConcurrent } from "./lib/book-pipeline/parallel";

export type BookJobAdvanceResult = { outcome: string; completedBatches?: number; totalBatches?: number; verifiedQuests?: number; totalQuests?: number; renderRequests?: RenderRequest[]; sourceFingerprint?: string; request?: ExtractionPageRequest; requests?: ExtractionPageRequest[]; maxPages?: number };

export const RESUMABLE_JOB_KEY = "playable-books-active-job:v1";
export const BROWSER_IDENTITY_KEY = "playable-books-browser-identity:v1";
export const OCR_RECHECK_MS = 15_000;

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
    return parseResponse(await this.fetcher(`${this.origin}/api/book-jobs/${encodeURIComponent(job.jobId)}/advance`, { method: "POST", headers: this.headers(job, true), body: JSON.stringify({ retryConfirmed }) }));
  }

  async uploadVisualAsset(job: ResumableBookJob, asset: unknown): Promise<void> {
    await parseResponse(await this.fetcher(`${this.origin}/api/book-jobs/${encodeURIComponent(job.jobId)}/visual-assets`, { method: "PUT", headers: this.headers(job, true), body: JSON.stringify(asset) }));
  }

  async initializeExtraction(job: ResumableBookJob, manifest: { sourceFingerprint: string; pageCount: number }): Promise<void> {
    await parseResponse(await this.fetcher(`${this.origin}/api/book-jobs/${encodeURIComponent(job.jobId)}/extraction`, { method: "POST", headers: this.headers(job, true), body: JSON.stringify(manifest) }));
  }

  async uploadExtractionAsset(job: ResumableBookJob, asset: unknown): Promise<void> {
    await parseResponse(await this.fetcher(`${this.origin}/api/book-jobs/${encodeURIComponent(job.jobId)}/extraction`, { method: "PUT", headers: this.headers(job, true), body: JSON.stringify(asset) }));
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
  const prepared = new Set<string>();
  let preparationTotal = 0;
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
    if (action === "pause") return "paused";
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
        if (error instanceof TypeError && ++connectionRecoveries <= 2) {
          await sleep(500, input.signal);
          continue;
        }
        if (error instanceof BookJobClientError && error.status === 409) {
          const latest = await input.client.status(input.job);
          if (input.signal.aborted) return "aborted";
          input.onStatus(latest);
          if (latest.stage === "interrupted") return "paused";
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
          const remaining = requests.filter((request) => !prepared.has(key(request)));
          preparationTotal = Math.max(preparationTotal, prepared.size + remaining.length);
          input.onPreparationProgress?.({ completedPages: prepared.size, totalPages: preparationTotal });
          // Keep enough uploads in flight to hide hosted R2/database latency.
          // Each compact page is bounded to 192 KiB; eight remain modest for a browser.
          if (remaining.length) preparation = mapConcurrent(remaining, 8, async (request) => {
            if (input.signal.aborted) return;
            await input.prepareExtractionPage!(request, advanced.sourceFingerprint!);
            prepared.add(key(request));
            input.onPreparationProgress?.({ completedPages: prepared.size, totalPages: preparationTotal });
          }).then(() => { preparation = undefined; }, (error) => { preparationError = error; preparation = undefined; });
          // The batch stage deliberately starts one model wave only after all
          // requested packets exist. Wait here instead of repeatedly scanning
          // hundreds of R2 keys while the browser is still uploading them.
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
