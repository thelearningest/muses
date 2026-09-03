import { chunkCanonicalBook, type RetrievalUnit } from "./chunk-book";
import type {
  BookMap,
  CanonicalBook,
  EvidenceCard,
  QuestEvidenceContract,
  QuestEvidenceMissingField,
} from "./contracts";
import type { BookJobRepository } from "./job-repository";

export interface EmbeddingProvider {
  embed(input: { model: string; values: string[] }): Promise<{ vectors: number[][]; requestId?: string }>;
}

export type RankedItem = { id: string; score: number };
export type StoredVisualAnnotation = {
  visualReferenceId: string;
  pageIndex: number;
  description: string;
  role: string;
  confidence: number;
};

function terms(value: string): string[] {
  return value.toLocaleLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
}

export function lexicalRank(query: string, units: RetrievalUnit[]): RankedItem[] {
  const queryTerms = [...new Set(terms(query))];
  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    documentFrequency.set(term, units.filter((unit) => terms(`${unit.contextPrefix} ${unit.text}`).includes(term)).length);
  }
  return units.map((unit) => {
    const unitTerms = terms(`${unit.contextPrefix} ${unit.text}`);
    const counts = new Map<string, number>();
    for (const term of unitTerms) counts.set(term, (counts.get(term) ?? 0) + 1);
    const score = queryTerms.reduce((sum, term) => {
      const tf = counts.get(term) ?? 0;
      const idf = Math.log(1 + (units.length + 1) / ((documentFrequency.get(term) ?? 0) + 1));
      return sum + (tf / (tf + 1.2)) * idf;
    }, 0);
    return { id: unit.id, score };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aa += a[index] ** 2;
    bb += b[index] ** 2;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function vectorRank(query: number[], unitVectors: Array<{ id: string; vector: number[] }>): RankedItem[] {
  return unitVectors.map((item) => ({ id: item.id, score: cosine(query, item.vector) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function reciprocalRankFusion(rankings: RankedItem[][], k = 60): RankedItem[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((item, index) => scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + index + 1)));
  }
  return [...scores].map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function expandWithinParent(selectedIds: string[], units: RetrievalUnit[]): RetrievalUnit[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const expanded = new Set<string>();
  for (const id of selectedIds) {
    const unit = byId.get(id);
    if (!unit) continue;
    expanded.add(unit.id);
    for (const neighborId of [unit.previousUnitId, unit.nextUnitId]) {
      const neighbor = neighborId ? byId.get(neighborId) : undefined;
      if (neighbor?.parentSectionId === unit.parentSectionId) expanded.add(neighbor.id);
    }
  }
  return units.filter((unit) => expanded.has(unit.id));
}

export function buildQuestContract(input: {
  concept: BookMap["concepts"][number];
  evidenceCards: EvidenceCard[];
  visualAnnotations: StoredVisualAnnotation[];
}): QuestEvidenceContract {
  const cards = input.evidenceCards.filter((card) => input.concept.evidenceCardIds.includes(card.id));
  const sources = cards.flatMap((card) => card.sources);
  const actions = [...new Set(cards.flatMap((card) => [...card.playerVerbs, ...card.applicableProcess]))];
  const missing: QuestEvidenceMissingField[] = [];
  const centralClaim = cards.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))[0]?.supportedClaim;
  if (!centralClaim) missing.push("central_claim");
  if (actions.length === 0) missing.push("player_action");
  if (sources.length === 0) missing.push("source_anchor");
  if (!cards.some((card) => card.successfulExamples.length > 0)) missing.push("example");
  if (!cards.some((card) => card.failureModes.length > 0)) missing.push("failure_mode");
  const visualIds = new Set(cards.flatMap((card) => card.visualReferenceIds));
  const visuals = input.visualAnnotations.filter((annotation) => visualIds.has(annotation.visualReferenceId));
  if (visualIds.size > 0 && visuals.length === 0) missing.push("visual_evidence");
  return {
    id: `contract-${input.concept.id}`,
    conceptId: input.concept.id,
    ...(centralClaim ? { centralClaim } : {}),
    playerActions: actions,
    sources,
    visualAnnotations: visuals.map((annotation) => ({
      visualReferenceId: annotation.visualReferenceId,
      description: annotation.description,
      source: {
        pageStart: annotation.pageIndex,
        pageEnd: annotation.pageIndex,
        canonicalBlockIds: cards.flatMap((card) => card.sources.flatMap((source) => source.canonicalBlockIds)).slice(0, 4),
      },
    })),
    confidence: cards.length ? Math.round(cards.reduce((sum, card) => sum + card.confidence, 0) / cards.length * 1_000) / 1_000 : 0,
    missingEvidence: missing,
  };
}

export async function retrieveQuestEvidenceStage(input: {
  job: { id: string; batchCursor: number; identityHash: string; expiresAt: number };
  canonical: CanonicalBook;
  bookMap: BookMap;
  visualAnnotations: StoredVisualAnnotation[];
  provider: EmbeddingProvider;
  repository: Pick<BookJobRepository, "commitStage" | "markRecoverable" | "appendOpenAiRequestId">;
  store: {
    getJson<T>(jobId: string, path: string): Promise<T | null>;
    putJson(jobId: string, path: string, value: unknown, expiresAt: number): Promise<void>;
  };
  model: string;
  now: number;
}) {
  try {
    const manifest = await input.store.getJson<{ batchCount: number }>(input.job.id, "evidence-manifest.json");
    if (!manifest || !Number.isSafeInteger(manifest.batchCount) || manifest.batchCount < 1) throw new Error("Evidence manifest is missing");
    const evidenceBatches = await Promise.all(Array.from({ length: manifest.batchCount }, (_, index) =>
      input.store.getJson<{ cards: EvidenceCard[] }>(input.job.id, `evidence/${index}.json`),
    ));
    if (evidenceBatches.some((batch) => !batch)) throw new Error("Evidence is incomplete");
    const cards = evidenceBatches.flatMap((batch) => batch?.cards ?? []);
    const units = chunkCanonicalBook(input.canonical).units;
    const concepts = input.bookMap.proposedQuestConceptIds.map((id) => input.bookMap.concepts.find((concept) => concept.id === id)).filter((value): value is BookMap["concepts"][number] => Boolean(value));
    const values = [...units.map((unit) => `${unit.contextPrefix}\n${unit.text}`), ...concepts.map((concept) => `${concept.name}\n${concept.summary}`)];
    const embedded = await input.provider.embed({ model: input.model, values });
    if (embedded.vectors.length !== values.length) throw new Error("Embedding count mismatch");
    if (embedded.requestId) await input.repository.appendOpenAiRequestId(input.job.id, embedded.requestId, input.now);
    const unitVectors = units.map((unit, index) => ({ id: unit.id, vector: embedded.vectors[index] }));
    const contracts = concepts.map((concept, index) => {
      const lexical = lexicalRank(`${concept.name} ${concept.summary}`, units);
      const vector = vectorRank(embedded.vectors[units.length + index], unitVectors);
      const fused = reciprocalRankFusion([lexical, vector]).slice(0, 5);
      const expanded = expandWithinParent(fused.map((item) => item.id), units);
      const relevantBlocks = new Set(expanded.flatMap((unit) => unit.blockIds));
      const conceptCards = cards.filter((card) => concept.evidenceCardIds.includes(card.id) || card.sources.some((source) => source.canonicalBlockIds.some((id) => relevantBlocks.has(id))));
      return buildQuestContract({ concept, evidenceCards: conceptCards, visualAnnotations: input.visualAnnotations });
    });
    if (contracts.some((contract) => contract.missingEvidence.includes("central_claim") || contract.missingEvidence.includes("player_action") || contract.missingEvidence.includes("source_anchor"))) {
      throw new Error("A proposed quest lacks required evidence");
    }
    await input.store.putJson(input.job.id, "retrieval-index.json", {
      units: units.map((unit, index) => ({ ...unit, vector: unitVectors[index].vector })),
      model: input.model,
    }, input.job.expiresAt);
    await input.store.putJson(input.job.id, "quest-evidence.json", { contracts }, input.job.expiresAt);
    await input.repository.commitStage({ jobId: input.job.id, expectedStatus: "retrieving_quest_evidence", nextStatus: "generating_game", now: input.now });
    return { outcome: "complete" as const, contractCount: contracts.length };
  } catch {
    await input.repository.markRecoverable(input.job.id, "retrieving_quest_evidence", "failed_recoverable", "grounding_quality_insufficient", input.now);
    return { outcome: "interrupted" as const };
  }
}
