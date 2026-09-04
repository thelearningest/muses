import { GAME_CONTENT_SCHEMA, parseGameContent, type GameContent } from "../../game-package";
import type { BookMap, QuestEvidenceContract } from "./contracts";
import { GAME_RENDERER_RULES, questRendererIssues } from "../../game-capabilities";
import { MODEL_EVIDENCE_RULES, modelEvidenceContract } from "./model-contract";
import type { ReasoningEffort } from "./config";
import type { BookJobRepository } from "./job-repository";
import { OpenAiIndeterminateRequestError, type StructuredOutputProvider, type InputImage } from "./providers/openai";
import { generateParallelGame } from "./parallel-generation";

export const GAME_GENERATION_INSTRUCTIONS = `Create an original, source-grounded browser learning RPG from only the supplied book map and quest evidence contracts.
Create one quest per contract, in the supplied sequence (four to nine total). Each quest follows inspect, diagnose, repair, reward. Make players apply the central claim through the permitted player actions. Each diagnosis and repair has exactly three choices and exactly one correct answer. Wrong-choice feedback explains the misconception.
Use direct second-person language, concrete nouns, concise practical stakes, and original expression. Do not quote source excerpts. Never invent citations or source claims.
Write for a first-time player: explain who they are helping, the problem they can see, and what they need to do next. Keep story to two short sentences and objective to one concrete action. Keep titles short and choices easy to compare. Put fantasy flavor in the setting and characters; use plain language for instructions and feedback. Explain specialist terms when first needed. Avoid bureaucratic phrases such as field study, apprenticeship record, evidence contract, or study object in player-facing copy. Introduce fictional situations naturally with "Imagine" or "Your challenge" instead of the label "Original exercise".
${MODEL_EVIDENCE_RULES}
${GAME_RENDERER_RULES}
Create a distinct visual brief for every quest and include at least one 3d visual. Verified visual annotations are private source references: use their supported relationships to design original diagrams and interactions. Respect every listed limitation. Reference-only annotations cannot be the sole basis of a scored answer. Do not copy the book's artwork or invent details from a visual description. The browser engine renders your structured game content; do not output application code or image URLs. Return only the strict structured output.`;

export type GenerationInput = {
  book: { title: string; thesis: string; learningArc: string[] };
  concepts: Array<{ id: string; name: string; summary: string }>;
  questContracts: ReturnType<typeof modelEvidenceContract>[];
};

