import { describe, expect, it, vi } from "vitest";
import { runVisualStage, VISUAL_STATE_PATH, type VisualStore } from "../../app/lib/book-pipeline/visual-agent/stage";
import { validateVisualAsset } from "../../app/lib/book-pipeline/visual-agent/assets";
import { driveBookJob } from "../../app/book-job-client";
import type { CanonicalBook } from "../../app/lib/book-pipeline/contracts";
import type { VisualState } from "../../app/lib/book-pipeline/visual-agent/schema";

function memoryStore() {
  const values = new Map<string, { value: unknown; version: number }>();
  const store: VisualStore = {
    getJson: async <T,>(_job: string, path: string) => structuredClone(values.get(path)?.value ?? null) as T | null,
    putJson: async (_job, path, value) => { values.set(path, { value: structuredClone(value), version: (values.get(path)?.version ?? 0) + 1 }); },
    putJsonIfAbsent: async (_job, path, value) => { if (values.has(path)) return false; values.set(path, { value: structuredClone(value), version: 1 }); return true; },
    getJsonVersion: async <T,>(_job: string, path: string) => { const data = values.get(path); return data ? { value: structuredClone(data.value) as T, etag: String(data.version) } : null; },
    putJsonVersion: async (_job, path, value, etag) => { const data = values.get(path); if (!data || String(data.version) !== etag) return false; values.set(path, { value: structuredClone(value), version: data.version + 1 }); return true; },
  };
  return { store, values };
}
const book: CanonicalBook = { schemaVersion: 1, source: { fingerprint: "source", filename: "fixture.pdf", pageCount: 1 }, pages: [{ index: 0, blockIds: [], visualReferences: [], warnings: [] }], blocks: [], warnings: [] };
async function setup() {
  const { store, values } = memoryStore();
  await store.putJson("job", "visual-agent/assets/thumbnail-0.json", { id: "thumbnail-0", width: 100, height: 100, hash: "hash", imageUrl: "data:image/png;base64,AA==", renderer: "fixture", rotation: 0 }, 10000);
  const response = { responseId: "id", data: { pages: [], reason: "No usable visual" }, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
  const provider = { generateStructured: vi.fn(async () => response) };
  const repository = { commitStage: vi.fn(async () => true), markRecoverable: vi.fn(async () => true), reserveProviderCost: vi.fn(async () => true), reconcileProviderCost: vi.fn(async () => true) };
  const input = { job: { id: "job", expiresAt: 10000, identityHash: "identity" }, book, cards: [], store, repository,
    provider: provider as unknown as Parameters<typeof runVisualStage>[0]["provider"],
    config: { model: "gpt-5.6-luna", plannedQuests: 0, maxMicros: 1000000, inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 }, maxPages: 12, maxCostUnits: 20000, now: 1 };
  return { input, values, provider, repository, response };
}
describe("visual persistence and website handoff", () => {
  it("does not double-dispatch concurrent paid work", async () => {
    const s = await setup();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    s.provider.generateStructured.mockImplementation(async () => { await ready; return s.response; });
    const first = runVisualStage(s.input);
    await vi.waitFor(() => expect(s.provider.generateStructured).toHaveBeenCalledOnce());
    const second = await runVisualStage(s.input);
    expect(second.outcome).toBe("waiting"); release(); await first;
    expect(s.provider.generateStructured).toHaveBeenCalledOnce();
    expect(s.repository.markRecoverable).not.toHaveBeenCalled();
  });
  it("replays a saved response after a crash before checkpoint commit", async () => {
    const s = await setup();
    const original = s.input.store.putJsonVersion;
    s.input.store.putJsonVersion = vi.fn().mockRejectedValueOnce(new Error("Simulated storage interruption")).mockImplementation(original);
    expect((await runVisualStage(s.input)).outcome).toBe("interrupted");
    expect((await runVisualStage(s.input)).outcome).toBe("advanced");
    expect(s.provider.generateStructured).toHaveBeenCalledOnce();
    expect((s.values.get(VISUAL_STATE_PATH)?.value as VisualState).step).toBe(1);
  });
  it("does not automatically retry an old uncertain attempt", async () => {
    const s = await setup();
    await s.input.store.putJson("job", "visual-agent/calls/0-0.attempt.json", { at: 1, reservedMicros: 1000, inputTokenBound: 10 }, 10000);
    expect((await runVisualStage({ ...s.input, now: 200 })).outcome).toBe("interrupted");
    expect(s.provider.generateStructured).not.toHaveBeenCalled();
    expect(s.repository.markRecoverable).toHaveBeenCalledWith("job", "annotating_visuals", "manual_retry_required", "manual_retry_required", 200);
  });
  it("explicit retry retains the worst-case prior spend", async () => {
    const s = await setup();
    await s.input.store.putJson("job", "visual-agent/calls/0-0.attempt.json", { at: 1, reservedMicros: 1000, inputTokenBound: 10 }, 10000);
    await runVisualStage({ ...s.input, now: 200, retryConfirmed: true });
    const state = s.values.get(VISUAL_STATE_PATH)?.value as VisualState;
    expect(state.usage.calls).toBe(2); expect(state.usage.estimatedMicros).toBeGreaterThan(1000);
  });
  it("validates ownership, dimensions and PNG envelope", async () => {
    const request = { id: "thumbnail-0", pageIndex: 0, box: null, revision: 0, kind: "thumbnail" as const };
    const value = { id: request.id, sourceFingerprint: "source", width: 1, height: 1, rotation: 0, renderer: "fixture", imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3eUAAAAASUVORK5CYII=" };
    expect((await validateVisualAsset(value, request, "source")).hash).toHaveLength(64);
    await expect(validateVisualAsset(value, request, "other")).rejects.toThrow(/mismatch/);
    await expect(validateVisualAsset({ ...value, width: 4000 }, request, "source")).rejects.toThrow();
    await expect(validateVisualAsset({ ...value, height: 2 }, request, "source")).rejects.toThrow(/dimensions/);
  });
  it("renders requested assets without creating another job", async () => {
    const controller = new AbortController(); const renderAssets = vi.fn(async () => { controller.abort(); });
    const requests = [{ id: "thumbnail-0", pageIndex: 0, kind: "thumbnail" as const, box: null, revision: 0 }];
    const result = await driveBookJob({ job: { jobId: "job", capabilityToken: "token", filename: "fixture.pdf", stage: "inspecting_visuals" },
      client: { status: vi.fn(async () => ({ jobId: "job", stage: "inspecting_visuals" as const, recoverable: false })), advance: vi.fn(async () => ({ outcome: "awaiting_assets", renderRequests: requests, sourceFingerprint: "source" })), acknowledge: vi.fn() },
      signal: controller.signal, onStatus: vi.fn(), saveGame: vi.fn(), clear: vi.fn(), sleep: vi.fn(), renderAssets });
    expect(result).toBe("aborted"); expect(renderAssets).toHaveBeenCalledWith(requests, "source");
  });
});
