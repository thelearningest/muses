import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import type { BookArtifactStore } from "../artifact-store";
import { BATCH_STATE_PATH, initialBatchState, type BatchExtractionState } from "./batch";
import type { ExtractionLimits } from "./stage";

export const PDF_SECTION_SIZE = 8;
export const MAX_SECTION_BYTES = 49_000_000;
// Isolate memory is shared. Admit one PDF parse at a time; competing requests
// receive a short waiting result, rather than retaining another source buffer.
let preparing = false;

export class InvalidSourcePdf extends Error {
  constructor(readonly code: "page_limit_exceeded" | "provider_rejected_source") { super(code); }
}

export async function splitPdfSections(bytes: Uint8Array, maxPages: number,
  save: (index: number, pages: number[], bytes: Uint8Array) => Promise<void>, isActive: () => Promise<boolean> = async () => true) {
  let source: PDFDocument;
  try { source = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }); }
  catch { throw new InvalidSourcePdf("provider_rejected_source"); }
  const pageCount = source.getPageCount();
  if (pageCount < 1 || pageCount > maxPages) throw new InvalidSourcePdf("page_limit_exceeded");
  // Annotation navigation can reference pages outside this section. Following
  // those references while copying recursively includes the rest of the book.
  // Keep visible annotation geometry/appearance, but omit navigation and event
  // actions from these model-only copies. The stored original is untouched.
  for (const page of source.getPages()) {
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      const annotation = source.context.lookup(ref);
      if (annotation instanceof PDFDict) {
        for (const key of ["P", "Dest", "A", "AA"]) annotation.delete(PDFName.of(key));
      }
    }
  }
  for (let offset = 0; offset < pageCount; offset += PDF_SECTION_SIZE) {
    if (!await isActive()) throw new Error("Inactive PDF preparation");
    const pages = Array.from({ length: Math.min(PDF_SECTION_SIZE, pageCount - offset) }, (_, i) => offset + i);
    const part = await PDFDocument.create();
    // Stable output across retries; preserve source graphics/fonts without
    // rasterization. Physical page order is the evidence index authority.
    part.setCreationDate(new Date(0)); part.setModificationDate(new Date(0));
    for (const page of await part.copyPages(source, pages)) part.addPage(page);
    const output = await part.save();
    if (output.byteLength >= MAX_SECTION_BYTES) throw new InvalidSourcePdf("provider_rejected_source");
    await save(offset / PDF_SECTION_SIZE, pages, output);
  }
  return pageCount;
}

export async function prepareDirectPdf(input: {
  job: { id: string; sourceFingerprint: string; expiresAt: number }; store: BookArtifactStore;
  maxPages: number; limits: ExtractionLimits; isActive(): Promise<boolean>;
}): Promise<BatchExtractionState | null> {
  const saved = await input.store.getJson<BatchExtractionState>(input.job.id, BATCH_STATE_PATH);
  if (saved) {
    if (saved.inputMode !== "pdf" || saved.fingerprint !== input.job.sourceFingerprint) throw new Error("PDF manifest conflict");
    return saved;
  }
  if (preparing) return null;
  preparing = true;
  try {
    const object = await input.store.get(input.job.id, "source.pdf");
    if (!object) throw new InvalidSourcePdf("provider_rejected_source");
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength > 50 * 1024 * 1024) throw new InvalidSourcePdf("provider_rejected_source");
    const pageCount = await splitPdfSections(bytes, input.maxPages, async (index, _pages, section) => {
      await input.store.putPdfIfAbsent(input.job.id, `extraction/sections/${index}.pdf`, section, input.job.expiresAt);
    }, input.isActive);
    if (!await input.isActive()) throw new Error("Inactive PDF preparation");
    const state = { ...initialBatchState(input.job.sourceFingerprint, pageCount, input.limits), inputMode: "pdf" as const };
    await input.store.putJsonIfAbsent(input.job.id, BATCH_STATE_PATH, state, input.job.expiresAt);
    return state;
  } finally { preparing = false; }
}
