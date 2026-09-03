import type {
  ActiveBookJobStatus,
  BookJobStatus,
  PublicBookJobStage,
  RecoverableBookJobStatus,
} from "./contracts";

export type { BookJobStatus } from "./contracts";

const RESUME_RECORDED_STAGE = "resume_recorded_stage" as const;
type TransitionTarget = BookJobStatus | typeof RESUME_RECORDED_STAGE;

const INTERRUPTIONS = [
  "failed_recoverable",
  "manual_retry_required",
  "cancelled",
  "failed_terminal",
] as const satisfies readonly BookJobStatus[];

export const BOOK_JOB_TRANSITIONS = {
  created: ["uploading", ...INTERRUPTIONS],
  uploading: ["uploaded", ...INTERRUPTIONS],
  uploaded: ["ocr_submitting", ...INTERRUPTIONS],
  ocr_submitting: ["ocr_queued", ...INTERRUPTIONS],
  ocr_queued: ["ocr_collecting", ...INTERRUPTIONS],
  ocr_collecting: ["canonicalizing", ...INTERRUPTIONS],
  canonicalizing: ["mapping_evidence", ...INTERRUPTIONS],
  mapping_evidence: ["building_book_map", ...INTERRUPTIONS],
  building_book_map: ["annotating_visuals", ...INTERRUPTIONS],
  annotating_visuals: ["retrieving_quest_evidence", ...INTERRUPTIONS],
  retrieving_quest_evidence: ["generating_game", ...INTERRUPTIONS],
  generating_game: ["verifying_quests", ...INTERRUPTIONS],
  verifying_quests: ["complete", ...INTERRUPTIONS],
  complete: ["acknowledged", "cleaning"],
  failed_recoverable: [
    RESUME_RECORDED_STAGE,
    "manual_retry_required",
    "cancelled",
    "failed_terminal",
    "cleaning",
  ],
  manual_retry_required: [
    RESUME_RECORDED_STAGE,
    "cancelled",
    "failed_terminal",
    "cleaning",
  ],
  cancelled: ["cleaning"],
  failed_terminal: ["cleaning"],
  acknowledged: ["cleaning"],
  cleaning: ["cleaned", "failed_recoverable", "manual_retry_required", "failed_terminal"],
  cleaned: [],
} as const satisfies Record<BookJobStatus, readonly TransitionTarget[]>;

export type BookJobState =
  | { status: Exclude<BookJobStatus, RecoverableBookJobStatus>; resumeStatus?: never }
  | { status: RecoverableBookJobStatus; resumeStatus: ActiveBookJobStatus };

export class BookJobTransitionError extends Error {
  constructor(from: BookJobStatus, to: BookJobStatus) {
    super(`Illegal book job transition: ${from} -> ${to}`);
    this.name = "BookJobTransitionError";
  }
}

const RECOVERABLE_STATUSES = new Set<RecoverableBookJobStatus>([
  "failed_recoverable",
  "manual_retry_required",
]);

function isRecoverableStatus(status: BookJobStatus): status is RecoverableBookJobStatus {
  return RECOVERABLE_STATUSES.has(status as RecoverableBookJobStatus);
}

export function transitionBookJob(
  current: BookJobState,
  nextStatus: BookJobStatus,
): BookJobState {
  const allowed = BOOK_JOB_TRANSITIONS[current.status] as readonly TransitionTarget[];
  const isRecordedResume =
    allowed.includes(RESUME_RECORDED_STAGE) &&
    "resumeStatus" in current &&
    current.resumeStatus === nextStatus;

  if (!allowed.includes(nextStatus) && !isRecordedResume) {
    throw new BookJobTransitionError(current.status, nextStatus);
  }

  if (isRecoverableStatus(nextStatus)) {
    const resumeStatus =
      "resumeStatus" in current && current.resumeStatus
        ? current.resumeStatus
        : (current.status as ActiveBookJobStatus);

    return {
      status: nextStatus,
      resumeStatus,
    };
  }

  return {
    status: nextStatus as Exclude<BookJobStatus, RecoverableBookJobStatus>,
  };
}

export const PUBLIC_STAGE_BY_STATUS = {
  created: "preparing",
  uploading: "uploading",
  uploaded: "preparing",
  ocr_submitting: "waiting_for_ocr",
  ocr_queued: "waiting_for_ocr",
  ocr_collecting: "reading_source",
  canonicalizing: "reading_source",
  mapping_evidence: "extracting_evidence",
  building_book_map: "building_learning_arc",
  annotating_visuals: "inspecting_visuals",
  retrieving_quest_evidence: "assembling_quests",
  generating_game: "generating_game",
  verifying_quests: "verifying_game",
  complete: "ready",
  failed_recoverable: "interrupted",
  manual_retry_required: "interrupted",
  cancelled: "cancelled",
  failed_terminal: "failed",
  acknowledged: "cleaning",
  cleaning: "cleaning",
  cleaned: "cleaned",
} as const satisfies Record<BookJobStatus, PublicBookJobStage>;

export const TERMINAL_PAID_WORK_STATUSES = new Set<BookJobStatus>([
  "complete",
  "cancelled",
  "failed_terminal",
  "acknowledged",
  "cleaning",
  "cleaned",
]);

export function publicStageFor(status: BookJobStatus): PublicBookJobStage {
  return PUBLIC_STAGE_BY_STATUS[status];
}
