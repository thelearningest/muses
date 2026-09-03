import type { CanonicalBlock, CanonicalBook } from "./contracts";

export type BookSection = {
  id: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  blockIds: string[];
  text: string;
};

export type RetrievalUnit = {
  id: string;
  parentSectionId: string;
  pageStart: number;
  pageEnd: number;
  blockIds: string[];
  contextPrefix: string;
  text: string;
  previousUnitId?: string;
  nextUnitId?: string;
};

export type ChunkedBook = { sections: BookSection[]; units: RetrievalUnit[] };

function approximateTokens(value: string): number {
  return Math.ceil(value.trim().split(/\s+/).filter(Boolean).length * 1.35);
}

function identifier(prefix: string, value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function createSection(title: string, blocks: CanonicalBlock[]): BookSection {
  const pageIndexes = blocks.map((block) => block.pageIndex);
  const value = `${title}:${blocks.map((block) => block.id).join(":")}`;
  return {
    id: identifier("section", value),
    title,
    pageStart: Math.min(...pageIndexes),
    pageEnd: Math.max(...pageIndexes),
    blockIds: blocks.map((block) => block.id),
    text: blocks.map((block) => block.text).join("\n\n"),
  };
}

export function chunkCanonicalBook(
  book: CanonicalBook,
  options: { childTargetTokens?: number; parentMaxTokens?: number } = {},
): ChunkedBook {
  const childTargetTokens = options.childTargetTokens ?? 450;
  const parentMaxTokens = options.parentMaxTokens ?? 2_400;
  const rawSections: Array<{ title: string; blocks: CanonicalBlock[] }> = [];
  let current = { title: book.source.title ?? "Opening", blocks: [] as CanonicalBlock[] };

  for (const block of book.blocks) {
    if (block.type === "heading" && current.blocks.length > 0) {
      rawSections.push(current);
      current = { title: block.text, blocks: [block] };
    } else {
      if (block.type === "heading") current.title = block.text;
      current.blocks.push(block);
    }
  }
  if (current.blocks.length > 0) rawSections.push(current);

  const sections: BookSection[] = [];
  for (const rawSection of rawSections) {
    let part: CanonicalBlock[] = [];
    let partNumber = 1;
    for (const block of rawSection.blocks) {
      if (
        part.length > 0 &&
        approximateTokens([...part.map((item) => item.text), block.text].join(" ")) >
          parentMaxTokens
      ) {
        sections.push(
          createSection(
            partNumber === 1 ? rawSection.title : `${rawSection.title} (${partNumber})`,
            part,
          ),
        );
        part = [];
        partNumber += 1;
      }
      part.push(block);
    }
    if (part.length > 0) {
      sections.push(
        createSection(
          partNumber === 1 ? rawSection.title : `${rawSection.title} (${partNumber})`,
          part,
        ),
      );
    }
  }

  const units: RetrievalUnit[] = [];
  for (const section of sections) {
    const sectionBlocks = section.blockIds
      .map((id) => book.blocks.find((block) => block.id === id))
      .filter((block): block is CanonicalBlock => Boolean(block));
    const localUnits: RetrievalUnit[] = [];
    let batch: CanonicalBlock[] = [];
    const flush = () => {
      if (batch.length === 0) return;
      const pageIndexes = batch.map((block) => block.pageIndex);
      const contextPrefix = [
        `Book: ${book.source.title ?? book.source.filename}`,
        `Section: ${section.title}`,
        `Pages: ${Math.min(...pageIndexes) + 1}-${Math.max(...pageIndexes) + 1}`,
      ].join(" | ");
      localUnits.push({
        id: identifier("unit", `${section.id}:${batch.map((block) => block.id).join(":")}`),
        parentSectionId: section.id,
        pageStart: Math.min(...pageIndexes),
        pageEnd: Math.max(...pageIndexes),
        blockIds: batch.map((block) => block.id),
        contextPrefix,
        text: batch.map((block) => block.text).join("\n\n"),
      });
      batch = [];
    };
    for (const block of sectionBlocks) {
      if (
        batch.length > 0 &&
        approximateTokens([...batch.map((item) => item.text), block.text].join(" ")) >
          childTargetTokens
      ) {
        flush();
      }
      batch.push(block);
    }
    flush();
    for (let index = 0; index < localUnits.length; index += 1) {
      if (index > 0) localUnits[index].previousUnitId = localUnits[index - 1].id;
      if (index + 1 < localUnits.length) localUnits[index].nextUnitId = localUnits[index + 1].id;
    }
    units.push(...localUnits);
  }
  return { sections, units };
}
