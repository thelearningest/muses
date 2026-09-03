import { describe, expect, it, vi } from "vitest";

import {
  cancelAndClear,
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
