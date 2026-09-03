import type { BookJobStatus, SafeBookJobErrorCategory } from "./contracts";
import type { D1DatabaseBinding, D1Result } from "./runtime-env";

type BookJobRow = {
  id: string;
  capability_hash: string;
  identity_hash: string;
  network_hash: string;
  source_fingerprint: string;
  original_filename: string;
  mime_type: string;
  byte_size: number;
  page_count: number | null;
  status: BookJobStatus;
  current_stage: BookJobStatus;
  resume_stage: BookJobStatus | null;
  batch_cursor: number;
  retry_count: number;
  cancellation_requested: number;
  cleanup_state: string;
  terminal_error_category: SafeBookJobErrorCategory | null;
  mistral_batch_id: string | null;
  mistral_input_file_id: string | null;
  mistral_output_file_id: string | null;
  openai_request_ids: string;
  reserved_cost_units: number;
  actual_cost_units: number;
  created_at: number;
  updated_at: number;
  terminal_at: number | null;
  expires_at: number;
};

export type BookJobRecord = {
  id: string;
  capabilityHash: string;
  identityHash: string;
  networkHash: string;
  sourceFingerprint: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  pageCount: number | null;
  status: BookJobStatus;
  currentStage: BookJobStatus;
  resumeStage: BookJobStatus | null;
  batchCursor: number;
  retryCount: number;
  cancellationRequested: boolean;
  cleanupState: string;
  terminalErrorCategory: SafeBookJobErrorCategory | null;
  mistralBatchId: string | null;
  mistralInputFileId: string | null;
  mistralOutputFileId: string | null;
  openaiRequestIds: string[];
  reservedCostUnits: number;
  actualCostUnits: number;
  createdAt: number;
  updatedAt: number;
  terminalAt: number | null;
  expiresAt: number;
};

