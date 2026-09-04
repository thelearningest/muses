import { expect, it } from "vitest";
import { modelEvidenceContract } from "../../app/lib/book-pipeline/model-contract";
import type { QuestEvidenceContract } from "../../app/lib/book-pipeline/contracts";

it("normalizes every source range once at the model boundary without mutating canonical evidence", () => {
  const source = { pageStart: 31, pageEnd: 32, canonicalBlockIds: ["p32-b0"] };
  const original: QuestEvidenceContract = { id: "c", conceptId: "c", playerActions: [], sources: [source], visualAnnotations: [{ visualReferenceId: "v", description: "Visible structure", source }], confidence: 1, missingEvidence: [] };
  const result = modelEvidenceContract(original);
  expect(result.sources[0]).toEqual({ ...source, pageStart: 32, pageEnd: 33 });
  expect(result.visualAnnotations[0].source).toEqual(result.sources[0]);
  expect(original.sources[0].pageStart).toBe(31);
  expect(modelEvidenceContract(original)).toEqual(result);
});
