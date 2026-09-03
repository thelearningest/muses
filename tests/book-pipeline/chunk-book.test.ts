import { describe, expect, it } from "vitest";

import type { CanonicalBook } from "../../app/lib/book-pipeline/contracts";
import { chunkCanonicalBook } from "../../app/lib/book-pipeline/chunk-book";

function book(): CanonicalBook {
  const texts = [
    ["h-1", "heading", "Observe"],
    ["p-1", "paragraph", "Record what changed before choosing an explanation."],
    ["p-2", "paragraph", "Separate measurements from interpretations."],
    ["h-2", "heading", "Test"],
    ["p-3", "paragraph", "Change one condition and state the prediction first."],
    ["p-4", "paragraph", "Treat a failed prediction as useful evidence."],
  ] as const;
  return {
    schemaVersion: 1,
    source: { fingerprint: "fingerprint", filename: "notes.pdf", title: "Field Notes", pageCount: 2 },
    pages: [
      { index: 0, blockIds: ["h-1", "p-1", "p-2"], visualReferences: [], warnings: [] },
      { index: 1, blockIds: ["h-2", "p-3", "p-4"], visualReferences: [], warnings: [] },
    ],
    blocks: texts.map(([id, type, text], index) => ({
      id,
      pageIndex: index < 3 ? 0 : 1,
      type,
      readingOrder: index,
      text,
      ancestorHeadings: type === "heading" ? [] : [index < 3 ? "Observe" : "Test"],
      visualReferenceIds: [],
    })),
    warnings: [],
  };
}

describe("canonical book chunking", () => {
  it("uses structural headings before arbitrary token cuts", () => {
    const result = chunkCanonicalBook(book(), { childTargetTokens: 12, parentMaxTokens: 500 });
    expect(result.sections.map((section) => section.title)).toEqual(["Observe", "Test"]);
    expect(result.sections[0].blockIds).not.toContain("h-2");
  });

  it("keeps parent identity, page range, context, and neighbors on every child", () => {
    const result = chunkCanonicalBook(book(), { childTargetTokens: 8, parentMaxTokens: 500 });
    expect(result.units.length).toBeGreaterThan(2);
    for (const unit of result.units) {
      expect(result.sections.some((section) => section.id === unit.parentSectionId)).toBe(true);
      expect(unit.pageStart).toBeLessThanOrEqual(unit.pageEnd);
      expect(unit.contextPrefix).toContain("Field Notes");
    }
    expect(result.units[0].nextUnitId).toBe(result.units[1].id);
    expect(result.units[1].previousUnitId).toBe(result.units[0].id);
  });
});
