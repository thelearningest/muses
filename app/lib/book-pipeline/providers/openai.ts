import { EventSourceParserStream } from "eventsource-parser/stream";
import type { ReasoningEffort } from "../config";
import type { VisualCallBudget } from "../operation-repository";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

export type StructuredResponse<T> = {
  responseId: string;
  requestId?: string;
  data: T;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens?: number; cacheWriteTokens?: number };
};

export type InputImage = { imageUrl: string; detail: "low" | "high"; label: string; width?: number; height?: number };
export type InputPdf = { fileUrl: string; detail: "low" | "high" };
export class OpenAiBackgroundPending extends Error {
  constructor() { super("The model is still processing this section"); this.name = "OpenAiBackgroundPending"; }
}

export interface StructuredOutputProvider {
  /** Stable independent call sequence, used for concurrent quest work. */
  partition?(index: number): StructuredOutputProvider;
  startBackground?(input: StructuredRequest): Promise<string>;
  collectBackground?<T>(id: string): Promise<StructuredResponse<T>>;
  deleteBackground?(id: string): Promise<void>;
  countInputTokens?(input: StructuredRequest): Promise<number>;
  generateStructured<T>(input: {
    model: string;
    reasoningEffort: ReasoningEffort;
    schemaName: string;
    schema: unknown;
    instructions: string;
    input: string;
    safetyIdentifier: string;
    images?: InputImage[];
    files?: InputPdf[];
    background?: boolean;
    reservedTokenUnits?: number;
    maxOutputTokens?: number;
    // Internal admission metadata; deliberately never forwarded to OpenAI.
    visualBudget?: VisualCallBudget & { inputPrice: number; outputPrice: number };
  }): Promise<StructuredResponse<T>>;
}
export type StructuredRequest = Parameters<StructuredOutputProvider["generateStructured"]>[0];

export function responsesInput(input: Pick<StructuredRequest, "input" | "images" | "files">) {
  return input.images?.length || input.files?.length ? [{ role: "user", content: [
    { type: "input_text", text: input.input },
    ...(input.files ?? []).map((file) => ({ type: "input_file", file_url: file.fileUrl, detail: file.detail })),
    ...(input.images ?? []).flatMap((image) => [
      { type: "input_text", text: image.label },
      { type: "input_image", image_url: image.imageUrl, detail: image.detail },
    ]),
  ] }] : input.input;
}

export class OpenAiIndeterminateRequestError extends Error {
  constructor() {
    super("The OpenAI request outcome is indeterminate");
    this.name = "OpenAiIndeterminateRequestError";
  }
}

// A received but unusable result can still be billable. It intentionally shares
// the existing explicit-retry/reservation-retention path with unknown outcomes;
// it is not evidence of a free call. Never put provider/source content in errors.
export class OpenAiUnusableResultError extends OpenAiIndeterminateRequestError {
  constructor() {
    super();
    this.name = "OpenAiUnusableResultError";
    this.message = "The OpenAI result is unusable and the request may have been charged";
  }
}

// The provider definitively completed this request but ran out of output room.
// Callers with a bounded larger schema allowance may retry automatically while
// durable accounting conservatively retains the first call's reservation.
export class OpenAiOutputLimitError extends OpenAiUnusableResultError {
  constructor() {
    super();
    this.name = "OpenAiOutputLimitError";
    this.message = "The OpenAI result reached its output token limit";
  }
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export class OpenAiRejectedRequestError extends Error {
  constructor(status: number) { super(`OpenAI request rejected with status ${status}`); this.name = "OpenAiRejectedRequestError"; }
}

export async function paidRequest(fetcher: Fetcher, url: string, apiKey: string, payload: unknown, milliseconds = 240_000): Promise<Response> {
  // Serialization errors happen before transmission and must not consume a
  // reservation. Once fetch starts, an exception cannot prove non-processing.
  const body = JSON.stringify(payload);
  let response: Response;
  try {
    response = await fetcher(url, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, signal: AbortSignal.timeout(milliseconds), body });
  } catch {
    console.warn("OpenAI request failed", { category: "transport" });
    throw new OpenAiIndeterminateRequestError();
  }
  if (!response.ok) {
    // Provider IDs and status only: never log keys, source text, images or bodies.
    console.warn("OpenAI request failed", { category: "http", status: response.status, requestId: response.headers.get("x-request-id") });
    if (response.status === 408 || response.status >= 500) throw new OpenAiIndeterminateRequestError();
    throw new OpenAiRejectedRequestError(response.status);
  }
  return response;
}

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      if (!response.body) throw new OpenAiIndeterminateRequestError();
      const reader = response.body.pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream({ onError: "terminate", maxBufferSize: 2_000_000 })).getReader();
      try {
        while (true) {
          const event = await reader.read();
          if (event.done) throw new OpenAiIndeterminateRequestError();
          if (event.value.data === "[DONE]") continue;
          const message = JSON.parse(event.value.data);
          // Early headers free a Workers connection slot. Only the complete
          // terminal response is accepted; deltas never become durable output.
          if (["response.completed", "response.incomplete", "response.failed"].includes(message.type)) {
            value = message.response;
            break;
          }
          if (message.type === "error") throw new OpenAiIndeterminateRequestError();
        }
      } finally { await reader.cancel().catch(() => {}); }
    } else value = await response.json();
  } catch {
    console.warn("OpenAI request failed", { category: "response_json", requestId: response.headers.get("x-request-id") });
    throw new OpenAiIndeterminateRequestError();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OpenAiUnusableResultError();
  return value as Record<string, unknown>;
}

