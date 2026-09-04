import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BookJobRepository } from "../../app/lib/book-pipeline/job-repository";
import type {
  D1DatabaseBinding,
  D1PreparedStatementBinding,
  D1Result,
} from "../../app/lib/book-pipeline/runtime-env";

class SqliteStatement implements D1PreparedStatementBinding {
  constructor(
    private readonly statement: StatementSync,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatementBinding {
    return new SqliteStatement(this.statement, values);
  }

  async run<T>(): Promise<D1Result<T>> {
    const result = this.statement.run(...(this.values as SQLInputValue[]));
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes) },
    };
  }

  async first<T>(): Promise<T | null> {
    return (
      (this.statement.get(...(this.values as SQLInputValue[])) as T | undefined) ?? null
    );
  }

  async all<T>(): Promise<D1Result<T>> {
    return {
      success: true,
      results: this.statement.all(...(this.values as SQLInputValue[])) as T[],
      meta: { changes: 0 },
    };
  }
}

class SqliteD1 implements D1DatabaseBinding {
  readonly database = new DatabaseSync(":memory:");

  prepare(query: string): D1PreparedStatementBinding {
    return new SqliteStatement(this.database.prepare(query));
  }

  async batch<T>(statements: D1PreparedStatementBinding[]): Promise<D1Result<T>[]> {
    return Promise.all(statements.map((statement) => statement.run<T>()));
  }
}

function installSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE book_provider_calls (job_id TEXT, reserved_units INTEGER NOT NULL, actual_units INTEGER NOT NULL);
    CREATE TABLE book_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      capability_hash TEXT NOT NULL,
      identity_hash TEXT NOT NULL,
      network_hash TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      page_count INTEGER,
      status TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      resume_stage TEXT,
      batch_cursor INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      cancellation_requested INTEGER NOT NULL DEFAULT 0,
      cleanup_state TEXT NOT NULL DEFAULT 'pending',
      terminal_error_category TEXT,
      mistral_batch_id TEXT,
      mistral_input_file_id TEXT,
      mistral_output_file_id TEXT,
      openai_request_ids TEXT NOT NULL DEFAULT '[]',
      reserved_cost_units INTEGER NOT NULL DEFAULT 0,
      actual_cost_units INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      terminal_at INTEGER,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE book_job_attempts (
      id TEXT PRIMARY KEY NOT NULL,
      identity_hash TEXT NOT NULL,
      network_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE book_daily_budget (
      day TEXT PRIMARY KEY NOT NULL,
      admitted_jobs INTEGER NOT NULL DEFAULT 0,
      reserved_cost_units INTEGER NOT NULL DEFAULT 0,
      actual_cost_units INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
}

const baseJob = {
  id: "job-1",
  capabilityHash: "capability-hash",
  identityHash: "identity-hash",
  networkHash: "network-hash",
  sourceFingerprint: "source-fingerprint",
  originalFilename: "book.pdf",
  mimeType: "application/pdf",
  byteSize: 1024,
  now: 1_000,
  expiresAt: 87_400,
} as const;

describe("BookJobRepository", () => {
  let binding: SqliteD1;
  let repository: BookJobRepository;

  beforeEach(() => {
    binding = new SqliteD1();
    installSchema(binding.database);
    repository = new BookJobRepository(binding, () => 1000);
  });

  afterEach(() => binding.database.close());

  it("allows only one concurrent stage claimant", async () => {
    await repository.createJob(baseJob);

    const claims = await Promise.all([
      repository.claimStage({
        jobId: baseJob.id,
        capabilityHash: baseJob.capabilityHash,
        expectedStatus: "created",
        claimedStatus: "uploading",
        now: 1_001,
      }),
      repository.claimStage({
        jobId: baseJob.id,
        capabilityHash: baseJob.capabilityHash,
        expectedStatus: "created",
        claimedStatus: "uploading",
        now: 1_001,
      }),
    ]);

    expect(claims.sort()).toEqual([false, true]);
  });

  it("does not let a late extraction failure resurrect cancelled or expired jobs", async () => {
    await repository.createJob(baseJob);
    await repository.claimStage({ jobId: baseJob.id, capabilityHash: baseJob.capabilityHash, expectedStatus: "created", claimedStatus: "extracting_pages", now: 1001 });
    expect(await repository.interruptExtraction(baseJob.id, "manual_retry_required", 1002)).toBe(true);
    expect(await repository.resumeRecoverable(baseJob.id, baseJob.capabilityHash, 1003)).toBe(true);
    expect(await repository.interruptExtraction(baseJob.id, "manual_retry_required", baseJob.expiresAt)).toBe(false);
    await repository.requestCancellation(baseJob.id, baseJob.capabilityHash, 1004);
    expect(await repository.interruptExtraction(baseJob.id, "extraction_quality_insufficient", 1005)).toBe(false);
  });

  it("rejects late completion and recoverable errors after cancellation", async () => {
    await repository.createJob(baseJob);
    await repository.claimStage({ jobId: baseJob.id, capabilityHash: baseJob.capabilityHash, expectedStatus: "created", claimedStatus: "verifying_quests", now: 1001 });
    await repository.requestCancellation(baseJob.id, baseJob.capabilityHash, 1002);
    await repository.markTerminal(baseJob.id, "cancelled", null, 1003, baseJob.expiresAt);
    expect(await repository.markTerminal(baseJob.id, "complete", null, 1004, baseJob.expiresAt)).toBe(false);
    expect(await repository.markRecoverable(baseJob.id, "verifying_quests", "failed_recoverable", "provider_unavailable", 1005)).toBe(false);
    expect((await repository.getJob(baseJob.id))?.status).toBe("cancelled");
  });

  it("rejects a stale stage error after another request advances the job", async () => {
    await repository.createJob(baseJob);
    await repository.claimStage({ jobId: baseJob.id, capabilityHash: baseJob.capabilityHash, expectedStatus: "created", claimedStatus: "mapping_evidence", now: 1001 });
    await repository.commitStage({ jobId: baseJob.id, expectedStatus: "mapping_evidence", nextStatus: "building_book_map", now: 1002 });
    expect(await repository.markRecoverable(baseJob.id, "mapping_evidence", "failed_recoverable", "provider_unavailable", 1003)).toBe(false);
    expect((await repository.getJob(baseJob.id))?.status).toBe("building_book_map");
  });

  it("does not advance, complete, or reserve paid work for an expired job", async () => {
    await repository.createJob(baseJob);
    await repository.claimStage({ jobId: baseJob.id, capabilityHash: baseJob.capabilityHash, expectedStatus: "created", claimedStatus: "verifying_quests", now: 1001 });
    expect(await repository.commitStage({ jobId: baseJob.id, expectedStatus: "verifying_quests", nextStatus: "verifying_quests", batchCursor: 2, now: baseJob.expiresAt })).toBe(false);
    expect(await repository.markTerminal(baseJob.id, "complete", null, baseJob.expiresAt, baseJob.expiresAt + 1000)).toBe(false);
    expect(await repository.reserveProviderCost(baseJob.id, 1, 10, baseJob.expiresAt)).toBe(false);
    expect((await repository.getJob(baseJob.id))?.expiresAt).toBe(baseJob.expiresAt);
  });

  it("rechecks wall time after a long provider call and never extends retention", async () => {
    let wallTime = 1000;
    repository = new BookJobRepository(binding, () => wallTime);
    await repository.createJob(baseJob);
    await repository.claimStage({ jobId: baseJob.id, capabilityHash: baseJob.capabilityHash, expectedStatus: "created", claimedStatus: "verifying_quests", now: 1001 });
    wallTime = baseJob.expiresAt;
    expect(await repository.markTerminal(baseJob.id, "complete", null, 1002, baseJob.expiresAt + 1000)).toBe(false);
    expect(await repository.markRecoverable(baseJob.id, "verifying_quests", "failed_recoverable", "provider_unavailable", 1002)).toBe(false);
    expect(await repository.reserveProviderCost(baseJob.id, 1, 100, 1002)).toBe(false);
    expect(await repository.commitStage({ jobId: baseJob.id, expectedStatus: "verifying_quests", nextStatus: "verifying_quests", now: 1002 })).toBe(false);
    expect(await repository.markTerminal(baseJob.id, "cancelled", null, 1002, baseJob.expiresAt + 1000)).toBe(true);
    expect((await repository.getJob(baseJob.id))?.expiresAt).toBe(baseJob.expiresAt);
  });

  it("can guard the expected cursor and terminal stage against stale results", async () => {
    await repository.createJob(baseJob);
    await repository.claimStage({ jobId: baseJob.id, capabilityHash: baseJob.capabilityHash, expectedStatus: "created", claimedStatus: "mapping_evidence", now: 1001 });
    expect(await repository.commitStage({ jobId: baseJob.id, expectedStatus: "mapping_evidence", nextStatus: "mapping_evidence", expectedBatchCursor: 0, batchCursor: 1, now: 1002 })).toBe(true);
    expect(await repository.commitStage({ jobId: baseJob.id, expectedStatus: "mapping_evidence", nextStatus: "mapping_evidence", expectedBatchCursor: 0, batchCursor: 1, now: 1003 })).toBe(false);
    expect(await repository.markRecoverable(baseJob.id, "mapping_evidence", "failed_recoverable", "provider_unavailable", 1003, "mapping_evidence", 0)).toBe(false);
    expect(await repository.markTerminal(baseJob.id, "failed_terminal", "verification_failed", 1004, baseJob.expiresAt, "verifying_quests")).toBe(false);
  });

  it("preserves the legacy OCR resume target without accepting errors from other stages", async () => {
    await repository.createJob(baseJob);
    await repository.claimStage({ jobId: baseJob.id, capabilityHash: baseJob.capabilityHash, expectedStatus: "created", claimedStatus: "ocr_submitting", now: 1001 });
    expect(await repository.markRecoverable(baseJob.id, "uploaded", "manual_retry_required", "manual_retry_required", 1002, "ocr_submitting")).toBe(true);
    expect(await repository.resumeRecoverable(baseJob.id, baseJob.capabilityHash, 1003)).toBe(true);
    expect((await repository.getJob(baseJob.id))?.status).toBe("uploaded");
  });

  it("reserves provider cost only within the per-job ceiling", async () => {
    await repository.createJob(baseJob);

    expect(await repository.reserveProviderCost(baseJob.id, 7, 10, 1_001)).toBe(true);
    expect(await repository.reserveProviderCost(baseJob.id, 4, 10, 1_002)).toBe(false);
    expect(await repository.reserveProviderCost(baseJob.id, 3, 10, 1_003)).toBe(true);

    const job = await repository.getAuthorizedJob(baseJob.id, baseJob.capabilityHash);
    expect(job?.reservedCostUnits).toBe(10);
  });

  it("admits five attempts and rejects the sixth inside a rolling day", async () => {
    for (let index = 0; index < 6; index += 1) {
      const admitted = await repository.admitAttempt({
        attemptId: `attempt-${index}`,
        identityHash: baseJob.identityHash,
        networkHash: baseJob.networkHash,
        now: 100_000 + index,
        since: 100_000 - 86_400,
        ceiling: 5,
      });
      expect(admitted).toBe(index < 5);
    }
  });

  it("does not count expired attempts", async () => {
    await repository.admitAttempt({
      attemptId: "old-attempt",
      identityHash: baseJob.identityHash,
      networkHash: baseJob.networkHash,
      now: 1_000,
      since: 0,
      ceiling: 5,
    });

    expect(
      await repository.countRecentAttempts(baseJob.identityHash, 1_001),
    ).toBe(0);
  });

  it("atomically enforces the UTC-day global admission ceiling", async () => {
    const admissions = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        repository.reserveDailyAdmission("2026-09-03", 3, 2_000 + index),
      ),
    );

    expect(admissions.filter(Boolean)).toHaveLength(3);
  });

  it("supports authorization, cancellation, acknowledgment, terminal state, and expiry", async () => {
    await repository.createJob(baseJob);
    expect(await repository.getAuthorizedJob(baseJob.id, "wrong")).toBeNull();
    expect(await repository.requestCancellation(baseJob.id, baseJob.capabilityHash, 1_010)).toBe(true);
    expect(await repository.markTerminal(baseJob.id, "cancelled", null, 1_011, 2_000)).toBe(true);
    expect(await repository.acknowledge(baseJob.id, baseJob.capabilityHash, 1_012)).toBe(false);

    const expired = await repository.listExpiredJobs(3_000, 10);
    expect(expired.map((job) => job.id)).toEqual([baseJob.id]);
  });

  it("still permits normal completion and acknowledgement before expiry", async () => {
    await repository.createJob(baseJob);
    await repository.claimStage({ jobId: baseJob.id, capabilityHash: baseJob.capabilityHash, expectedStatus: "created", claimedStatus: "verifying_quests", now: 1001 });
    expect(await repository.markTerminal(baseJob.id, "complete", null, 1002, baseJob.expiresAt + 1000)).toBe(true);
    expect((await repository.getJob(baseJob.id))?.expiresAt).toBe(baseJob.expiresAt);
    expect(await repository.acknowledge(baseJob.id, baseJob.capabilityHash, 1003)).toBe(true);
    expect((await repository.getJob(baseJob.id))?.status).toBe("acknowledged");
  });
});
