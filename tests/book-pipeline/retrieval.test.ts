import { describe, expect, it, vi } from "vitest";

import type { RetrievalUnit } from "../../app/lib/book-pipeline/chunk-book";
import type { BookMap, CanonicalBook, EvidenceCard } from "../../app/lib/book-pipeline/contracts";
import { buildQuestContract, expandWithinParent, reciprocalRankFusion, retrieveQuestEvidenceStage } from "../../app/lib/book-pipeline/retrieval";
import { OpenAiEmbeddingsProvider } from "../../app/lib/book-pipeline/providers/openai";

function retrievalFixture(fetcher: (_url: string, init?: RequestInit) => Promise<Response>) {
  const canonical: CanonicalBook = { schemaVersion: 1, source: { fingerprint: "f", filename: "book.pdf", pageCount: 1 }, pages: [{ index: 0, blockIds: ["b"], visualReferences: [], warnings: [] }], blocks: [{ id: "b", pageIndex: 0, type: "paragraph", readingOrder: 0, text: "Observe before deciding.", ancestorHeadings: [], visualReferenceIds: [] }], warnings: [] };
  const bookMap: BookMap = { schemaVersion: 1, thesis: "Observe first", learningArc: ["Observe"], chapters: [], concepts: [{ id: "c", name: "Observe", summary: "Observe first", evidenceCardIds: [], prerequisiteConceptIds: [], relatedConceptIds: [], score: 1, confidence: 1 }], contradictions: [], visualOpportunities: [], omissions: [], proposedQuestConceptIds: ["c"] };
  const repository = { reserveProviderCost: vi.fn().mockResolvedValue(true), reconcileProviderCost: vi.fn(), appendOpenAiRequestId: vi.fn(), commitStage: vi.fn(), markRecoverable: vi.fn() };
  const store = { getJson: async <T,>(_job: string, path: string): Promise<T | null> => (path === "evidence-manifest.json" ? { batchCount: 1 } : { cards: [] }) as T, putJson: vi.fn() };
  return { job: { id: "job", batchCursor: 0, identityHash: "identity", expiresAt: 999 }, canonical, bookMap, visualAnnotations: [], provider: new OpenAiEmbeddingsProvider("test", fetcher), repository, store, model: "text-embedding-3-small", reserveCostUnits: 100, maxCostUnits: 1000, now: 1 };
}

describe("hybrid quest retrieval", () => {
  it("retains reservations and requires explicit retry after embedding transport failure", async () => {
    const input = retrievalFixture(async () => { throw new TypeError("connection lost"); });
    await retrieveQuestEvidenceStage(input);
    expect(input.repository.reconcileProviderCost).not.toHaveBeenCalled();
    expect(input.repository.markRecoverable).toHaveBeenCalledWith("job", "retrieving_quest_evidence", "manual_retry_required", "manual_retry_required", 1);
  });
  it("does not release a paid embedding charge when later grounding fails", async () => {
    const input = retrievalFixture(async () => Response.json({ data: [{ index: 0, embedding: [1] }, { index: 1, embedding: [1] }] }));
    expect(await retrieveQuestEvidenceStage(input)).toMatchObject({ outcome: "interrupted" });
    expect(input.repository.reconcileProviderCost.mock.calls).toEqual([["job", 100, 100, 1]]);
    expect(input.store.putJson).not.toHaveBeenCalled();
  });
  it("retains the reservation if accounting persistence fails after a paid result", async () => {
    const input = retrievalFixture(async () => Response.json({ data: [{ index: 0, embedding: [1] }, { index: 1, embedding: [1] }] }));
    input.repository.reconcileProviderCost.mockRejectedValueOnce(new Error("Database unavailable"));
    await retrieveQuestEvidenceStage(input);
    expect(input.repository.reconcileProviderCost.mock.calls).toEqual([["job", 100, 100, 1]]);
    expect(input.repository.markRecoverable).toHaveBeenCalledWith("job", "retrieving_quest_evidence", "manual_retry_required", "manual_retry_required", 1);
  });
  it("releases a reservation after a definite API rejection", async () => {
    const input = retrievalFixture(async () => new Response(null, { status: 401 }));
    await retrieveQuestEvidenceStage(input);
    expect(input.repository.reconcileProviderCost.mock.calls).toEqual([["job", 100, 0, 1]]);
  });
  it("fuses missing lexical/vector results and resolves ties stably", () => {
    expect(reciprocalRankFusion([
      [{ id: "b", score: 2 }, { id: "a", score: 1 }],
      [{ id: "c", score: 2 }, { id: "a", score: 1 }],
    ]).map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(reciprocalRankFusion([[], [{ id: "x", score: 1 }]])[0].id).toBe("x");
  });

  it("expands only to adjacent units in the same parent section", () => {
    const units: RetrievalUnit[] = [
      { id: "a", parentSectionId: "one", pageStart: 0, pageEnd: 0, blockIds: ["a"], contextPrefix: "", text: "", nextUnitId: "b" },
      { id: "b", parentSectionId: "one", pageStart: 0, pageEnd: 0, blockIds: ["b"], contextPrefix: "", text: "", previousUnitId: "a", nextUnitId: "c" },
      { id: "c", parentSectionId: "two", pageStart: 1, pageEnd: 1, blockIds: ["c"], contextPrefix: "", text: "", previousUnitId: "b" },
    ];
    expect(expandWithinParent(["b"], units).map((unit) => unit.id)).toEqual(["a", "b"]);
  });

  it("reports missing evidence instead of filling gaps", () => {
    const concept: BookMap["concepts"][number] = { id: "concept", name: "Observe", summary: "Observe first", evidenceCardIds: ["card"], prerequisiteConceptIds: [], relatedConceptIds: [], score: 0.9, confidence: 0.9 };
    const card = { id: "card", sectionId: "s", concept: "Observe", supportedClaim: "", sources: [], playerVerbs: [], applicableProcess: [], successfulExamples: [], failureModes: [], misconceptions: [], prerequisites: [], causalLinks: [], tradeoffs: [], visualReferenceIds: [], importanceSignals: [], confidence: 0.5, uncertainty: [], contradictions: [] } satisfies EvidenceCard;
    expect(buildQuestContract({ concept, evidenceCards: [card], visualAnnotations: [] }).missingEvidence).toEqual(expect.arrayContaining(["central_claim", "player_action", "source_anchor", "example", "failure_mode"]));
  });
});
