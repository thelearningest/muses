import { describe, expect, it, vi } from "vitest";

import { buildBookMap, buildBookMapStage, scoreConcept } from "../../app/lib/book-pipeline/book-map-stage";
import { chunkCanonicalBook } from "../../app/lib/book-pipeline/chunk-book";
import type { CanonicalBook, EvidenceCard } from "../../app/lib/book-pipeline/contracts";

function fixture(): { canonical: CanonicalBook; cards: EvidenceCard[] } {
  const canonical: CanonicalBook = {
    schemaVersion: 1,
    source: { fingerprint: "f", filename: "book.pdf", title: "Practical Inquiry", pageCount: 4 },
    pages: Array.from({ length: 4 }, (_, index) => ({ index, blockIds: [`h${index}`, `p${index}`], visualReferences: [], warnings: [] })),
    blocks: Array.from({ length: 4 }, (_, index) => [
      { id: `h${index}`, pageIndex: index, type: "heading" as const, readingOrder: 0, text: `Step ${index + 1}`, ancestorHeadings: [], visualReferenceIds: [] },
      { id: `p${index}`, pageIndex: index, type: "paragraph" as const, readingOrder: 1, text: `Grounded practice ${index + 1}`, ancestorHeadings: [`Step ${index + 1}`], visualReferenceIds: [] },
    ]).flat(),
    warnings: [],
  };
  const sections = chunkCanonicalBook(canonical).sections;
  const cards = sections.map((section, index): EvidenceCard => ({
    id: `card-${index}`,
    sectionId: section.id,
    concept: `Concept ${index + 1}`,
    supportedClaim: `Claim ${index + 1}`,
    sources: [{ pageStart: index, pageEnd: index, canonicalBlockIds: [`p${index}`], boundedExcerpt: `Grounded practice ${index + 1}` }],
    playerVerbs: ["apply"], applicableProcess: ["test"], successfulExamples: ["works"], failureModes: ["fails"], misconceptions: [], prerequisites: index ? [`Concept ${index}`] : [], causalLinks: [], tradeoffs: [], visualReferenceIds: [], importanceSignals: ["chapter"], confidence: 0.9, uncertainty: [], contradictions: [],
  }));
  return { canonical, cards };
}

describe("global book map", () => {
  it("reads every completed evidence batch before selection", async () => {
    const { canonical, cards } = fixture();
    const writes = new Map<string, unknown>();
    const commitStage = vi.fn(async () => true);
    const result = await buildBookMapStage({
      job: { id: "job", batchCursor: 2, expiresAt: 9_999 },
      canonical,
      repository: { commitStage, markRecoverable: vi.fn() },
      store: {
        getJson: async <T,>(_job: string, path: string) => ({ cards: path.endsWith("0.json") ? cards.slice(0, 2) : cards.slice(2) }) as T,
        putJson: async (_job, path, value) => { writes.set(path, value); },
      },
      now: 1,
    });
    expect(result).toMatchObject({ outcome: "complete", conceptCount: 4 });
    expect((writes.get("book-map.json") as { concepts: unknown[] }).concepts).toHaveLength(4);
    expect(writes.get("evidence-manifest.json")).toEqual({ batchCount: 2 });
  });

  it("does not let frequency alone dominate a well-supported actionable concept", () => {
    const { cards } = fixture();
    const repeated = Array.from({ length: 12 }, (_, index) => ({ ...cards[0], id: `thin-${index}`, playerVerbs: [], applicableProcess: [], successfulExamples: [], failureModes: [], prerequisites: [], importanceSignals: [], confidence: 0.5 }));
    expect(scoreConcept(repeated)).toBeLessThan(scoreConcept([cards[1]]));
  });

  it("selects four to nine concepts using stable scores", () => {
    const { canonical, cards } = fixture();
    const map = buildBookMap(canonical, [...cards, ...cards.map((card, index) => ({ ...card, id: `extra-${index}`, concept: `Extra ${index}` }))]);
    expect(map.proposedQuestConceptIds.length).toBeGreaterThanOrEqual(4);
    expect(map.proposedQuestConceptIds.length).toBeLessThanOrEqual(9);
  });
});
