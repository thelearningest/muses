import type { CanonicalBook } from "../contracts";
import type { BookJobRepository } from "../job-repository";
import { renderRequests } from "./agent";
import { rankedCandidates } from "./policy";
import { validBox, type Candidate, type CropBox, type VisualAsset, type VisualSemanticClass, type VisualState } from "./schema";
import { VISUAL_STATE_PATH, type VisualStore } from "./stage";

type ExtractedVisual = { pageIndex: number; concept: string; evidenceIds: string[]; description: string; box: CropBox; appeal: number; semanticClass?: VisualSemanticClass | string };
const limitation = "Selected from full-page extraction, not independently crop-reviewed. Do not score tiny labels, counts, attribution or crop-dependent claims without checking the actual supplied image and source text. The quiz reviewer must inspect this crop before it can be used.";

function referenceState(book: CanonicalBook, seeds: ExtractedVisual[], semanticFilter: boolean): VisualState {
  const candidates: Candidate[] = seeds.filter((seed) => (!semanticFilter || seed.semanticClass === "applied_example")
    && Number.isFinite(seed.appeal) && seed.appeal >= 0.625 && seed.appeal <= 1 && validBox(seed.box)
    && seed.evidenceIds.length > 0 && seed.evidenceIds.every((id) => book.blocks.some((block) => block.id === id && block.pageIndex === seed.pageIndex)))
    .map((seed) => ({ id: `batch-v${seed.pageIndex}`, pageIndex: seed.pageIndex, title: seed.description, concept: seed.concept, boxes: [seed.box],
      evidenceIds: seed.evidenceIds, revision: 0, ...(semanticFilter ? { semanticClass: "applied_example" as const } : {}), extractionAppeal: seed.appeal,
      review: { action: "verify", scores: [0, 0, 0, 0, 0], boxes: [], visibleFacts: [], limitations: [limitation], quiz: null, reason: "No separate crop review; holistic extractor appeal estimate only." },
      verdict: { disposition: "reference_only", evidenceIds: seed.evidenceIds, claims: [], reason: limitation } }));
  const selected = rankedCandidates(candidates).slice(0, 3);
  return { schemaVersion: 1, promptVersion: semanticFilter ? "visual-reference-v2" : "visual-reference-v1", sourceFingerprint: book.source.fingerprint, phase: "references", step: 0,
    pages: selected.map((candidate) => candidate.pageIndex), queue: [], candidates: selected, selectedIds: [],
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, reservedMicros: 0, estimatedMicros: 0 }, stopReason: null };
}

export function batchReferenceState(book: CanonicalBook, seeds: ExtractedVisual[]): VisualState {
  return referenceState(book, seeds, true);
}

/** Reuse images the extractor already inspected. The current quest's independent
 * visual verifier remains responsible for scored claims; no quiz-ready shortcut. */
export async function prepareBatchReferences(input: {
  job: { id: string; expiresAt: number }; book: CanonicalBook; store: VisualStore;
  repository: Pick<BookJobRepository, "commitStage">; now: number; isActive(): Promise<boolean>;
}) {
  const { job, store } = input;
  let checkpoint = await store.getJsonVersion<VisualState>(job.id, VISUAL_STATE_PATH);
  if (!checkpoint) {
    const extracted = await store.getJson<{ version?: number; candidates: ExtractedVisual[] }>(job.id, "extraction-visuals.json");
    // Older jobs retain the old visual workflow and exact replay history.
    if (!extracted) return null;
    await store.putJsonIfAbsent(job.id, VISUAL_STATE_PATH,
      referenceState(input.book, extracted.candidates, extracted.version === 2), job.expiresAt);
    checkpoint = await store.getJsonVersion<VisualState>(job.id, VISUAL_STATE_PATH);
  }
  if (!checkpoint || !["visual-reference-v1", "visual-reference-v2"].includes(checkpoint.value.promptVersion)) return null;
  const state = checkpoint.value;
  if (state.sourceFingerprint !== input.book.source.fingerprint) throw new Error("Visual source mismatch");
  const requests = renderRequests(state);
  const assets = await Promise.all(requests.map((request) => store.getJson<VisualAsset>(job.id, `visual-agent/assets/${request.id}.json`)));
  const missing = requests.filter((_, index) => !assets[index]);
  if (missing.length) return { outcome: "awaiting_assets" as const, renderRequests: missing, sourceFingerprint: state.sourceFingerprint };
  if (!await input.isActive()) return { outcome: "inactive" as const };
  if (state.phase !== "done") {
    for (const candidate of state.candidates) candidate.cropHashes = candidate.boxes.map((_, index) => {
      const asset = assets.find((value) => value?.id === `${candidate.id}-r${candidate.revision}-${index}-crop`);
      if (!asset?.hash) throw new Error("Missing reference crop");
      return asset.hash;
    });
    state.selectedIds = rankedCandidates(state.candidates).slice(0, 3).map((candidate) => candidate.id);
    state.phase = "done"; state.stopReason = "extracted_references_prepared";
    if (!await store.putJsonVersion(job.id, VISUAL_STATE_PATH, state, checkpoint.etag, job.expiresAt)) return { outcome: "waiting" as const };
  }
  const annotations = state.candidates.filter((candidate) => state.selectedIds.includes(candidate.id)).map((candidate) => ({
    visualReferenceId: candidate.id, pageIndex: candidate.pageIndex, description: candidate.title, role: "reference_only", confidence: 0.5,
    canonicalBlockIds: candidate.evidenceIds, visualAgent: { candidateId: candidate.id, revision: candidate.revision, disposition: "reference_only", limitations: [limitation] },
  }));
  await store.putJson(job.id, "visual-annotations.json", { selectedPages: state.pages, annotations }, job.expiresAt);
  if (!await input.isActive() || !await input.repository.commitStage({ jobId: job.id, expectedStatus: "annotating_visuals", nextStatus: "retrieving_quest_evidence", batchCursor: 0, now: input.now })) return { outcome: "inactive" as const };
  return { outcome: "complete" as const, selectedVisuals: annotations.length };
}
