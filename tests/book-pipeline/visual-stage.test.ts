import { describe, expect, it, vi } from "vitest";

import type { CanonicalBook, EvidenceCard } from "../../app/lib/book-pipeline/contracts";
import { advanceVisualStage, selectVisualPages } from "../../app/lib/book-pipeline/visual-stage";

function fixture(count = 14): CanonicalBook {
  return {
    schemaVersion: 1,
    source: { fingerprint: "f", filename: "book.pdf", pageCount: count },
    pages: Array.from({ length: count }, (_, index) => ({ index, blockIds: [`b${index}`], visualReferences: [{ id: `v${index}`, pageIndex: index, kind: "figure", captionBlockIds: [] }], warnings: index % 2 ? [] : ["low_ocr_confidence"] })),
    blocks: Array.from({ length: count }, (_, index) => ({ id: `b${index}`, pageIndex: index, type: "paragraph" as const, readingOrder: 0, text: `Page ${index}`, ancestorHeadings: [], visualReferenceIds: [`v${index}`] })),
    warnings: [],
  };
}

describe("selective visual annotation", () => {
  it("is deterministic and never exceeds the twelve-page ceiling", () => {
    const canonical = fixture();
    const cards = [{ visualReferenceIds: ["v3", "v5"] }] as EvidenceCard[];
    expect(selectVisualPages(canonical, cards, 99)).toEqual(selectVisualPages(canonical, cards, 99));
    expect(selectVisualPages(canonical, cards, 99)).toHaveLength(12);
    expect(selectVisualPages(canonical, cards, 2)).toEqual([3, 5]);
  });

  it("splits annotation work into resumable calls of at most eight pages", async () => {
    const canonical = fixture(12);
    const annotate = vi.fn(async ({ pages }: { pages: number[] }) => pages.map((page) => ({ visualReferenceId: `${page}:0`, pageIndex: page, description: `Visual ${page}`, role: "example", confidence: 0.8 })));
    const artifacts = new Map<string, unknown>();
    await advanceVisualStage({
      job: { id: "job", batchCursor: 0, expiresAt: 100 }, canonical, evidenceCards: [], provider: { annotate },
      repository: { commitStage: vi.fn(), markRecoverable: vi.fn() },
      store: { getJson: async <T,>(_job: string, path: string) => (artifacts.get(path) as T | undefined) ?? null, putJson: async (_job, path, value) => { artifacts.set(path, value); } },
      config: { model: "mistral-ocr-4-1", maxPages: 12 }, sourceUrl: "https://example.test/source", now: 1,
    });
    expect(annotate.mock.calls[0][0].pages.length).toBeLessThanOrEqual(8);
  });
});
