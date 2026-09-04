import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BookJobRepository } from "../../app/lib/book-pipeline/job-repository";
import { BookOperationRepository, STAGE_LEASE_SECONDS } from "../../app/lib/book-pipeline/operation-repository";
import { MigratedD1 } from "./sqlite-d1";

describe("durable operation ownership against production migrations", () => {
  let db: MigratedD1; let repo: BookOperationRepository; let now: number;
  const input = { jobId: "job-1", stage: "generating_game" as const, cursor: 0, policyHash: "a".repeat(64) };
  const call = { slot: 0, requestHash: "b".repeat(64), reserveUnits: 100, ceiling: 300 };
  beforeEach(async () => {
    now = 1000; db = new MigratedD1(); repo = new BookOperationRepository(db, () => now);
    await new BookJobRepository(db, () => now).createJob({ id: "job-1", capabilityHash: "cap", identityHash: "identity", networkHash: "network", sourceFingerprint: "source", originalFilename: "book.pdf", mimeType: "application/pdf", byteSize: 1000, now, expiresAt: 5000 });
    db.database.exec("UPDATE book_jobs SET status='generating_game',current_stage='generating_game'");
  });
  afterEach(() => db.close());
  it("admits one concurrent owner and one concurrent paid intent", async () => {
    const owners = await Promise.all([repo.acquire(input),repo.acquire(input)]);
    expect(owners.filter(Boolean)).toHaveLength(1);
    const admitted = await Promise.all([repo.claimCall(owners.find(Boolean)!,call),repo.claimCall(owners.find(Boolean)!,call)]);
    expect(admitted.filter(Boolean)).toHaveLength(1);
  });
  it("requires confirmation to steal expired ownership and fences late writes", async () => {
    const old = (await repo.acquire(input))!; now += STAGE_LEASE_SECONDS + 1;
    expect(await repo.acquire(input)).toBeNull();
    const current = (await repo.acquire({ ...input, retryConfirmed: true }))!;
    expect(await repo.renew(old)).toBe(false);
    expect(await repo.transition(old,{ status: "verifying_quests" },{ "game-draft.json": "operations/artifacts/abcd.json" })).toBe(false);
    expect(await repo.artifactPath("job-1","game-draft.json")).toBeNull();
    expect(await repo.transition(current,{ status: "verifying_quests" },{ "game-draft.json": "operations/artifacts/abcd.json" })).toBe(true);
    expect(await repo.artifactPath("job-1","game-draft.json")).toBe("operations/artifacts/abcd.json");
    expect(await repo.transition(current,{ status: "complete" })).toBe(false);
  });
  it("pins policy across restart", async () => {
    const owner = (await repo.acquire(input))!; await repo.release(owner);
    expect(await repo.acquire({ ...input, policyHash: "c".repeat(64) })).toBeNull();
    expect(await repo.acquire(input)).not.toBeNull();
  });
  it("retains unknown spend, bounds retries and rejects changed requests", async () => {
    const owner = (await repo.acquire(input))!; const first = (await repo.claimCall(owner,call))!;
    await repo.failCall(owner,first,false);
    expect((await repo.latestCall(owner,0))?.reserved_units).toBe(100);
    expect(await repo.claimCall(owner,call)).toBeNull();
    expect(await repo.claimCall(owner,{ ...call, requestHash: "c".repeat(64), retryConfirmed: true })).toBeNull();
    const second = (await repo.claimCall(owner,{ ...call, retryConfirmed: true }))!;
    expect(second.attempt).toBe(1);
    expect(await repo.settle(owner,first,10)).toBe(false);
    await repo.failCall(owner,second,false);
    expect(await repo.claimCall(owner,{ ...call, retryConfirmed: true })).toBeNull();
  });
  it("settles once and includes legacy plus ledger costs in admission", async () => {
    db.database.exec("UPDATE book_jobs SET actual_cost_units=150");
    const owner = (await repo.acquire(input))!; const first = (await repo.claimCall(owner,call))!;
    expect(await repo.claimCall(owner,{ ...call, slot: 1 })).toBeNull();
    expect(await repo.settle(owner,first,20)).toBe(true);
    expect(await repo.settle(owner,first,20)).toBe(true);
    expect(await repo.settle(owner,first,0)).toBe(false);
    expect(await repo.claimCall(owner,{ ...call, slot: 1 })).not.toBeNull();
    expect(await repo.claimCall(owner,{ ...call, slot: 2 })).toBeNull();
  });
  it.each(["UPDATE book_jobs SET cancellation_requested=1", "UPDATE book_jobs SET expires_at=1000"])("fences inactive jobs: %s", async (sql) => {
    const owner = (await repo.acquire(input))!; db.database.exec(sql);
    expect(await repo.claimCall(owner,call)).toBeNull();
    expect(await repo.transition(owner,{ status: "complete" })).toBe(false);
  });
  it("does not erase active reservations in cleanup", async () => {
    const owner = (await repo.acquire(input))!; await repo.claimCall(owner,call);
    await repo.cleanup("job-1"); expect(await repo.latestCall(owner,0)).not.toBeNull();
    db.database.exec("UPDATE book_jobs SET status='cancelled'");
    await repo.cleanup("job-1"); expect(await repo.latestCall(owner,0)).toBeNull();
  });
  it("includes journal spend when a legacy-accounted visual stage reserves later", async () => {
    const owner = (await repo.acquire(input))!; await repo.claimCall(owner,call);
    expect(await new BookJobRepository(db,() => now).reserveProviderCost("job-1",250,300,now)).toBe(false);
    expect(await new BookJobRepository(db,() => now).reserveProviderCost("job-1",150,300,now)).toBe(true);
  });
  it("suspends only an expired owner and never a live replacement", async () => {
    const old = (await repo.acquire(input))!;
    expect(await repo.suspendExpired(old.id)).toBe(false); now += STAGE_LEASE_SECONDS + 1;
    await repo.acquire({ ...input,retryConfirmed: true });
    expect(await repo.suspendExpired(old.id)).toBe(false); now += STAGE_LEASE_SECONDS + 1;
    expect(await repo.suspendExpired(old.id)).toBe(true);
  });
});
