import { z } from "zod";
import type { BookJobRepository } from "../job-repository";
import type { VisualStore } from "../visual-agent/stage";
import { assertSameOrigin, hashPrivateValue, readBearerToken } from "../security";
import { assetUploadSchema, MAX_VISUAL_ASSET_BYTES, validateVisualAsset, validateBatchVisualAsset } from "../visual-agent/assets";
import { extractionRenderRequests, nativeTextUsable } from "./policy";
import { EXTRACTION_STATE_PATH, initialExtractionState, type ExtractionAsset, type ExtractionLimits, type ExtractionState } from "./stage";
import { initialBatchState, type BatchExtractionState } from "./batch";

const manifestSchema = z.object({ sourceFingerprint: z.string().max(200), pageCount: z.number().int().min(1).max(300) }).strict();
const uploadSchema = z.object({ sourceFingerprint: z.string().max(200), pageIndex: z.number().int().min(0).max(299), revision: z.number().int().min(0).max(2), nativeText: z.string().max(30000), orderReliable: z.boolean(), images: z.array(assetUploadSchema).max(4) }).strict();

// Pin the actual provider/tier price basis into each new manifest. Fast Sol is
// currently twice Standard; Luna remains the visual-agent default.
// https://developers.openai.com/api/docs/pricing (checked 2026-09-04)
export function lunaLimits(env: Record<string, unknown>, prefix: "BOOK_EXTRACTION" | "BOOK_VISUAL"): ExtractionLimits {
  const positive = (key: string, fallback: number) => {
    const n = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isFinite(n) || n <= 0) throw new Error("Invalid provider budget configuration");
    return n;
  };
  const extraction = prefix === "BOOK_EXTRACTION";
  const fast = extraction && env.OPENAI_SERVICE_TIER === "fast";
  return {
    maxMicros: Math.ceil(positive(`${prefix}_MAX_USD`, extraction ? (fast ? 50 : 25) : 0.5) * 1_000_000),
    inputUsdPerMillion: positive(`${prefix}_INPUT_USD_PER_MILLION`, extraction ? (fast ? 8 : 4) : 0.2),
    outputUsdPerMillion: positive(`${prefix}_OUTPUT_USD_PER_MILLION`, extraction ? (fast ? 40 : 20) : 1.2),
  };
}

