export type BookJobStatus =
  | "created"
  | "uploading"
  | "uploaded"
  | "extracting_pages"
  | "ocr_submitting"
  | "ocr_queued"
  | "ocr_collecting"
  | "canonicalizing"
  | "mapping_evidence"
  | "building_book_map"
  | "annotating_visuals"
  | "retrieving_quest_evidence"
  | "generating_game"
  | "verifying_quests"
  | "complete"
  | "failed_recoverable"
  | "manual_retry_required"
  | "cancelled"
  | "failed_terminal"
  | "acknowledged"
  | "cleaning"
  | "cleaned";

export type ActiveBookJobStatus = Exclude<
  BookJobStatus,
  | "complete"
  | "failed_recoverable"
  | "manual_retry_required"
  | "cancelled"
  | "failed_terminal"
  | "acknowledged"
  | "cleaned"
>;

export type RecoverableBookJobStatus =
  | "failed_recoverable"
  | "manual_retry_required";

export type PublicBookJobStage =
  | "preparing"
  | "uploading"
  | "waiting_for_ocr"
  | "reading_source"
  | "extracting_evidence"
  | "building_learning_arc"
  | "inspecting_visuals"
  | "assembling_quests"
  | "generating_game"
  | "verifying_game"
  | "ready"
  | "interrupted"
  | "cancelled"
  | "capacity_reached"
  | "failed"
  | "cleaning"
  | "cleaned";

export type PublicBookJobProgress = {
  stage: PublicBookJobStage;
  recoverable: boolean;
  completedUnits?: number;
  totalUnits?: number;
  unit?: "pages" | "quests";
  retryAfterSeconds?: number;
};

export type ProviderReference = {
  provider: "mistral" | "openai";
  kind: "batch" | "file" | "request" | "response";
  id: string;
};

export type SafeBookJobErrorCategory =
  | "invalid_pdf"
  | "encrypted_pdf"
  | "malformed_pdf"
  | "pdf_too_large"
  | "page_limit_exceeded"
  | "verification_failed"
  | "rights_confirmation_required"
  | "same_origin_required"
  | "turnstile_failed"
  | "identity_quota_reached"
  | "global_capacity_reached"
  | "generation_disabled"
  | "provider_delayed"
  | "provider_unavailable"
  | "provider_rejected_source"
  | "extraction_quality_insufficient"
  | "grounding_quality_insufficient"
  | "cleanup_incomplete"
  | "manual_retry_required"
  | "unexpected_failure";

export type SafeBookJobError = {
  category: SafeBookJobErrorCategory;
  message: string;
  recoverable: boolean;
  retryAfterSeconds?: number;
};

export type CanonicalBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanonicalBlockType =
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "caption"
  | "figure"
  | "header"
  | "footer"
  | "page_number"
  | "unknown";

export type CanonicalVisualReference = {
  id: string;
  pageIndex: number;
  kind: "figure" | "diagram" | "chart" | "table" | "illustration" | "unknown";
  boundingBox?: CanonicalBoundingBox;
  captionBlockIds: string[];
  description?: string;
};

export type CanonicalBlock = {
  id: string;
  pageIndex: number;
  type: CanonicalBlockType;
  readingOrder: number;
  text: string;
  boundingBox?: CanonicalBoundingBox;
  confidence?: number;
  ancestorHeadings: string[];
  previousBlockId?: string;
  nextBlockId?: string;
  visualReferenceIds: string[];
};

export type CanonicalPage = {
  index: number;
  printedLabel?: string;
  width?: number;
  height?: number;
  blockIds: string[];
  visualReferences: CanonicalVisualReference[];
  confidence?: number;
  warnings: string[];
};

export type CanonicalBook = {
  schemaVersion: 1;
  source: {
    fingerprint: string;
    filename: string;
    title?: string;
    pageCount: number;
  };
  pages: CanonicalPage[];
  blocks: CanonicalBlock[];
  warnings: string[];
};

export type SourceReference = {
  pageStart: number;
  pageEnd: number;
  canonicalBlockIds: string[];
  boundedExcerpt?: string;
};

export type EvidenceCard = {
  id: string;
  sectionId: string;
  concept: string;
  supportedClaim: string;
  sources: SourceReference[];
  playerVerbs: string[];
  applicableProcess: string[];
  successfulExamples: string[];
  failureModes: string[];
  misconceptions: string[];
  prerequisites: string[];
  causalLinks: string[];
  tradeoffs: string[];
  visualReferenceIds: string[];
  importanceSignals: string[];
  confidence: number;
  uncertainty: string[];
  contradictions: string[];
};

export type BookMapChapter = {
  id: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  summary: string;
  evidenceCardIds: string[];
};

export type BookMapConcept = {
  id: string;
  name: string;
  summary: string;
  evidenceCardIds: string[];
  prerequisiteConceptIds: string[];
  relatedConceptIds: string[];
  score: number;
  confidence: number;
};

export type BookMap = {
  schemaVersion: 1;
  bookTitle?: string;
  thesis: string;
  learningArc: string[];
  chapters: BookMapChapter[];
  concepts: BookMapConcept[];
  contradictions: string[];
  visualOpportunities: string[];
  omissions: string[];
  proposedQuestConceptIds: string[];
};

export type QuestEvidenceMissingField =
  | "central_claim"
  | "player_action"
  | "source_anchor"
  | "example"
  | "failure_mode"
  | "visual_evidence";

export type QuestEvidenceContract = {
  id: string;
  conceptId: string;
  centralClaim?: string;
  playerActions: string[];
  sources: SourceReference[];
  visualAnnotations: Array<{
    visualReferenceId: string;
    description: string;
    source: SourceReference;
    visualAgent?: { candidateId: string; revision: number; disposition: "quiz_ready" | "reference_only" | "rejected"; limitations: string[] };
  }>;
  confidence: number;
  missingEvidence: QuestEvidenceMissingField[];
};
