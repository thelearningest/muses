import { describe, expect, it, vi } from "vitest";

import type { GameContent, Quest } from "../../app/game-package";
import type { BookMap, QuestEvidenceContract } from "../../app/lib/book-pipeline/contracts";
import { buildGenerationInput, generateGameStage, validateGameAgainstContracts } from "../../app/lib/book-pipeline/generation-stage";
import type { StructuredOutputProvider } from "../../app/lib/book-pipeline/providers/openai";

function quest(index: number): Quest {
  return {
    id: `q${index}`, number: String(index + 1), title: `Trial ${index}`, gallery: `Lab ${index}`, story: `A system ${index} needs attention.`, objective: `Apply concept ${index}.`, clue: `Inspect evidence ${index}.`, artifact: "console", xp: 100,
    observationTools: [`meter ${index}`, `log ${index}`, `map ${index}`],
    diagnosis: [{ id: "a", label: `cause ${index}`, feedback: "Supported.", correct: true }, { id: "b", label: `guess ${index}`, feedback: "Unsupported.", correct: false }, { id: "c", label: `delay ${index}`, feedback: "Too late.", correct: false }],
    repairs: [{ id: "a", label: `repair ${index}`, feedback: "Works.", correct: true }, { id: "b", label: `patch ${index}`, feedback: "Misses cause.", correct: false }, { id: "c", label: `ignore ${index}`, feedback: "No change.", correct: false }],
    principle: { name: `Concept ${index}`, summary: `Claim ${index}` },
    visual: { mode: index === 0 ? "3d" : "diagram", form: "console", accent: "green", title: `Console ${index}`, problemLabel: `Fault ${index}`, repairLabel: `Fix ${index}`, elements: [`sensor ${index}`, `signal ${index}`, `switch ${index}`] },
    sourceAnchors: [{ label: `Section ${index}`, pageStart: index + 1, pageEnd: index + 1 }],
  };
}

function contracts(): QuestEvidenceContract[] {
  return Array.from({ length: 4 }, (_, index) => ({ id: `contract-${index}`, conceptId: `c${index}`, centralClaim: `Claim ${index}`, playerActions: ["apply"], sources: [{ pageStart: index, pageEnd: index, canonicalBlockIds: [`b${index}`], boundedExcerpt: `Evidence ${index}` }], visualAnnotations: [], confidence: 0.9, missingEvidence: [] }));
}

function map(): BookMap {
  return { schemaVersion: 1, bookTitle: "Source", thesis: "Bounded thesis", learningArc: ["one", "two", "three", "four"], chapters: [{ id: "unrelated", title: "Do not send", pageStart: 0, pageEnd: 99, summary: "UNRELATED_FULL_TRANSCRIPT", evidenceCardIds: [] }], concepts: contracts().map((contract, index) => ({ id: contract.conceptId, name: `Concept ${index}`, summary: `Claim ${index}`, evidenceCardIds: [], prerequisiteConceptIds: [], relatedConceptIds: [], score: 0.9, confidence: 0.9 })), contradictions: [], visualOpportunities: [], omissions: [], proposedQuestConceptIds: contracts().map((contract) => contract.conceptId) };
}

