import { describe, expect, it, vi } from "vitest";

import {
  cancelAndClear,
  BookJobClient,
  BookJobClientError,
  driveBookJob,
  loadResumableJob,
  persistValidGameThenAcknowledge,
  RESUMABLE_JOB_KEY,
  saveResumableJob,
  type ResumableBookJob,
} from "../../app/book-job-client";
import type { GamePackage } from "../../app/game-package";

const job: ResumableBookJob = { jobId: "job-1", capabilityToken: "secret-capability", filename: "book.pdf", stage: "waiting_for_ocr" };

function game(): GamePackage {
  const choice = (id: string, correct: boolean) => ({ id, label: id, feedback: "Feedback", correct });
  const quest = (index: number) => ({
    id: `q${index}`, number: String(index + 1), title: `Quest ${index}`, gallery: `Lab ${index}`, story: "Story", objective: "Objective", clue: "Clue", artifact: "console" as const, xp: 100,
    observationTools: ["one", "two", "three"], diagnosis: [choice("a", true), choice("b", false), choice("c", false)], repairs: [choice("a", true), choice("b", false), choice("c", false)],
    principle: { name: `Principle ${index}`, summary: "Summary" }, visual: { mode: index ? "diagram" as const : "3d" as const, form: "console" as const, accent: "green" as const, title: `Visual ${index}`, problemLabel: `Problem ${index}`, repairLabel: `Repair ${index}`, elements: ["one", "two", "three"] as [string, string, string] }, sourceAnchors: [{ label: "Chapter", pageStart: index + 1, pageEnd: index + 1 }],
  });
  return { schemaVersion: 1, id: "game", sourceFilename: "book.pdf", generatedAt: "2026-09-03T00:00:00.000Z", sourceTitle: "Book", title: "Game", subtitle: "Learn", setting: "Lab", quests: Array.from({ length: 4 }, (_, index) => quest(index)) };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

describe("resumable book job client", () => {
  it("finishes healthy waves before exposing a failed page for resume", async () => {
    const requests = Array.from({ length: 40 }, (_, pageIndex) => ({ pageIndex, revision: 0, parts: 1 as const, allowNative: true, compact: true }));
    const uploaded = new Set<number>();
    const progress: number[] = [];
    const prepare = vi.fn(async (request: typeof requests[number]) => {
      if (request.pageIndex === 0) throw new Error("Rendering PDF page 1 timed out");
      uploaded.add(request.pageIndex);
    });
    await expect(driveBookJob({ job, signal: new AbortController().signal,
      client: {
        status: async () => ({ jobId: job.jobId, stage: "reading_source", recoverable: false }),
        advance: async () => ({ outcome: "awaiting_extraction_assets", requests: requests.filter((request) => !uploaded.has(request.pageIndex)), sourceFingerprint: "source" }),
        acknowledge: vi.fn(),
      }, prepareExtractionPage: prepare, onPreparationProgress: (value) => progress.push(value.completedPages),
      onStatus: vi.fn(), saveGame: vi.fn(), clear: vi.fn(), sleep: vi.fn(async () => undefined),
    })).rejects.toThrow("Rendering PDF page 1 timed out");
    expect(uploaded.size).toBe(39);
    expect(prepare).toHaveBeenCalledTimes(40);
    expect(progress.at(-1)).toBe(39);
  });

  it("cancels a stalled upload without retrying or accepting its late response", async () => {
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    let uploadSignal!: AbortSignal;
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      uploadSignal = init!.signal!;
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    const pending = new BookJobClient(fetcher as typeof fetch).uploadExtractionAsset(job, { pageIndex: 0 }, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    expect(uploadSignal.aborted).toBe(true);
    finish(Response.json({ accepted: true }));
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rechecks status after a dropped advance response and does not retry an uncertain paid call", async () => {
    const status = vi.fn().mockResolvedValueOnce({ jobId: job.jobId, stage: "reading_source", recoverable: false })
      .mockResolvedValueOnce({ jobId: job.jobId, stage: "interrupted", recoverable: true });
    const advance = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await driveBookJob({ job, client: { status, advance, acknowledge: vi.fn() }, signal: new AbortController().signal, onStatus: vi.fn(), saveGame: vi.fn(), clear: vi.fn(), sleep: vi.fn(async () => undefined) })).toBe("paused");
    expect(status).toHaveBeenCalledTimes(2);
    expect(advance).toHaveBeenCalledOnce();
  });
  it("finishes the requested preparation set before advancing again", async () => {
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const prepareExtractionPage = vi.fn(() => gate);
    const request = { pageIndex: 0, revision: 0, parts: 1 as const, allowNative: true, compact: true };
    const advance = vi.fn(async () => {
      if (advance.mock.calls.length === 2) {
        expect(prepareExtractionPage).toHaveBeenCalledOnce();
        controller.abort();
      }
      return { outcome: "awaiting_extraction_assets", requests: [request], sourceFingerprint: "source" };
    });
    const running = driveBookJob({ job, client: { status: vi.fn(async () => ({ jobId: job.jobId, stage: "reading_source" as const, recoverable: false })), advance, acknowledge: vi.fn() }, signal: controller.signal, onStatus: vi.fn(), saveGame: vi.fn(), clear: vi.fn(), prepareExtractionPage, sleep: vi.fn(async () => undefined) });
    await vi.waitFor(() => expect(prepareExtractionPage).toHaveBeenCalledOnce());
    expect(advance).toHaveBeenCalledOnce();
    release();
    expect(await running).toBe("aborted");
    expect(advance).toHaveBeenCalledTimes(2);
    expect(prepareExtractionPage).toHaveBeenCalledOnce();
  });
  it("reports only successfully uploaded page preparation", async () => {
    const controller = new AbortController();
    const onPreparationProgress = vi.fn();
    const requests = [0, 1, 2].map((pageIndex) => ({ pageIndex, revision: 0, parts: 1 as const, allowNative: true, compact: true }));
    const prepareExtractionPage = vi.fn(async () => undefined);
    let advances = 0;
    await driveBookJob({
      job,
      client: {
        status: vi.fn(async () => ({ jobId: job.jobId, stage: "reading_source" as const, recoverable: false })),
        advance: vi.fn(async () => { if (++advances === 2) controller.abort(); return { outcome: "awaiting_extraction_assets", requests, sourceFingerprint: "source" }; }),
        acknowledge: vi.fn(),
      },
      signal: controller.signal, onStatus: vi.fn(), saveGame: vi.fn(), clear: vi.fn(),
      prepareExtractionPage, onPreparationProgress, sleep: vi.fn(async () => undefined),
    });
    expect(onPreparationProgress).toHaveBeenNthCalledWith(1, { completedPages: 0, totalPages: 3 });
    expect(onPreparationProgress).toHaveBeenLastCalledWith({ completedPages: 3, totalPages: 3 });
  });
  it("prepares 299 pages with bounded concurrency and monotonic progress", async () => {
    const controller = new AbortController();
    const requests = Array.from({ length: 299 }, (_, pageIndex) => ({ pageIndex, revision: 0, parts: 1 as const, allowNative: true, compact: true }));
    let active = 0, peak = 0;
    const progress: number[] = [];
    const advance = vi.fn(async () => {
      if (advance.mock.calls.length > Math.ceil(requests.length / 32)) controller.abort();
      return { outcome: "awaiting_extraction_assets", requests, sourceFingerprint: "source" };
    });
    await driveBookJob({
      job,
      client: { status: vi.fn(async () => ({ jobId: job.jobId, stage: "reading_source" as const, recoverable: false })), advance, acknowledge: vi.fn() },
      signal: controller.signal, onStatus: vi.fn(), saveGame: vi.fn(), clear: vi.fn(),
      prepareExtractionPage: async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; },
      onPreparationProgress: ({ completedPages, totalPages }) => { expect(totalPages).toBe(299); progress.push(completedPages); },
      sleep: vi.fn(async () => undefined),
    });
    expect(peak).toBe(8);
    expect(advance).toHaveBeenCalledTimes(Math.ceil(requests.length / 32) + 1);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(299);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });
  it("surfaces a terminal extraction failure instead of silently removing the job", async () => {
    const clear = vi.fn();
    await expect(driveBookJob({ job, client: { status: vi.fn(async () => ({ jobId: job.jobId, stage: "failed" as const, recoverable: false, error: { code: "extraction_quality_insufficient", message: "Cannot read PDF page 6." } })), advance: vi.fn(), acknowledge: vi.fn() }, signal: new AbortController().signal, onStatus: vi.fn(), saveGame: vi.fn(), clear, sleep: vi.fn() })).rejects.toThrow("Cannot read PDF page 6.");
    expect(clear).toHaveBeenCalledOnce();
  });

  it("loads the paused status and retry controls after a stage returns HTTP 409", async () => {
    const status = vi.fn().mockResolvedValueOnce({ jobId: job.jobId, stage: "extracting_evidence", recoverable: false })
      .mockResolvedValueOnce({ jobId: job.jobId, stage: "interrupted", recoverable: true });
    const onStatus = vi.fn();
    expect(await driveBookJob({ job, client: { status, advance: vi.fn().mockRejectedValue(new BookJobClientError("request_failed", "Paused", 409)), acknowledge: vi.fn() }, signal: new AbortController().signal, onStatus, saveGame: vi.fn(), clear: vi.fn(), sleep: vi.fn() })).toBe("paused");
    expect(onStatus).toHaveBeenLastCalledWith({ jobId: job.jobId, stage: "interrupted", recoverable: true });
  });
  it("does not bind native browser fetch to the client instance", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      expect(this).not.toBeInstanceOf(BookJobClient);
      return Promise.resolve(Response.json({ jobId: job.jobId, stage: "reading_source", recoverable: false }));
    };
    try { expect((await new BookJobClient().status(job)).stage).toBe("reading_source"); }
    finally { globalThis.fetch = original; }
  });
  it("stops waiting for a hung advance request before the hosted cutoff", async () => {
    vi.useFakeTimers();
    try {
      const client = new BookJobClient(vi.fn(() => new Promise<Response>(() => undefined)));
      const pending = client.advance(job);
      const rejection = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(90_000);
      await rejection;
    } finally { vi.useRealTimers(); }
  });
  it.each(["extraction", "visual-assets"])("retries an idempotent %s asset upload after a transient network failure", async (kind) => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(Response.json({ accepted: true }));
    const client = new BookJobClient(fetcher);
    if (kind === "extraction") await client.uploadExtractionAsset(job, { pageIndex: 0 });
    else await client.uploadVisualAsset(job, { id: "asset" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toContain(`/api/book-jobs/${job.jobId}/${kind}`);
    expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it("records a batched page skip through the extraction endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ accepted: true }));
    await new BookJobClient(fetcher).skipExtractionAsset(job, { pageIndex: 7, revision: 0, parts: 1, allowNative: true, compact: true }, "source");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      sourceFingerprint: "source", pageIndex: 7, revision: 0, nativeText: "", orderReliable: false, images: [], skipped: true,
    });
  });
  it("prepares only the requested extraction manifest and page before resuming", async () => {
    const controller = new AbortController();
    const prepareExtractionManifest = vi.fn(async () => undefined), prepareExtractionPage = vi.fn(async () => undefined);
    const advance = vi.fn().mockResolvedValueOnce({ outcome: "awaiting_extraction_manifest", sourceFingerprint: "source", maxPages: 300 })
      .mockResolvedValueOnce({ outcome: "awaiting_extraction_assets", sourceFingerprint: "source", request: { pageIndex: 7, revision: 1, parts: 2, allowNative: false } });
    let sleeps = 0;
    await driveBookJob({ job, client: { status: vi.fn(async () => ({ jobId: job.jobId, stage: "reading_source" as const, recoverable: false })), advance, acknowledge: vi.fn() }, signal: controller.signal, onStatus: vi.fn(), saveGame: vi.fn(), clear: vi.fn(), prepareExtractionManifest, prepareExtractionPage, sleep: async (milliseconds) => { expect(milliseconds).toBe(0); if (++sleeps === 2) controller.abort(); } });
    expect(prepareExtractionManifest).toHaveBeenCalledWith("source", 300);
    expect(prepareExtractionPage).toHaveBeenCalledWith({ pageIndex: 7, revision: 1, parts: 2, allowNative: false }, "source");
    expect(advance).toHaveBeenCalledTimes(2);
  });

  it("does not render or upload after cancellation during advance", async () => {
    const controller = new AbortController(), prepareExtractionPage = vi.fn();
    const result = await driveBookJob({ job, client: { status: vi.fn(async () => ({ jobId: job.jobId, stage: "reading_source" as const, recoverable: false })), advance: vi.fn(async () => { controller.abort(); return { outcome: "awaiting_extraction_assets", sourceFingerprint: "source", request: { pageIndex: 0, revision: 0, parts: 1, allowNative: true } }; }), acknowledge: vi.fn() }, signal: controller.signal, onStatus: vi.fn(), saveGame: vi.fn(), clear: vi.fn(), prepareExtractionPage, sleep: vi.fn() });
    expect(result).toBe("aborted"); expect(prepareExtractionPage).not.toHaveBeenCalled();
  });
  it("polls status without advancing again while OCR is merely queued", async () => {
    const controller = new AbortController();
    const advance = vi.fn();
    const status = vi.fn(async () => ({ jobId: job.jobId, stage: "waiting_for_ocr" as const, recoverable: false }));
    await driveBookJob({
      job, client: { status, advance, acknowledge: vi.fn() }, signal: controller.signal, onStatus: vi.fn(), saveGame: vi.fn(), clear: vi.fn(), now: () => 10_000,
      sleep: async () => { controller.abort(); },
    });
    expect(status).toHaveBeenCalledOnce();
    expect(advance).not.toHaveBeenCalled();
  });

  it("restores exactly the same job after refresh", () => {
    const storage = memoryStorage();
    saveResumableJob(storage, job);
    expect(loadResumableJob(storage)).toEqual(job);
    expect(Object.keys(JSON.parse(storage.getItem(RESUMABLE_JOB_KEY)!))).toEqual(["jobId", "capabilityToken", "filename", "stage"]);
  });

  it("acknowledges only after a valid package is saved locally", async () => {
    const order: string[] = [];
    await persistValidGameThenAcknowledge({
      status: { jobId: job.jobId, stage: "ready", recoverable: false, game: game() }, job,
      saveGame: () => { order.push("save"); }, acknowledge: async () => { order.push("acknowledge"); }, clear: () => { order.push("clear"); },
    });
    expect(order).toEqual(["save", "acknowledge", "clear"]);
    const acknowledge = vi.fn();
    await expect(persistValidGameThenAcknowledge({ status: { jobId: job.jobId, stage: "ready", recoverable: false, game: {} }, job, saveGame: vi.fn(), acknowledge, clear: vi.fn() })).rejects.toThrow(/validation/i);
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("uses one bounded automatic recovery, then pauses without creating a different job", async () => {
    const advance = vi.fn();
    const result = await driveBookJob({
      job, client: { status: vi.fn(async () => ({ jobId: job.jobId, stage: "interrupted" as const, recoverable: true, error: { code: "manual_retry_required", message: "Review and retry." } })), advance, acknowledge: vi.fn() },
      signal: new AbortController().signal, onStatus: vi.fn(), saveGame: vi.fn(), clear: vi.fn(), sleep: vi.fn(),
    });
    expect(result).toBe("paused");
    expect(advance).toHaveBeenCalledOnce();
    expect(advance).toHaveBeenCalledWith(job, true);
  });

  it("keeps the server's quest-creation error when the bounded retry also returns 409", async () => {
    const paused = { jobId: job.jobId, stage: "interrupted" as const, resumeStage: "generating_game" as const,
      recoverable: true, error: { code: "manual_retry_required", message: "Quest creation was interrupted. Your book reading is saved." } };
    const onStatus = vi.fn();
    const advance = vi.fn().mockRejectedValue(new BookJobClientError("request_failed", "The request could not be completed.", 409));
    const status = vi.fn().mockResolvedValue(paused);
    expect(await driveBookJob({ job, client: { status, advance, acknowledge: vi.fn() }, signal: new AbortController().signal,
      onStatus, saveGame: vi.fn(), clear: vi.fn(), sleep: vi.fn() })).toBe("paused");
    expect(advance).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledTimes(2);
    expect(onStatus).toHaveBeenLastCalledWith(paused);
  });

  it("cancels the current job and always clears resumable local state", async () => {
    const storage = memoryStorage();
    saveResumableJob(storage, job);
    const clear = vi.fn();
    await cancelAndClear({ job, cancel: vi.fn(async () => undefined), storage, clear });
    expect(storage.getItem(RESUMABLE_JOB_KEY)).toBeNull();
    expect(clear).toHaveBeenCalledOnce();
  });
});