export function buildGenerationInput(bookMap: BookMap, contracts: QuestEvidenceContract[]): GenerationInput {
  const selected = new Set(bookMap.proposedQuestConceptIds);
  return {
    book: { title: bookMap.bookTitle ?? "Uploaded book", thesis: bookMap.thesis, learningArc: bookMap.learningArc },
    concepts: bookMap.concepts.filter((concept) => selected.has(concept.id)).map(({ id, name, summary }) => ({ id, name, summary })),
    questContracts: contracts.map(modelEvidenceContract),
  };
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function validateGameAgainstContracts(game: GameContent, contracts: QuestEvidenceContract[]): string[] {
  const issues: string[] = [];
  if (game.quests.length !== contracts.length) issues.push("quest_count_mismatch");
  const conceptNames = game.quests.map((quest) => normalized(quest.principle.name));
  if (new Set(conceptNames).size !== conceptNames.length) issues.push("duplicate_concepts");
  if (!game.quests.some((quest) => quest.visual?.mode === "3d")) issues.push("missing_3d_visual");
  const visualSignatures = new Set<string>();
  game.quests.forEach((quest, index) => {
    issues.push(...questRendererIssues(quest).map((issue) => `quest_${index}:${issue}`));
    if (!quest.visual) {
      issues.push(`quest_${index}:missing_visual`);
      return;
    }
    const labels = [quest.visual.title, quest.visual.problemLabel, quest.visual.repairLabel, ...quest.visual.elements].map(normalized);
    if (new Set(labels).size !== labels.length) issues.push(`quest_${index}:duplicate_visual_labels`);
    const signature = labels.join("|");
    if (visualSignatures.has(signature)) issues.push(`quest_${index}:duplicate_visual_brief`);
    visualSignatures.add(signature);
    const contract = contracts[index];
    if (!contract) return;
    for (const anchor of quest.sourceAnchors ?? []) {
      const supported = contract.sources.some((source) =>
        anchor.pageStart >= source.pageStart + 1 && anchor.pageEnd <= source.pageEnd + 1,
      );
      if (!supported) issues.push(`quest_${index}:invalid_source_anchor`);
    }
  });
  return issues;
}

export async function generateGameStage(input: {
  job: { id: string; identityHash: string; originalFilename: string; expiresAt: number };
  bookMap: BookMap;
  contracts: QuestEvidenceContract[];
  provider: StructuredOutputProvider;
  images?: InputImage[];
  questImages?: InputImage[][];
  repository: Pick<BookJobRepository, "commitStage" | "markRecoverable" | "appendOpenAiRequestId"> & Partial<Pick<BookJobRepository, "reserveProviderCost" | "reconcileProviderCost">>;
  store: { putJson(jobId: string, path: string, value: unknown, expiresAt: number): Promise<void> };
  config: { model: string; reasoningEffort: ReasoningEffort; reserveCostUnits?: number; maxCostUnits?: number; parallel?: boolean };
  now: number;
  isActive?: () => Promise<boolean>;
}) {
  let reserved = false;
  let providerCompleted = false;
  try {
    if (input.isActive && !await input.isActive()) return { outcome: "inactive" as const };
    if (input.config.reserveCostUnits && input.config.maxCostUnits && input.repository.reserveProviderCost &&
      !(await input.repository.reserveProviderCost(input.job.id, input.config.reserveCostUnits, input.config.maxCostUnits, input.now))) {
      throw new Error("Provider budget exhausted");
    }
    reserved = Boolean(input.config.reserveCostUnits && input.config.maxCostUnits && input.repository.reserveProviderCost);
    const boundedInput = buildGenerationInput(input.bookMap, input.contracts);
    const response = input.config.parallel ? await generateParallelGame({
      provider: input.provider, content: boundedInput, instructions: GAME_GENERATION_INSTRUCTIONS,
      model: input.config.model, reasoningEffort: input.config.reasoningEffort, identity: input.job.identityHash,
      images: input.images, questImages: input.questImages,
      recordRequest: async (id) => { await input.repository.appendOpenAiRequestId(input.job.id, id, input.now); },
    }) : await input.provider.generateStructured<GameContent>({
      model: input.config.model,
      reasoningEffort: input.config.reasoningEffort,
      schemaName: "book_rpg",
      schema: GAME_CONTENT_SCHEMA,
      instructions: GAME_GENERATION_INSTRUCTIONS,
      input: JSON.stringify(boundedInput),
      safetyIdentifier: input.job.identityHash,
      images: input.images,
    });
    providerCompleted = true;
    if (input.config.reserveCostUnits && input.repository.reconcileProviderCost) {
      await input.repository.reconcileProviderCost(input.job.id, input.config.reserveCostUnits, Math.max(1, Math.ceil(response.usage.totalTokens / 1_000)), input.now);
      reserved = false;
    }
    const game = parseGameContent(response.data);
    if (input.isActive && !await input.isActive()) return { outcome: "inactive" as const };
    if (!game) throw new Error("Generated game failed schema validation");
    const issues = validateGameAgainstContracts(game, input.contracts);
    if (issues.length > 0) throw new Error(`Generated game failed deterministic validation: ${issues.join(",")}`);
    await input.store.putJson(input.job.id, "game-draft.json", {
      game,
      questContractIds: Object.fromEntries(game.quests.map((quest, index) => [quest.id, input.contracts[index].id])),
    }, input.job.expiresAt);
    await input.repository.appendOpenAiRequestId(input.job.id, response.requestId ?? response.responseId, input.now);
    if (await input.repository.commitStage({ jobId: input.job.id, expectedStatus: "generating_game", nextStatus: "verifying_quests", now: input.now, batchCursor: 0 }) === false) return { outcome: "inactive" as const };
    return { outcome: "complete" as const, questCount: game.quests.length };
  } catch (error) {
    const manual = error instanceof OpenAiIndeterminateRequestError || (providerCompleted && reserved);
    if (reserved && !manual && input.config.reserveCostUnits && input.repository.reconcileProviderCost) {
      await input.repository.reconcileProviderCost(input.job.id, input.config.reserveCostUnits, 0, input.now);
    }
    await input.repository.markRecoverable(input.job.id, "generating_game", manual ? "manual_retry_required" : "failed_recoverable", manual ? "manual_retry_required" : "grounding_quality_insufficient", input.now);
    return { outcome: "interrupted" as const };
  }
}
