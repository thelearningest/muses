import type { ReasoningEffort } from "../config";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

export type StructuredResponse<T> = {
  responseId: string;
  requestId?: string;
  data: T;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
};

export interface StructuredOutputProvider {
  generateStructured<T>(input: {
    model: string;
    reasoningEffort: ReasoningEffort;
    schemaName: string;
    schema: unknown;
    instructions: string;
    input: string;
    safetyIdentifier: string;
  }): Promise<StructuredResponse<T>>;
}

export class OpenAiIndeterminateRequestError extends Error {
  constructor() {
    super("The OpenAI request outcome is indeterminate");
    this.name = "OpenAiIndeterminateRequestError";
  }
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

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
  }): Promise<StructuredResponse<T>> {
    let response: Response;
    try {
      response = await this.fetcher(RESPONSES_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          store: false,
          reasoning: { effort: input.reasoningEffort },
          instructions: input.instructions,
          input: input.input,
          safety_identifier: input.safetyIdentifier.slice(0, 64),
          text: {
            format: {
              type: "json_schema",
              name: input.schemaName,
              strict: true,
              schema: input.schema,
            },
          },
        }),
      });
    } catch (error) {
      if (error instanceof TypeError) throw new OpenAiIndeterminateRequestError();
      throw error;
    }
    if (!response.ok) throw new Error(`OpenAI request failed with status ${response.status}`);
    const value = (await response.json()) as Record<string, unknown>;
    if (value.status !== "completed") throw new Error("OpenAI response was incomplete");
    const text = outputText(value);
    if (!text) throw new Error("OpenAI response contained no structured output");
    const usage = (value.usage ?? {}) as Record<string, unknown>;
    return {
      responseId: String(value.id ?? ""),
      requestId: response.headers.get("x-request-id") ?? undefined,
      data: JSON.parse(text) as T,
      usage: {
        inputTokens: Number(usage.input_tokens ?? 0),
        outputTokens: Number(usage.output_tokens ?? 0),
        totalTokens: Number(usage.total_tokens ?? 0),
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
    const response = await this.fetcher(EMBEDDINGS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: input.model, input: input.values, encoding_format: "float" }),
    });
    if (!response.ok) throw new Error(`OpenAI embedding request failed with status ${response.status}`);
    const body = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
    const vectors = [...(body.data ?? [])].sort((a, b) => a.index - b.index).map((item) => item.embedding);
    return { vectors, requestId: response.headers.get("x-request-id") ?? undefined };
  }
}
