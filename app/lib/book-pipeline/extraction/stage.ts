import type { StructuredOutputProvider, StructuredResponse, InputImage } from "../providers/openai";
import type { VisualStore } from "../visual-agent/stage";
import { extractionImageTokenBound, SOL_EXTRACTION_PRICE, type ExtractionPrice, type ExtractionModel } from "./model-policy";
import { canonicalizeExtractedPages, EXTRACTION_PROMPT_VERSION, SELECTIVE_EXTRACTION_PROMPT_VERSION, SELECTIVE_EXTRACTION_INSTRUCTIONS, nativeTextUsable, PAGE_EXTRACTION_INSTRUCTIONS, PAGE_EXTRACTION_JSON_SCHEMA, parseExtractedPage, type PageRecord } from "./page-extraction";
import { AUXILIARY_EXTRACTION_PROMPT_VERSION, AUXILIARY_EXTRACTION_INSTRUCTIONS, AUXILIARY_EXTRACTION_JSON_SCHEMA, parseAuxiliaryExtractedPage } from "./page-extraction";
import { CONTINUATION_EXTRACTION_PROMPT_VERSION, CONTINUATION_EXTRACTION_INSTRUCTIONS } from "./page-extraction";

export const EXTRACTION_STATE_PATH = "extraction/state.json";
export type ExtractionLimits = { maxMicros: number; inputUsdPerMillion: number; outputUsdPerMillion: number };
export type ExtractionState = {
  version: 1 | 2 | 3; provider: "luna"; model: ExtractionModel; promptVersion: string;
  price?: ExtractionPrice;
  fallback?: { model: "gpt-5.6-sol"; revision: 2; price: ExtractionPrice };
  fingerprint: string; pageCount: number; cursor: number; revision: number; attempt: number;
  completed: string[];
  failure?: "extraction_quality_insufficient";
  limits: ExtractionLimits;
  usage: { calls: number; inputTokens: number; outputTokens: number; estimatedMicros: number };
};
export type ExtractionPageRequest = { pageIndex: number; revision: number; parts: number; allowNative: boolean; compact?: boolean };
export type ExtractionAsset = {
  pageIndex: number; revision: number; nativeText: string; orderReliable: boolean;
  images: Array<InputImage & { hash: string; width: number; height: number }>;
};
type Attempt = { at: number; requestHash: string; reservedMicros: number; model?: ExtractionModel; price?: ExtractionPrice };
type SavedCall = { requestHash: string; response: StructuredResponse<unknown>; model?: ExtractionModel; price?: ExtractionPrice };
export type ExtractionOutcome =
  | { outcome: "awaiting_extraction_assets"; request: ExtractionPageRequest; sourceFingerprint: string }
  | { outcome: "advanced"; completedPages: number; totalPages: number }
  | { outcome: "waiting" | "complete" | "inactive" }
  | { outcome: "interrupted"; reason: "manual_retry_required" | "extraction_quality_insufficient" | "budget_exhausted" };

export function initialExtractionState(fingerprint: string, pageCount: number, limits: ExtractionLimits, version: 2 | 3 = 3): ExtractionState {
  if (!fingerprint || !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 300 ||
    !Number.isSafeInteger(limits.maxMicros) || limits.maxMicros < 1 ||
    ![limits.inputUsdPerMillion, limits.outputUsdPerMillion].every((n) => Number.isFinite(n) && n > 0)) throw new Error("Invalid extraction configuration");
  return { ...(version === 2 ? {
    version: 2 as const, provider: "luna" as const, model: "gpt-5.6-luna" as const, promptVersion: SELECTIVE_EXTRACTION_PROMPT_VERSION,
    fallback: { model: "gpt-5.6-sol" as const, revision: 2 as const, price: { ...SOL_EXTRACTION_PRICE } },
  } : {
    version: 3 as const, provider: "luna" as const, model: "gpt-5.6-sol" as const, promptVersion: CONTINUATION_EXTRACTION_PROMPT_VERSION,
    price: { ...SOL_EXTRACTION_PRICE },
  }),
    fingerprint, pageCount, cursor: 0, revision: 0, attempt: 0, completed: [], limits: { ...limits },
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedMicros: 0 } };
}