class Rejected extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
async function boundedJson(request: Request, limit: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Rejected("missing_body", 400);
  let text = "", bytes = 0; const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    bytes += chunk.value.length;
    if (bytes > limit) { await reader.cancel(); throw new Rejected("request_too_large", 413); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}

export function createExtractionApi(deps: {
  repository: Pick<BookJobRepository, "getAuthorizedJob" | "claimStage">;
  store: VisualStore; capabilityHmacKey: string; maxPages: number;
  limits: ExtractionLimits; now(): number;
}) {
  return async (request: Request, jobId: string): Promise<Response> => {
    try {
      assertSameOrigin(request);
      const token = readBearerToken(request);
      if (!token) throw new Rejected("invalid_capability", 401);
      const capabilityHash = await hashPrivateValue(token, deps.capabilityHmacKey);
      const active = async () => {
        const job = await deps.repository.getAuthorizedJob(jobId, capabilityHash);
        if (!job || job.expiresAt <= deps.now() || job.cancellationRequested || !["uploaded", "extracting_pages"].includes(job.status)) throw new Rejected("job_not_found", 404);
        return job;
      };
      const job = await active();
      const ingestion = await deps.store.getJson<{ provider: string; batchedExtraction?: boolean }>(jobId, "ingestion.json");
      if (ingestion?.provider !== "luna") throw new Rejected("wrong_extraction_provider", 409);
      if (request.method === "POST") {
        const value = manifestSchema.parse(await boundedJson(request, 2048));
        if (value.sourceFingerprint !== job.sourceFingerprint || value.pageCount > deps.maxPages) throw new Rejected("invalid_extraction_manifest", 400);
        await active();
        await deps.store.putJsonIfAbsent(jobId, EXTRACTION_STATE_PATH, ingestion.batchedExtraction
          ? initialBatchState(value.sourceFingerprint, value.pageCount, deps.limits)
          : initialExtractionState(value.sourceFingerprint, value.pageCount, deps.limits), job.expiresAt);
        const saved = await deps.store.getJson<ExtractionState>(jobId, EXTRACTION_STATE_PATH);
        if (!saved || saved.fingerprint !== value.sourceFingerprint || saved.pageCount !== value.pageCount) throw new Rejected("extraction_manifest_conflict", 409);
        if (job.status === "uploaded") {
          const claimed = await deps.repository.claimStage({ jobId, capabilityHash, expectedStatus: "uploaded", claimedStatus: "extracting_pages", now: deps.now() });
          if (!claimed) await active();
        }
      } else if (request.method === "PUT") {
        if (job.status !== "extracting_pages") throw new Rejected("extraction_not_started", 409);
        const value = uploadSchema.parse(await boundedJson(request, 4 * Math.ceil(MAX_VISUAL_ASSET_BYTES * 4 / 3) + 200000));
        const state = await deps.store.getJson<ExtractionState | BatchExtractionState>(jobId, EXTRACTION_STATE_PATH);
        if (!state || state.cursor >= state.pageCount || state.fingerprint !== value.sourceFingerprint ||
          (state.version === 4 ? value.pageIndex >= state.pageCount || value.revision !== 0
            : state.cursor !== value.pageIndex || state.revision !== value.revision)) throw new Rejected("unexpected_extraction_asset", 409);
        const expected = extractionRenderRequests(value.pageIndex, value.revision);
        const native = value.revision === 0 && nativeTextUsable(value.nativeText, value.orderReliable);
        if (value.images.length !== (native ? 0 : expected.length)) throw new Rejected("incomplete_extraction_asset", 400);
        const images: ExtractionAsset["images"] = [];
        for (let i = 0; i < value.images.length; i++) {
          let image: Awaited<ReturnType<typeof validateVisualAsset>>;
          try {
            image = await (state.version === 4 ? validateBatchVisualAsset : validateVisualAsset)(value.images[i], expected[i], state.fingerprint);
          } catch {
            // Let the browser distinguish a render-compatibility problem from a
            // malformed request and retry this page once as a conservative PNG.
            throw new Rejected("invalid_extraction_asset", 400);
          }
          if (state.version === 4 && (image.imageUrl.length - image.imageUrl.indexOf(",") - 1) * 3 / 4 > 384 * 1024) throw new Rejected("batch_image_too_large", 413);
          images.push({ imageUrl: image.imageUrl, width: image.width, height: image.height, hash: image.hash, detail: "high", label: `${state.version === 4 ? `pageIndex=${value.pageIndex}, ` : ""}PDF page ${value.pageIndex + 1}, full-page region ${JSON.stringify(expected[i].box ?? { x: 0, y: 0, width: 1, height: 1 })}` });
        }
        const asset: ExtractionAsset = { pageIndex: value.pageIndex, revision: value.revision, nativeText: value.nativeText, orderReliable: value.orderReliable, images };
        const latest = await deps.store.getJson<ExtractionState | BatchExtractionState>(jobId, EXTRACTION_STATE_PATH);
        if (!latest || latest.version !== state.version || latest.fingerprint !== state.fingerprint || latest.pageCount !== state.pageCount ||
          (latest.version !== 4 && state.version !== 4 && (latest.cursor !== state.cursor || latest.revision !== state.revision))) throw new Rejected("unexpected_extraction_asset", 409);
        await active();
        const path = `extraction/assets/${value.pageIndex}-${value.revision}.json`;
        if (!await deps.store.putJsonIfAbsent(jobId, path, asset, job.expiresAt)) {
          const existing = await deps.store.getJson<ExtractionAsset>(jobId, path);
          if (JSON.stringify(existing) !== JSON.stringify(asset)) throw new Rejected("extraction_asset_conflict", 409);
        }
      } else throw new Rejected("method_not_allowed", 405);
      return Response.json({ accepted: true }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return Response.json({ error: { code: error instanceof Rejected ? error.code : "invalid_extraction_request", message: "The extraction request could not be accepted." } }, { status: error instanceof Rejected ? error.status : 400, headers: { "cache-control": "no-store" } });
    }
  };
}
