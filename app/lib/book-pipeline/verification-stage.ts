import { parseQuest, QUEST_SCHEMA, type GameContent, type GamePackage, type Quest } from "../../game-package";
import type { QuestEvidenceContract } from "./contracts";
import type { ReasoningEffort } from "./config";
import { validateGameAgainstContracts } from "./generation-stage";
import type { BookJobRepository } from "./job-repository";
import { OpenAiIndeterminateRequestError, type StructuredOutputProvider } from "./providers/openai";
import { QUEST_VERIFICATION_SCHEMA } from "./verification-schema";

type Verdict = { accepted: boolean; issues: string[] };
type StorePort = { putJson(jobId: string, path: string, value: unknown, expiresAt: number): Promise<void> };

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
    instructions: "Check only whether this quest's claims, correct choices, feedback, actions, and page anchors are fully supported by the supplied evidence contract. Reject unsupported embellishment. Do not reward plausibility without evidence.",
    input: JSON.stringify({ quest: input.quest, evidenceContract: input.contract }),
    safetyIdentifier: input.identityHash,
  });
}

async function repairQuest(input: { quest: Quest; contract: QuestEvidenceContract; issues: string[]; provider: StructuredOutputProvider; repository: Pick<BookJobRepository, "appendOpenAiRequestId">; jobId: string; identityHash: string; model: string; reasoningEffort: ReasoningEffort; now: number }): Promise<Quest> {
  const candidate = await traced<Quest>(input.provider, input.repository, input.jobId, input.now, {
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    schemaName: "repaired_quest",
    schema: QUEST_SCHEMA,
    instructions: "Repair only the supplied quest. Resolve every listed verification issue using only the evidence contract. Preserve its id and number. Return the complete repaired quest and no commentary.",
    input: JSON.stringify({ quest: input.quest, evidenceContract: input.contract, issues: input.issues }),
    safetyIdentifier: input.identityHash,
  });
  const parsed = parseQuest(candidate);
  if (!parsed || parsed.id !== input.quest.id || parsed.number !== input.quest.number) throw new Error("Quest repair is invalid");
  return parsed;
}

async function finish(input: { job: { id: string; originalFilename: string; expiresAt: number }; game: GameContent; store: StorePort; repository: Pick<BookJobRepository, "markTerminal">; now: number }) {
  const game: GamePackage = { ...input.game, schemaVersion: 1, id: crypto.randomUUID(), sourceFilename: input.job.originalFilename, generatedAt: new Date(input.now * 1_000).toISOString() };
  await input.store.putJson(input.job.id, "game.json", game, input.job.expiresAt);
  await input.repository.markTerminal(input.job.id, "complete", null, input.now, input.job.expiresAt);
  return { outcome: "complete" as const, game };
}

export async function verifyNextQuestStage(input: {
  job: { id: string; batchCursor: number; identityHash: string; originalFilename: string; expiresAt: number };
  game: GameContent;
  contracts: QuestEvidenceContract[];
  provider: StructuredOutputProvider;
  repository: Pick<BookJobRepository, "commitStage" | "markRecoverable" | "markTerminal" | "appendOpenAiRequestId">;
  store: StorePort;
  config: { model: string; reasoningEffort: ReasoningEffort; maxRepairAttempts: number };
  now: number;
}) {
  if (input.job.batchCursor >= input.game.quests.length) return finish({ job: input.job, game: input.game, store: input.store, repository: input.repository, now: input.now });
  const index = input.job.batchCursor;
  const contract = input.contracts[index];
  if (!contract) {
    await input.repository.markTerminal(input.job.id, "failed_terminal", "verification_failed", input.now, input.job.expiresAt);
    return { outcome: "terminal" as const };
  }
  try {
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
    let repairs = 0;
    while (!verdict.accepted && repairs < input.config.maxRepairAttempts) {
      quest = await repairQuest({ ...requestContext, quest, contract, issues: verdict.issues });
      const candidate = { ...game, quests: game.quests.map((existing, questIndex) => questIndex === index ? quest : existing) };
      const deterministicIssues = validateGameAgainstContracts(candidate, input.contracts);
      verdict = deterministicIssues.length ? { accepted: false, issues: deterministicIssues } : await verifyQuest({ ...requestContext, quest, contract });
      game = candidate;
      repairs += 1;
    }
    if (!verdict.accepted) {
      await input.repository.markTerminal(input.job.id, "failed_terminal", "verification_failed", input.now, input.job.expiresAt);
      return { outcome: "terminal" as const, failedQuestIndex: index };
    }
    await input.store.putJson(input.job.id, "game-draft.json", { game, questContractIds: Object.fromEntries(game.quests.map((item, questIndex) => [item.id, input.contracts[questIndex]?.id])) }, input.job.expiresAt);
    await input.store.putJson(input.job.id, `verification/${index}.json`, { accepted: true, repairs }, input.job.expiresAt);
    const nextCursor = index + 1;
    if (nextCursor >= game.quests.length) return finish({ job: input.job, game, store: input.store, repository: input.repository, now: input.now });
    await input.repository.commitStage({ jobId: input.job.id, expectedStatus: "verifying_quests", nextStatus: "verifying_quests", now: input.now, batchCursor: nextCursor });
    return { outcome: "advanced" as const, verifiedQuests: nextCursor, totalQuests: game.quests.length };
  } catch (error) {
    const manual = error instanceof OpenAiIndeterminateRequestError;
    await input.repository.markRecoverable(input.job.id, "verifying_quests", manual ? "manual_retry_required" : "failed_recoverable", manual ? "manual_retry_required" : "provider_unavailable", input.now);
    return { outcome: "interrupted" as const };
  }
}
