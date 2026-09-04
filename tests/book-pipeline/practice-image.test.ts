import { expect, it } from "vitest";
import type { QuestEvidenceContract } from "../../app/lib/book-pipeline/contracts";
import { practiceImageRequest } from "../../app/lib/book-pipeline/visual-agent/practice-image";

const contract = (id: string): QuestEvidenceContract => ({
  id, conceptId: "concept", centralClaim: "Alignment helps readers scan a composition.", playerActions: ["compare"],
  sources: [{ pageStart: 0, pageEnd: 0, canonicalBlockIds: ["b0"], boundedExcerpt: "Alignment helps readers scan." }],
  visualAnnotations: [], confidence: 1, missingEvidence: [],
});

it("gives repeated principles three distinct concrete visual formats", () => {
  const prompts = [
    practiceImageRequest(contract("contract-concept")).prompt,
    practiceImageRequest(contract("contract-concept-practice-2")).prompt,
    practiceImageRequest(contract("contract-concept-practice-3")).prompt,
  ];
  expect(new Set(prompts).size).toBe(3);
  expect(prompts.join("\n")).toContain("editorial spread");
  expect(prompts.join("\n")).toContain("wayfinding poster");
  expect(prompts.join("\n")).toContain("packaging or interface");
  expect(prompts.every((prompt) => prompt.includes("actual design a learner will inspect"))).toBe(true);
});
