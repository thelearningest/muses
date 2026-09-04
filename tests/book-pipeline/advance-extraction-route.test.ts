import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ job: {} as Record<string, unknown>, provider: "luna" as string | null, env: {} as Record<string, unknown>, extraction: vi.fn(), legacy: vi.fn(), mistral: vi.fn(), claim: vi.fn(), interrupt: vi.fn() }));
vi.mock("../../app/lib/book-pipeline/runtime-env", () => ({ getBookPipelineRuntimeEnv: async () => f.env }));
vi.mock("../../app/lib/book-pipeline/job-repository", () => ({ BookJobRepository: class {
  getAuthorizedJob = async () => f.job;
  claimStage = f.claim;
  interruptExtraction = f.interrupt;
} }));
vi.mock("../../app/lib/book-pipeline/artifact-store", () => ({ BookArtifactStore: class {
  getJson = async (_jobId: string, path: string) => path === "ingestion.json" && f.provider ? { provider: f.provider } : null;
} }));
vi.mock("../../app/lib/book-pipeline/extraction/stage", () => ({ advanceExtraction: f.extraction }));
vi.mock("../../app/lib/book-pipeline/mistral-stage", () => ({ advanceOcrStage: f.legacy }));
vi.mock("../../app/lib/book-pipeline/providers/mistral", () => ({ MistralOcrProvider: class { constructor() { f.mistral(); } } }));
import { POST } from "../../app/api/book-jobs/[jobId]/advance/route";

beforeEach(() => {
  vi.clearAllMocks(); f.provider = "luna";
  f.env = { DB: {}, BOOK_JOBS: {}, BOOK_CAPABILITY_HMAC_KEY: "local-test-capability-key", BOOK_PROVIDER_URL_HMAC_KEY: "local-test-provider-url-key", OPENAI_API_KEY: "local-test-openai-key" };
  f.job = { id: "job", status: "uploaded", sourceFingerprint: "fingerprint", expiresAt: Math.floor(Date.now() / 1000) + 3600, cancellationRequested: false };
  f.extraction.mockResolvedValue({ outcome: "waiting" }); f.legacy.mockResolvedValue({ outcome: "waiting" });
});
const call = () => POST(new Request("https://books.test/api/book-jobs/job/advance", { method: "POST", headers: { origin: "https://books.test", authorization: "Bearer capability" }, body: "{}" }), { params: Promise.resolve({ jobId: "job" }) });

describe("real advance route provider selection", () => {
  it("requests a new Luna manifest without any Mistral credential or provider", async () => {
    const response = await call(); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "awaiting_extraction_manifest", sourceFingerprint: "fingerprint", maxPages: 300 });
    expect(f.mistral).not.toHaveBeenCalled(); expect(f.legacy).not.toHaveBeenCalled();
  });
  it("honors the pinned provider after environment changes and advances complete extraction", async () => {
    f.env.BOOK_OCR_PROVIDER = "mistral"; f.job.status = "extracting_pages";
    f.extraction.mockResolvedValue({ outcome: "complete" });
    expect((await call()).status).toBe(200);
    expect(f.extraction).toHaveBeenCalledOnce(); expect(f.mistral).not.toHaveBeenCalled();
    expect(f.claim).toHaveBeenCalledWith(expect.objectContaining({ expectedStatus: "extracting_pages", claimedStatus: "mapping_evidence" }));
    const isActive = f.extraction.mock.calls[0][0].isActive;
    expect(await isActive()).toBe(true); f.job.cancellationRequested = true; expect(await isActive()).toBe(false);
  });
  it("retains the legacy path for jobs without a pinned ingestion manifest", async () => {
    f.provider = null; f.env.MISTRAL_API_KEY = "local-test-legacy-key";
    expect((await call()).status).toBe(202);
    expect(f.mistral).toHaveBeenCalledOnce(); expect(f.legacy).toHaveBeenCalledOnce(); expect(f.extraction).not.toHaveBeenCalled();
  });
  it("does not call either provider for a cancelled job", async () => {
    f.job.status = "cancelled"; f.job.cancellationRequested = true;
    expect(await (await call()).json()).toEqual({ outcome: "inactive" });
    expect(f.mistral).not.toHaveBeenCalled(); expect(f.extraction).not.toHaveBeenCalled();
  });
});
