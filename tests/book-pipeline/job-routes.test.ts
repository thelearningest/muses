import { describe, expect, it, vi } from "vitest";

import {
  createBookJobApi,
  streamValidatedPdf,
  type BookJobApiDependencies,
} from "../../app/lib/book-pipeline/http";
import { DEFAULT_BOOK_PIPELINE_CONFIG } from "../../app/lib/book-pipeline/config";
import { createPurposeToken } from "../../app/lib/book-pipeline/security";

function request(path: string, init?: RequestInit) {
  return new Request(`https://books.example${path}`, {
    ...init,
    headers: { origin: "https://books.example", ...init?.headers },
  });
}

function makeDependencies(overrides: Partial<BookJobApiDependencies> = {}) {
  const job = {
    id: "job-1",
    capabilityHash: "capability-hash",
    identityHash: "identity-hash",
    networkHash: "network-hash",
    sourceFingerprint: "fingerprint",
    originalFilename: "book.pdf",
    mimeType: "application/pdf",
    byteSize: 9,
    pageCount: null,
    status: "created" as const,
    currentStage: "created" as const,
    resumeStage: null,
    batchCursor: 0,
    retryCount: 0,
    cancellationRequested: false,
    cleanupState: "pending",
    terminalErrorCategory: null,
    mistralBatchId: null,
    mistralInputFileId: null,
    mistralOutputFileId: null,
    openaiRequestIds: [],
    reservedCostUnits: 0,
    actualCostUnits: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    terminalAt: null,
    expiresAt: 100_000,
  };
  const repository = {
    createJob: vi.fn(async () => undefined),
    getAuthorizedJob: vi.fn(async () => job),
    countActiveJobs: vi.fn(async () => 0),
    admitAttempt: vi.fn(async () => true),
    reserveDailyAdmission: vi.fn(async () => true),
    claimStage: vi.fn(async () => true),
    commitStage: vi.fn(async () => true),
    requestCancellation: vi.fn(async () => true),
    markTerminal: vi.fn(async () => true),
    acknowledge: vi.fn(async () => true),
    listExpiredJobs: vi.fn(async () => []),
    markCleanupState: vi.fn(async () => true),
  };
  const store = {
    putJson: vi.fn(async () => undefined),
    putSource: vi.fn(async (_id: string, stream: ReadableStream<Uint8Array>) => {
      await new Response(stream).arrayBuffer();
    }),
    delete: vi.fn(async () => undefined),
    deleteJobArtifacts: vi.fn(async () => 0),
    getJson: vi.fn(async () => null),
    get: vi.fn(async () => null),
  };
  return {
    config: DEFAULT_BOOK_PIPELINE_CONFIG,
    repository,
    store,
    capabilityHmacKey: "capability-key-that-is-long-enough",
    identityHmacKey: "identity-key-that-is-long-enough",
    providerUrlHmacKey: "provider-key-that-is-long-enough",
    verifyTurnstile: vi.fn(async () => true),
    now: () => 1_000,
    newId: () => "job-1",
    newCapability: () => "capability-token",
    ...overrides,
  } satisfies BookJobApiDependencies;
}

