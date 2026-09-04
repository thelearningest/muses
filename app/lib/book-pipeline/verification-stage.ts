import { hasPlayableVisuals, hasRequiredVisualQuests, parseQuest, QUEST_SCHEMA, type GameContent, type GamePackage, type Quest } from "../../game-package";
import type { QuestEvidenceContract } from "./contracts";
import type { ReasoningEffort } from "./config";
import { validateGameAgainstContracts } from "./generation-stage";
import type { BookJobRepository } from "./job-repository";
import { OpenAiIndeterminateRequestError, type StructuredOutputProvider } from "./providers/openai";
import { QUEST_VERIFICATION_SCHEMA } from "./verification-schema";
import { GAME_RENDERER_RULES } from "../../game-capabilities";
import { MODEL_EVIDENCE_RULES, modelEvidenceContract } from "./model-contract";
import { InactiveBookJobError, requireActiveJob } from "./lifecycle";
import { settleAll } from "./parallel";

type Verdict = { accepted: boolean; issues: string[] };
type StorePort = { putJson(jobId: string, path: string, value: unknown, expiresAt: number): Promise<void> };

// Send image bytes once as vision inputs, never as base64 text in the prompt.
function modelQuest(quest: Quest) {
  const { sourceImages: _images, ...visual } = quest.visual ?? {};
  return { ...quest, visual };
}
function playerImages(quest: Quest) {
  return quest.visual?.sourceImages?.map((image) => ({ ...image, detail: "high" as const }));
}

async function traced<T>(provider: StructuredOutputProvider, repository: Pick<BookJobRepository, "appendOpenAiRequestId">, jobId: string, now: number, request: Parameters<StructuredOutputProvider["generateStructured"]>[0]) {
  const response = await provider.generateStructured<T>(request);
  await repository.appendOpenAiRequestId(jobId, response.requestId ?? response.responseId, now);
  return response.data;
}

async function verifyQuest(input: { quest: Quest; contract: QuestEvidenceContract; provider: StructuredOutputProvider; repository: Pick<BookJobRepository, "appendOpenAiRequestId">; jobId: string; identityHash: string; model: string; reasoningEffort: ReasoningEffort; now: number }): Promise<Verdict> {
  return traced<Verdict>(input.provider, input.repository, input.jobId, input.now, {
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    schemaName: "quest_verification",
    schema: QUEST_VERIFICATION_SCHEMA,
    instructions: `Verify the CURRENT visual quiz against the attached player-visible images and book evidence. Reject wrong or ambiguous correct answers, unsupported source facts, text-only questions, and missing or illegible visual evidence essential to the answer. A proposed change to a specific existing visible element is allowed: do NOT require a before/after rendering or all hypothetical alternatives to be pictured. The learner reasons about the proposed change using existing visible objects. Each question must require a concrete observation, not merely general design advice. Diagnosis feedback is displayed AFTER the diagnosis answer, not before; it may explain the answer. Repair feedback appears only AFTER the repair. The second question must still require a new observation even after diagnosis feedback. Regions are approximate navigation aids, not precision measurements; tolerate broad/overlapping regions if they include the named features, and ignore minor caption or boundary imperfections irrelevant to the answer. Report only actionable correctness or visual-dependence defects, not stylistic preferences. Do not reject fictional scenarios or proposed changes just because they are not in the book. Evaluate wrong choices as distractors. Accept with an empty issues array if no substantive defect remains. ${MODEL_EVIDENCE_RULES}\n${GAME_RENDERER_RULES}`,
    input: JSON.stringify({ quest: modelQuest(input.quest), evidenceContract: modelEvidenceContract(input.contract) }),
    images: playerImages(input.quest),
    safetyIdentifier: input.identityHash,
  });
}

async function repairQuest(input: { quest: Quest; contract: QuestEvidenceContract; issues: string[]; provider: StructuredOutputProvider; repository: Pick<BookJobRepository, "appendOpenAiRequestId">; jobId: string; identityHash: string; model: string; reasoningEffort: ReasoningEffort; now: number }): Promise<Quest> {
  const candidate = await traced<Quest>(input.provider, input.repository, input.jobId, input.now, {
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    schemaName: "repaired_quest",
    schema: QUEST_SCHEMA,
    instructions: `Repair only the supplied quest. Resolve every listed verification issue using only the evidence contract. Preserve its id, number and valid page anchors. Return the complete repaired quest and no commentary. ${MODEL_EVIDENCE_RULES}\n${GAME_RENDERER_RULES}`,
    input: JSON.stringify({ quest: modelQuest(input.quest), evidenceContract: modelEvidenceContract(input.contract), issues: input.issues }),
    images: playerImages(input.quest),
    safetyIdentifier: input.identityHash,
  });
  const parsed = parseQuest(candidate);
  if (!parsed || parsed.id !== input.quest.id || parsed.number !== input.quest.number) throw new Error("Quest repair is invalid");
  if (parsed.visual) parsed.visual.sourceImages = input.quest.visual?.sourceImages;
  return parsed;
}