export function extractionPageRequest(state: ExtractionState): ExtractionPageRequest {
  return { pageIndex: state.cursor, revision: state.revision, parts: 2 ** state.revision, allowNative: state.revision === 0 };
}

const assetPath = (s: ExtractionState) => `extraction/assets/${s.cursor}-${s.revision}.json`;
const pagePath = (s: ExtractionState) => `extraction/pages/${s.cursor}-${s.revision}-${s.attempt}.json`;

/** One page/revision per invocation. The route owns authorization and stage
 * transitions; this module owns exclusive paid attempts and page checkpoints. */
export async function advanceExtraction(input: {
  job: { id: string; identityHash: string; originalFilename: string; expiresAt: number };
  store: VisualStore; provider: StructuredOutputProvider; now: number;
  isActive(): Promise<boolean>; retryConfirmed?: boolean;
}): Promise<ExtractionOutcome> {
  const { job, store } = input;
  if (job.expiresAt <= input.now || !await input.isActive()) return { outcome: "inactive" };
  const checkpoint = await store.getJsonVersion<ExtractionState>(job.id, EXTRACTION_STATE_PATH);
  if (!checkpoint) throw new Error("Extraction manifest missing");
  const state = structuredClone(checkpoint.value);
  const legacy = state.version === 1 && state.promptVersion === EXTRACTION_PROMPT_VERSION && !state.fallback;
  const selective = state.version === 2 && state.promptVersion === SELECTIVE_EXTRACTION_PROMPT_VERSION &&
    state.fallback?.model === "gpt-5.6-sol" && state.fallback.revision === 2 &&
    [state.fallback.price.inputUsdPerMillion, state.fallback.price.outputUsdPerMillion].every((n) => Number.isFinite(n) && n > 0);
  const auxiliary = state.version === 3 && [AUXILIARY_EXTRACTION_PROMPT_VERSION, CONTINUATION_EXTRACTION_PROMPT_VERSION].includes(state.promptVersion) &&
    state.model === "gpt-5.6-sol" && !state.fallback && state.price &&
    [state.price.inputUsdPerMillion, state.price.outputUsdPerMillion].every((n) => Number.isFinite(n) && n > 0);
  if ((!auxiliary && !((legacy || selective) && state.model === "gpt-5.6-luna")) || state.provider !== "luna") throw new Error("Unsupported extraction manifest version");
  if (state.failure) return { outcome: "interrupted", reason: state.failure };
  if (state.completed.length !== state.cursor) throw new Error("Extraction page manifest is incomplete");
  if (state.cursor === state.pageCount) {
    const records: PageRecord[] = [];
    for (let i = 0; i < state.pageCount; i++) {
      const record = await store.getJson<PageRecord>(job.id, state.completed[i]);
      if (!record) throw new Error("Extraction page checkpoint missing");
      records.push(record);
    }
    const canonical = canonicalizeExtractedPages({ fingerprint: state.fingerprint, filename: job.originalFilename, pageCount: state.pageCount }, records);
    if (!await input.isActive()) return { outcome: "inactive" };
    await store.putJson(job.id, "canonical-book.json", canonical, job.expiresAt);
    return { outcome: "complete" };
  }
  if (!Number.isSafeInteger(state.cursor) || state.cursor < 0 || state.cursor >= state.pageCount || ![0,1,2].includes(state.revision) || ![0,1].includes(state.attempt)) throw new Error("Invalid extraction cursor");
  const request = extractionPageRequest(state);
  const asset = await store.getJson<ExtractionAsset>(job.id, assetPath(state));
  if (!asset) return { outcome: "awaiting_extraction_assets", request, sourceFingerprint: state.fingerprint };
  if (asset.pageIndex !== state.cursor || asset.revision !== state.revision || asset.nativeText.length > 30000) throw new Error("Extraction asset mismatch");
  let record: PageRecord;
  if (request.allowNative && nativeTextUsable(asset.nativeText, asset.orderReliable)) {
    // Preserve line text; do not invent a semantic heading hierarchy from font
    // guesses. The downstream mapper still sees exact page/block provenance.
    const paragraphs = asset.nativeText.match(/[\s\S]{1,6000}/g) ?? [];
    record = { method: "native_text", revision: 0, imageHashes: [], promptVersion: state.promptVersion,
      page: parseExtractedPage({ pageIndex: state.cursor, quality: "readable", printedLabel: null,
        blocks: paragraphs.map((text) => ({ type: "paragraph", text, box: null })), visuals: [], warnings: ["Native text ordering passed heuristics; visual layout not OCR-verified."] }, state.cursor) };
  } else {
    if (asset.images.length !== request.parts || asset.images.some((i) => !i.imageUrl.startsWith("data:image/png;base64,") ||
      !/^[a-f0-9]{64}$/.test(i.hash) || !Number.isSafeInteger(i.width) || !Number.isSafeInteger(i.height) ||
      i.width < 1 || i.height < 1 || i.width > 2048 || i.height > 2048)) throw new Error("Invalid extraction images");
    const fallback = selective && state.revision === 2 ? state.fallback : undefined;
    const model = fallback?.model ?? state.model;
    const price: ExtractionPrice = (auxiliary ? state.price : fallback?.price) ?? { inputUsdPerMillion: state.limits.inputUsdPerMillion, outputUsdPerMillion: state.limits.outputUsdPerMillion };
    const call = { model, reasoningEffort: "none" as const, schemaName: "book_page_extraction", schema: auxiliary ? AUXILIARY_EXTRACTION_JSON_SCHEMA : PAGE_EXTRACTION_JSON_SCHEMA,
      instructions: auxiliary ? (state.promptVersion === CONTINUATION_EXTRACTION_PROMPT_VERSION ? CONTINUATION_EXTRACTION_INSTRUCTIONS : AUXILIARY_EXTRACTION_INSTRUCTIONS) : selective ? SELECTIVE_EXTRACTION_INSTRUCTIONS : PAGE_EXTRACTION_INSTRUCTIONS, input: JSON.stringify({ pageIndex: state.cursor, revision: state.revision, nativeText: asset.nativeText }),
      safetyIdentifier: job.identityHash, images: asset.images, maxOutputTokens: 10000 };
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(call))));
    const requestHash = [...digest].map((b) => b.toString(16).padStart(2,"0")).join("");
    const prefix = `extraction/calls/${state.cursor}-${state.revision}-${state.attempt}`;
    let saved = await store.getJson<SavedCall>(job.id, `${prefix}.json`);
    if (saved && saved.requestHash !== requestHash) throw new Error("Extraction request changed after completion");
    if (!saved) {
      const prior = await store.getJson<Attempt>(job.id, `${prefix}.attempt.json`);
      if (prior) {
        if (input.now - prior.at < 120) return { outcome: "waiting" };
        if (!input.retryConfirmed || state.attempt >= 1) return { outcome: "interrupted", reason: "manual_retry_required" };
        // An explicitly authorized retry retains the whole unknown charge. The
        // previous completed result, if it arrives late, cannot move this CAS.
        state.attempt++;
        state.usage.calls++;
        state.usage.estimatedMicros += prior.reservedMicros;
        if (!await store.putJsonVersion(job.id, EXTRACTION_STATE_PATH, state, checkpoint.etag, job.expiresAt)) return { outcome: "waiting" };
        return { outcome: "advanced", completedPages: state.cursor, totalPages: state.pageCount };
      }
      const inputBound = new TextEncoder().encode(call.instructions + call.input + JSON.stringify(call.schema) + asset.images.map((i) => i.label).join(" ")).length +
        asset.images.reduce((n, i) => n + extractionImageTokenBound(model, i.width, i.height), 0) + 1000;
      const reserve = Math.ceil(inputBound * price.inputUsdPerMillion * 1.25 + call.maxOutputTokens * price.outputUsdPerMillion);
      if (state.usage.estimatedMicros + reserve > state.limits.maxMicros) return { outcome: "interrupted", reason: "budget_exhausted" };
      if (!await input.isActive()) return { outcome: "inactive" };
      if (!await store.putJsonIfAbsent(job.id, `${prefix}.attempt.json`, { at: input.now, requestHash, reservedMicros: reserve, model, price } satisfies Attempt, job.expiresAt)) return { outcome: "waiting" };
      try {
        const response = await input.provider.generateStructured(call);
        if (!await input.isActive()) return { outcome: "inactive" };
        saved = { requestHash, response, model, price };
        await store.putJson(job.id, `${prefix}.json`, saved, job.expiresAt);
      } catch {
        // Includes transport failures and interrupted result persistence. Never
        // reinterpret an absent result as proof that no charge occurred.
        return { outcome: "interrupted", reason: "manual_retry_required" };
      }
    }
    const usage = saved.response.usage;
    if (!Number.isSafeInteger(usage.inputTokens) || usage.inputTokens <= 0 || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0) return { outcome: "interrupted", reason: "manual_retry_required" };
    state.usage.calls++;
    state.usage.inputTokens += usage.inputTokens;
    state.usage.outputTokens += usage.outputTokens;
    state.usage.estimatedMicros += Math.ceil(usage.inputTokens * price.inputUsdPerMillion * 1.25 + usage.outputTokens * price.outputUsdPerMillion);
    try {
      // Preserve raw output above. The strict schema still validates every field;
      // only optional geometry is discarded for the approved tiled policy.
      const raw = (selective || auxiliary) && state.revision > 0 ? omitRefinedTextBoxes(saved.response.data) : saved.response.data;
      const parsed = auxiliary ? parseAuxiliaryExtractedPage(raw, state.cursor) : { page: parseExtractedPage(raw, state.cursor) };
      const { page } = parsed;
      if (page.quality === "needs_refinement") throw new Error("Page needs refinement");
      record = { ...parsed, method: model === "gpt-5.6-sol" ? "sol" : "luna", model, priceBasis: { ...price, inputCacheWriteMultiplier: 1.25 }, revision: state.revision, imageHashes: asset.images.map((i) => i.hash), promptVersion: state.promptVersion };
    } catch {
      if (state.revision >= 2) {
        state.failure = "extraction_quality_insufficient";
        if (!await input.isActive()) return { outcome: "inactive" };
        if (!await store.putJsonVersion(job.id, EXTRACTION_STATE_PATH, state, checkpoint.etag, job.expiresAt)) return { outcome: "waiting" };
        return { outcome: "interrupted", reason: state.failure };
      }
      state.revision++; state.attempt = 0;
      if (!await input.isActive()) return { outcome: "inactive" };
      if (!await store.putJsonVersion(job.id, EXTRACTION_STATE_PATH, state, checkpoint.etag, job.expiresAt)) return { outcome: "waiting" };
      return { outcome: "advanced", completedPages: state.cursor, totalPages: state.pageCount };
    }
  }
  if (!await input.isActive()) return { outcome: "inactive" };
  // The committed manifest points to the winning attempt's immutable page.
  // A late response from an explicitly retried call can only leave an orphan,
  // never replace the page selected by the successful CAS.
  const completedPath = pagePath(state);
  await store.putJsonIfAbsent(job.id, completedPath, record, job.expiresAt);
  state.completed.push(completedPath);
  state.cursor++; state.revision = 0; state.attempt = 0;
  if (!await store.putJsonVersion(job.id, EXTRACTION_STATE_PATH, state, checkpoint.etag, job.expiresAt)) return { outcome: "waiting" };
  return { outcome: "advanced", completedPages: state.cursor, totalPages: state.pageCount };
}

function omitRefinedTextBoxes(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("blocks" in value) || !Array.isArray(value.blocks)) return value;
  return { ...value, blocks: value.blocks.map((block: unknown) => block && typeof block === "object" ? { ...block, box: null } : block) };
}
