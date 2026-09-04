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

  it("pauses a manual retry without creating or advancing a different job", async () => {
    const advance = vi.fn();
    const result = await driveBookJob({
      job, client: { status: vi.fn(async () => ({ jobId: job.jobId, stage: "interrupted" as const, recoverable: true, error: { code: "manual_retry_required", message: "Review and retry." } })), advance, acknowledge: vi.fn() },
      signal: new AbortController().signal, onStatus: vi.fn(), saveGame: vi.fn(), clear: vi.fn(), sleep: vi.fn(),
    });
    expect(result).toBe("paused");
    expect(advance).not.toHaveBeenCalled();
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
