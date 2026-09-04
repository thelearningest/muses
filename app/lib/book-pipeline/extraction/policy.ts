import type { RenderRequest } from "../visual-agent/schema";

// Conservative eligibility, not a guarantee of OCR accuracy.
export function nativeTextUsable(text: string, orderReliable: boolean): boolean {
  if (!orderReliable || text.length < 160 || text.length > 30000 || /[\uFFFD\u0000]/u.test(text)) return false;
  const meaningful = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return meaningful / text.length >= 0.45 && text.split(/\s+/u).filter(Boolean).length >= 20;
}

/** Overlapping full-page regions. The model maps tile coordinates back to these. */
export function extractionRenderRequests(pageIndex: number, revision: number): RenderRequest[] {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex > 299 || ![0, 1, 2].includes(revision)) throw new Error("Invalid extraction request");
  const boxes = revision === 0 ? [undefined] : revision === 1
    ? [{ x: 0, y: 0, width: 0.53, height: 1 }, { x: 0.47, y: 0, width: 0.53, height: 1 }]
    : [0, 0.47].flatMap((y) => [0, 0.47].map((x) => ({ x, y, width: 0.53, height: 0.53 })));
  return boxes.map((box, part) => ({ id: `ocr-p${pageIndex}-r${revision}-${part}`, pageIndex, revision, kind: box ? "crop" : "page", box: box ?? null }));
}