function outputText(response: Record<string, unknown>): string | null {
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const item of response.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as Record<string, unknown>).type === "output_text" &&
        typeof (part as Record<string, unknown>).text === "string"
      ) {
        return (part as Record<string, unknown>).text as string;
      }
    }
  }
  return null;
}

export class OpenAiResponsesProvider implements StructuredOutputProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly serviceTier?: "fast",
  ) {}

  async countInputTokens(input: StructuredRequest): Promise<number> {
    const response = await this.fetcher(`${RESPONSES_URL}/input_tokens`, {
      method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: input.model, input: responsesInput(input),
        instructions: `${input.instructions}\nOutput schema: ${JSON.stringify(input.schema)}` }),
    });
    if (!response.ok) throw new Error("PDF token counting unavailable");
    const value = await response.json() as { input_tokens?: number };
    if (!Number.isSafeInteger(value.input_tokens) || value.input_tokens! <= 0) throw new Error("Invalid PDF token count");
    return value.input_tokens!;
  }

  async startBackground(input: StructuredRequest): Promise<string> {
    if (!input.maxOutputTokens || !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens > 16000 || input.maxOutputTokens < 1) throw new TypeError("Invalid output limit");
    const response = await paidRequest(this.fetcher, RESPONSES_URL, this.apiKey, {
      model: input.model, background: true, store: true, stream: false,
      ...(this.serviceTier ? { service_tier: this.serviceTier } : {}),
      reasoning: { effort: input.reasoningEffort }, instructions: input.instructions,
      input: responsesInput(input), max_output_tokens: input.maxOutputTokens,
      safety_identifier: input.safetyIdentifier.slice(0, 64),
      text: { format: { type: "json_schema", name: input.schemaName, strict: true, schema: input.schema } },
    }, 30_000);
    const value = await responseObject(response);
    if (typeof value.id !== "string" || !/^resp_[A-Za-z0-9_-]+$/.test(value.id)) throw new OpenAiUnusableResultError();
    return value.id;
  }

  async collectBackground<T>(id: string): Promise<StructuredResponse<T>> {
    if (!/^resp_[A-Za-z0-9_-]+$/.test(id)) throw new TypeError("Invalid response id");
    let response: Response;
    try {
      response = await this.fetcher(`${RESPONSES_URL}/${id}`, {
        headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new OpenAiBackgroundPending(); }
    // A failed read never authorizes another paid submission.
    if (response.status === 429 || response.status >= 500) throw new OpenAiBackgroundPending();
    if (!response.ok) throw new OpenAiUnusableResultError();
    let value: Record<string, unknown>;
    try { value = await responseObject(response); } catch { throw new OpenAiBackgroundPending(); }
    if (["queued", "in_progress"].includes(String(value.status))) throw new OpenAiBackgroundPending();
    return parseStructuredResponse<T>(value, response.headers.get("x-request-id"));
  }

  async deleteBackground(id: string): Promise<void> {
    if (!/^resp_[A-Za-z0-9_-]+$/.test(id)) throw new TypeError("Invalid response id");
    await this.cancelBackground(id);
    const response = await this.fetcher(`${RESPONSES_URL}/${id}`, {
      method: "DELETE", headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok && response.status !== 404) throw new Error("Response cleanup incomplete");
  }

  async cancelBackground(id: string): Promise<void> {
    if (!/^resp_[A-Za-z0-9_-]+$/.test(id)) throw new TypeError("Invalid response id");
    const response = await this.fetcher(`${RESPONSES_URL}/${id}/cancel`, {
      method: "POST", headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(15_000),
    });
    // A completed or already deleted response no longer needs cancellation.
    if (!response.ok && ![400, 404, 409].includes(response.status)) throw new Error("Response cancellation incomplete");
  }

  async generateStructured<T>(input: StructuredRequest): Promise<StructuredResponse<T>> {
    if (input.maxOutputTokens !== undefined && (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 16000)) throw new TypeError("Invalid output limit");
    const response = await paidRequest(this.fetcher, RESPONSES_URL, this.apiKey, {
      model: input.model,
      store: false,
      stream: true,
      ...(this.serviceTier ? { service_tier: this.serviceTier } : {}),
      reasoning: { effort: input.reasoningEffort },
      instructions: input.instructions,
      input: responsesInput(input),
      ...(input.maxOutputTokens ? { max_output_tokens: input.maxOutputTokens } : {}),
      safety_identifier: input.safetyIdentifier.slice(0, 64),
      text: {
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: input.schema,
        },
      },
    });
    const value = await responseObject(response);
    return parseStructuredResponse<T>(value, response.headers.get("x-request-id"));
  }

}

export class OpenAiEmbeddingsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async embed(input: { model: string; values: string[] }): Promise<{ vectors: number[][]; requestId?: string }> {
    if (!input.values.length) throw new TypeError("Embedding input is empty");
    const response = await paidRequest(this.fetcher, EMBEDDINGS_URL, this.apiKey, { model: input.model, input: input.values, encoding_format: "float" });
    const body = await responseObject(response);
    if (!Array.isArray(body.data) || body.data.length !== input.values.length) throw new OpenAiUnusableResultError();
    const entries = body.data as Array<{ index: number; embedding: number[] }>;
    if (entries.some((item) => !item || !Number.isSafeInteger(item.index) || !Array.isArray(item.embedding) || !item.embedding.length || item.embedding.some((n) => typeof n !== "number" || !Number.isFinite(n)))) throw new OpenAiUnusableResultError();
    const sorted = [...entries].sort((a, b) => a.index - b.index);
    if (sorted.some((item, index) => item.index !== index || item.embedding.length !== sorted[0].embedding.length)) throw new OpenAiUnusableResultError();
    const vectors = sorted.map((item) => item.embedding);
    return { vectors, requestId: response.headers.get("x-request-id") ?? undefined };
  }
}