async function finish(input: { job: { id: string; originalFilename: string; expiresAt: number }; game: GameContent; store: StorePort; repository: Pick<BookJobRepository, "markTerminal">; now: number; isActive?: () => Promise<boolean> }) {
  await requireActiveJob(input.isActive);
  if (!hasRequiredVisualQuests(input.game)) throw new Error("A completed game needs at least three quests with different inspectable visuals");
  const game: GamePackage = { ...input.game, schemaVersion: 1, id: crypto.randomUUID(), sourceFilename: input.job.originalFilename, generatedAt: new Date(input.now * 1_000).toISOString() };
  await input.store.putJson(input.job.id, "game.json", game, input.job.expiresAt);
  if (await input.repository.markTerminal(input.job.id, "complete", null, input.now, input.job.expiresAt) === false) return { outcome: "inactive" as const };
  return { outcome: "complete" as const, game };
}

export async function verifyNextQuestStage(input: {
  job: { id: string; batchCursor: number; identityHash: string; originalFilename: string; expiresAt: number };
  game: GameContent;
  contracts: QuestEvidenceContract[];
  provider: StructuredOutputProvider;
  repository: Pick<BookJobRepository, "commitStage" | "markRecoverable" | "markTerminal" | "appendOpenAiRequestId"> & Partial<Pick<BookJobRepository, "reserveProviderCost" | "reconcileProviderCost">>;
  store: StorePort;
  config: { model: string; reasoningEffort: ReasoningEffort; maxRepairAttempts: number; reserveCostUnits?: number; maxCostUnits?: number; parallel?: boolean };
  now: number;
  isActive?: () => Promise<boolean>;
}) {
  if (input.isActive && !await input.isActive()) return { outcome: "inactive" as const };
  if (input.job.batchCursor >= input.game.quests.length) {
    try { return await finish(input); }
    catch (error) { if (error instanceof InactiveBookJobError) return { outcome: "inactive" as const }; throw error; }
  }
  if (input.config.parallel) return verifyRemainingQuests(input);
  const index = input.job.batchCursor;
  const contract = input.contracts[index];
  if (!contract) {
    await input.repository.markTerminal(input.job.id, "failed_terminal", "verification_failed", input.now, input.job.expiresAt, "verifying_quests");
    return { outcome: "terminal" as const };
  }
  let reserved = false;
  try {
    if (input.config.reserveCostUnits && input.config.maxCostUnits && input.repository.reserveProviderCost) {
      reserved = await input.repository.reserveProviderCost(input.job.id, input.config.reserveCostUnits, input.config.maxCostUnits, input.now);
      if (!reserved) throw new Error("Provider budget exhausted");
    }
    let game = input.game;
    let quest = game.quests[index];
    const requestContext = {
      provider: input.provider,
      repository: input.repository,
      jobId: input.job.id,
      identityHash: input.job.identityHash,
      model: input.config.model,
      reasoningEffort: input.config.reasoningEffort,
      now: input.now,
    };
    let verdict = await verifyQuest({ ...requestContext, quest, contract });
    await requireActiveJob(input.isActive);
    let repairs = 0;
    while (!verdict.accepted && repairs < input.config.maxRepairAttempts) {
      quest = await repairQuest({ ...requestContext, quest, contract, issues: verdict.issues });
      await requireActiveJob(input.isActive);
      const candidate = { ...game, quests: game.quests.map((existing, questIndex) => questIndex === index ? quest : existing) };
      const deterministicIssues = validateGameAgainstContracts(candidate, input.contracts);
      verdict = deterministicIssues.length ? { accepted: false, issues: deterministicIssues } : await verifyQuest({ ...requestContext, quest, contract });
      await requireActiveJob(input.isActive);
      game = candidate;
      repairs += 1;
    }
    if (!verdict.accepted) {
      await input.repository.markTerminal(input.job.id, "failed_terminal", "verification_failed", input.now, input.job.expiresAt, "verifying_quests");
      return { outcome: "terminal" as const, failedQuestIndex: index };
    }
    await input.store.putJson(input.job.id, "game-draft.json", { game, questContractIds: Object.fromEntries(game.quests.map((item, questIndex) => [item.id, input.contracts[questIndex]?.id])) }, input.job.expiresAt);
    await requireActiveJob(input.isActive);
    await input.store.putJson(input.job.id, `verification/${index}.json`, { accepted: true, repairs }, input.job.expiresAt);
    const nextCursor = index + 1;
    if (nextCursor >= game.quests.length) return await finish({ ...input, game });
    if (await input.repository.commitStage({ jobId: input.job.id, expectedStatus: "verifying_quests", nextStatus: "verifying_quests", now: input.now, batchCursor: nextCursor, expectedBatchCursor: input.job.batchCursor }) === false) return { outcome: "inactive" as const };
    return { outcome: "advanced" as const, verifiedQuests: nextCursor, totalQuests: game.quests.length };
  } catch (error) {
    if (error instanceof InactiveBookJobError) return { outcome: "inactive" as const };
    const manual = error instanceof OpenAiIndeterminateRequestError;
    await input.repository.markRecoverable(input.job.id, "verifying_quests", manual ? "manual_retry_required" : "failed_recoverable", manual ? "manual_retry_required" : "provider_unavailable", input.now, "verifying_quests", input.job.batchCursor);
    return { outcome: "interrupted" as const };
  } finally {
    if (reserved && input.config.reserveCostUnits && input.repository.reconcileProviderCost) {
      await input.repository.reconcileProviderCost(input.job.id, input.config.reserveCostUnits, input.config.reserveCostUnits, input.now);
    }
  }
}