describe("book job routes", () => {
  it("serves only the section named in an unexpired provider token", async () => {
    const deps = makeDependencies();
    const get = vi.fn(async (_job: string, path: string) => ({ key: path, text: async () => "", arrayBuffer: async () => new TextEncoder().encode("%PDF-section").buffer }));
    deps.store.get = get;
    const api = createBookJobApi(deps);
    const token = await createPurposeToken({ jobId: "job-1", purpose: "pdf-section", section: 2, expiresAt: 2000 }, deps.providerUrlHmacKey);
    expect((await api.source("job-1", request(`/api/book-jobs/job-1/source?section=2&token=${token}`))).status).toBe(200);
    expect(get).toHaveBeenCalledWith("job-1", "extraction/sections/2.pdf");
    expect((await api.source("job-1", request(`/api/book-jobs/job-1/source?section=3&token=${token}`))).status).toBe(401);
    expect((await api.source("job-1", request(`/api/book-jobs/job-1/source?token=${token}`))).status).not.toBe(200);
    expect((await api.source("job-1", request("/api/book-jobs/job-1/source?section=2"))).status).toBe(401);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("recovers the original source using the browser job capability", async () => {
    const deps = makeDependencies();
    const get = vi.fn(async () => ({ key: "source.pdf", text: async () => "", arrayBuffer: async () => new TextEncoder().encode("%PDF-source").buffer }));
    deps.store.get = get;
    const response = await createBookJobApi(deps).source("job-1", request("/api/book-jobs/job-1/source", { headers: { authorization: "Bearer capability-token" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(get).toHaveBeenCalledWith("job-1", "source.pdf");
  });
  it.each([
    ["missing rights", { rightsConfirmed: false }, 400],
    ["invalid Turnstile", { turnstileToken: "bad" }, 403],
  ] as const)("rejects %s before creating a paid job", async (_name, patch, status) => {
    const dependencies = makeDependencies(
      "turnstileToken" in patch
        ? { verifyTurnstile: vi.fn(async () => false) }
        : {},
    );
    const api = createBookJobApi(dependencies);
    const response = await api.create(
      request("/api/book-jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" },
        body: JSON.stringify({
          filename: "book.pdf",
          mimeType: "application/pdf",
          byteSize: 9,
          sourceFingerprint: "fingerprint",
          browserToken: "browser-token-long-enough",
          turnstileToken: "turnstile-token",
          rightsConfirmed: true,
          ...patch,
        }),
      }),
    );

    expect(response.status).toBe(status);
    expect(dependencies.repository.createJob).not.toHaveBeenCalled();
  });

  it("creates a capability-scoped job without returning private hashes", async () => {
    const dependencies = makeDependencies();
    const response = await createBookJobApi(dependencies).create(
      request("/api/book-jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" },
        body: JSON.stringify({
          filename: "book.pdf",
          mimeType: "application/pdf",
          byteSize: 9,
          sourceFingerprint: "fingerprint",
          browserToken: "browser-token-long-enough",
          turnstileToken: "turnstile-token",
          rightsConfirmed: true,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ jobId: "job-1", capabilityToken: "capability-token" });
    expect(JSON.stringify(body)).not.toMatch(/hash|provider|sourceFingerprint/i);
  });

  it("accepts five attempts and rejects the sixth", async () => {
    let attempts = 0;
    const dependencies = makeDependencies({
      repository: {
        ...makeDependencies().repository,
        admitAttempt: vi.fn(async () => ++attempts <= 5),
      },
    });
    const api = createBookJobApi(dependencies);
    const createRequest = () =>
      request("/api/book-jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" },
        body: JSON.stringify({
          filename: "book.pdf",
          mimeType: "application/pdf",
          byteSize: 9,
          sourceFingerprint: "fingerprint",
          browserToken: "browser-token-long-enough",
          turnstileToken: "turnstile-token",
          rightsConfirmed: true,
        }),
      });

    for (let index = 0; index < 5; index += 1) {
      expect((await api.create(createRequest())).status).toBe(201);
    }
    expect((await api.create(createRequest())).status).toBe(429);
  });

  it("blocks a second active job for the same anonymous identity", async () => {
    const dependencies = makeDependencies({
      repository: {
        ...makeDependencies().repository,
        countActiveJobs: vi.fn(async () => 1),
      },
    });
    const response = await createBookJobApi(dependencies).create(
      request("/api/book-jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" },
        body: JSON.stringify({
          filename: "book.pdf",
          mimeType: "application/pdf",
          byteSize: 9,
          sourceFingerprint: "fingerprint",
          browserToken: "browser-token-long-enough",
          turnstileToken: "turnstile-token",
          rightsConfirmed: true,
        }),
      }),
    );
    expect(response.status).toBe(429);
  });

  it.each([
    ["missing length", {}, 411],
    ["oversized", { "content-length": String(51 * 1024 * 1024) }, 413],
    ["wrong content type", { "content-length": "9", "content-type": "text/plain" }, 415],
  ] as const)("rejects an upload with %s", async (_name, headers, status) => {
    const dependencies = makeDependencies();
    const response = await createBookJobApi(dependencies).upload(
      "job-1",
      request("/api/book-jobs/job-1/source", {
        method: "PUT",
        headers: {
          authorization: "Bearer capability-token",
          "content-type": "application/pdf",
          ...headers,
        },
        body: new Blob(["%PDF-test"]).stream(),
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(status);
    expect(dependencies.store.putSource).not.toHaveBeenCalled();
  });

  it("rejects invalid magic bytes and removes a partial upload", async () => {
    const dependencies = makeDependencies();
    const response = await createBookJobApi(dependencies).upload(
      "job-1",
      request("/api/book-jobs/job-1/source", {
        method: "PUT",
        headers: {
          authorization: "Bearer capability-token",
          "content-type": "application/pdf",
          "content-length": "9",
        },
        body: new Blob(["not-a-pdf"]).stream(),
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(400);
    expect(dependencies.store.delete).toHaveBeenCalledWith("job-1", "source.pdf");
  });

  it("independently enforces the byte ceiling while streaming", async () => {
    const stream = streamValidatedPdf(new Blob(["%PDF-too-long"]).stream(), 8);
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow(/size/i);
  });

  it("keeps public status free of provider IDs and source content", async () => {
    const dependencies = makeDependencies();
    const response = await createBookJobApi(dependencies).status(
      "job-1",
      request("/api/book-jobs/job-1", {
        headers: { authorization: "Bearer capability-token" },
      }),
    );
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toMatch(/mistral|openai|fingerprint|capabilityHash/i);
  });

  it("reports saved page progress for an interrupted extraction", async () => {
    const dependencies = makeDependencies();
    const current = await dependencies.repository.getAuthorizedJob("job-1", "capability-hash");
    dependencies.repository.getAuthorizedJob.mockResolvedValue({ ...current!, status: "manual_retry_required", currentStage: "manual_retry_required", resumeStage: "extracting_pages" });
    dependencies.store.getJson.mockResolvedValue({ cursor: 144, pageCount: 210 });
    const response = await createBookJobApi(dependencies).status("job-1", request("/api/book-jobs/job-1", { headers: { authorization: "Bearer capability-token" } }));
    expect(await response.json()).toMatchObject({ stage: "interrupted", resumeStage: "reading_source", progress: { completedUnits: 144, totalUnits: 210, unit: "pages" } });
  });

  it("makes cancellation and acknowledgment idempotent", async () => {
    const dependencies = makeDependencies();
    const api = createBookJobApi(dependencies);
    const auth = { authorization: "Bearer capability-token" };

    expect((await api.cancel("job-1", request("/api/book-jobs/job-1", { method: "DELETE", headers: auth }))).status).toBe(204);
    expect((await api.cancel("job-1", request("/api/book-jobs/job-1", { method: "DELETE", headers: auth }))).status).toBe(204);
    expect((await api.acknowledge("job-1", request("/api/book-jobs/job-1/acknowledge", { method: "POST", headers: auth }))).status).toBe(204);
  });
});
