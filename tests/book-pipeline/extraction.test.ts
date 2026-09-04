import { describe, it, expect, vi } from "vitest";
import { canonicalizeExtractedPages, EXTRACTION_PROMPT_VERSION, PAGE_EXTRACTION_INSTRUCTIONS, nativeTextUsable, parseExtractedPage, type PageRecord } from "../../app/lib/book-pipeline/extraction/page-extraction";
import { advanceExtraction, EXTRACTION_STATE_PATH, initialExtractionState, type ExtractionAsset, type ExtractionState } from "../../app/lib/book-pipeline/extraction/stage";
import type { VisualStore } from "../../app/lib/book-pipeline/visual-agent/stage";
import type { StructuredOutputProvider } from "../../app/lib/book-pipeline/providers/openai";

const page = (pageIndex = 0, quality = "readable") => ({ pageIndex, quality, printedLabel: "113", blocks: [{ type: "paragraph", text: "Record evidence before choosing an explanation.", box: null }], visuals: [], warnings: [] });
const response = (data: unknown) => ({ responseId: "response", data, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } });
const limits = { maxMicros: 1_000_000, inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 };
function memoryStore() {
  const values = new Map<string, unknown>(); const versions = new Map<string, number>();
  const store: VisualStore = {
    getJson: async <T,>(_id: string, path: string) => structuredClone(values.get(path) ?? null) as T | null,
    putJson: async (_id, path, value) => { values.set(path, structuredClone(value)); versions.set(path, (versions.get(path) ?? 0) + 1); },
    putJsonIfAbsent: async (id, path, value, expiry) => { if (values.has(path)) return false; await store.putJson(id, path, value, expiry); return true; },
    getJsonVersion: async <T,>(id: string, path: string) => { const value = await store.getJson<T>(id, path); return value ? { value, etag: String(versions.get(path)) } : null; },
    putJsonVersion: async (id, path, value, etag, expiry) => { if (String(versions.get(path)) !== etag) return false; await store.putJson(id, path, value, expiry); return true; },
  };
  return store;
}
async function fixture() {
  const store = memoryStore(); const job = { id: "job", identityHash: "identity", originalFilename: "book.pdf", expiresAt: 10000 };
  await store.putJson(job.id, EXTRACTION_STATE_PATH, initialExtractionState("fingerprint", 1, limits), job.expiresAt);
  const generate = vi.fn(async () => response(page()));
  const input = { job, store, provider: { generateStructured: generate } as unknown as StructuredOutputProvider, now: 1000, isActive: async () => true };
  async function asset(revision = 0, nativeText = "", orderReliable = false) {
    const value: ExtractionAsset = { pageIndex: 0, revision, nativeText, orderReliable,
      images: Array.from({ length: 2 ** revision }, (_, i) => ({ imageUrl: "data:image/png;base64,dGVzdA==", hash: "a".repeat(64), width: 100, height: 100, detail: "high", label: `Full-page region ${i}` })) };
    // Image-byte validation belongs to the authenticated upload boundary; this
    // unit fixture tests orchestration with already validated asset metadata.
    await store.putJson(job.id, `extraction/assets/0-${revision}.json`, value, job.expiresAt);
  }
  const state = () => store.getJson<ExtractionState>(job.id, EXTRACTION_STATE_PATH);
  return { input, store, job, generate, asset, state };
}

