import { describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts, PDFName } from "pdf-lib";
import { splitPdfSections, prepareDirectPdf } from "../../app/lib/book-pipeline/extraction/direct-pdf";
import { initialBatchState, pendingBatchExtractionRequests } from "../../app/lib/book-pipeline/extraction/batch";
import { BookArtifactStore } from "../../app/lib/book-pipeline/artifact-store";
import { ConditionalR2 } from "./durable-fixture";

async function pdf(pages: number) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = document.addPage([300 + i, 400]);
    page.drawText(`Original page ${i + 1}`, { font });
    page.drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
  }
  return document.save();
}

describe("server PDF sections", () => {
  it("preserves physical order, page sizes, fonts and vector content without rasterization", async () => {
    const sections: number[][] = [];
    expect(await splitPdfSections(await pdf(17), 300, async (_index, pages, bytes) => {
      sections.push(pages);
      const part = await PDFDocument.load(bytes);
      expect(part.getPageCount()).toBe(pages.length);
      for (const [offset, page] of part.getPages().entries()) {
        expect(page.getWidth()).toBe(300 + pages[offset]);
        expect(page.node.Resources()?.has(PDFName.of("Font"))).toBe(true);
        expect(page.node.Contents()).toBeDefined();
      }
    })).toBe(17);
    expect(sections).toEqual([[0,1,2,3,4,5,6,7], [8,9,10,11,12,13,14,15], [16]]);
  });
  it("rejects too many pages before saving any sections", async () => {
    const save = vi.fn();
    await expect(splitPdfSections(await pdf(9), 8, save)).rejects.toMatchObject({ code: "page_limit_exceeded" });
    expect(save).not.toHaveBeenCalled();
  });
  it("keeps link appearance without copying navigation into other source pages", async () => {
    const source = await PDFDocument.load(await pdf(16));
    const target = source.getPage(15);
    // A large stream on the destination must not leak into the first section.
    const image = source.context.register(source.context.stream(new Uint8Array(1_000_000), { Type: "XObject", Subtype: "Image", Width: 1000, Height: 1000, BitsPerComponent: 8, ColorSpace: "DeviceGray" }));
    target.node.set(PDFName.of("Resources"), source.context.obj({ XObject: { OnlyThere: image } }));
    source.getPage(0).node.set(PDFName.of("Annots"), source.context.obj([{ Type: "Annot", Subtype: "Link", Rect: [0,0,30,30], Border: [0,0,1], P: source.getPage(0).ref, Dest: [target.ref, "Fit"] }]));
    await splitPdfSections(await source.save(), 300, async (index, _pages, bytes) => {
      if (index !== 0) return;
      expect(bytes.length).toBeLessThan(100_000);
      const section = await PDFDocument.load(bytes);
      const annotation = section.getPage(0).node.Annots()!.lookup(0) as import("pdf-lib").PDFDict;
      expect(annotation.has(PDFName.of("Rect"))).toBe(true);
      expect(annotation.has(PDFName.of("Border"))).toBe(true);
      expect(annotation.has(PDFName.of("Dest"))).toBe(false);
    });
    expect((source.getPage(0).node.Annots()!.lookup(0) as import("pdf-lib").PDFDict).has(PDFName.of("Dest"))).toBe(true);
  });
  it("rejects malformed PDFs and stops between sections on cancellation", async () => {
    await expect(splitPdfSections(new TextEncoder().encode("not PDF"), 300, vi.fn())).rejects.toMatchObject({ code: "provider_rejected_source" });
    const save = vi.fn();
    await expect(splitPdfSections(await pdf(16), 300, save, async () => save.mock.calls.length === 0)).rejects.toThrow("Inactive");
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("resumes a server manifest without opening the PDF or requesting browser assets", async () => {
    const store = new BookArtifactStore(new ConditionalR2());
    const state = { ...initialBatchState("fingerprint", 210, { maxMicros: 25_000_000, inputUsdPerMillion: 4, outputUsdPerMillion: 20 }), inputMode: "pdf" as const };
    await store.putJson("job", "extraction/state.json", state, 5000);
    const read = vi.spyOn(store, "get");
    expect(await prepareDirectPdf({ job: { id: "job", sourceFingerprint: "fingerprint", expiresAt: 5000 }, store, maxPages: 300, limits: state.limits, isActive: async () => true })).toEqual(state);
    expect(await pendingBatchExtractionRequests({ jobId: "job", state, store })).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
