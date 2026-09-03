import { chunkCanonicalBook } from "./chunk-book";
import type { ReasoningEffort } from "./config";
import type { CanonicalBook, EvidenceCard } from "./contracts";
import { EVIDENCE_CARDS_SCHEMA } from "./evidence-schema";
import type { BookJobRepository } from "./job-repository";
import {
  OpenAiIndeterminateRequestError,
  type StructuredOutputProvider,
} from "./providers/openai";

const MAX_EXCERPT_CHARS = 480;

export function validateEvidenceCards(
  cards: EvidenceCard[],
  canonical: CanonicalBook,
): EvidenceCard[] {
  const blocks = new Set(canonical.blocks.map((block) => block.id));
  const visuals = new Set(
    canonical.pages.flatMap((page) => page.visualReferences.map((visual) => visual.id)),
  );
  for (const card of cards) {
    if (!card.id || !card.sectionId || !card.concept || !card.supportedClaim) {
      throw new Error("Evidence card is missing required content");
    }
    if (!Number.isFinite(card.confidence) || card.confidence < 0 || card.confidence > 1) {
      throw new Error("Evidence confidence is invalid");
    }
    for (const source of card.sources) {
      if (
        source.pageStart < 0 ||
        source.pageEnd < source.pageStart ||
        source.pageEnd >= canonical.source.pageCount
      ) {
        throw new Error("Evidence page anchor is invalid");
      }
      if (source.canonicalBlockIds.length === 0 || source.canonicalBlockIds.some((id) => !blocks.has(id))) {
        throw new Error("Evidence cites a missing canonical block");
      }
      if ((source.boundedExcerpt?.length ?? 0) > MAX_EXCERPT_CHARS) {
        throw new Error("Evidence excerpt exceeds the bounded limit");
      }
    }
    if (card.visualReferenceIds.some((id) => !visuals.has(id))) {
      throw new Error("Evidence cites a missing visual reference");
    }
  }
  return cards;
}

type RepositoryPort = Pick<
  BookJobRepository,
  | "commitStage"
  | "markRecoverable"
  | "appendOpenAiRequestId"
> &
  Partial<
    Pick<BookJobRepository, "reserveProviderCost" | "reconcileProviderCost">
  >;

export async function mapEvidenceBatch(input: {
  job: {
    id: string;
    status: "mapping_evidence";
    batchCursor: number;
    identityHash: string;
    expiresAt: number;
  };
  canonical: CanonicalBook;
  provider: StructuredOutputProvider;
  repository: RepositoryPort;
  store: {
    getJson<T>(jobId: string, path: string): Promise<T | null>;
    putJson(jobId: string, path: string, value: unknown, expiresAt: number): Promise<void>;
  };
  config: {
    model: string;
    reasoningEffort: ReasoningEffort;
    sectionsPerBatch: number;
    reserveCostUnits?: number;
    maxCostUnits?: number;
  };
  now: number;
}) {
  const chunked = chunkCanonicalBook(input.canonical);
  const batches = Array.from(
    { length: Math.ceil(chunked.sections.length / input.config.sectionsPerBatch) },
    (_, index) =>
      chunked.sections.slice(
        index * input.config.sectionsPerBatch,
        (index + 1) * input.config.sectionsPerBatch,
      ),
  );
  if (input.job.batchCursor >= batches.length) {
    await input.repository.commitStage({
      jobId: input.job.id,
      expectedStatus: "mapping_evidence",
      nextStatus: "building_book_map",
      now: input.now,
    });
    return { outcome: "complete", completedBatches: batches.length, totalBatches: batches.length };
  }

  const path = `evidence/${input.job.batchCursor}.json`;
  const existing = await input.store.getJson<{ cards: EvidenceCard[] }>(input.job.id, path);
  if (!existing) {
    const sections = batches[input.job.batchCursor];
    try {
      if (
        input.config.reserveCostUnits &&
        input.config.maxCostUnits &&
        input.repository.reserveProviderCost &&
        !(await input.repository.reserveProviderCost(
          input.job.id,
          input.config.reserveCostUnits,
          input.config.maxCostUnits,
          input.now,
        ))
      ) {
        throw new Error("The job provider budget is exhausted");
      }
      const response = await input.provider.generateStructured<{ cards: EvidenceCard[] }>({
        model: input.config.model,
        reasoningEffort: input.config.reasoningEffort,
        schemaName: "evidence_cards",
        schema: EVIDENCE_CARDS_SCHEMA,
        instructions:
          "Map the supplied bounded book sections into concise source-grounded evidence cards. Preserve canonical block and page anchors. Do not quote more than the bounded excerpt field permits. Mark uncertainty instead of inventing support.",
        input: JSON.stringify({
          book: input.canonical.source.title ?? input.canonical.source.filename,
          sections: sections.map((section) => ({
            id: section.id,
            title: section.title,
            pageStart: section.pageStart,
            pageEnd: section.pageEnd,
            blockIds: section.blockIds,
            text: section.text,
          })),
        }),
        safetyIdentifier: input.job.identityHash,
      });
      if (input.config.reserveCostUnits && input.repository.reconcileProviderCost) {
        await input.repository.reconcileProviderCost(
          input.job.id,
          input.config.reserveCostUnits,
          Math.max(1, Math.ceil(response.usage.totalTokens / 1_000)),
          input.now,
        );
      }
      const cards = validateEvidenceCards(response.data.cards, input.canonical);
      const sectionIds = new Set(sections.map((section) => section.id));
      if (cards.some((card) => !sectionIds.has(card.sectionId))) {
        throw new Error("Evidence card cites a section outside its batch");
      }
      await input.store.putJson(
        input.job.id,
        path,
        { cards, responseId: response.responseId, usage: response.usage },
        input.job.expiresAt,
      );
      await input.repository.appendOpenAiRequestId(
        input.job.id,
        response.requestId ?? response.responseId,
        input.now,
      );
    } catch (error) {
      const manual = error instanceof OpenAiIndeterminateRequestError;
      await input.repository.markRecoverable(
        input.job.id,
        "mapping_evidence",
        manual ? "manual_retry_required" : "failed_recoverable",
        manual ? "manual_retry_required" : "grounding_quality_insufficient",
        input.now,
      );
      return { outcome: "interrupted", completedBatches: input.job.batchCursor, totalBatches: batches.length };
    }
  }

  const nextCursor = input.job.batchCursor + 1;
  const done = nextCursor >= batches.length;
  await input.repository.commitStage({
    jobId: input.job.id,
    expectedStatus: "mapping_evidence",
    nextStatus: done ? "building_book_map" : "mapping_evidence",
    now: input.now,
    batchCursor: nextCursor,
  });
  return {
    outcome: done ? "complete" : "advanced",
    completedBatches: nextCursor,
    totalBatches: batches.length,
  };
}
