import { describe, expect, it } from "vitest";

import fixture from "../fixtures/mistral-ocr-result.json";
import { canonicalizeMistralOcr } from "../../app/lib/book-pipeline/canonicalize";

describe("canonical Mistral OCR normalization", () => {
  it("produces stable IDs for identical input", async () => {
    const first = await canonicalizeMistralOcr(fixture, "fingerprint", "field-notes.pdf");
    const second = await canonicalizeMistralOcr(fixture, "fingerprint", "field-notes.pdf");
    expect(first).toEqual(second);
    expect(first.blocks.every((block) => block.id.length > 8)).toBe(true);
  });

  it("normalizes headings, headers, footers, captions, neighbors, and visuals", async () => {
    const book = await canonicalizeMistralOcr(fixture, "fingerprint", "field-notes.pdf");

    expect(book.pages).toHaveLength(2);
    expect(book.blocks.some((block) => block.type === "heading")).toBe(true);
    expect(book.blocks.some((block) => block.type === "header")).toBe(true);
    expect(book.blocks.some((block) => block.type === "footer")).toBe(true);
    expect(book.blocks.some((block) => block.type === "caption")).toBe(true);
    expect(book.pages[0].visualReferences).toHaveLength(1);
    expect(book.blocks[0].nextBlockId).toBe(book.blocks[1].id);
    expect(book.blocks[1].previousBlockId).toBe(book.blocks[0].id);
  });

  it("drops empty blocks and flags low-confidence pages", async () => {
    const book = await canonicalizeMistralOcr(fixture, "fingerprint", "field-notes.pdf");
    expect(book.blocks.some((block) => block.text.trim() === "")).toBe(false);
    expect(book.pages[1].warnings).toContain("low_ocr_confidence");
    expect(book.warnings).toContain("page_2_low_ocr_confidence");
  });
});
