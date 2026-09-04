import { describe, expect, it, vi } from "vitest";
import { questVisualImages, VisualQuestProvider } from "../../app/lib/book-pipeline/visual-agent/quest-provider";
import { VISUAL_STATE_PATH, type VisualStore } from "../../app/lib/book-pipeline/visual-agent/stage";
import type { VisualState } from "../../app/lib/book-pipeline/visual-agent/schema";
import type { QuestEvidenceContract } from "../../app/lib/book-pipeline/contracts";
import type { StructuredOutputProvider } from "../../app/lib/book-pipeline/providers/openai";

async function setup() {
  const values = new Map<string, { value: unknown; version: number }>();
  const store: VisualStore = {
    getJson: async <T,>(_job: string, path: string) => structuredClone(values.get(path)?.value ?? null) as T | null,
    putJson: async (_job, path, value) => { values.set(path, { value: structuredClone(value), version: (values.get(path)?.version ?? 0) + 1 }); },
    putJsonIfAbsent: async (_job, path, value) => { if (values.has(path)) return false; values.set(path, { value: structuredClone(value), version: 1 }); return true; },
    getJsonVersion: async <T,>(_job: string, path: string) => { const item = values.get(path); return item ? { value: structuredClone(item.value) as T, etag: String(item.version) } : null; },
    putJsonVersion: async (_job, path, value, etag) => { const item = values.get(path); if (!item || String(item.version) !== etag) return false; values.set(path, { value: structuredClone(value), version: item.version + 1 }); return true; },
  };
  const source = { pageStart: 0, pageEnd: 0, canonicalBlockIds: ["b0"] };
  const contract: QuestEvidenceContract = { id: "q0", conceptId: "grid", playerActions: ["compare"], sources: [source], confidence: 1, missingEvidence: [],
    visualAnnotations: [{ visualReferenceId: "v0", description: "Paired grid layouts", source,
      visualAgent: { candidateId: "v0", revision: 0, disposition: "reference_only", limitations: ["Small text is illegible"] } }] };
  const box = { x: 0, y: 0, width: 1, height: 1 };
  const state: VisualState = { schemaVersion: 1, promptVersion: "visual-v1", sourceFingerprint: "source", phase: "done", step: 5, pages: [0], queue: [], selectedIds: ["v0"], stopReason: "sampled_selection_complete",
    usage: { calls: 5, inputTokens: 100, outputTokens: 100, estimatedMicros: 100, reservedMicros: 0 },
    candidates: [{ id: "v0", pageIndex: 0, title: "Grid", concept: "grid", boxes: [box, box], evidenceIds: ["b0"], revision: 0, cropHashes: ["hash0", "hash1"],
      verdict: { disposition: "reference_only", evidenceIds: ["b0"], claims: [], reason: "Reference only" } }] };
  await store.putJson("job", VISUAL_STATE_PATH, state, 10000);
  for (let i = 0; i < 2; i++) await store.putJson("job", `visual-agent/assets/v0-r0-${i}-crop.json`, { id: `v0-r0-${i}-crop`, width: 300, height: 200, hash: `hash${i}`, imageUrl: `data:image/png;base64,${i}`, renderer: "fixture", rotation: 0 }, 10000);
  const response = { responseId: "r", data: { supported: true }, usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };
  const call = vi.fn(async () => response);
  const provider = new VisualQuestProvider({ generateStructured: call } as unknown as StructuredOutputProvider, store, { id: "job", expiresAt: 10000 },
    { model: "gpt-5.6-luna", plannedQuests: 0, maxMicros: 150000, inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 });
  const request = { model: "legacy", reasoningEffort: "none" as const, schemaName: "verified_quest", schema: {}, instructions: "Verify", safetyIdentifier: "identity", input: JSON.stringify({ evidenceContract: contract, quest: { question: "Which layout is aligned?" } }) };
  return { store, values, contract, state, call, provider, request };
}

describe("visual evidence RPG handoff", () => {
  it("preserves pairs and limitations while rejecting stale or missing crops", async () => {
    const s = await setup();
    const images = await questVisualImages(s.store, "job", [s.contract, s.contract]);
    expect(images).toHaveLength(2); expect(images[0].label).toContain("reference_only");
    expect(images[1].label).toContain("Small text is illegible");
    s.state.candidates[0].revision = 1;
    await s.store.putJson("job", VISUAL_STATE_PATH, s.state, 10000);
    await expect(questVisualImages(s.store, "job", [s.contract])).rejects.toThrow(/Stale/);
    s.state.candidates[0].revision = 0;
    await s.store.putJson("job", VISUAL_STATE_PATH, s.state, 10000);
    s.values.delete("visual-agent/assets/v0-r0-1-crop.json");
    await expect(questVisualImages(s.store, "job", [s.contract])).rejects.toThrow(/missing/);
  });
  it("verifies the actual quest with images and replays the exact saved request", async () => {
    const s = await setup();
    await s.provider.generateStructured(s.request); await s.provider.generateStructured(s.request);
    expect(s.call).toHaveBeenCalledOnce();
    expect(s.call).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-luna", images: expect.any(Array), input: s.request.input }));
    const state = await s.store.getJson<VisualState>("job", VISUAL_STATE_PATH);
    expect(state?.usage.calls).toBe(6); expect(state?.usage.reservedMicros).toBe(0);
    expect(state?.usage.inputTokens).toBe(200);
    await s.provider.generateStructured({ ...s.request, input: s.request.input.replace("aligned", "misaligned") });
    expect(s.call).toHaveBeenCalledTimes(2);
  });
  it("retains allowances and never auto-retries an uncertain verification", async () => {
    const s = await setup(); s.call.mockRejectedValueOnce(new Error("Network outcome unknown"));
    await expect(s.provider.generateStructured(s.request)).rejects.toThrow();
    await expect(s.provider.generateStructured(s.request)).rejects.toThrow(/indeterminate/);
    expect(s.call).toHaveBeenCalledOnce();
    const state = await s.store.getJson<VisualState>("job", VISUAL_STATE_PATH);
    expect(state!.usage.reservedMicros).toBeGreaterThan(0); expect(state!.usage.inputTokens).toBeGreaterThan(100);
  });
  it("fails closed at the shared visual call budget", async () => {
    const s = await setup(); s.state.usage.calls = 40;
    await s.store.putJson("job", VISUAL_STATE_PATH, s.state, 10000);
    await expect(s.provider.generateStructured(s.request)).rejects.toThrow(/budget/);
    expect(s.call).not.toHaveBeenCalled();
  });
  it("leaves legacy text-only verification unchanged", async () => {
    const s = await setup();
    const request = { ...s.request, input: JSON.stringify({ quest: "Text only" }) };
    await s.provider.generateStructured(request);
    expect(s.call).toHaveBeenCalledExactlyOnceWith(request);
  });
});
