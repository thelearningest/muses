import { expect, it } from "vitest";
import { batchReferenceState, prepareBatchReferences } from "../../app/lib/book-pipeline/visual-agent/batch-references";
import { renderRequests } from "../../app/lib/book-pipeline/visual-agent/agent";
import { BookArtifactStore } from "../../app/lib/book-pipeline/artifact-store";
import { ConditionalR2 } from "./durable-fixture";
import type { CanonicalBook } from "../../app/lib/book-pipeline/contracts";
import { questVisualImages } from "../../app/lib/book-pipeline/visual-agent/quest-provider";

const book: CanonicalBook = { schemaVersion: 1, source: { fingerprint: "f", filename: "book.pdf", pageCount: 4 }, warnings: [],
  pages: [], blocks: [0, 1, 2, 3].map((pageIndex) => ({ id: `b${pageIndex}`, pageIndex, type: "paragraph", text: "A source principle.", readingOrder: pageIndex, ancestorHeadings: [], visualReferenceIds: [] })) };
const seeds = [0, 1, 2, 3].map((pageIndex) => ({ pageIndex, evidenceIds: [`b${pageIndex}`], concept: `Concept ${pageIndex}`, description: "An appealing source example", box: { x: 0, y: 0, width: 1, height: 1 }, appeal: 0.7 + pageIndex / 10 }));
it("reuses the highest-appeal source candidates without claiming independent verification", () => {
  const state = batchReferenceState(book, seeds);
  expect(state.candidates.map((candidate) => candidate.pageIndex)).toEqual([3, 2, 1]);
  expect(state.usage.calls).toBe(0);
  expect(state.candidates.every((candidate) => candidate.verdict?.disposition === "reference_only" && candidate.review?.quiz === null)).toBe(true);
  expect(renderRequests(state)).toHaveLength(3);
  expect(batchReferenceState(book, [{ ...seeds[0], evidenceIds: ["b3"] }]).candidates).toEqual([]);
});
it("waits for actual crops, pins hashes and supplies those images to quest verification", async () => {
  const store = new BookArtifactStore(new ConditionalR2());
  await store.putJson("job", "extraction-visuals.json", { candidates: seeds }, 5000);
  const input = { job: { id: "job", expiresAt: 5000 }, book, store, repository: { commitStage: async () => true }, now: 1000, isActive: async () => true };
  const pending = await prepareBatchReferences(input);
  expect(pending?.outcome).toBe("awaiting_assets");
  if (!pending || !("renderRequests" in pending) || !pending.renderRequests) throw new Error("Missing requests");
  for (const request of pending.renderRequests) await store.putJson("job", `visual-agent/assets/${request.id}.json`, { id: request.id, hash: request.id, imageUrl: "data:image/png;base64,fixture", width: 300, height: 200 }, 5000);
  expect(await prepareBatchReferences(input)).toMatchObject({ outcome: "complete", selectedVisuals: 3 });
  const annotations = (await store.getJson<{ annotations: unknown[] }>("job", "visual-annotations.json"))!.annotations;
  const images = await questVisualImages(store, "job", [{ visualAnnotations: annotations }] as Parameters<typeof questVisualImages>[2]);
  expect(images).toHaveLength(3);
  expect(images.every((image) => image.label.includes("reference_only"))).toBe(true);
});
