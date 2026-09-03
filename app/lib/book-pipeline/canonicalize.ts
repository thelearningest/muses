import type {
  CanonicalBlock,
  CanonicalBlockType,
  CanonicalBook,
  CanonicalBoundingBox,
  CanonicalVisualReference,
} from "./contracts";
import type { MistralOcrResponse } from "./providers/mistral";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function stableId(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  let binary = "";
  for (const byte of digest.slice(0, 12)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function blockType(value: unknown): CanonicalBlockType {
  switch (value) {
    case "title":
    case "heading":
      return "heading";
    case "text":
      return "paragraph";
    case "list":
    case "table":
    case "caption":
    case "header":
    case "footer":
    case "figure":
      return value;
    case "image":
      return "figure";
    default:
      return "unknown";
  }
}

function boundingBox(value: unknown): CanonicalBoundingBox | undefined {
  if (Array.isArray(value) && value.length >= 4) {
    const [x0, y0, x1, y1] = value.map(number);
    if ([x0, y0, x1, y1].every((item) => item !== undefined)) {
      return { x: x0!, y: y0!, width: x1! - x0!, height: y1! - y0! };
    }
  }
  const bbox = record(value);
  const x0 = number(bbox.x0 ?? bbox.left ?? bbox.x);
  const y0 = number(bbox.y0 ?? bbox.top ?? bbox.y);
  const x1 = number(bbox.x1 ?? bbox.right);
  const y1 = number(bbox.y1 ?? bbox.bottom);
  const width = number(bbox.width) ?? (x0 !== undefined && x1 !== undefined ? x1 - x0 : undefined);
  const height = number(bbox.height) ?? (y0 !== undefined && y1 !== undefined ? y1 - y0 : undefined);
  return x0 !== undefined && y0 !== undefined && width !== undefined && height !== undefined
    ? { x: x0, y: y0, width, height }
    : undefined;
}

export async function canonicalizeMistralOcr(
  input: MistralOcrResponse,
  sourceFingerprint: string,
  filename: string,
): Promise<CanonicalBook> {
  if (!Array.isArray(input.pages)) throw new Error("OCR pages are missing");
  const pages: CanonicalBook["pages"] = [];
  const blocks: CanonicalBlock[] = [];
  const warnings: string[] = [];
  let currentHeadings: string[] = [];

  for (let position = 0; position < input.pages.length; position += 1) {
    const sourcePage = record(input.pages[position]);
    const pageIndex = number(sourcePage.index) ?? position;
    const dimensions = record(sourcePage.dimensions);
    const confidence = number(sourcePage.confidence ?? sourcePage.confidence_score);
    const pageWarnings: string[] = [];
    if (confidence !== undefined && confidence < 0.5) {
      pageWarnings.push("low_ocr_confidence");
      warnings.push(`page_${pageIndex + 1}_low_ocr_confidence`);
    }

    const visualReferences: CanonicalVisualReference[] = [];
    const images = Array.isArray(sourcePage.images) ? sourcePage.images : [];
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = record(images[imageIndex]);
      visualReferences.push({
        id: await stableId(`${sourceFingerprint}:${pageIndex}:visual:${imageIndex}`),
        pageIndex,
        kind: "figure",
        boundingBox: boundingBox({
          x0: image.top_left_x,
          y0: image.top_left_y,
          x1: image.bottom_right_x,
          y1: image.bottom_right_y,
        }),
        captionBlockIds: [],
      });
    }

    const pageBlocks: Array<{ type: CanonicalBlockType; text: string; source: UnknownRecord }> = [];
    const header = text(sourcePage.header);
    if (header) pageBlocks.push({ type: "header", text: header, source: {} });
    const rawBlocks = Array.isArray(sourcePage.blocks) ? sourcePage.blocks : [];
    for (const rawBlock of rawBlocks) {
      const source = record(rawBlock);
      const content = text(source.text ?? source.content ?? source.markdown);
      if (content) pageBlocks.push({ type: blockType(source.type ?? source.label), text: content, source });
    }
    if (rawBlocks.length === 0) {
      const markdown = text(sourcePage.markdown);
      if (markdown) pageBlocks.push({ type: "paragraph", text: markdown, source: {} });
    }
    const footer = text(sourcePage.footer);
    if (footer) pageBlocks.push({ type: "footer", text: footer, source: {} });

    const pageBlockIds: string[] = [];
    for (let order = 0; order < pageBlocks.length; order += 1) {
      const source = pageBlocks[order];
      if (source.type === "heading") currentHeadings = [...currentHeadings.slice(0, 2), source.text];
      const id = await stableId(
        `${sourceFingerprint}:${pageIndex}:${order}:${JSON.stringify(source.source.bbox ?? source.text)}`,
      );
      const block: CanonicalBlock = {
        id,
        pageIndex,
        type: source.type,
        readingOrder: order,
        text: source.text,
        boundingBox: boundingBox(source.source.bbox ?? source.source.bounding_box),
        confidence: number(source.source.confidence ?? source.source.confidence_score),
        ancestorHeadings: source.type === "heading" ? currentHeadings.slice(0, -1) : [...currentHeadings],
        visualReferenceIds: source.type === "caption" ? visualReferences.map((visual) => visual.id) : [],
      };
      blocks.push(block);
      pageBlockIds.push(id);
      if (source.type === "caption") {
        for (const visual of visualReferences) visual.captionBlockIds.push(id);
      }
    }

    if (pageBlockIds.length === 0) {
      pageWarnings.push("empty_ocr_page");
      warnings.push(`page_${pageIndex + 1}_empty_ocr_page`);
    }
    pages.push({
      index: pageIndex,
      printedLabel: footer,
      width: number(dimensions.width),
      height: number(dimensions.height),
      blockIds: pageBlockIds,
      visualReferences,
      confidence,
      warnings: pageWarnings,
    });
  }

  for (let index = 0; index < blocks.length; index += 1) {
    if (index > 0) blocks[index].previousBlockId = blocks[index - 1].id;
    if (index + 1 < blocks.length) blocks[index].nextBlockId = blocks[index + 1].id;
  }
  const title = blocks.find((block) => block.type === "heading")?.text;
  return {
    schemaVersion: 1,
    source: {
      fingerprint: sourceFingerprint,
      filename,
      ...(title ? { title } : {}),
      pageCount: pages.length,
    },
    pages,
    blocks,
    warnings,
  };
}