function changes(result: D1Result): number {
  return Number(result.meta?.changes ?? 0);
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function mapJob(row: BookJobRow): BookJobRecord {
  return {
    id: row.id,
    capabilityHash: row.capability_hash,
    identityHash: row.identity_hash,
    networkHash: row.network_hash,
    sourceFingerprint: row.source_fingerprint,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    pageCount: row.page_count,
    status: row.status,
    currentStage: row.current_stage,
    resumeStage: row.resume_stage,
    batchCursor: row.batch_cursor,
    retryCount: row.retry_count,
    cancellationRequested: row.cancellation_requested === 1,
    cleanupState: row.cleanup_state,
    terminalErrorCategory: row.terminal_error_category,
    mistralBatchId: row.mistral_batch_id,
    mistralInputFileId: row.mistral_input_file_id,
    mistralOutputFileId: row.mistral_output_file_id,
    openaiRequestIds: parseStringArray(row.openai_request_ids),
    reservedCostUnits: row.reserved_cost_units,
    actualCostUnits: row.actual_cost_units,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    terminalAt: row.terminal_at,
    expiresAt: row.expires_at,
  };
}

const JOB_COLUMNS = `
  id, capability_hash, identity_hash, network_hash, source_fingerprint,
  original_filename, mime_type, byte_size, page_count, status, current_stage, resume_stage,
  batch_cursor, retry_count, cancellation_requested, cleanup_state,
  terminal_error_category, mistral_batch_id, mistral_input_file_id,
  mistral_output_file_id, openai_request_ids, reserved_cost_units,
  actual_cost_units, created_at, updated_at, terminal_at, expires_at
`;

export class BookJobRepository {
  constructor(private readonly db: D1DatabaseBinding) {}

  async createJob(input: {
    id: string;
    capabilityHash: string;
    identityHash: string;
    networkHash: string;
    sourceFingerprint: string;
    originalFilename: string;
    mimeType: string;
    byteSize: number;
    now: number;
    expiresAt: number;
  }): Promise<void> {
    const result = await this.db
      .prepare(`
        INSERT INTO book_jobs (
          id, capability_hash, identity_hash, network_hash, source_fingerprint,
          original_filename, mime_type, byte_size, status, current_stage,
          created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', 'created', ?, ?, ?)
      `)
      .bind(
        input.id,
        input.capabilityHash,
        input.identityHash,
        input.networkHash,
        input.sourceFingerprint,
        input.originalFilename,
        input.mimeType,
        input.byteSize,
        input.now,
        input.now,
        input.expiresAt,
      )
      .run();
    if (!result.success) throw new Error("Unable to create book job");
  }

  async getAuthorizedJob(
    jobId: string,
    capabilityHash: string,
  ): Promise<BookJobRecord | null> {
    const row = await this.db
      .prepare(`SELECT ${JOB_COLUMNS} FROM book_jobs WHERE id = ? AND capability_hash = ?`)
      .bind(jobId, capabilityHash)
      .first<BookJobRow>();
    return row ? mapJob(row) : null;
  }

  async getJob(jobId: string): Promise<BookJobRecord | null> {
    const row = await this.db
      .prepare(`SELECT ${JOB_COLUMNS} FROM book_jobs WHERE id = ?`)
      .bind(jobId)
      .first<BookJobRow>();
    return row ? mapJob(row) : null;
  }

  async claimStage(input: {
    jobId: string;
    capabilityHash: string;
    expectedStatus: BookJobStatus;
    claimedStatus: BookJobStatus;
    now: number;
  }): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE book_jobs
        SET status = ?, current_stage = ?, updated_at = ?
        WHERE id = ? AND capability_hash = ? AND status = ?
          AND cancellation_requested = 0 AND expires_at > ?
      `)
      .bind(
        input.claimedStatus,
        input.claimedStatus,
        input.now,
        input.jobId,
        input.capabilityHash,
        input.expectedStatus,
        input.now,
      )
      .run();
    return result.success && changes(result) === 1;
  }

  async commitStage(input: {
    jobId: string;
    expectedStatus: BookJobStatus;
    nextStatus: BookJobStatus;
    now: number;
    batchCursor?: number;
  }): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE book_jobs
        SET status = ?, current_stage = ?, updated_at = ?,
            batch_cursor = COALESCE(?, batch_cursor)
        WHERE id = ? AND status = ? AND cancellation_requested = 0
      `)
      .bind(
        input.nextStatus,
        input.nextStatus,
        input.now,
        input.batchCursor ?? null,
        input.jobId,
        input.expectedStatus,
      )
      .run();
    return result.success && changes(result) === 1;
  }

  async admitAttempt(input: {
    attemptId: string;
    identityHash: string;
    networkHash: string;
    now: number;
    since: number;
    ceiling: number;
  }): Promise<boolean> {
    const result = await this.db
      .prepare(`
        INSERT INTO book_job_attempts (id, identity_hash, network_hash, created_at)
        SELECT ?, ?, ?, ?
        WHERE (
          SELECT COUNT(*) FROM book_job_attempts
          WHERE (identity_hash = ? OR network_hash = ?) AND created_at >= ?
        ) < ?
      `)
      .bind(
        input.attemptId,
        input.identityHash,
        input.networkHash,
        input.now,
        input.identityHash,
        input.networkHash,
        input.since,
        input.ceiling,
      )
      .run();
    return result.success && changes(result) === 1;
  }

  async countRecentAttempts(identityHash: string, since: number): Promise<number> {
    const row = await this.db
      .prepare(`
        SELECT COUNT(*) AS count FROM book_job_attempts
        WHERE identity_hash = ? AND created_at >= ?
      `)
      .bind(identityHash, since)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async countActiveJobs(identityHash: string, now: number): Promise<number> {
    const row = await this.db
      .prepare(`
        SELECT COUNT(*) AS count FROM book_jobs
        WHERE identity_hash = ? AND expires_at > ?
          AND status NOT IN ('complete', 'cancelled', 'failed_terminal', 'acknowledged', 'cleaning', 'cleaned')
      `)
      .bind(identityHash, now)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async reserveDailyAdmission(day: string, ceiling: number, now: number): Promise<boolean> {
    const result = await this.db
      .prepare(`
        INSERT INTO book_daily_budget (day, admitted_jobs, updated_at)
        VALUES (?, 1, ?)
        ON CONFLICT(day) DO UPDATE SET
          admitted_jobs = admitted_jobs + 1,
          updated_at = excluded.updated_at
        WHERE admitted_jobs < ?
      `)
      .bind(day, now, ceiling)
      .run();
    return result.success && changes(result) === 1;
  }

  async reserveProviderCost(
    jobId: string,
    units: number,
    ceiling: number,
    now: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE book_jobs
        SET reserved_cost_units = reserved_cost_units + ?, updated_at = ?
        WHERE id = ? AND reserved_cost_units + actual_cost_units + ? <= ?
      `)
      .bind(units, now, jobId, units, ceiling)
      .run();
    return result.success && changes(result) === 1;
  }

  async reconcileProviderCost(
    jobId: string,
    reservedUnits: number,
    actualUnits: number,
    now: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE book_jobs
        SET reserved_cost_units = MAX(0, reserved_cost_units - ?),
            actual_cost_units = actual_cost_units + ?, updated_at = ?
        WHERE id = ?
      `)
      .bind(reservedUnits, actualUnits, now, jobId)
      .run();
    return result.success && changes(result) === 1;
  }

  async requestCancellation(
    jobId: string,
    capabilityHash: string,
    now: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE book_jobs SET cancellation_requested = 1, updated_at = ?
        WHERE id = ? AND capability_hash = ? AND status != 'cleaned'
      `)
      .bind(now, jobId, capabilityHash)
      .run();
    return result.success && changes(result) === 1;
  }

  async acknowledge(
    jobId: string,
    capabilityHash: string,
    now: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE book_jobs SET status = 'acknowledged', updated_at = ?
        WHERE id = ? AND capability_hash = ? AND status = 'complete'
      `)
      .bind(now, jobId, capabilityHash)
      .run();
    return result.success && changes(result) === 1;
  }

  async markTerminal(
    jobId: string,
    status: "complete" | "cancelled" | "failed_terminal",
    errorCategory: SafeBookJobErrorCategory | null,
    now: number,
    expiresAt: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE book_jobs
        SET status = ?, current_stage = ?, terminal_error_category = ?,
            terminal_at = ?, updated_at = ?, expires_at = ?
        WHERE id = ? AND status != 'cleaned'
      `)
      .bind(status, status, errorCategory, now, now, expiresAt, jobId)
      .run();
    return result.success && changes(result) === 1;
  }

  async setMistralReferences(
    jobId: string,
    references: { batchId?: string; inputFileId?: string; outputFileId?: string },
    now: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE book_jobs SET
          mistral_batch_id = COALESCE(?, mistral_batch_id),
          mistral_input_file_id = COALESCE(?, mistral_input_file_id),
          mistral_output_file_id = COALESCE(?, mistral_output_file_id),
          updated_at = ?
        WHERE id = ?
      `)
      .bind(
        references.batchId ?? null,
        references.inputFileId ?? null,
        references.outputFileId ?? null,
        now,
        jobId,
      )
      .run();
    return result.success && changes(result) === 1;
  }

  async markRecoverable(
    jobId: string,
    resumeStage: BookJobStatus,
    status: "failed_recoverable" | "manual_retry_required",
    errorCategory: SafeBookJobErrorCategory,
    now: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE book_jobs SET status = ?, resume_stage = ?, current_stage = ?,
          terminal_error_category = ?, retry_count = retry_count + 1, updated_at = ?
        WHERE id = ? AND status != 'cleaned'
      `)
      .bind(status, resumeStage, resumeStage, errorCategory, now, jobId)
      .run();
    return result.success && changes(result) === 1;
  }

  async resumeRecoverable(jobId: string, capabilityHash: string, now: number): Promise<boolean> {
    const result = await this.db
      .prepare(`
        UPDATE book_jobs SET status = resume_stage, current_stage = resume_stage,
          resume_stage = NULL, terminal_error_category = NULL, updated_at = ?
        WHERE id = ? AND capability_hash = ?
          AND status IN ('failed_recoverable', 'manual_retry_required')
          AND resume_stage IS NOT NULL AND cancellation_requested = 0 AND expires_at > ?
      `)
      .bind(now, jobId, capabilityHash, now)
      .run();
    return result.success && changes(result) === 1;
  }

  async appendOpenAiRequestId(jobId: string, requestId: string, now: number): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job || job.openaiRequestIds.includes(requestId)) return Boolean(job);
    const result = await this.db
      .prepare(`UPDATE book_jobs SET openai_request_ids = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify([...job.openaiRequestIds, requestId]), now, jobId)
      .run();
    return result.success && changes(result) === 1;
  }

  async listExpiredJobs(now: number, limit: number): Promise<BookJobRecord[]> {
    const result = await this.db
      .prepare(`
        SELECT ${JOB_COLUMNS} FROM book_jobs
        WHERE expires_at <= ? AND cleanup_state != 'complete'
        ORDER BY expires_at ASC LIMIT ?
      `)
      .bind(now, limit)
      .all<BookJobRow>();
    return (result.results ?? []).map(mapJob);
  }

  async markCleanupState(jobId: string, state: string, now: number): Promise<boolean> {
    const result = await this.db
      .prepare(`UPDATE book_jobs SET cleanup_state = ?, updated_at = ? WHERE id = ?`)
      .bind(state, now, jobId)
      .run();
    return result.success && changes(result) === 1;
  }
}
