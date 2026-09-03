import { describe, expect, it } from "vitest";

import type { RetrievalUnit } from "../../app/lib/book-pipeline/chunk-book";
import type { BookMap, EvidenceCard } from "../../app/lib/book-pipeline/contracts";
import { buildQuestContract, expandWithinParent, reciprocalRankFusion } from "../../app/lib/book-pipeline/retrieval";

describe("hybrid quest retrieval", () => {
  it("fuses missing lexical/vector results and resolves ties stably", () => {
    expect(reciprocalRankFusion([
      [{ id: "b", score: 2 }, { id: "a", score: 1 }],
      [{ id: "c", score: 2 }, { id: "a", score: 1 }],
    ]).map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(reciprocalRankFusion([[], [{ id: "x", score: 1 }]])[0].id).toBe("x");
  });

  it("expands only to adjacent units in the same parent section", () => {
    const units: RetrievalUnit[] = [
      { id: "a", parentSectionId: "one", pageStart: 0, pageEnd: 0, blockIds: ["a"], contextPrefix: "", text: "", nextUnitId: "b" },
      { id: "b", parentSectionId: "one", pageStart: 0, pageEnd: 0, blockIds: ["b"], contextPrefix: "", text: "", previousUnitId: "a", nextUnitId: "c" },
      { id: "c", parentSectionId: "two", pageStart: 1, pageEnd: 1, blockIds: ["c"], contextPrefix: "", text: "", previousUnitId: "b" },
    ];
    expect(expandWithinParent(["b"], units).map((unit) => unit.id)).toEqual(["a", "b"]);
  });

  it("reports missing evidence instead of filling gaps", () => {
    const concept: BookMap["concepts"][number] = { id: "concept", name: "Observe", summary: "Observe first", evidenceCardIds: ["card"], prerequisiteConceptIds: [], relatedConceptIds: [], score: 0.9, confidence: 0.9 };
    const card = { id: "card", sectionId: "s", concept: "Observe", supportedClaim: "", sources: [], playerVerbs: [], applicableProcess: [], successfulExamples: [], failureModes: [], misconceptions: [], prerequisites: [], causalLinks: [], tradeoffs: [], visualReferenceIds: [], importanceSignals: [], confidence: 0.5, uncertainty: [], contradictions: [] } satisfies EvidenceCard;
    expect(buildQuestContract({ concept, evidenceCards: [card], visualAnnotations: [] }).missingEvidence).toEqual(expect.arrayContaining(["central_claim", "player_action", "source_anchor", "example", "failure_mode"]));
  });
});
