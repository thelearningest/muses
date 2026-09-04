import { describe, expect, it, vi } from "vitest";

import type { CanonicalBook, EvidenceCard } from "../../app/lib/book-pipeline/contracts";
import {
  mapEvidenceBatch,
  validateEvidenceCards,
} from "../../app/lib/book-pipeline/evidence-stage";
import {
  OpenAiIndeterminateRequestError,
  OpenAiResponsesProvider,
  type StructuredOutputProvider,
} from "../../app/lib/book-pipeline/providers/openai";

const canonical: CanonicalBook = {
  schemaVersion: 1,
  source: { fingerprint: "fingerprint", filename: "book.pdf", title: "Field Notes", pageCount: 1 },
  pages: [{ index: 0, blockIds: ["h-1", "p-1"], visualReferences: [], warnings: [] }],
  blocks: [
    { id: "h-1", pageIndex: 0, type: "heading", readingOrder: 0, text: "Observe", ancestorHeadings: [], visualReferenceIds: [] },
    { id: "p-1", pageIndex: 0, type: "paragraph", readingOrder: 1, text: "Record observations first.", ancestorHeadings: ["Observe"], visualReferenceIds: [] },
  ],
  warnings: [],
};

const card: EvidenceCard = {
  id: "card-1",
  sectionId: "section-1",
  concept: "Separate observation from explanation",
  supportedClaim: "Record observations before proposing causes.",
  sources: [{ pageStart: 0, pageEnd: 0, canonicalBlockIds: ["p-1"], boundedExcerpt: "Record observations first." }],
  playerVerbs: ["observe", "classify"],
  applicableProcess: ["record evidence"],
  successfulExamples: [],
  failureModes: ["premature explanation"],
  misconceptions: [],
  prerequisites: [],
  causalLinks: [],
  tradeoffs: [],
  visualReferenceIds: [],
  importanceSignals: ["section heading"],
  confidence: 0.9,
  uncertainty: [],
  contradictions: [],
};

