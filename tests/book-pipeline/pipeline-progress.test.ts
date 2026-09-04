import { describe, expect, it } from "vitest";
import { overallPipelineProgress, pipelineUnitLabel } from "../../app/pipeline-progress";

describe("overall pipeline progress", () => {
  it("uses real page and quest counts inside their weighted ranges", () => {
    expect(overallPipelineProgress("reading_source", { completedUnits: 105, totalUnits: 210, unit: "pages" })).toBe(33);
    expect(overallPipelineProgress("verifying_game", { completedUnits: 2, totalUnits: 4, unit: "quests" })).toBe(97);
  });

  it("uses confirmed stage milestones without inventing unit progress", () => {
    expect(overallPipelineProgress("extracting_evidence")).toBe(58);
    expect(overallPipelineProgress("generating_game")).toBe(86);
    expect(overallPipelineProgress("ready")).toBe(100);
  });

  it("clamps inconsistent counts and formats concrete units", () => {
    expect(overallPipelineProgress("reading_source", { completedUnits: 999, totalUnits: 210, unit: "pages" })).toBe(58);
    expect(pipelineUnitLabel({ completedUnits: 999, totalUnits: 210, unit: "pages" })).toBe("210 of 210 pages");
  });
});
