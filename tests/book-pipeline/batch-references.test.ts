import { expect, it, vi } from "vitest";
import { batchReferenceState, prepareBatchReferences } from "../../app/lib/book-pipeline/visual-agent/batch-references";
import { renderRequests } from "../../app/lib/book-pipeline/visual-agent/agent";
import { BookArtifactStore } from "../../app/lib/book-pipeline/artifact-store";
import { ConditionalR2 } from "./durable-fixture";
import type { CanonicalBook } from "../../app/lib/book-pipeline/contracts";
import { questVisualImages } from "../../app/lib/book-pipeline/visual-agent/quest-provider";
import { prepareQuestImages } from "../../app/lib/book-pipeline/visual-agent/practice-image";
import type { QuestEvidenceContract } from "../../app/lib/book-pipeline/contracts";

const book: CanonicalBook = { schemaVersion: 1, source: { fingerprint: "f", filename: "book.pdf", pageCount: 4 }, warnings: [],
  pages: [], blocks: [0, 1, 2, 3].map((pageIndex) => ({ id: `b${pageIndex}`, pageIndex, type: "paragraph", text: "A source principle.", readingOrder: pageIndex, ancestorHeadings: [], visualReferenceIds: [] })) };
const seeds = [0, 1, 2, 3].map((pageIndex) => ({ pageIndex, evidenceIds: [`b${pageIndex}`], concept: `Concept ${pageIndex}`, description: "An appealing source example", box: { x: 0, y: 0, width: 1, height: 1 }, appeal: 0.7 + pageIndex / 10, semanticClass: "applied_example" as const }));
it("reuses the highest-appeal source candidates without claiming independent verification", () => {
  const state = batchReferenceState(book, seeds);
  expect(state.candidates.map((candidate) => candidate.pageIndex)).toEqual([3, 2, 1]);
  expect(state.usage.calls).toBe(0);
  expect(state.candidates.every((candidate) => candidate.verdict?.disposition === "reference_only" && candidate.review?.quiz === null)).toBe(true);
  expect(renderRequests(state)).toHaveLength(3);
  expect(batchReferenceState(book, [{ ...seeds[0], evidenceIds: ["b3"] }]).candidates).toEqual([]);
});
it("filters semantic eligibility before appeal and fails closed", () => {
  const candidates = batchReferenceState(book, [
    { ...seeds[0], appeal: 1, semanticClass: "meta_explanation" },
    { ...seeds[1], appeal: 0.9, semanticClass: "decorative" },
    { ...seeds[2], appeal: 0.8, semanticClass: "applied_example" },
    { ...seeds[3], appeal: 1, semanticClass: "unknown" },
    { ...seeds[0], appeal: 1, semanticClass: undefined },
  ]).candidates;
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({ pageIndex: 2, semanticClass: "applied_example", extractionAppeal: 0.8 });
});
it("waits for actual crops, pins hashes and supplies those images to quest verification", async () => {
  const store = new BookArtifactStore(new ConditionalR2());
  await store.putJson("job", "extraction-visuals.json", { version: 2, candidates: seeds }, 5000);
  const input = { job: { id: "job", expiresAt: 5000 }, book, store, repository: { commitStage: async () => true }, now: 1000, isActive: async () => true };
  const pending = await prepareBatchReferences(input);
  expect(pending?.outcome).toBe("awaiting_assets");
  if (!pending || !("renderRequests" in pending) || !pending.renderRequests) throw new Error("Missing requests");
  for (const request of pending.renderRequests) await store.putJson("job", `visual-agent/assets/${request.id}.json`, { id: request.id, hash: request.id, imageUrl: "data:image/png;base64,fixture", width: 300, height: 200 }, 5000);
  expect(await prepareBatchReferences(input)).toMatchObject({ outcome: "complete", selectedVisuals: 3 });
  const annotations = (await store.getJson<{ annotations: unknown[] }>("job", "visual-annotations.json"))!.annotations;
  const images = await questVisualImages(store, "job", [{ visualAnnotations: annotations }] as Parameters<typeof questVisualImages>[2]);
  expect(images).toHaveLength(3);
  expect(images.map((image) => image.label)).toEqual([
    "From your book · PDF page 4",
    "From your book · PDF page 3",
    "From your book · PDF page 2",
  ]);
});

it("fills a semantic shortfall with distinct generated practice visuals", async () => {
  const store = new BookArtifactStore(new ConditionalR2());
  const state = batchReferenceState(book, [seeds[0]]);
  const candidate = state.candidates[0];
  candidate.cropHashes = ["source-hash"];
  state.selectedIds = [candidate.id];
  state.phase = "done";
  await store.putJson("job", "visual-agent/state.json", state, 5000);
  await store.putJson("job", `visual-agent/assets/${candidate.id}-r0-0-crop.json`, {
    id: `${candidate.id}-r0-0-crop`, hash: "source-hash", imageUrl: "data:image/png;base64,c291cmNl",
    width: 300, height: 200, rotation: 0, renderer: "fixture",
  }, 5000);
  const source = { pageStart: 0, pageEnd: 0, canonicalBlockIds: ["b0"], boundedExcerpt: "A source principle." };
  const contracts: QuestEvidenceContract[] = [1, 2, 3].map((number) => ({
    id: number === 1 ? "contract-concept" : `contract-concept-practice-${number}`,
    conceptId: "concept", centralClaim: "Alignment creates a clear reading path.", playerActions: ["compare"], sources: [source],
    visualAnnotations: number === 1 ? [{ visualReferenceId: candidate.id, description: candidate.title, source,
      visualAgent: { candidateId: candidate.id, revision: 0, disposition: "reference_only", limitations: [] } }] : [],
    confidence: 1, missingEvidence: [],
  }));
  const generated = { imageUrl: "data:image/jpeg;base64,Z2VuZXJhdGVk", width: 1024, height: 1024, detail: "high" as const, label: "AI-created practice design" };
  const execute = vi.fn(async () => generated);
  const images = await prepareQuestImages({ contracts, store, job: { id: "job", expiresAt: 5000 }, journal: { execute } as never, apiKey: "unused" });

  expect(images).toHaveLength(3);
  expect(images[0][0].label).toBe("From your book · PDF page 1");
  expect(execute).toHaveBeenCalledTimes(2);
  const prompts = execute.mock.calls.map((call) => (call[0] as { request: { prompt: string } }).request.prompt);
  expect(new Set(prompts).size).toBe(2);
  expect(prompts.join("\n")).toContain("wayfinding poster");
  expect(prompts.join("\n")).toContain("packaging or interface");
});
