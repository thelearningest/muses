import type { CanonicalBook, EvidenceCard } from "./contracts";
import type { BookJobRepository } from "./job-repository";
import type { StoredVisualAnnotation } from "./retrieval";

const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr";
const MAX_PAGES_PER_ANNOTATION_REQUEST = 8;

export interface VisualAnnotationProvider {
  annotate(input: { model: string; sourceUrl: string; pages: number[] }): Promise<StoredVisualAnnotation[]>;
}

export function selectVisualPages(canonical: CanonicalBook, cards: EvidenceCard[], ceiling: number): number[] {
  const referenced = new Set(cards.flatMap((card) => card.visualReferenceIds));
  return canonical.pages
    .filter((page) => page.visualReferences.length > 0)
    .map((page) => ({
      page: page.index,
      score: page.visualReferences.length * 2 +
        page.visualReferences.filter((visual) => referenced.has(visual.id)).length * 5 +
        page.warnings.length * 3 + (page.confidence !== undefined && page.confidence < 0.7 ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.page - b.page)
    .slice(0, Math.max(0, Math.min(ceiling, 12)))
    .map((item) => item.page)
    .sort((a, b) => a - b);
}

function annotationValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export class MistralVisualAnnotationProvider implements VisualAnnotationProvider {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}

  async annotate(input: { model: string; sourceUrl: string; pages: number[] }): Promise<StoredVisualAnnotation[]> {
    const response = await this.fetcher(MISTRAL_OCR_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        document: { type: "document_url", document_url: input.sourceUrl },
        pages: input.pages,
        include_blocks: false,
        include_image_base64: false,
        bbox_annotation_format: {
          type: "json_schema",
          json_schema: {
            name: "book_visual_annotation",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["description", "role", "relationships", "confidence"],
              properties: {
                description: { type: "string" },
                role: { type: "string" },
                relationships: { type: "array", items: { type: "string" } },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`Mistral visual annotation failed with status ${response.status}`);
    const body = await response.json() as { pages?: Array<{ index?: number; images?: unknown[] }> };
    const result: StoredVisualAnnotation[] = [];
    for (const page of body.pages ?? []) {
      const pageIndex = Number(page.index);
      for (const [imageIndex, raw] of (page.images ?? []).entries()) {
        const image = annotationValue(raw);
        const annotation = annotationValue(image.annotation ?? image.bbox_annotation);
        const description = typeof annotation.description === "string" ? annotation.description.trim() : "";
        if (!Number.isInteger(pageIndex) || !description) continue;
        result.push({
          visualReferenceId: `${pageIndex}:${imageIndex}`,
          pageIndex,
          description,
          role: typeof annotation.role === "string" ? annotation.role : "supporting visual",
          confidence: typeof annotation.confidence === "number" ? annotation.confidence : 0.5,
        });
      }
    }
    return result;
  }
}

export async function advanceVisualStage(input: {
  job: { id: string; batchCursor: number; expiresAt: number };
  canonical: CanonicalBook;
  evidenceCards: EvidenceCard[];
  provider: VisualAnnotationProvider;
  repository: Pick<BookJobRepository, "commitStage" | "markRecoverable">;
  store: {
    getJson<T>(jobId: string, path: string): Promise<T | null>;
    putJson(jobId: string, path: string, value: unknown, expiresAt: number): Promise<void>;
  };
  config: { model: string; maxPages: number };
  sourceUrl: string;
  now: number;
}) {
  const selectedPages = selectVisualPages(input.canonical, input.evidenceCards, input.config.maxPages);
  const batches = Array.from({ length: Math.ceil(selectedPages.length / MAX_PAGES_PER_ANNOTATION_REQUEST) }, (_, index) =>
    selectedPages.slice(index * MAX_PAGES_PER_ANNOTATION_REQUEST, (index + 1) * MAX_PAGES_PER_ANNOTATION_REQUEST),
  );
  if (input.job.batchCursor < batches.length) {
    const path = `visual/${input.job.batchCursor}.json`;
    try {
      let stored = await input.store.getJson<{ annotations: StoredVisualAnnotation[] }>(input.job.id, path);
      if (!stored) {
        const raw = await input.provider.annotate({ model: input.config.model, sourceUrl: input.sourceUrl, pages: batches[input.job.batchCursor] });
        const annotations = raw.map((annotation) => {
          const page = input.canonical.pages.find((candidate) => candidate.index === annotation.pageIndex);
          const imageIndex = Number(annotation.visualReferenceId.split(":").at(-1));
          const visual = page?.visualReferences[imageIndex];
          if (!visual) throw new Error("Visual annotation does not map to a canonical visual");
          return { ...annotation, visualReferenceId: visual.id };
        });
        stored = { annotations };
        await input.store.putJson(input.job.id, path, stored, input.job.expiresAt);
      }
      const nextCursor = input.job.batchCursor + 1;
      await input.repository.commitStage({ jobId: input.job.id, expectedStatus: "annotating_visuals", nextStatus: "annotating_visuals", now: input.now, batchCursor: nextCursor });
      return { outcome: "advanced" as const, completedBatches: nextCursor, totalBatches: batches.length };
    } catch {
      await input.repository.markRecoverable(input.job.id, "annotating_visuals", "failed_recoverable", "provider_unavailable", input.now);
      return { outcome: "interrupted" as const };
    }
  }
  const batchArtifacts = await Promise.all(batches.map((_, index) => input.store.getJson<{ annotations: StoredVisualAnnotation[] }>(input.job.id, `visual/${index}.json`)));
  const annotations = batchArtifacts.flatMap((artifact) => artifact?.annotations ?? []);
  await input.store.putJson(input.job.id, "visual-annotations.json", { selectedPages, annotations }, input.job.expiresAt);
  await input.repository.commitStage({ jobId: input.job.id, expectedStatus: "annotating_visuals", nextStatus: "retrieving_quest_evidence", now: input.now, batchCursor: 0 });
  return { outcome: "complete" as const, completedBatches: batches.length, totalBatches: batches.length };
}
