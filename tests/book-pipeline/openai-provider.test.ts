import { describe, expect, it, vi } from "vitest";
import { OpenAiResponsesProvider, OpenAiEmbeddingsProvider, OpenAiIndeterminateRequestError } from "../../app/lib/book-pipeline/providers/openai";

const request = { model: "gpt-5.6-luna", reasoningEffort: "none" as const, schemaName: "test", schema: { type: "object" }, instructions: "Extract evidence", input: "Source", safetyIdentifier: "test" };
const valid = { id: "resp_test", status: "completed", output_text: '{"ok":true}', usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } };

describe("paid provider failure boundaries", () => {
  it.each([
    ["incomplete output", { ...valid, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }],
    ["refusal", { ...valid, output_text: undefined, output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot comply" }] }] }],
    ["invalid structured JSON", { ...valid, output_text: '{"ok":' }],
    ["missing usage", { ...valid, usage: undefined }],
    ["invalid usage", { ...valid, usage: { input_tokens: -1, output_tokens: 2, total_tokens: 1 } }],
    ["missing response id", { ...valid, id: undefined }],
  ])("retains the paid reservation and requires explicit retry for %s", async (_label, body) => {
    const fetcher = vi.fn(async () => Response.json(body));
    await expect(new OpenAiResponsesProvider("test", fetcher).generateStructured(request)).rejects.toBeInstanceOf(OpenAiIndeterminateRequestError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([408, 500, 502, 503, 504])("treats HTTP %s as possibly processed without retrying", async (status) => {
    const fetcher = vi.fn(async () => new Response(null, { status }));
    await expect(new OpenAiResponsesProvider("test", fetcher).generateStructured(request)).rejects.toBeInstanceOf(OpenAiIndeterminateRequestError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps definite rejection separate from potentially paid failure", async () => {
    const provider = new OpenAiResponsesProvider("test", async () => new Response(null, { status: 401 }));
    await expect(provider.generateStructured(request)).rejects.not.toBeInstanceOf(OpenAiIndeterminateRequestError);
  });
  it("preserves valid results and usage", async () => {
    const provider = new OpenAiResponsesProvider("test", async () => Response.json(valid));
    expect(await provider.generateStructured(request)).toMatchObject({ responseId: "resp_test", data: { ok: true }, usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } });
  });
  it("classifies an embedding timeout as uncertain and supplies a time limit", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { expect(init?.signal).toBeInstanceOf(AbortSignal); throw new DOMException("timeout", "TimeoutError"); });
    await expect(new OpenAiEmbeddingsProvider("test", fetcher).embed({ model: "text-embedding-3-small", values: ["source"] })).rejects.toBeInstanceOf(OpenAiIndeterminateRequestError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { data: [] },
    { data: [{ index: 0, embedding: [] }] },
    { data: [{ index: 1, embedding: [1] }] },
    { data: [{ index: 0, embedding: ["invalid"] }] },
  ])("rejects malformed embedding output as a potentially paid result", async (body) => {
    await expect(new OpenAiEmbeddingsProvider("test", async () => Response.json(body)).embed({ model: "text-embedding-3-small", values: ["source"] })).rejects.toBeInstanceOf(OpenAiIndeterminateRequestError);
  });
  it("validates embedding indexes and preserves the request order", async () => {
    const provider = new OpenAiEmbeddingsProvider("test", async () => Response.json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }));
    expect(await provider.embed({ model: "text-embedding-3-small", values: ["first", "second"] })).toMatchObject({ vectors: [[1, 0], [0, 1]] });
  });
});
