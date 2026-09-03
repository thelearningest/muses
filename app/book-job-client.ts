import { isGamePackage, type GamePackage } from "./game-package";
import type { PublicBookJobStage } from "./lib/book-pipeline/contracts";

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
  recoverable: boolean;
  progress?: { completedUnits?: number; totalUnits?: number };
  error?: { code: string; message: string } | null;
  game?: unknown;
};

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
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly origin = "") {}

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

  async advance(job: ResumableBookJob): Promise<{ outcome: string; completedBatches?: number; totalBatches?: number; verifiedQuests?: number; totalQuests?: number }> {
    return parseResponse(await this.fetcher(`${this.origin}/api/book-jobs/${encodeURIComponent(job.jobId)}/advance`, { method: "POST", headers: this.headers(job, true), body: "{}" }));
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
}): Promise<"complete" | "paused" | "cleared" | "aborted"> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((milliseconds, signal) => new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
  }));
  let lastAdvanceAt = 0;
  while (!input.signal.aborted) {
    const status = await input.client.status(input.job);
    input.onStatus(status);
    const action = nextJobAction(status, now(), lastAdvanceAt);
    if (action === "complete") {
      await persistValidGameThenAcknowledge({ status, job: input.job, saveGame: input.saveGame, acknowledge: (job) => input.client.acknowledge(job), clear: input.clear });
      return "complete";
    }
    if (action === "pause") return "paused";
    if (action === "clear") { input.clear(); return "cleared"; }
    if (action === "advance") { await input.client.advance(input.job); lastAdvanceAt = now(); }
    await sleep(status.stage === "waiting_for_ocr" ? 5_000 : 1_200, input.signal);
  }
  return "aborted";
}
