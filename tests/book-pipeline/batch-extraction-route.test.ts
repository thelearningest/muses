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
import { PDFDocument } from "pdf-lib";

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

  it("creates a server manifest from the uploaded PDF without a browser manifest", async () => {
    const document = await PDFDocument.create();
    for (let index = 0; index < 9; index++) document.addPage();
    const bytes = await document.save();
    const bucket = fixture.env.BOOK_JOBS as ConditionalR2;
    const originalGet = bucket.get.bind(bucket);
    vi.spyOn(bucket, "get").mockImplementation(async (key) => key.endsWith("/source.pdf")
      ? { key, etag: "source-etag", text: async () => "", arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }
      : originalGet(key));
    db.database.exec("UPDATE book_jobs SET status='uploaded',current_stage='uploaded'");
    await store.putJson("job", "ingestion.json", { provider: "luna", batchedExtraction: true, directPdf: true }, Math.floor(Date.now() / 1000) + 3600);
    expect(await (await call()).json()).toEqual({ outcome: "advanced" });
    expect(await store.getJson("job", "extraction/state.json")).toMatchObject({ pageCount: 9, inputMode: "pdf", cursor: 0 });
    expect(await store.exists("job", "extraction/sections/0.pdf")).toBe(true);
    expect(await store.exists("job", "extraction/sections/1.pdf")).toBe(true);
    expect(await jobs.getJob("job")).toMatchObject({ status: "extracting_pages" });
    expect(db.database.prepare("SELECT COUNT(*) AS count FROM book_provider_calls").get()).toEqual({ count: 0 });
  });

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
  it("reads all 210 pages as background PDF sections and replays results without resubmitting", async () => {
    const now = Math.floor(Date.now() / 1000);
    fixture.env.BOOK_PROVIDER_URL_HMAC_KEY = "local-test-provider-url-key";
    const state = { ...initialBatchState("source", 210, { maxMicros: 25_000_000, inputUsdPerMillion: 4, outputUsdPerMillion: 20 }), inputMode: "pdf" as const };
    await store.putJson("job", "ingestion.json", { provider: "luna", batchedExtraction: true, directPdf: true }, now + 3600);
    await store.putJson("job", "extraction/state.json", state, now + 3600);
    const submitted = new Map<string, number[]>();
    let ready = false, counts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/input_tokens")) { counts++; return Response.json({ input_tokens: 23000 }); }
      if (url.endsWith("/responses") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.background).toBe(true);
        expect(body.input[0].content).toHaveLength(2);
        expect(body.input[0].content[1].type).toBe("input_file");
        const sectionUrl = new URL(body.input[0].content[1].file_url);
        const pages = JSON.parse(body.input[0].content[0].text).pages;
        expect(pages[0].pageIndex).toBe(Number(sectionUrl.searchParams.get("section")) * 8);
        expect(pages[0].sectionPage).toBe(1);
        const id = `resp_${submitted.size}`;
        submitted.set(id, pages.map((page: { pageIndex: number }) => page.pageIndex));
        return Response.json({ id, status: "queued" });
      }
      if (init?.method === "POST" || init?.method === "DELETE") return Response.json({ deleted: true });
      const id = url.split("/").at(-1)!;
      if (!ready) return Response.json({ id, status: "in_progress" });
      return Response.json({ id, status: "completed", usage: { input_tokens: 22000, output_tokens: 1000, total_tokens: 23000 },
        output_text: JSON.stringify({ bookTitle: "Source", pages: submitted.get(id)!.map((pageIndex) => ({ pageIndex, role: "lesson", concept: `Concept ${pageIndex}`,
          excerpt: `Evidence ${pageIndex}`, claim: `Evidence ${pageIndex}`, action: "compare", example: "", pitfall: "", prerequisites: [], visual: null, uncertainty: "" })) }) });
    }));
    try {
      expect(await (await call()).json()).toMatchObject({ outcome: "waiting" });
      expect(submitted.size).toBe(27);
      expect(await (await call()).json()).toMatchObject({ outcome: "waiting" });
      expect(submitted.size).toBe(27);
      ready = true;
      expect(await (await call()).json()).toMatchObject({ outcome: "complete", completedPages: 210 });
      expect(counts).toBe(27);
      expect(submitted.size).toBe(27);
      expect(await jobs.getJob("job")).toMatchObject({ status: "annotating_visuals" });
      const published = new BookArtifactStore(fixture.env.BOOK_JOBS as import("../../app/lib/book-pipeline/runtime-env").R2BucketBinding, new (await import("../../app/lib/book-pipeline/operation-repository")).BookOperationRepository(db));
      expect(await published.getJson("job", "canonical-book.json")).toMatchObject({ source: { pageCount: 210 } });
      expect(db.database.prepare("SELECT COUNT(*) AS count FROM book_provider_calls").get()).toEqual({ count: 27 });
    } finally { vi.unstubAllGlobals(); }
  });
});