describe("evidence-driven generation", () => {
  // Paid-concurrency acceptance now exercises the actual ownership boundary in
  // advance-durability-route.test.ts, with real migrated SQL and HTTP adapters.
  it("retains the paid reservation when usage persistence fails", async () => {
    const repository = { commitStage: vi.fn(), markRecoverable: vi.fn(), appendOpenAiRequestId: vi.fn(), reserveProviderCost: vi.fn().mockResolvedValue(true), reconcileProviderCost: vi.fn().mockRejectedValueOnce(new Error("Database unavailable")) };
    const provider = { generateStructured: vi.fn(async () => ({ responseId: "resp", data: {}, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } })) } as unknown as StructuredOutputProvider;
    await generateGameStage({ job: { id: "job", identityHash: "identity", originalFilename: "source.pdf", expiresAt: 99 }, bookMap: map(), contracts: contracts(), provider, repository, store: { putJson: vi.fn() }, config: { model: "gpt-5.6-sol", reasoningEffort: "high", reserveCostUnits: 100, maxCostUnits: 1000 }, now: 1 });
    expect(repository.reconcileProviderCost.mock.calls).toEqual([["job", 100, 1, 1]]);
    expect(repository.markRecoverable).toHaveBeenCalledWith("job", "generating_game", "manual_retry_required", "manual_retry_required", 1);
  });
  it("accounts for a paid response but does not publish after cancellation", async () => {
    let active = true;
    const provider = { generateStructured: vi.fn(async () => { active = false; return { responseId: "resp", data: {}, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } }; }) } as unknown as StructuredOutputProvider;
    const repository = { commitStage: vi.fn(), markRecoverable: vi.fn(), appendOpenAiRequestId: vi.fn(), reserveProviderCost: vi.fn().mockResolvedValue(true), reconcileProviderCost: vi.fn() };
    const store = { putJson: vi.fn() };
    const result = await generateGameStage({
      job: { id: "job", identityHash: "identity", originalFilename: "source.pdf", expiresAt: 99 }, bookMap: map(), contracts: contracts(), provider, repository, store,
      config: { model: "gpt-5.6-sol", reasoningEffort: "high", reserveCostUnits: 100, maxCostUnits: 1000 }, now: 1, isActive: async () => active,
    });
    expect(result.outcome).toBe("inactive"); expect(store.putJson).not.toHaveBeenCalled(); expect(repository.commitStage).not.toHaveBeenCalled();
    expect(repository.reconcileProviderCost).toHaveBeenCalledWith("job", 100, 1, 1);
  });
  it("sends only the compact map selection and quest contracts, never a PDF or transcript", async () => {
    let supplied = "";
    const game: GameContent = { sourceTitle: "Source", title: "Game", subtitle: "Learn", setting: "Lab", quests: Array.from({ length: 4 }, (_, index) => quest(index)) };
    const provider: StructuredOutputProvider = { async generateStructured<T>(input: Parameters<StructuredOutputProvider["generateStructured"]>[0]) { supplied = input.input; return { responseId: "resp", data: game as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }; } };
    const putJson = vi.fn();
    await expect(generateGameStage({
      job: { id: "job", identityHash: "identity", originalFilename: "source.pdf", expiresAt: 99 }, bookMap: map(), contracts: contracts(), provider,
      repository: { commitStage: vi.fn(), markRecoverable: vi.fn(), appendOpenAiRequestId: vi.fn() }, store: { putJson },
      config: { model: "gpt-5.6-sol", reasoningEffort: "high" }, now: 1,
    })).resolves.toMatchObject({ outcome: "complete", questCount: 4 });
    expect(supplied).not.toMatch(/%PDF|UNRELATED_FULL_TRANSCRIPT|chapters/);
    expect(Object.keys(JSON.parse(supplied))).toEqual(["book", "concepts", "questContracts"]);
    expect(buildGenerationInput(map(), contracts()).questContracts).toHaveLength(4);
    const first = JSON.parse(supplied).questContracts[0];
    expect(first.pageNumbering).toBe("one_based_pdf_pages");
    expect(first.sources[0].pageStart).toBe(1);
  });

  it("fails deterministic validation for unsafe anchors, duplicate concepts/visuals, or missing 3D", () => {
    const base: GameContent = { sourceTitle: "Source", title: "Game", subtitle: "Learn", setting: "Lab", quests: Array.from({ length: 4 }, (_, index) => quest(index)) };
    expect(validateGameAgainstContracts({ ...base, quests: base.quests.map((item, index) => index ? item : { ...item, sourceAnchors: [{ label: "bad", pageStart: 99, pageEnd: 99 }] }) }, contracts())).toContain("quest_0:invalid_source_anchor");
    expect(validateGameAgainstContracts({ ...base, quests: base.quests.map((item) => ({ ...item, principle: { ...item.principle, name: "same" } })) }, contracts())).toContain("duplicate_concepts");
    expect(validateGameAgainstContracts({ ...base, quests: base.quests.map((item, index) => index ? item : { ...item, visual: { ...item.visual!, elements: ["same", "same", "other"] } }) }, contracts())).toContain("quest_0:duplicate_visual_labels");
    expect(validateGameAgainstContracts({ ...base, quests: base.quests.map((item) => ({ ...item, visual: { ...item.visual!, mode: "diagram" } })) }, contracts())).toContain("missing_3d_visual");
    const tooLong = structuredClone(base);
    tooLong.quests[0].visual!.elements[0] = "x".repeat(49);
    expect(validateGameAgainstContracts(tooLong, contracts())).toContain("quest_0:visual_label_too_long");
    const unsupported = structuredClone(base);
    unsupported.quests[0].clue = "Move the slider to inspect the grid.";
    expect(validateGameAgainstContracts(unsupported, contracts())).toContain("quest_0:unsupported_renderer_control");
    expect(validateGameAgainstContracts(base, contracts())).toEqual([]);
  });
});
