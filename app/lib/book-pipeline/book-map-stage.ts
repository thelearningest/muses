import { chunkCanonicalBook } from "./chunk-book";
import type { BookMap, BookMapConcept, CanonicalBook, EvidenceCard } from "./contracts";
import type { BookJobRepository } from "./job-repository";

type StorePort = {
  getJson<T>(jobId: string, path: string): Promise<T | null>;
  putJson(jobId: string, path: string, value: unknown, expiresAt: number): Promise<void>;
};

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stableId(prefix: string, value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function scoreConcept(cards: EvidenceCard[]): number {
  if (cards.length === 0) return 0;
  const sectionSupport = new Set(cards.map((card) => card.sectionId)).size;
  const frequency = Math.min(cards.length, 3) / 3;
  const supportBreadth = Math.min(sectionSupport, 3) / 3;
  const actionable = cards.some((card) => card.playerVerbs.length > 0 && card.applicableProcess.length > 0) ? 1 : 0;
  const prerequisite = cards.some((card) => card.prerequisites.length > 0 || card.causalLinks.length > 0) ? 1 : 0;
  const visual = cards.some((card) => card.visualReferenceIds.length > 0) ? 1 : 0;
  const examples = cards.some((card) => card.successfulExamples.length > 0 && card.failureModes.length > 0) ? 1 : 0;
  const distinct = unique(cards.flatMap((card) => card.importanceSignals)).length > 0 ? 1 : 0;
  const confidence = cards.reduce((sum, card) => sum + card.confidence, 0) / cards.length;
  return Math.round(Math.min(1,
    frequency * 0.08 + supportBreadth * 0.14 + actionable * 0.22 + prerequisite * 0.1 +
    visual * 0.1 + examples * 0.16 + distinct * 0.08 + confidence * 0.12,
  ) * 1_000) / 1_000;
}

export function buildBookMap(canonical: CanonicalBook, cards: EvidenceCard[]): BookMap {
  const chunked = chunkCanonicalBook(canonical);
  const groups = new Map<string, EvidenceCard[]>();
  for (const card of cards) {
    const key = normalized(card.concept);
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  const concepts: BookMapConcept[] = [...groups.entries()].map(([key, matches]) => ({
    id: stableId("concept", key),
    name: matches[0].concept,
    summary: matches.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))[0].supportedClaim,
    evidenceCardIds: unique(matches.map((card) => card.id)).sort(),
    prerequisiteConceptIds: [],
    relatedConceptIds: [],
    score: scoreConcept(matches),
    confidence: Math.round((matches.reduce((sum, card) => sum + card.confidence, 0) / matches.length) * 1_000) / 1_000,
  }));
  concepts.sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.id.localeCompare(b.id));

  const byName = new Map(concepts.map((concept) => [normalized(concept.name), concept.id]));
  for (const concept of concepts) {
    const relatedCards = cards.filter((card) => concept.evidenceCardIds.includes(card.id));
    concept.prerequisiteConceptIds = unique(relatedCards.flatMap((card) => card.prerequisites)
      .map((name) => byName.get(normalized(name)) ?? "").filter(Boolean)).sort();
    concept.relatedConceptIds = unique(relatedCards.flatMap((card) => card.causalLinks)
      .map((name) => byName.get(normalized(name)) ?? "").filter((id) => id && id !== concept.id)).sort();
  }

  const chapters = chunked.sections.map((section) => {
    const matches = cards.filter((card) => card.sectionId === section.id);
    return {
      id: section.id,
      title: section.title,
      pageStart: section.pageStart,
      pageEnd: section.pageEnd,
      summary: matches[0]?.supportedClaim ?? "No sufficiently grounded summary was extracted for this section.",
      evidenceCardIds: matches.map((card) => card.id).sort(),
    };
  });
  const selected = concepts.slice(0, 9);
  const omissions = unique(cards.flatMap((card) => card.uncertainty));
  if (!selected.length) omissions.push("No independently supported quest concepts were found.");
  return {
    schemaVersion: 1,
    ...(canonical.source.title ? { bookTitle: canonical.source.title } : {}),
    thesis: selected[0]?.summary ?? "The source did not yield a sufficiently supported thesis.",
    learningArc: selected.map((concept) => concept.name),
    chapters,
    concepts,
    contradictions: unique(cards.flatMap((card) => card.contradictions)),
    visualOpportunities: unique(cards.filter((card) => card.visualReferenceIds.length > 0).map((card) => card.concept)),
    omissions,
    proposedQuestConceptIds: selected.map((concept) => concept.id),
  };
}

export async function buildBookMapStage(input: {
  job: { id: string; batchCursor: number; expiresAt: number };
  canonical: CanonicalBook;
  repository: Pick<BookJobRepository, "commitStage" | "markRecoverable">;
  store: StorePort;
  now: number;
}) {
  try {
    const batches = await Promise.all(Array.from({ length: input.job.batchCursor }, (_, index) =>
      input.store.getJson<{ cards: EvidenceCard[] }>(input.job.id, `evidence/${index}.json`),
    ));
    if (batches.some((batch) => !batch)) throw new Error("An evidence batch is missing");
    const map = buildBookMap(input.canonical, batches.flatMap((batch) => batch?.cards ?? []));
    if (map.proposedQuestConceptIds.length < 1) throw new Error("Insufficient supported concepts");
    await input.store.putJson(input.job.id, "book-map.json", map, input.job.expiresAt);
    await input.store.putJson(input.job.id, "evidence-manifest.json", { batchCount: input.job.batchCursor }, input.job.expiresAt);
    await input.repository.commitStage({
      jobId: input.job.id,
      expectedStatus: "building_book_map",
      nextStatus: "annotating_visuals",
      now: input.now,
      batchCursor: 0,
    });
    return { outcome: "complete" as const, conceptCount: map.proposedQuestConceptIds.length };
  } catch {
    await input.repository.markRecoverable(input.job.id, "building_book_map", "failed_recoverable", "grounding_quality_insufficient", input.now);
    return { outcome: "interrupted" as const };
  }
}