describe("OpenAI evidence mapping", () => {
  it("retains the paid reservation when usage persistence fails", async () => {
    const repository = { commitStage: vi.fn(), markRecoverable: vi.fn(), appendOpenAiRequestId: vi.fn(), reserveProviderCost: vi.fn().mockResolvedValue(true), reconcileProviderCost: vi.fn().mockRejectedValueOnce(new Error("Database unavailable")) };
    const provider = { generateStructured: vi.fn(async () => ({ responseId: "resp", data: { cards: [card] }, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } })) } as unknown as StructuredOutputProvider;
    await mapEvidenceBatch({ job: { id: "job", status: "mapping_evidence", batchCursor: 0, identityHash: "identity", expiresAt: 99 }, canonical, provider, repository, store: { getJson: async () => null, putJson: vi.fn() }, config: { model: "gpt-5.4-mini", reasoningEffort: "low", sectionsPerBatch: 3, reserveCostUnits: 100, maxCostUnits: 1000 }, now: 1 });
    expect(repository.reconcileProviderCost.mock.calls).toEqual([["job", 100, 1, 1]]);
    expect(repository.markRecoverable).toHaveBeenCalledWith("job", "mapping_evidence", "manual_retry_required", "manual_retry_required", 1, "mapping_evidence", 0);
  });
  it("uses strict structured output, store false, tracing, and a hashed safety id", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toContain("/responses");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "gpt-5.4-mini",
        store: false,
        reasoning: { effort: "low" },
        text: { format: { type: "json_schema", strict: true } },
        safety_identifier: "hashed-identity",
      });
      expect(body.input).not.toMatch(/%PDF/);
      return Response.json({
        id: "resp-1",
        status: "completed",
        output_text: JSON.stringify({ cards: [card] }),
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      }, { headers: { "x-request-id": "req-1" } });
    });
    const provider = new OpenAiResponsesProvider("secret", fetcher);
    await expect(provider.generateStructured({
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
      schemaName: "evidence_cards",
      schema: { type: "object" },
      instructions: "Map evidence.",
      input: "A bounded section",
      safetyIdentifier: "hashed-identity",
    })).resolves.toMatchObject({ responseId: "resp-1", requestId: "req-1", usage: { totalTokens: 150 } });
  });

  it("skips a provider call when the batch artifact is already committed", async () => {
    const provider = { generateStructured: vi.fn() };
    const commitStage = vi.fn(async () => true);
    await mapEvidenceBatch({
      job: { id: "job-1", status: "mapping_evidence", batchCursor: 0, identityHash: "identity", expiresAt: 10_000 },
      canonical,
      provider,
      repository: { commitStage, markRecoverable: vi.fn(), appendOpenAiRequestId: vi.fn() },
      store: {
        getJson: async <T,>() => ({ cards: [card] }) as T,
        putJson: vi.fn(),
      },
      config: { model: "gpt-5.4-mini", reasoningEffort: "low", sectionsPerBatch: 3 },
      now: 1_000,
    });
    expect(provider.generateStructured).not.toHaveBeenCalled();
    expect(commitStage).toHaveBeenCalled();
  });

  it("rejects cards with missing blocks, invalid pages, or oversized excerpts", () => {
    expect(() => validateEvidenceCards([{ ...card, sources: [{ ...card.sources[0], canonicalBlockIds: ["missing"] }] }], canonical)).toThrow(/block/i);
    expect(() => validateEvidenceCards([{ ...card, sources: [{ ...card.sources[0], pageEnd: 2 }] }], canonical)).toThrow(/page/i);
    expect(() => validateEvidenceCards([{ ...card, sources: [{ ...card.sources[0], boundedExcerpt: "x".repeat(600) }] }], canonical)).toThrow(/excerpt/i);
  });

  it("rejects existing blocks attributed to the wrong PDF page", () => {
    const book = { ...canonical, source: { ...canonical.source, pageCount: 2 } };
    expect(() => validateEvidenceCards([{ ...card, sources: [{ ...card.sources[0], pageStart: 1, pageEnd: 1 }] }], book)).toThrow(/page/i);
  });

  it("rejects fabricated excerpts and unsupported empty source lists", () => {
    expect(() => validateEvidenceCards([{ ...card, sources: [{ ...card.sources[0], boundedExcerpt: "The author recommends guessing without observing." }] }], canonical)).toThrow(/excerpt/i);
    expect(() => validateEvidenceCards([{ ...card, sources: [] }], canonical)).toThrow(/source/i);
  });

  it("requires integer page anchors and accepts only source-faithful whitespace normalization", () => {
    expect(() => validateEvidenceCards([{ ...card, sources: [{ ...card.sources[0], pageStart: Number.NaN }] }], canonical)).toThrow(/page/i);
    expect(() => validateEvidenceCards([{ ...card, sources: [{ ...card.sources[0], pageStart: 0.5 }] }], canonical)).toThrow(/page/i);
    expect(validateEvidenceCards([{ ...card, sources: [{ ...card.sources[0], boundedExcerpt: "Record\n observations first." }] }], canonical)).toHaveLength(1);
  });

  it("rejects a card borrowing evidence from another section in the same batch", async () => {
    const book: CanonicalBook = { ...canonical, source: { ...canonical.source, pageCount: 2 },
      pages: [...canonical.pages, { index: 1, blockIds: ["h-2", "p-2"], visualReferences: [], warnings: [] }],
      blocks: [...canonical.blocks,
        { ...canonical.blocks[0], id: "h-2", pageIndex: 1, text: "Compare" },
        { ...canonical.blocks[1], id: "p-2", pageIndex: 1, text: "Compare alternative explanations." }],
    };
    const putJson = vi.fn();
    const result = await mapEvidenceBatch({
      job: { id: "job-1", status: "mapping_evidence", batchCursor: 0, identityHash: "identity", expiresAt: 10_000 }, canonical: book,
      provider: { async generateStructured<T>(request: Parameters<StructuredOutputProvider["generateStructured"]>[0]) {
        const sectionId = JSON.parse(request.input).sections[0].id;
        return { responseId: "resp", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, data: { cards: [{ ...card, sectionId,
          sources: [{ pageStart: 1, pageEnd: 1, canonicalBlockIds: ["p-2"], boundedExcerpt: "Compare alternative explanations." }] }] } as T };
      } },
      repository: { commitStage: vi.fn(), markRecoverable: vi.fn(), appendOpenAiRequestId: vi.fn() },
      store: { getJson: vi.fn(async () => null), putJson },
      config: { model: "gpt-5.4-mini", reasoningEffort: "low", sectionsPerBatch: 3 }, now: 1_000,
    });
    expect(result.outcome).toBe("interrupted");
    expect(putJson).not.toHaveBeenCalled();
  });

  it("requires manual retry for an indeterminate OpenAI outcome", async () => {
    const markRecoverable = vi.fn(async () => true);
    await mapEvidenceBatch({
      job: { id: "job-1", status: "mapping_evidence", batchCursor: 0, identityHash: "identity", expiresAt: 10_000 },
      canonical,
      provider: { generateStructured: vi.fn(async () => { throw new OpenAiIndeterminateRequestError(); }) },
      repository: { commitStage: vi.fn(), markRecoverable, appendOpenAiRequestId: vi.fn() },
      store: { getJson: vi.fn(async () => null), putJson: vi.fn() },
      config: { model: "gpt-5.4-mini", reasoningEffort: "low", sectionsPerBatch: 3 },
      now: 1_000,
    });
    expect(markRecoverable).toHaveBeenCalledWith(
      "job-1",
      "mapping_evidence",
      "manual_retry_required",
      "manual_retry_required",
      1_000,
      "mapping_evidence",
      0,
    );
  });
});