export function parseStructuredResponse<T>(value: Record<string, unknown>, requestId: string | null): StructuredResponse<T> {
    if (value.status !== "completed" || typeof value.id !== "string" || !value.id) {
      const details = value.incomplete_details as { reason?: unknown } | undefined;
      const outputLimited = value.status === "incomplete" && details?.reason === "max_output_tokens";
      console.warn("OpenAI request failed", { category: "unusable_response", requestId: requestId,
        status: ["completed", "incomplete", "failed", "cancelled", "queued", "in_progress"].includes(String(value.status)) ? value.status : "unknown",
        reason: details?.reason === "max_output_tokens" || details?.reason === "content_filter" ? details.reason : "unknown" });
      if (outputLimited) throw new OpenAiOutputLimitError();
      throw new OpenAiUnusableResultError();
    }
    const text = outputText(value);
    if (!text) { console.warn("OpenAI request failed", { category: "missing_output", requestId: requestId }); throw new OpenAiUnusableResultError(); }
    let data: T;
    try { data = JSON.parse(text) as T; } catch { console.warn("OpenAI request failed", { category: "output_json", requestId: requestId }); throw new OpenAiUnusableResultError(); }
    const usage = (value.usage ?? {}) as Record<string, unknown>;
    const details = (usage.input_tokens_details ?? {}) as Record<string, unknown>;
    const counts = [usage.input_tokens, usage.output_tokens, usage.total_tokens];
    if (counts.some((n) => typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) ||
      Number(usage.input_tokens) <= 0 || usage.total_tokens !== Number(usage.input_tokens) + Number(usage.output_tokens)) throw new OpenAiUnusableResultError();
    return {
      responseId: value.id,
      requestId: requestId ?? undefined,
      data,
      usage: {
        inputTokens: Number(usage.input_tokens ?? 0),
        outputTokens: Number(usage.output_tokens ?? 0),
        totalTokens: Number(usage.total_tokens ?? 0),
        cachedInputTokens: Number(details.cached_tokens ?? 0),
        cacheWriteTokens: Number(details.cache_write_tokens ?? details.cache_creation_tokens ?? 0),
      },
    };
  }
