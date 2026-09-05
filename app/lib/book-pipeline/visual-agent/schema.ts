import { z } from "zod";

const text = z.string().max(1200);
const ids = z.array(z.string().max(160)).max(24);
export const boxSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) }).strict();
export const visualSemanticClassSchema = z.enum(["applied_example", "meta_explanation", "decorative"]);
export type VisualSemanticClass = z.infer<typeof visualSemanticClassSchema>;
export type CropBox = z.infer<typeof boxSchema>;
export function validBox(box: CropBox): boolean {
  return boxSchema.safeParse(box).success && box.x + box.width <= 1 && box.y + box.height <= 1;
}
export const quizSchema = z.object({ question: text, choices: z.array(text).length(3), correctIndex: z.number().int().min(0).max(2), explanation: text }).strict();
export const scoutSchema = z.object({ pages: z.array(z.number().int().min(0)).max(12), reason: text }).strict();
export const cropSchema = z.object({ title: text, boxes: z.array(boxSchema).max(2), evidenceIds: ids, concept: text, reason: text }).strict();
export const reviewSchema = z.object({
  action: z.enum(["verify", "refine", "reject"]),
  scores: z.array(z.number().int().min(0).max(4)).length(5),
  boxes: z.array(boxSchema).max(2),
  visibleFacts: z.array(text).max(8),
  limitations: z.array(text).max(8),
  quiz: quizSchema.nullable(),
  reason: text,
}).strict();
export const verdictSchema = z.object({
  disposition: z.enum(["quiz_ready", "reference_only", "rejected"]),
  evidenceIds: ids,
  claims: z.array(z.object({ claim: text, kind: z.enum(["visible", "source_supported", "interpretation", "unsupported"]), evidenceIds: ids }).strict()).max(12),
  reason: text,
}).strict();
export const selectionSchema = z.object({ selectedIds: ids, reason: text }).strict();
export type Review = z.infer<typeof reviewSchema>;
export type Verdict = z.infer<typeof verdictSchema>;
export type RenderRequest = { id: string; pageIndex: number; kind: "thumbnail" | "page" | "crop" | "preview"; box: CropBox | null; revision: number };
export type VisualAsset = { id: string; width: number; height: number; hash: string; rotation: number; renderer: string; imageUrl: string };
export type Candidate = {
  id: string; pageIndex: number; title: string; concept: string; boxes: CropBox[];
  evidenceIds: string[]; revision: number; review?: Review; verdict?: Verdict;
  cropHashes?: string[];
  // Batch-extracted candidates are admitted only when this is applied_example.
  // It remains optional so historical and independently reviewed visual states
  // keep their original versioned shape.
  semanticClass?: VisualSemanticClass;
  // One holistic appeal estimate from the page-reading model, not five reviews.
  extractionAppeal?: number;
};
export type VisualUsage = { calls: number; inputTokens: number; outputTokens: number; reservedMicros: number; estimatedMicros: number };
export type VisualState = {
  schemaVersion: 1; promptVersion: "visual-v1" | "visual-reference-v1" | "visual-reference-v2"; sourceFingerprint: string;
  phase: "scout" | "crop" | "review" | "verify" | "select" | "references" | "done";
  step: number; pages: number[]; queue: number[]; candidates: Candidate[];
  selectedIds: string[]; usage: VisualUsage; stopReason: string | null;
  retryCount?: number;
};

export function jsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: "draft-7" });
}
