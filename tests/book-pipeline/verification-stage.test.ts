import { describe, expect, it, vi } from "vitest";

import { isGamePackage, type GameContent, type Quest } from "../../app/game-package";
import type { StructuredOutputProvider } from "../../app/lib/book-pipeline/providers/openai";
import { verifyNextQuestStage } from "../../app/lib/book-pipeline/verification-stage";

function makeQuest(index: number): Quest {
  return {
    id: `q${index}`, number: String(index + 1), title: `Trial ${index}`, gallery: `Lab ${index}`, story: `Situation ${index}.`, objective: `Apply ${index}.`, clue: `Inspect ${index}.`, artifact: "console", xp: 100,
    observationTools: [`meter ${index}`, `log ${index}`, `map ${index}`],
    diagnosis: [{ id: "a", label: `cause ${index}`, feedback: "Yes.", correct: true }, { id: "b", label: `guess ${index}`, feedback: "No.", correct: false }, { id: "c", label: `delay ${index}`, feedback: "No.", correct: false }],
    repairs: [{ id: "a", label: `repair ${index}`, feedback: "Yes.", correct: true }, { id: "b", label: `patch ${index}`, feedback: "No.", correct: false }, { id: "c", label: `ignore ${index}`, feedback: "No.", correct: false }],
    principle: { name: `Concept ${index}`, summary: `Claim ${index}` },
    visual: { mode: index === 0 ? "3d" : "diagram", form: "console", accent: "green", title: `Console ${index}`, problemLabel: `Fault ${index}`, repairLabel: `Fix ${index}`, elements: [`sensor ${index}`, `signal ${index}`, `switch ${index}`] },
    sourceAnchors: [{ label: `Section ${index}`, pageStart: index + 1, pageEnd: index + 1 }],
  };
}

function makeContracts() {
  return Array.from({ length: 4 }, (_, index) => ({ id: `contract-${index}`, conceptId: `c${index}`, centralClaim: `Claim ${index}`, playerActions: ["apply"], sources: [{ pageStart: index, pageEnd: index, canonicalBlockIds: [`b${index}`], boundedExcerpt: `Evidence ${index}` }], visualAnnotations: [], confidence: 0.9, missingEvidence: [] }));
}

function game(): GameContent {
  return { sourceTitle: "Source", title: "Game", subtitle: "Learn", setting: "Lab", quests: Array.from({ length: 4 }, (_, index) => makeQuest(index)) };
}

function repository() {
  return { commitStage: vi.fn(), markRecoverable: vi.fn(), markTerminal: vi.fn(), appendOpenAiRequestId: vi.fn() };
}

