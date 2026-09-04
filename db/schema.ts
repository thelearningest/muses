import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const bookJobs = sqliteTable(
  "book_jobs",
  {
    id: text("id").primaryKey(),
    capabilityHash: text("capability_hash").notNull(),
    identityHash: text("identity_hash").notNull(),
    networkHash: text("network_hash").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    pageCount: integer("page_count"),
    status: text("status").notNull(),
    currentStage: text("current_stage").notNull(),
    resumeStage: text("resume_stage"),
    batchCursor: integer("batch_cursor").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    cancellationRequested: integer("cancellation_requested", { mode: "boolean" })
      .notNull()
      .default(false),
    cleanupState: text("cleanup_state").notNull().default("pending"),
    terminalErrorCategory: text("terminal_error_category"),
    mistralBatchId: text("mistral_batch_id"),
    mistralInputFileId: text("mistral_input_file_id"),
    mistralOutputFileId: text("mistral_output_file_id"),
    openaiRequestIds: text("openai_request_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    reservedCostUnits: integer("reserved_cost_units").notNull().default(0),
    actualCostUnits: integer("actual_cost_units").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    terminalAt: integer("terminal_at"),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("idx_book_jobs_identity_status").on(table.identityHash, table.status),
    index("idx_book_jobs_expires_at").on(table.expiresAt),
  ],
);

export const bookJobAttempts = sqliteTable(
  "book_job_attempts",
  {
    id: text("id").primaryKey(),
    identityHash: text("identity_hash").notNull(),
    networkHash: text("network_hash").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_book_job_attempts_identity_created").on(
      table.identityHash,
      table.createdAt,
    ),
    index("idx_book_job_attempts_network_created").on(
      table.networkHash,
      table.createdAt,
    ),
  ],
);

export const bookDailyBudget = sqliteTable("book_daily_budget", {
  day: text("day").primaryKey(),
  admittedJobs: integer("admitted_jobs").notNull().default(0),
  reservedCostUnits: integer("reserved_cost_units").notNull().default(0),
  actualCostUnits: integer("actual_cost_units").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const bookStageRuns = sqliteTable("book_stage_runs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  stage: text("stage").notNull(),
  cursor: integer("cursor").notNull(),
  policyHash: text("policy_hash").notNull(),
  owner: text("owner").notNull(),
  leaseUntil: integer("lease_until").notNull(),
  state: text("state").notNull().default("running"),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [uniqueIndex("idx_book_stage_identity").on(t.jobId, t.stage, t.cursor)]);

export const bookProviderCalls = sqliteTable("book_provider_calls", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  jobId: text("job_id").notNull(),
  slot: integer("slot").notNull(),
  attempt: integer("attempt").notNull(),
  requestHash: text("request_hash").notNull(),
  state: text("state").notNull(),
  reservedUnits: integer("reserved_units").notNull(),
  actualUnits: integer("actual_units").notNull().default(0),
  visualBudget: text("visual_budget").notNull().default("{}"),
  resultPath: text("result_path").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [uniqueIndex("idx_book_call_identity").on(t.runId, t.slot, t.attempt), index("idx_book_call_budget").on(t.jobId)]);

export const bookArtifactRefs = sqliteTable("book_artifact_refs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  logicalPath: text("logical_path").notNull(),
  resultPath: text("result_path").notNull(),
  runId: text("run_id").notNull(),
  owner: text("owner").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [uniqueIndex("idx_book_artifact_identity").on(t.jobId, t.logicalPath)]);
