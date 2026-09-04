import { describe, expect, it } from "vitest";

import {
  BOOK_JOB_TRANSITIONS,
  BookJobTransitionError,
  transitionBookJob,
  type BookJobState,
  type BookJobStatus,
} from "../../app/lib/book-pipeline/state-machine";

const successPath: BookJobStatus[] = [
  "created",
  "uploading",
  "uploaded",
  "ocr_submitting",
  "ocr_queued",
  "ocr_collecting",
  "canonicalizing",
  "mapping_evidence",
  "building_book_map",
  "annotating_visuals",
  "retrieving_quest_evidence",
  "generating_game",
  "verifying_quests",
  "complete",
  "acknowledged",
  "cleaning",
  "cleaned",
];

const paidStages: BookJobStatus[] = [
  "ocr_submitting",
  "ocr_queued",
  "ocr_collecting",
  "mapping_evidence",
  "building_book_map",
  "annotating_visuals",
  "retrieving_quest_evidence",
  "generating_game",
  "verifying_quests",
];

describe("book job state machine", () => {
  it("permits every transition in the successful lifecycle", () => {
    let state: BookJobState = { status: "created" };

    for (const nextStatus of successPath.slice(1)) {
      state = transitionBookJob(state, nextStatus);
    }

    expect(state).toEqual({ status: "cleaned" });
  });

  it("rejects skipped and backward success transitions", () => {
    expect(() => transitionBookJob({ status: "created" }, "uploaded")).toThrow(
      BookJobTransitionError,
    );
    expect(() => transitionBookJob({ status: "uploaded" }, "uploading")).toThrow(
      BookJobTransitionError,
    );
  });

  it.each(["failed_recoverable", "manual_retry_required"] as const)(
    "resumes %s only at its recorded stage",
    (failureStatus) => {
      const failed = transitionBookJob({ status: "mapping_evidence" }, failureStatus);

      expect(failed).toEqual({
        status: failureStatus,
        resumeStatus: "mapping_evidence",
      });
      expect(() => transitionBookJob(failed, "generating_game")).toThrow(
        BookJobTransitionError,
      );
      expect(transitionBookJob(failed, "mapping_evidence")).toEqual({
        status: "mapping_evidence",
      });
    },
  );

  it.each([
    "created",
    "uploading",
    "uploaded",
    "ocr_submitting",
    "ocr_queued",
    "ocr_collecting",
    "canonicalizing",
    "mapping_evidence",
    "building_book_map",
    "annotating_visuals",
    "retrieving_quest_evidence",
    "generating_game",
    "verifying_quests",
  ] as const)("permits cancellation and both failure kinds from %s", (status) => {
    expect(transitionBookJob({ status }, "cancelled")).toEqual({
      status: "cancelled",
    });
    expect(transitionBookJob({ status }, "failed_terminal")).toEqual({
      status: "failed_terminal",
    });
    expect(transitionBookJob({ status }, "failed_recoverable")).toEqual({
      status: "failed_recoverable",
      resumeStatus: status,
    });
    expect(transitionBookJob({ status }, "manual_retry_required")).toEqual({
      status: "manual_retry_required",
      resumeStatus: status,
    });
  });

  it.each([
    { status: "complete" },
    { status: "cancelled" },
    { status: "failed_terminal" },
    { status: "failed_recoverable", resumeStatus: "ocr_collecting" },
    { status: "manual_retry_required", resumeStatus: "generating_game" },
  ] satisfies BookJobState[])("permits documented cleanup from $status", (state) => {
    const cleaning = transitionBookJob(state, "cleaning");
    expect(transitionBookJob(cleaning, "cleaned")).toEqual({ status: "cleaned" });
  });

  it("permits acknowledgment only after a complete game", () => {
    expect(transitionBookJob({ status: "complete" }, "acknowledged")).toEqual({
      status: "acknowledged",
    });
    expect(() =>
      transitionBookJob({ status: "failed_terminal" }, "acknowledged"),
    ).toThrow(BookJobTransitionError);
  });

  it.each(["complete", "cancelled", "failed_terminal", "acknowledged", "cleaned"] as const)(
    "does not resurrect terminal lifecycle state %s into a paid stage",
    (status) => {
      for (const paidStage of paidStages) {
        expect(() => transitionBookJob({ status }, paidStage)).toThrow(
          BookJobTransitionError,
        );
      }
    },
  );

  it("defines an exhaustive transition entry for every status", () => {
    const statuses = Object.keys(BOOK_JOB_TRANSITIONS).sort();
    expect(statuses).toEqual(
      [
        "acknowledged",
        "annotating_visuals",
        "building_book_map",
        "cancelled",
        "canonicalizing",
        "cleaned",
        "cleaning",
        "complete",
        "created",
        "extracting_pages",
        "failed_recoverable",
        "failed_terminal",
        "generating_game",
        "manual_retry_required",
        "mapping_evidence",
        "ocr_collecting",
        "ocr_queued",
        "ocr_submitting",
        "retrieving_quest_evidence",
        "uploaded",
        "uploading",
        "verifying_quests",
      ].sort(),
    );
  });
});
