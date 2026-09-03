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
    repository = new BookJobRepository(binding);
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
});