async function verifyRemainingQuests(input: Parameters<typeof verifyNextQuestStage>[0]): Promise<{
  outcome: "complete" | "inactive" | "terminal" | "interrupted"; game?: GamePackage; failedQuestIndex?: number;
}> {
  try {
    if (!input.provider.partition || input.game.quests.length !== input.contracts.length) throw new Error("Parallel verification requires complete contracts and durable partitions");
    const results = await settleAll(input.game.quests.slice(input.job.batchCursor).map(async (original, offset) => {
      const index = input.job.batchCursor + offset;
      const context = { provider: input.provider.partition!(index), repository: input.repository,
        jobId: input.job.id, identityHash: input.job.identityHash, model: input.config.model,
        reasoningEffort: input.config.reasoningEffort, now: input.now, contract: input.contracts[index] };
      await requireActiveJob(input.isActive);
      let quest = original;
      let verdict = await verifyQuest({ ...context, quest });
      let repairs = 0;
      while (!verdict.accepted && repairs < input.config.maxRepairAttempts) {
        await requireActiveJob(input.isActive);
        quest = await repairQuest({ ...context, quest, issues: verdict.issues });
        await requireActiveJob(input.isActive);
        verdict = await verifyQuest({ ...context, quest });
        repairs++;
      }
      return { index, quest, verdict, repairs };
    }));
    await requireActiveJob(input.isActive);
    // Keep only candidates whose image-dependent questions passed. Never fill
    // a quota with rejected questions or fail a good quest because a peer failed.
    const accepted = results.filter((result) => result.verdict.accepted &&
      !validateGameAgainstContracts({ ...input.game, quests: [result.quest] }, [input.contracts[result.index]]).length &&
      hasPlayableVisuals({ ...input.game, quests: [result.quest] }));
    const kept = [...input.game.quests.slice(0, input.job.batchCursor).map((quest, index) => ({ quest, index })), ...accepted];
    const contracts = kept.map((result) => input.contracts[result.index]);
    const game = { ...input.game, quests: kept.map((result, index) => ({ ...result.quest, id: `q${index + 1}`, number: String(index + 1) })) };
    if (!hasRequiredVisualQuests(game) || validateGameAgainstContracts(game, contracts).length) {
      await input.repository.markTerminal(input.job.id, "failed_terminal", "verification_failed", input.now, input.job.expiresAt, "verifying_quests");
      return { outcome: "terminal" };
    }
    for (const result of results) await input.store.putJson(input.job.id, `verification/${result.index}.json`, { accepted: accepted.includes(result), repairs: result.repairs, issues: result.verdict.issues }, input.job.expiresAt);
    // Preserve the original draft/indices for exact provider-call replay.
    return await finish({ ...input, game });
  } catch (error) {
    if (error instanceof InactiveBookJobError) return { outcome: "inactive" };
    await input.repository.markRecoverable(input.job.id, "verifying_quests", "manual_retry_required", "manual_retry_required", input.now, "verifying_quests", input.job.batchCursor);
    return { outcome: "interrupted" };
  }
}
