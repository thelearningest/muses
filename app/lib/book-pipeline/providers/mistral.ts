const MISTRAL_API = "https://api.mistral.ai/v1";

export type OcrProviderStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelling"
  | "cancelled";

export type OcrBatch = {
  id: string;
  status: OcrProviderStatus;
  inputFileIds: string[];
  outputFileId?: string;
  errorFileId?: string;
};

export type MistralOcrResponse = {
  model: string;
  pages: unknown[];
  usage_info?: Record<string, unknown>;
};

export interface OcrProvider {
  submit(input: { customId: string; model: string; sourceUrl: string }): Promise<OcrBatch>;
  inspect(batchId: string): Promise<OcrBatch>;
  collect(outputFileId: string, expectedCustomId: string): Promise<MistralOcrResponse>;
  cancel(batchId: string): Promise<void>;
  deleteBatch(batchId: string): Promise<void>;
  deleteFile(fileId: string): Promise<void>;
}

export class MistralIndeterminateSubmissionError extends Error {
  constructor() {
    super("The OCR submission outcome is indeterminate");
    this.name = "MistralIndeterminateSubmissionError";
  }
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

function mapStatus(status: unknown): OcrProviderStatus {
  switch (status) {
    case "QUEUED":
      return "queued";
    case "RUNNING":
      return "running";
    case "SUCCESS":
      return "success";
    case "CANCELLATION_REQUESTED":
      return "cancelling";
    case "CANCELLED":
      return "cancelled";
    case "FAILED":
    case "TIMEOUT_EXCEEDED":
      return "failed";
    default:
      throw new Error("Unexpected Mistral batch status");
  }
}

function parseBatch(value: unknown): OcrBatch {
  if (!value || typeof value !== "object") throw new Error("Invalid Mistral batch response");
  const batch = value as Record<string, unknown>;
  if (typeof batch.id !== "string") throw new Error("Invalid Mistral batch id");
  return {
    id: batch.id,
    status: mapStatus(batch.status),
    inputFileIds: Array.isArray(batch.input_files)
      ? batch.input_files.filter((item): item is string => typeof item === "string")
      : [],
    ...(typeof batch.output_file === "string" ? { outputFileId: batch.output_file } : {}),
    ...(typeof batch.error_file === "string" ? { errorFileId: batch.error_file } : {}),
  };
}

export class MistralOcrProvider implements OcrProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetcher(`${MISTRAL_API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`Mistral request failed with status ${response.status}`);
    return response;
  }

  async submit(input: {
    customId: string;
    model: string;
    sourceUrl: string;
  }): Promise<OcrBatch> {
    let response: Response;
    try {
      response = await this.request("/batch/jobs", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "/v1/ocr",
          model: input.model,
          requests: [
            {
              custom_id: input.customId,
              body: {
                document: {
                  type: "document_url",
                  document_url: input.sourceUrl,
                },
                include_blocks: true,
                include_image_base64: false,
                confidence_scores_granularity: "block",
                extract_header: true,
                extract_footer: true,
                table_format: "markdown",
              },
            },
          ],
          metadata: { application: "book-rpg", job_id: input.customId },
        }),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new MistralIndeterminateSubmissionError();
      throw error;
    }
    return parseBatch(await response.json());
  }

  async inspect(batchId: string): Promise<OcrBatch> {
    return parseBatch(await (await this.request(`/batch/jobs/${encodeURIComponent(batchId)}`)).json());
  }

  async collect(outputFileId: string, expectedCustomId: string): Promise<MistralOcrResponse> {
    const text = await (
      await this.request(`/files/${encodeURIComponent(outputFileId)}/content`)
    ).text();
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        throw new Error("Malformed OCR batch output");
      }
      if (parsed.custom_id !== expectedCustomId) continue;
      const response = parsed.response as Record<string, unknown> | undefined;
      const body = response?.body as Record<string, unknown> | undefined;
      if (response?.status_code !== 200 || !body || !Array.isArray(body.pages)) {
        throw new Error("OCR result was incomplete or unsuccessful");
      }
      return body as MistralOcrResponse;
    }
    throw new Error("OCR result did not contain the expected job");
  }

  async cancel(batchId: string): Promise<void> {
    await this.request(`/batch/jobs/${encodeURIComponent(batchId)}/cancel`, {
      method: "POST",
    });
  }

  async deleteBatch(batchId: string): Promise<void> {
    await this.request(`/batch/jobs/${encodeURIComponent(batchId)}`, { method: "DELETE" });
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.request(`/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  }
}
