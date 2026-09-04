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

export interface StructuredOutputProvider {
  /** Stable independent call sequence, used for concurrent quest work. */
  partition?(index: number): StructuredOutputProvider;
  generateStructured<T>(input: {
    model: string;
    reasoningEffort: ReasoningEffort;
    schemaName: string;
    schema: unknown;
    instructions: string;
    input: string;
    safetyIdentifier: string;
    images?: InputImage[];
    maxOutputTokens?: number;
    // Internal admission metadata; deliberately never forwarded to OpenAI.
    visualBudget?: VisualCallBudget & { inputPrice: number; outputPrice: number };
  }): Promise<StructuredResponse<T>>;
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

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export class OpenAiRejectedRequestError extends Error {
  constructor(status: number) { super(`OpenAI request rejected with status ${status}`); this.name = "OpenAiRejectedRequestError"; }
}

async function paidRequest(fetcher: Fetcher, url: string, apiKey: string, payload: unknown): Promise<Response> {
  // Serialization errors happen before transmission and must not consume a
  // reservation. Once fetch starts, an exception cannot prove non-processing.
  const body = JSON.stringify(payload);
  let response: Response;
  try {
    response = await fetcher(url, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, signal: AbortSignal.timeout(90_000), body });
  } catch { throw new OpenAiIndeterminateRequestError(); }
  if (response.status === 408 || response.status >= 500) throw new OpenAiIndeterminateRequestError();
  if (!response.ok) throw new OpenAiRejectedRequestError(response.status);
  return response;
}

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await response.json(); } catch { throw new OpenAiIndeterminateRequestError(); }
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
  ) {}

  async generateStructured<T>(input: {
    model: string;
    reasoningEffort: ReasoningEffort;
    schemaName: string;
    schema: unknown;
    instructions: string;
    input: string;
    safetyIdentifier: string;
    images?: InputImage[];
    maxOutputTokens?: number;
  }): Promise<StructuredResponse<T>> {
    if (input.maxOutputTokens !== undefined && (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 16000)) throw new TypeError("Invalid output limit");
    const response = await paidRequest(this.fetcher, RESPONSES_URL, this.apiKey, {
      model: input.model,
      store: false,
      reasoning: { effort: input.reasoningEffort },
      instructions: input.instructions,
      input: input.images?.length ? [{ role: "user", content: [
        { type: "input_text", text: input.input },
        ...input.images.flatMap((image) => [
          { type: "input_text", text: image.label },
          { type: "input_image", image_url: image.imageUrl, detail: image.detail },
        ]),
      ] }] : input.input,
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
    if (value.status !== "completed" || typeof value.id !== "string" || !value.id) throw new OpenAiUnusableResultError();
    const text = outputText(value);
    if (!text) throw new OpenAiUnusableResultError();
    let data: T;
    try { data = JSON.parse(text) as T; } catch { throw new OpenAiUnusableResultError(); }
    const usage = (value.usage ?? {}) as Record<string, unknown>;
    const details = (usage.input_tokens_details ?? {}) as Record<string, unknown>;
    const counts = [usage.input_tokens, usage.output_tokens, usage.total_tokens];
    if (counts.some((n) => typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) ||
      Number(usage.input_tokens) <= 0 || usage.total_tokens !== Number(usage.input_tokens) + Number(usage.output_tokens)) throw new OpenAiUnusableResultError();
    return {
      responseId: value.id,
      requestId: response.headers.get("x-request-id") ?? undefined,
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
