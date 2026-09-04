import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { BookArtifactStore } from "../../app/lib/book-pipeline/artifact-store";
import { BookJobRepository } from "../../app/lib/book-pipeline/job-repository";
import { BookOperationRepository, type StageOwner } from "../../app/lib/book-pipeline/operation-repository";
import { PaidCallJournal } from "../../app/lib/book-pipeline/paid-call-journal";
import { durableStage } from "../../app/lib/book-pipeline/durable-stage";
import { OpenAiRejectedRequestError } from "../../app/lib/book-pipeline/providers/openai";
import { MigratedD1 } from "./sqlite-d1";
import { ConditionalR2 } from "./durable-fixture";

describe("paid result recovery and atomic artifact publication", () => {
  let db: MigratedD1; let operations: BookOperationRepository; let jobs: BookJobRepository; let store: BookArtifactStore; let owner: StageOwner; let now: number;
  const identity = { jobId: "job", stage: "generating_game" as const, cursor: 0, policyHash: "a".repeat(64) };
  const limits = { reserveUnits: 100, ceiling: 1000, retryConfirmed: false };
  const journal = (retryConfirmed = false) => new PaidCallJournal(operations,owner,store,{ ...limits,retryConfirmed });
  beforeEach(async () => {
    now = 1000; db = new MigratedD1(); jobs = new BookJobRepository(db,() => now); operations = new BookOperationRepository(db,() => now); store = new BookArtifactStore(new ConditionalR2(),operations);
    await jobs.createJob({ id: "job", capabilityHash: "cap", identityHash: "identity", networkHash: "net", sourceFingerprint: "f", originalFilename: "source.pdf", mimeType: "application/pdf", byteSize: 100, now, expiresAt: 5000 });
    db.database.exec("UPDATE book_jobs SET status='generating_game',current_stage='generating_game'"); owner = (await operations.acquire(identity))!;
  });
  afterEach(() => db.close());
  it("replays after a crash between raw persistence and accounting without another call", async () => {
    const send = vi.fn(async () => ({ value: "saved" }));
    vi.spyOn(operations,"settle").mockRejectedValueOnce(new Error("simulated D1 outage"));
    await expect(journal().execute({ prompt: "one" },send,() => 10)).rejects.toThrow();
    await operations.release(owner); owner = (await operations.acquire(identity))!;
    expect(await journal().execute({ prompt: "one" },send,() => 10)).toEqual({ value: "saved" });
    expect(send).toHaveBeenCalledTimes(1); expect((await operations.latestCall(owner,0))?.actual_units).toBe(10);
  });
  it("does not retry unknown outcomes implicitly; explicit retry is bounded", async () => {
    const send = vi.fn(async () => { throw new Error("lost response"); });
    await expect(journal().execute("request",send,() => 10)).rejects.toThrow();
    await expect(journal().execute("request",send,() => 10)).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
    await expect(journal(true).execute("request",send,() => 10)).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(2);
    await expect(journal(true).execute("request",send,() => 10)).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(2);
    expect(db.database.prepare("SELECT SUM(reserved_units) AS n FROM book_provider_calls").get()?.n).toBe(200);
  });
  it("rejects changed requests without spending, even with confirmation", async () => {
    const send = vi.fn(async () => "ok"); await journal().execute("original",send,() => 10);
    await expect(journal(true).execute("changed",send,() => 10)).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
  });
  it("releases only definite rejected requests", async () => {
    await expect(journal().execute("request",async () => { throw new OpenAiRejectedRequestError(401); },() => 10)).rejects.toThrow();
    expect(await operations.latestCall(owner,0)).toMatchObject({ state: "rejected", reserved_units: 0 });
  });
  it("keeps a late result private and retains its reservation after cancellation", async () => {
    await expect(journal().execute("request",async () => { db.database.exec("UPDATE book_jobs SET cancellation_requested=1"); return "late"; },() => 10)).rejects.toThrow();
    expect(await operations.latestCall(owner,0)).toMatchObject({ state: "pending", reserved_units: 100 });
  });
  it("publishes draft and cursor atomically, preserving the prior checkpoint on a crash", async () => {
    await store.putJson("job","game-draft.json",{ version: "old" },5000);
    const stage = durableStage(operations,owner,store,jobs,limits);
    await stage.store.putJson("job","game-draft.json",{ version: "new" },5000);
    expect(await store.getJson("job","game-draft.json")).toEqual({ version: "old" });
    expect(await stage.store.getJson("job","game-draft.json")).toEqual({ version: "new" });
    expect(await stage.repository.commitStage({ jobId: "job",expectedStatus: "generating_game",nextStatus: "verifying_quests",batchCursor: 0,now })).toBe(true);
    expect(await store.getJson("job","game-draft.json")).toEqual({ version: "new" });
    expect((await jobs.getJob("job"))?.status).toBe("verifying_quests");
  });
  it("preserves visual ceilings and releases bounds only after saved-result settlement", async () => {
    const visual = { micros: 80,input: 100,output: 10,priorMicros: 10,priorInput: 0,priorOutput: 0,priorCalls: 0,maxMicros: 100 };
    const j = journal(); const send = vi.fn(async () => "ok");
    await j.execute("one",send,() => 10,visual,() => ({ micros: 20,input: 20,output: 2 }));
    await expect(j.execute("two",send,() => 10,visual)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