function response<T>(data: T) {
  return { responseId: crypto.randomUUID(), data, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
}

describe("targeted quest verification", () => {
  // Simultaneous paid-call acceptance lives in advance-durability-route.test.ts.
  it("does not repair or publish when cancelled during verification", async () => {
    let active = true;
    const provider = { generateStructured: vi.fn(async () => { active = false; return response({ accepted: false, issues: ["repair needed"] }); }) } as unknown as StructuredOutputProvider;
    const repo = repository(); const store = { putJson: vi.fn() };
    const result = await verifyNextQuestStage({
      job: { id: "job", batchCursor: 0, identityHash: "identity", originalFilename: "source.pdf", expiresAt: 99 },
      game: game(), contracts: makeContracts(), provider, repository: repo, store,
      config: { model: "gpt-5.4-mini", reasoningEffort: "low", maxRepairAttempts: 2 }, now: 1, isActive: async () => active,
    });
    expect(result.outcome).toBe("inactive");
    expect(provider.generateStructured).toHaveBeenCalledTimes(1);
    expect(store.putJson).not.toHaveBeenCalled(); expect(repo.markTerminal).not.toHaveBeenCalled(); expect(repo.markRecoverable).not.toHaveBeenCalled();
  });
  it("does not report complete when the final database transition loses", async () => {
    const repo = repository(); repo.markTerminal.mockResolvedValue(false);
    const result = await verifyNextQuestStage({
      job: { id: "job", batchCursor: 4, identityHash: "identity", originalFilename: "source.pdf", expiresAt: 99 },
      game: game(), contracts: makeContracts(), provider: { generateStructured: vi.fn() }, repository: repo, store: { putJson: vi.fn() },
      config: { model: "gpt-5.4-mini", reasoningEffort: "low", maxRepairAttempts: 2 }, now: 1,
    });
    expect(result.outcome).toBe("inactive");
  });
  it("rejects an off-by-one repair without asking the model to approve invalid anchors", async () => {
    const original = game();
    const invalid = { ...original.quests[1], sourceAnchors: [{ label: "Wrong index", pageStart: 1, pageEnd: 1 }] };
    const outputs: unknown[] = [{ accepted: false, issues: ["repair needed"] }, invalid];
    const provider = { generateStructured: vi.fn(async () => response(outputs.shift())) } as unknown as StructuredOutputProvider;
    const store = { putJson: vi.fn() };
    const result = await verifyNextQuestStage({
      job: { id: "job", batchCursor: 1, identityHash: "identity", originalFilename: "source.pdf", expiresAt: 99 },
      game: original, contracts: makeContracts(), provider, repository: repository(), store,
      config: { model: "gpt-5.6-luna", reasoningEffort: "none", maxRepairAttempts: 1 }, now: 1,
    });
    expect(result.outcome).toBe("terminal");
    expect(provider.generateStructured).toHaveBeenCalledTimes(2);
    expect(store.putJson).not.toHaveBeenCalled();
  });

  it("repairs only the failing quest and leaves passing quests unchanged", async () => {
    const original = game();
    const repaired: Quest = { ...original.quests[1], story: "A corrected grounded situation." };
    const requests: string[] = [];
    const outputs: unknown[] = [{ accepted: false, issues: ["unsupported claim"] }, repaired, { accepted: true, issues: [] }];
    const provider: StructuredOutputProvider = { async generateStructured<T>(input: Parameters<StructuredOutputProvider["generateStructured"]>[0]) {
      requests.push(input.schemaName);
      const payload = JSON.parse(input.input);
      expect(payload.evidenceContract.pageNumbering).toBe("one_based_pdf_pages");
      expect(payload.evidenceContract.sources[0].pageStart).toBe(2);
      expect(payload.quest.sourceAnchors[0].pageStart).toBe(2);
      expect(input.instructions).toContain("original fiction");
      expect(input.instructions).toContain("static observation-topic labels");
      return response(outputs.shift() as T);
    } };
    const writes: Array<[string, unknown]> = [];
    const result = await verifyNextQuestStage({
      job: { id: "job", batchCursor: 1, identityHash: "identity", originalFilename: "source.pdf", expiresAt: 99 }, game: original, contracts: makeContracts(), provider,
      repository: repository(), store: { putJson: async (_job, path, value) => { writes.push([path, value]); } },
      config: { model: "gpt-5.4-mini", reasoningEffort: "low", maxRepairAttempts: 2 }, now: 1,
    });
    expect(result).toMatchObject({ outcome: "advanced", verifiedQuests: 2 });
    expect(requests).toEqual(["quest_verification", "repaired_quest", "quest_verification"]);
    const draft = writes.find(([path]) => path === "game-draft.json")?.[1] as { game: GameContent };
    expect(draft.game.quests[0]).toEqual(original.quests[0]);
    expect(draft.game.quests[1].story).toBe(repaired.story);
    expect(draft.game.quests[2]).toEqual(original.quests[2]);
  });

  it("terminates safely after two failed repairs", async () => {
    const original = game();
    const outputs: unknown[] = [
      { accepted: false, issues: ["unsupported"] }, original.quests[0], { accepted: false, issues: ["still unsupported"] }, original.quests[0], { accepted: false, issues: ["still unsupported"] },
    ];
    const provider: StructuredOutputProvider = { async generateStructured<T>() { return response(outputs.shift() as T); } };
    const repo = repository();
    await expect(verifyNextQuestStage({
      job: { id: "job", batchCursor: 0, identityHash: "identity", originalFilename: "source.pdf", expiresAt: 99 }, game: original, contracts: makeContracts(), provider, repository: repo,
      store: { putJson: vi.fn() }, config: { model: "gpt-5.4-mini", reasoningEffort: "low", maxRepairAttempts: 2 }, now: 1,
    })).resolves.toMatchObject({ outcome: "terminal", failedQuestIndex: 0 });
    expect(repo.markTerminal).toHaveBeenCalledWith("job", "failed_terminal", "verification_failed", 1, 99, "verifying_quests");
  });

  it("stores a package accepted by the existing game engine", async () => {
    const provider: StructuredOutputProvider = { async generateStructured<T>() { return response({ accepted: true, issues: [] } as T); } };
    let saved: unknown;
    const result = await verifyNextQuestStage({
      job: { id: "job", batchCursor: 3, identityHash: "identity", originalFilename: "source.pdf", expiresAt: 99 }, game: game(), contracts: makeContracts(), provider, repository: repository(),
      store: { putJson: async (_job, path, value) => { if (path === "game.json") saved = value; } },
      config: { model: "gpt-5.4-mini", reasoningEffort: "low", maxRepairAttempts: 2 }, now: 1_800_000_000,
    });
    expect(result.outcome).toBe("complete");
    expect(isGamePackage(saved)).toBe(true);
  });
});
