import { it, expect, vi } from "vitest";
import { initialBatchState, validateBatchOutput, advanceBatchExtraction, pendingBatchExtractionRequests } from "../../app/lib/book-pipeline/extraction/batch";
import { BookArtifactStore } from "../../app/lib/book-pipeline/artifact-store";
import { BookJobRepository } from "../../app/lib/book-pipeline/job-repository";
import { BookOperationRepository } from "../../app/lib/book-pipeline/operation-repository";
import { durableStage } from "../../app/lib/book-pipeline/durable-stage";
import { OpenAiOutputLimitError, type StructuredOutputProvider } from "../../app/lib/book-pipeline/providers/openai";
import { MigratedD1 } from "./sqlite-d1";
import { ConditionalR2 } from "./durable-fixture";

const page = (pageIndex: number) => ({ pageIndex, role: "lesson", concept: `Concept ${pageIndex}`, excerpt: `Evidence for concept ${pageIndex}.`,
  claim: `Evidence for concept ${pageIndex}.`, action: "compare", example: "", pitfall: "", prerequisites: [], visual: null, uncertainty: "Selected excerpt only." });

it.each([1, 7, 8, 9, 100, 299, 300])("discovers preparation work across the supported page range (%i pages)", async (pageCount) => {
  const state = initialBatchState("f", pageCount, { maxMicros: 15_000_000, inputUsdPerMillion: 4, outputUsdPerMillion: 20 });
  const present = new Set<number>();
  const store = { exists: vi.fn(async (_jobId: string, path: string) => present.has(Number(path.match(/assets\/(\d+)-/)?.[1]))) };
  const first = await pendingBatchExtractionRequests({ jobId: "job", state, store });
  expect(first).toHaveLength(pageCount);
  expect(first.map((request) => request.pageIndex)).toEqual(Array.from({ length: pageCount }, (_, index) => index));
  for (let index = 0; index < pageCount; index++) present.add(index);
  expect(await pendingBatchExtractionRequests({ jobId: "job", state, store })).toEqual([]);
});

it("rejects page counts outside the manifest boundary", () => {
  const limits = { maxMicros: 15_000_000, inputUsdPerMillion: 4, outputUsdPerMillion: 20 };
  expect(() => initialBatchState("f", 0, limits)).toThrow(/manifest/i);
  expect(() => initialBatchState("f", 301, limits)).toThrow(/manifest/i);
});

it("omits malformed individual pages without failing the book", () => {
  expect(validateBatchOutput({ bookTitle: null, pages: [page(0)] }, [0, 1]).pages.map((p) => p.role)).toEqual(["lesson", "unreadable"]);
  expect(validateBatchOutput({ bookTitle: null, pages: [page(0), page(0)] }, [0, 1]).pages.map((p) => p.role)).toEqual(["lesson", "unreadable"]);
  expect(validateBatchOutput({ bookTitle: null, pages: [{ ...page(0), role: "lesson", excerpt: "" }] }, [0]).pages[0].role).toBe("unreadable");
  expect(validateBatchOutput({ bookTitle: null, pages: [{ ...page(0), role: "unreadable", concept: "", excerpt: "", claim: "" }] }, [0]).pages[0].role).toBe("unreadable");
  expect(validateBatchOutput({ bookTitle: null, pages: [page(1), page(0)] }, [0, 1]).pages.map((p) => p.pageIndex)).toEqual([0, 1]);
});

it.each([false, true])("extracts ready groups and publishes all evidence atomically (partial preparation: %s)", async (partial) => {
  const db = new MigratedD1();
  try {
    const now = 1000;
    const jobs = new BookJobRepository(db, () => now);
    const operations = new BookOperationRepository(db, () => now);
    const store = new BookArtifactStore(new ConditionalR2(), operations);
    await jobs.createJob({ id: "job", capabilityHash: "cap", identityHash: "identity", networkHash: "net", sourceFingerprint: "f", originalFilename: "source.pdf", mimeType: "application/pdf", byteSize: 100, now, expiresAt: 5000 });
    db.database.exec("UPDATE book_jobs SET status='extracting_pages',current_stage='extracting_pages'");
    const state = initialBatchState("f", 16, { maxMicros: 15_000_000, inputUsdPerMillion: 4, outputUsdPerMillion: 20 });
    await store.putJson("job", "extraction/state.json", state, 5000);
    const prepare = async (from: number, to: number) => {
      for (let index = from; index < to; index++) await store.putJson("job", `extraction/assets/${index}-0.json`, { pageIndex: index, revision: 0, nativeText: page(index).excerpt, orderReliable: true, images: [] }, 5000);
    };
    await prepare(0, partial ? 8 : 16);
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    if (partial) release();
    let outputLimited = false;
    const outputLimits: number[] = [];
    const send = vi.fn(async (request: Parameters<StructuredOutputProvider["generateStructured"]>[0]) => {
      outputLimits.push(request.maxOutputTokens ?? 0);
      if (++started === 2) release();
      await gate;
      if (!partial && !outputLimited && JSON.parse(request.input).pages[0].pageIndex === 0) { outputLimited = true; throw new OpenAiOutputLimitError(); }
      return { responseId: "response", data: { bookTitle: "Source", pages: JSON.parse(request.input).pages.map((p: { pageIndex: number }) => page(p.pageIndex)) }, usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 } };
    });
    const owner = (await operations.acquire({ jobId: "job", stage: "extracting_pages", cursor: 0, policyHash: "a".repeat(64) }))!;
    const durable = durableStage(operations, owner, store, jobs, { reserveUnits: 1000, ceiling: 20000, retryConfirmed: false });
    const input = { job: { id: "job", identityHash: "identity", originalFilename: "source.pdf", expiresAt: 5000 }, state, store: durable.store,
      provider: durable.journal.structured({ generateStructured: send } as StructuredOutputProvider), isActive: durable.isActive };
    if (partial) {
      expect(await advanceBatchExtraction(input)).toMatchObject({ outcome: "awaiting_extraction_assets", requests: Array.from({ length: 8 }, (_, index) => expect.objectContaining({ pageIndex: index + 8 })) });
      expect(send).not.toHaveBeenCalled();
      expect(await store.getJson("job", "canonical-book.json")).toBeNull();
      await prepare(8, 16);
    }
    expect(await advanceBatchExtraction(input)).toMatchObject({ outcome: "complete", completedPages: 16 });
    expect(await store.getJson("job", "canonical-book.json")).toBeNull();
    expect(await advanceBatchExtraction(input)).toMatchObject({ outcome: "complete" });
    expect(send).toHaveBeenCalledTimes(partial ? 2 : 3);
    expect(outputLimits).toContain(6000);
    if (!partial) expect(outputLimits).toContain(10000);
    expect(await durable.repository.commitStage({ jobId: "job", expectedStatus: "extracting_pages", nextStatus: "annotating_visuals", batchCursor: 0, now })).toBe(true);
    expect(await store.getJson("job", "canonical-book.json")).toMatchObject({ source: { pageCount: 16 } });
    expect(await store.getJson("job", "evidence-manifest.json")).toEqual({ batchCount: 1 });
    expect((await jobs.getJob("job"))?.status).toBe("annotating_visuals");
  } finally { db.close(); }
});
