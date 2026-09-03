import { describe, expect, it, vi } from "vitest";

import {
  MistralOcrProvider,
  type OcrProvider,
} from "../../app/lib/book-pipeline/providers/mistral";
import { advanceOcrStage } from "../../app/lib/book-pipeline/mistral-stage";

describe("Mistral OCR provider", () => {
  it("submits one inline OCR batch without source bytes or base64 images", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      void url;
      void init;
      return Response.json({ id: "batch-1", status: "QUEUED", input_files: [] });
    });
    const provider = new MistralOcrProvider("secret", fetcher);

    const result = await provider.submit({
      customId: "job-1",
      model: "mistral-ocr-4-1",
      sourceUrl: "https://books.example/api/book-jobs/job-1/source?token=signed",
    });
    const [url, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(url).toBe("https://api.mistral.ai/v1/batch/jobs");
    expect(body).toMatchObject({
      endpoint: "/v1/ocr",
      model: "mistral-ocr-4-1",
      requests: [
        {
          custom_id: "job-1",
          body: {
            document: { type: "document_url" },
            include_blocks: true,
            include_image_base64: false,
            confidence_scores_granularity: "block",
            extract_header: true,
            extract_footer: true,
          },
        },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/data:.*base64|%PDF/i);
    expect(result).toMatchObject({ id: "batch-1", status: "queued" });
  });

  it.each([
    ["QUEUED", "queued"],
    ["RUNNING", "running"],
    ["SUCCESS", "success"],
    ["FAILED", "failed"],
    ["TIMEOUT_EXCEEDED", "failed"],
    ["CANCELLATION_REQUESTED", "cancelling"],
    ["CANCELLED", "cancelled"],
  ] as const)("maps provider status %s to %s", async (status, expected) => {
    const provider = new MistralOcrProvider(
      "secret",
      vi.fn(async () =>
        Response.json({
          id: "batch-1",
          status,
          output_file: status === "SUCCESS" ? "output-1" : null,
          error_file: status === "FAILED" ? "error-1" : null,
        }),
      ),
    );
    await expect(provider.inspect("batch-1")).resolves.toMatchObject({ status: expected });
  });

  it("collects only the expected custom ID and rejects partial responses", async () => {
    const valid = {
      custom_id: "job-1",
      response: { status_code: 200, body: { model: "mistral-ocr-4-1", pages: [] } },
    };
    const provider = new MistralOcrProvider(
      "secret",
      vi.fn(async () => new Response(`${JSON.stringify(valid)}\n`)),
    );
    await expect(provider.collect("output-1", "job-1")).resolves.toMatchObject({ pages: [] });

    const partialProvider = new MistralOcrProvider(
      "secret",
      vi.fn(async () =>
        new Response(
          `${JSON.stringify({ ...valid, response: { status_code: 500, body: null } })}\n`,
        ),
      ),
    );
    await expect(partialProvider.collect("output-1", "job-1")).rejects.toThrow(/OCR result/i);
  });

  it("uses the documented cancellation and deletion endpoints", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      void url;
      void init;
      return Response.json({ deleted: true });
    });
    const provider = new MistralOcrProvider("secret", fetcher);
    await provider.cancel("batch-1");
    await provider.deleteBatch("batch-1");
    await provider.deleteFile("file-1");

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["https://api.mistral.ai/v1/batch/jobs/batch-1/cancel", "POST"],
      ["https://api.mistral.ai/v1/batch/jobs/batch-1", "DELETE"],
      ["https://api.mistral.ai/v1/files/file-1", "DELETE"],
    ]);
  });
});

describe("OCR stage", () => {
  it("never submits a second batch when a provider ID already exists", async () => {
    const provider = {
      submit: vi.fn(),
      inspect: vi.fn(),
      collect: vi.fn(),
      cancel: vi.fn(),
      deleteBatch: vi.fn(),
      deleteFile: vi.fn(),
    } satisfies OcrProvider;
    const commitStage = vi.fn(async () => true);

    await advanceOcrStage({
      job: {
        id: "job-1",
        status: "ocr_submitting",
        mistralBatchId: "batch-1",
        mistralInputFileId: null,
        mistralOutputFileId: null,
        sourceFingerprint: "fingerprint",
        originalFilename: "book.pdf",
        expiresAt: 10_000,
      },
      provider,
      repository: {
        claimStage: vi.fn(),
        commitStage,
        setMistralReferences: vi.fn(),
        markTerminal: vi.fn(),
        markRecoverable: vi.fn(),
      },
      store: { putJson: vi.fn(), getJson: vi.fn() },
      config: { model: "mistral-ocr-4-1", maxPages: 300 },
      sourceUrl: "https://books.example/source",
      now: 1_000,
    });

    expect(provider.submit).not.toHaveBeenCalled();
    expect(commitStage).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "ocr_submitting",
        nextStatus: "ocr_queued",
      }),
    );
  });

  it("stores a successful result before deleting provider artifacts", async () => {
    const order: string[] = [];
    const provider = {
      submit: vi.fn(),
      inspect: vi.fn(),
      collect: vi.fn(async () => ({ model: "mistral-ocr-4-1", pages: [] })),
      cancel: vi.fn(),
      deleteBatch: vi.fn(async () => {
        order.push("delete-batch");
      }),
      deleteFile: vi.fn(async () => {
        order.push("delete-file");
      }),
    } satisfies OcrProvider;

    await advanceOcrStage({
      job: {
        id: "job-1",
        status: "ocr_collecting",
        mistralBatchId: "batch-1",
        mistralInputFileId: null,
        mistralOutputFileId: "output-1",
        sourceFingerprint: "fingerprint",
        originalFilename: "book.pdf",
        expiresAt: 10_000,
      },
      provider,
      repository: {
        claimStage: vi.fn(),
        commitStage: vi.fn(async () => true),
        setMistralReferences: vi.fn(),
        markTerminal: vi.fn(),
        markRecoverable: vi.fn(),
      },
      store: {
        putJson: vi.fn(async () => {
          order.push("store");
        }),
        getJson: vi.fn(),
      },
      config: { model: "mistral-ocr-4-1", maxPages: 300 },
      sourceUrl: "https://books.example/source",
      now: 1_000,
    });

    expect(order[0]).toBe("store");
    expect(order).toContain("delete-file");
    expect(order).toContain("delete-batch");
  });
});