describe("provider-neutral page extraction", () => {
  it("uses Sol only at final refinement and records model-specific spend and provenance", async () => {
    const f = await fixture();
    f.generate.mockResolvedValueOnce(response(page(0, "needs_refinement"))).mockResolvedValueOnce(response(page(0, "needs_refinement")));
    for (let revision = 0; revision < 3; revision++) { await f.asset(revision); await advanceExtraction(f.input); }
    const calls = f.generate.mock.calls as unknown as Array<[{ model: string }]>;
    expect(calls.map(([request]) => request.model)).toEqual(["gpt-5.6-luna", "gpt-5.6-luna", "gpt-5.6-sol"]);
    expect((await f.state())?.usage.estimatedMicros).toBe(2 * 85 + 1500);
    expect(await f.store.getJson(f.job.id, "extraction/pages/0-2-0.json")).toMatchObject({ method: "sol", model: "gpt-5.6-sol", priceBasis: { inputUsdPerMillion: 4, outputUsdPerMillion: 20 } });
  });
  it("keeps legacy requests and final refinement Luna-only", async () => {
    const f = await fixture(); const state = (await f.state())!;
    state.version = 1; state.promptVersion = EXTRACTION_PROMPT_VERSION; delete state.fallback; state.revision = 2;
    await f.store.putJson(f.job.id, EXTRACTION_STATE_PATH, state, f.job.expiresAt); await f.asset(2);
    await advanceExtraction(f.input);
    expect(f.generate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-luna", instructions: PAGE_EXTRACTION_INSTRUCTIONS }));
    expect((await f.state())?.usage.estimatedMicros).toBe(85);
  });
  it("admits the Sol request at Sol prices, not the cheaper default prices", async () => {
    const f = await fixture(); const state = (await f.state())!; state.revision = 2; state.limits.maxMicros = 100000;
    await f.store.putJson(f.job.id, EXTRACTION_STATE_PATH, state, f.job.expiresAt); await f.asset(2);
    expect(await advanceExtraction(f.input)).toMatchObject({ reason: "budget_exhausted" });
    expect(f.generate).not.toHaveBeenCalled();
  });
  it("omits refined text geometry but retains raw response and validates visual boxes", async () => {
    const f = await fixture(); const state = (await f.state())!; state.revision = 2;
    await f.store.putJson(f.job.id, EXTRACTION_STATE_PATH, state, f.job.expiresAt); await f.asset(2);
    const box = { x: 0.9, y: 0, width: 0.5, height: 1 };
    f.generate.mockResolvedValueOnce(response({ ...page(), blocks: [{ ...page().blocks[0], box }] }));
    expect(await advanceExtraction(f.input)).toMatchObject({ completedPages: 1 });
    expect(await f.store.getJson(f.job.id, "extraction/pages/0-2-0.json")).toMatchObject({ page: { blocks: [{ box: null }] } });
    expect(await f.store.getJson(f.job.id, "extraction/calls/0-2-0.json")).toMatchObject({ response: { data: { blocks: [{ box }] } } });
  });
  it("rejects wrong page indices, invalid caption relationships and missing coverage", () => {
    expect(() => parseExtractedPage(page(1), 0)).toThrow(/mismatch/);
    expect(() => parseExtractedPage({ ...page(), visuals: [{ kind: "figure", description: "Chart", box: { x: 0, y: 0, width: 1, height: 1 }, captionBlockIndexes: [0] }] }, 0)).toThrow(/caption/);
    expect(() => canonicalizeExtractedPages({ fingerprint: "f", filename: "f.pdf", pageCount: 2 }, [])).toThrow(/coverage/);
  });
  it("rejects mislabeled blank pages and boxes outside the full page", () => {
    expect(() => parseExtractedPage(page(0, "blank"), 0)).toThrow(/Non-text/);
    expect(() => parseExtractedPage({ ...page(), blocks: [{ ...page().blocks[0], box: { x: 0.9, y: 0, width: 0.5, height: 1 } }] }, 0)).toThrow(/outside/);
  });
  it("preserves PDF page identity independently of printed folios", () => {
    const records: PageRecord[] = [0,1].map((i) => ({ page: parseExtractedPage(page(i), i), method: "luna", revision: 0, imageHashes: [], promptVersion: "test" }));
    const book = canonicalizeExtractedPages({ fingerprint: "f", filename: "f.pdf", pageCount: 2 }, records);
    expect(book.pages.map((p) => p.index)).toEqual([0,1]);
    expect(book.pages[0].printedLabel).toBe("113");
    expect(book.blocks[0].nextBlockId).toBe("p1-b0");
    expect(() => canonicalizeExtractedPages(book.source, [records[0], records[0]])).toThrow(/mismatch/);
  });
  it("uses native text only with sufficient text and reliable ordering", () => {
    const text = "Read the source carefully and compare evidence before deciding. ".repeat(5);
    expect(nativeTextUsable(text, true)).toBe(true);
    expect(nativeTextUsable(text, false)).toBe(false);
    expect(nativeTextUsable("", true)).toBe(false);
    expect(nativeTextUsable(text + "\uFFFD", true)).toBe(false);
  });
  it("requests assets without paying and produces canonical output only after page completion", async () => {
    const f = await fixture();
    expect(await advanceExtraction(f.input)).toMatchObject({ outcome: "awaiting_extraction_assets", request: { pageIndex: 0, revision: 0, parts: 1 } });
    expect(f.generate).not.toHaveBeenCalled();
    await f.asset();
    expect(await advanceExtraction(f.input)).toMatchObject({ outcome: "advanced", completedPages: 1 });
    expect(await advanceExtraction(f.input)).toEqual({ outcome: "complete" });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(await f.store.getJson(f.job.id, "canonical-book.json")).toMatchObject({ source: { pageCount: 1 } });
  });
  it("does not pay for the native-text fast path", async () => {
    const f = await fixture(); await f.asset(0, "Read the source carefully and compare evidence before deciding. ".repeat(5), true);
    expect(await advanceExtraction(f.input)).toMatchObject({ completedPages: 1 });
    expect(f.generate).not.toHaveBeenCalled();
  });
  it("replays a completed paid result after a cursor-write crash", async () => {
    const f = await fixture(); await f.asset();
    const original = f.store.putJsonVersion;
    f.store.putJsonVersion = vi.fn().mockRejectedValueOnce(new Error("storage interrupted")).mockImplementation(original);
    await expect(advanceExtraction(f.input)).rejects.toThrow(/storage/);
    expect(await advanceExtraction(f.input)).toMatchObject({ completedPages: 1 });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect((await f.state())?.usage.calls).toBe(1);
  });
  it("allows only one concurrent paid request", async () => {
    const f = await fixture(); await f.asset();
    let finish!: (value: ReturnType<typeof response>) => void;
    let started!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; });
    f.generate.mockImplementationOnce(() => { started(); return new Promise((resolve) => { finish = resolve; }); });
    const first = advanceExtraction(f.input); await start;
    expect(await advanceExtraction(f.input)).toEqual({ outcome: "waiting" });
    finish(response(page())); await first;
    expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it("requires explicit consent for an unknown paid outcome and retains its reservation", async () => {
    const f = await fixture(); await f.asset(); f.generate.mockRejectedValueOnce(new Error("network lost"));
    expect(await advanceExtraction(f.input)).toMatchObject({ reason: "manual_retry_required" });
    expect(await advanceExtraction({ ...f.input, now: 1121 })).toMatchObject({ reason: "manual_retry_required" });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(await advanceExtraction({ ...f.input, now: 1121, retryConfirmed: true })).toMatchObject({ outcome: "advanced", completedPages: 0 });
    expect(await advanceExtraction({ ...f.input, now: 1122 })).toMatchObject({ completedPages: 1 });
    expect((await f.state())?.usage.calls).toBe(2);
    expect((await f.state())!.usage.estimatedMicros).toBeGreaterThan(1000);
  });
  it("cannot let a late original response replace the explicitly retried page", async () => {
    const f = await fixture(); await f.asset();
    let finish!: (value: ReturnType<typeof response>) => void;
    let started!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; });
    f.generate.mockImplementationOnce(() => { started(); return new Promise((resolve) => { finish = resolve; }); });
    const original = advanceExtraction(f.input); await start;
    await advanceExtraction({ ...f.input, now: 1121, retryConfirmed: true });
    f.generate.mockResolvedValueOnce(response({ ...page(), blocks: [{ ...page().blocks[0], text: "The retry's verified transcription." }] }));
    await advanceExtraction({ ...f.input, now: 1122 });
    finish(response({ ...page(), blocks: [{ ...page().blocks[0], text: "Late original transcription." }] }));
    expect(await original).toEqual({ outcome: "waiting" });
    expect((await f.state())?.completed).toEqual(["extraction/pages/0-0-1.json"]);
    await advanceExtraction(f.input);
    expect(await f.store.getJson(f.job.id, "canonical-book.json")).toMatchObject({ blocks: [{ text: "The retry's verified transcription." }] });
  });
  it("refines only the unreadable page and stops at the quality limit without exporting", async () => {
    const f = await fixture(); f.generate.mockImplementation(async () => response(page(0, "needs_refinement")));
    for (let revision = 0; revision < 3; revision++) {
      await f.asset(revision);
      const result = await advanceExtraction(f.input);
      expect(result.outcome).toBe(revision < 2 ? "advanced" : "interrupted");
    }
    expect(await advanceExtraction(f.input)).toMatchObject({ reason: "extraction_quality_insufficient" });
    expect((await f.state())?.usage.calls).toBe(3);
    expect(await f.store.getJson(f.job.id, "canonical-book.json")).toBeNull();
    expect(f.generate).toHaveBeenCalledTimes(3);
  });
  it("does no paid work after cancellation or expiry or beyond its admission budget", async () => {
    const f = await fixture(); await f.asset();
    expect(await advanceExtraction({ ...f.input, isActive: async () => false })).toEqual({ outcome: "inactive" });
    expect(await advanceExtraction({ ...f.input, now: 10000 })).toEqual({ outcome: "inactive" });
    const s = (await f.state())!; s.limits.maxMicros = 1; await f.store.putJson(f.job.id, EXTRACTION_STATE_PATH, s, f.job.expiresAt);
    expect(await advanceExtraction(f.input)).toMatchObject({ reason: "budget_exhausted" });
    expect(f.generate).not.toHaveBeenCalled();
  });
});
