import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("../../app/lib/book-pipeline/runtime-env", () => ({ getBookPipelineRuntimeEnv: async () => fixture.env }));

import { POST } from "../../app/api/book-jobs/[jobId]/advance/route";
import { BookArtifactStore } from "../../app/lib/book-pipeline/artifact-store";
import { initialBatchState } from "../../app/lib/book-pipeline/extraction/batch";
import { BookJobRepository } from "../../app/lib/book-pipeline/job-repository";
import { hashPrivateValue } from "../../app/lib/book-pipeline/security";
import { ConditionalR2 } from "./durable-fixture";
import { MigratedD1 } from "./sqlite-d1";

describe("batch extraction preparation admission", () => {
  let db: MigratedD1;
  let jobs: BookJobRepository;
  let store: BookArtifactStore;
  const call = () => POST(new Request("https://books.test/api/book-jobs/job/advance", {
    method: "POST", headers: { origin: "https://books.test", authorization: "Bearer capability" }, body: "{}",
  }), { params: Promise.resolve({ jobId: "job" }) });

  beforeEach(async () => {
    db = new MigratedD1();
    jobs = new BookJobRepository(db);
    const bucket = new ConditionalR2();
    store = new BookArtifactStore(bucket);
    fixture.env = { DB: db, BOOK_JOBS: bucket, OPENAI_API_KEY: "local-test-openai-key", BOOK_CAPABILITY_HMAC_KEY: "local-test-capability-key" };
    const now = Math.floor(Date.now() / 1000);
    await jobs.createJob({ id: "job", capabilityHash: await hashPrivateValue("capability", String(fixture.env.BOOK_CAPABILITY_HMAC_KEY)),
      identityHash: "identity", networkHash: "network", sourceFingerprint: "source", originalFilename: "source.pdf",
      mimeType: "application/pdf", byteSize: 100, now, expiresAt: now + 3600 });
    db.database.exec("UPDATE book_jobs SET status='extracting_pages',current_stage='extracting_pages'");
    await store.putJson("job", "ingestion.json", { provider: "luna", batchedExtraction: true }, now + 3600);
  });
  afterEach(() => { vi.restoreAllMocks(); db.close(); });

  it.each([1, 299])("returns all missing packets without acquiring a paid-stage lease (%i pages)", async (pageCount) => {
    const now = Math.floor(Date.now() / 1000);
    await store.putJson("job", "extraction/state.json", initialBatchState("source", pageCount,
      { maxMicros: 15_000_000, inputUsdPerMillion: 4, outputUsdPerMillion: 20 }), now + 3600);
    const response = await call();
    expect(response.status).toBe(200);
    const body = await response.json() as { outcome: string; requests: Array<{ pageIndex: number }> };
    expect(body.outcome).toBe("awaiting_extraction_assets");
    expect(body.requests).toHaveLength(pageCount);
    expect(body.requests[0].pageIndex).toBe(0);
    expect(body.requests.at(-1)?.pageIndex).toBe(pageCount - 1);
    expect(db.database.prepare("SELECT COUNT(*) AS count FROM book_stage_runs").get()).toEqual({ count: 0 });
    expect(db.database.prepare("SELECT COUNT(*) AS count FROM book_provider_calls").get()).toEqual({ count: 0 });
  });
});
