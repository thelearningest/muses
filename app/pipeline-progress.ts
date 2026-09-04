import type { PublicBookJobStage } from "./lib/book-pipeline/contracts";

export type PipelineUnitProgress = {
  completedUnits?: number;
  totalUnits?: number;
  unit?: "pages" | "quests";
};

const STAGE_PROGRESS: Partial<Record<PublicBookJobStage, { start: number; end: number; unit?: PipelineUnitProgress["unit"] }>> = {
  uploading: { start: 2, end: 2 },
  preparing: { start: 5, end: 5 },
  waiting_for_ocr: { start: 8, end: 8 },
  reading_source: { start: 8, end: 58, unit: "pages" },
  extracting_evidence: { start: 58, end: 58 },
  building_learning_arc: { start: 66, end: 66 },
  inspecting_visuals: { start: 72, end: 72 },
  assembling_quests: { start: 80, end: 80 },
  generating_game: { start: 86, end: 86 },
  verifying_game: { start: 94, end: 99, unit: "quests" },
  ready: { start: 100, end: 100 },
};

export function overallPipelineProgress(stage: PublicBookJobStage | undefined, progress?: PipelineUnitProgress): number {
  const range = stage ? STAGE_PROGRESS[stage] : undefined;
  if (!range) return 0;
  if (!range.unit || progress?.unit !== range.unit || !progress.totalUnits || progress.totalUnits <= 0) return range.start;
  const ratio = Math.min(1, Math.max(0, (progress.completedUnits ?? 0) / progress.totalUnits));
  return Math.round(range.start + (range.end - range.start) * ratio);
}

export function pipelineUnitLabel(progress?: PipelineUnitProgress): string | null {
  if (!progress?.unit || !progress.totalUnits || progress.totalUnits <= 0) return null;
  const completed = Math.min(progress.totalUnits, Math.max(0, progress.completedUnits ?? 0));
  return `${completed} of ${progress.totalUnits} ${progress.unit}`;
}
