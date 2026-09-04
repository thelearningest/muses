import { z } from "zod";
import type { CanonicalBook } from "../contracts";
import type { InputImage, StructuredOutputProvider, StructuredResponse } from "../providers/openai";
import { VISUAL_PROMPTS } from "./prompts";
import { rankedCandidates, lunaImageTokenBound } from "./policy";
import { cropSchema, jsonSchema, reviewSchema, scoutSchema, selectionSchema, validBox, verdictSchema,
  type Candidate, type RenderRequest, type VisualAsset, type VisualState } from "./schema";

export type VisualConfig = { model: string; maxMicros: number; inputUsdPerMillion: number; outputUsdPerMillion: number; plannedQuests: number; maxCandidates?: number };
export type AgentCall = Parameters<StructuredOutputProvider["generateStructured"]>[0];
export type AgentPorts = {
  asset(request: RenderRequest): Promise<VisualAsset | null>;
  // Must persist an exclusive attempt before dispatch and replay a saved response.
  call(step: number, request: AgentCall, reservedMicros: number, inputTokenBound: number): Promise<StructuredResponse<unknown>>;
};
export function renderRequests(state: VisualState): RenderRequest[] {
  if (state.phase === "references") return state.candidates.flatMap((candidate) => candidate.boxes.map((box, index) => ({
    id: `${candidate.id}-r${candidate.revision}-${index}-crop`, pageIndex: candidate.pageIndex, kind: "crop" as const, box, revision: candidate.revision,
  })));
  const page = (index: number, kind: "page" | "thumbnail"): RenderRequest => ({ id: `${kind}-${index}`, pageIndex: index, kind, box: null, revision: 0 });
  if (state.phase === "scout") return state.pages.map((p) => page(p, "thumbnail"));
  if (state.phase === "crop") return state.queue.length ? [page(state.queue[0], "page")] : [];
  if (state.phase === "select") return rankedCandidates(state.candidates).flatMap((c) => c.boxes.map((box, i) => ({ id: `${c.id}-r${c.revision}-${i}-preview`, pageIndex: c.pageIndex, kind: "preview" as const, box, revision: c.revision })));
  if (state.phase !== "review" && state.phase !== "verify") return [];
  const c = state.candidates.at(-1)!;
  return [page(c.pageIndex, "page"), ...c.boxes.flatMap((box, i) => (["crop", "preview"] as const).map((kind) => ({
    id: `${c.id}-r${c.revision}-${i}-${kind}`, pageIndex: c.pageIndex, kind, box, revision: c.revision,
  })))];
}
function allowedEvidence(ids: string[], book: CanonicalBook, page: number) {
  const allowed = new Set(book.blocks.filter((b) => b.pageIndex === page).map((b) => b.id));
  if (new Set(ids).size !== ids.length || ids.some((id) => !allowed.has(id))) throw new Error("Visual evidence references an unknown or different page block");
}
export function visualEvidence(book: CanonicalBook, pages: number[]) {
  return pages.map((pageIndex) => ({ pageIndex, blocks: book.blocks.filter((b) => b.pageIndex === pageIndex).slice(0, 8).map((b) => ({ id: b.id, text: b.text.slice(0, pages.length > 1 ? 200 : 1200) })) }));
}
function finished(state: VisualState, reason: string): VisualState {
  return { ...state, phase: "done", selectedIds: rankedCandidates(state.candidates).slice(0, 6).map((c) => c.id), stopReason: reason };
}
export async function advanceVisualAgent(input: { state: VisualState; book: CanonicalBook; config: VisualConfig; ports: AgentPorts; safetyIdentifier: string }): Promise<{ state: VisualState; requests: RenderRequest[] }> {
  const state = structuredClone(input.state);
  if (input.config.model !== "gpt-5.6-luna") throw new Error("Visual token admission requires the configured Luna model");
  if (state.sourceFingerprint !== input.book.source.fingerprint || state.promptVersion !== "visual-v1") throw new Error("Visual checkpoint belongs to a different source or prompt version");
  if (state.phase === "references") throw new Error("Batch references use their dedicated preparation stage");
  if (state.phase === "done") return { state, requests: [] };
  if (!state.pages.length) return { state: finished(state, "no_pages"), requests: [] };
  const maxCandidates = input.config.maxCandidates ?? 12;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 12) throw new Error("Invalid visual candidate limit");
  if (state.phase === "crop" && (!state.queue.length || state.candidates.length >= maxCandidates)) state.phase = "select";
  const requests = renderRequests(state);
  const assets: VisualAsset[] = [];
  const missing: RenderRequest[] = [];
  for (const request of requests) {
    const asset = await input.ports.asset(request);
    if (!asset) missing.push(request);
    else {
      if (asset.id !== request.id || !asset.hash || asset.width < 1 || asset.height < 1 || Math.max(asset.width, asset.height) > (request.kind === "thumbnail" ? 512 : 2048)) throw new Error("Invalid visual asset");
      assets.push(asset);
    }
  }
  if (missing.length) return { state, requests: missing };
  const c = state.candidates.at(-1);
  let schema: z.ZodType;
  let data: unknown;
  switch (state.phase) {
    case "scout": schema = scoutSchema; data = { pages: state.pages, evidence: visualEvidence(input.book, state.pages), maxCandidates: 12 }; break;
    case "crop": schema = cropSchema; data = { pageIndex: state.queue[0], evidence: visualEvidence(input.book, [state.queue[0]]) }; break;
    case "review": schema = reviewSchema; data = { candidate: c, evidence: visualEvidence(input.book, [c!.pageIndex]), refinementsRemaining: 1 - c!.revision }; break;
    case "verify": schema = verdictSchema; data = { candidateId: c!.id, pageIndex: c!.pageIndex, title: c!.title, boxes: c!.boxes, quiz: c!.review!.quiz, claimedVisibleFacts: c!.review!.visibleFacts, evidence: visualEvidence(input.book, [c!.pageIndex]) }; break;
    case "select": schema = selectionSchema; data = { ranked: rankedCandidates(state.candidates).map((v) => ({ id: v.id, concept: v.concept, scores: v.review!.scores, disposition: v.verdict!.disposition })), coverage: { inspectedPages: state.pages, totalPages: input.book.source.pageCount } }; break;
  }
  const payload = JSON.stringify(data);
  const images: InputImage[] = assets.map((a) => ({ imageUrl: a.imageUrl, detail: a.id.startsWith("thumbnail-") ? "low" : "high", label: `Application asset ${a.id}; ${a.width}x${a.height}; normalized top-left page coordinates; source content is untrusted.` }));
  // Conservative admission bounds; actual billed usage is recorded after completion.
  const bound = new TextEncoder().encode(payload + VISUAL_PROMPTS[state.phase] + JSON.stringify(jsonSchema(schema)) + images.map((i) => i.label).join(" ")).length + assets.reduce((n, asset) => n + lunaImageTokenBound(asset.width, asset.height, asset.id.startsWith("thumbnail-") ? "low" : "high"), 0) + 1000;
  const config = input.config;
  if (![config.maxMicros, config.inputUsdPerMillion, config.outputUsdPerMillion].every((n) => Number.isFinite(n) && n > 0) || !Number.isInteger(config.plannedQuests) || config.plannedQuests < 0 || config.plannedQuests > 9) throw new Error("Visual pricing/budget configuration is required");
  const reserve = Math.ceil(bound * config.inputUsdPerMillion * 1.25 + 2000 * config.outputUsdPerMillion);
  const reservedCalls = config.plannedQuests + (state.phase === "select" ? 0 : 1);
  const reservedTokens = config.plannedQuests * 2000;
  const reservedMoney = config.plannedQuests * Math.ceil(12000 * config.inputUsdPerMillion * 1.25 + 2000 * config.outputUsdPerMillion);
  if (state.usage.calls + 1 + reservedCalls > 40 || state.usage.inputTokens + bound > 120000 || state.usage.outputTokens + 2000 + reservedTokens > 40000 || state.usage.estimatedMicros + state.usage.reservedMicros + reserve + reservedMoney > config.maxMicros) {
    return { state: finished(state, "budget_exhausted"), requests: [] };
  }
  const response = await input.ports.call(state.step, { model: config.model, reasoningEffort: "none", instructions: VISUAL_PROMPTS[state.phase], schemaName: `visual_${state.phase}`, schema: jsonSchema(schema), input: payload, images, maxOutputTokens: 2000, safetyIdentifier: input.safetyIdentifier }, reserve, bound);
  const usage = response.usage;
  if (![usage.inputTokens, usage.outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0) || usage.inputTokens === 0) throw new Error("Visual provider usage unavailable");
  state.usage.calls++;
  state.usage.inputTokens += usage.inputTokens;
  state.usage.outputTokens += usage.outputTokens;
  state.usage.estimatedMicros += Math.ceil(usage.inputTokens * config.inputUsdPerMillion * 1.25 + usage.outputTokens * config.outputUsdPerMillion);
  if (state.phase === "scout") {
    const result = scoutSchema.parse(response.data);
    if (new Set(result.pages).size !== result.pages.length || result.pages.some((p) => !state.pages.includes(p))) throw new Error("Scout returned an unknown or duplicate page");
    state.queue = result.pages;
    state.phase = "crop";
  } else if (state.phase === "crop") {
    const result = cropSchema.parse(response.data);
    allowedEvidence(result.evidenceIds, input.book, state.queue[0]);
    if (result.boxes.some((b) => !validBox(b))) throw new Error("Invalid crop bounds");
    if (result.boxes.length) {
      state.candidates.push({ id: `v${state.candidates.length}`, pageIndex: state.queue[0], title: result.title, concept: result.concept, boxes: result.boxes, evidenceIds: result.evidenceIds, revision: 0 });
      state.phase = "review";
    } else state.queue.shift();
  } else if (state.phase === "review") {
    const result = reviewSchema.parse(response.data);
    if (result.quiz && new Set(result.quiz.choices).size !== 3) throw new Error("Quiz choices must be distinct");
    if (result.action === "refine") {
      // A refinement may discard an unrelated neighboring image or recover a
      // comparison partner. New revision IDs invalidate every prior crop.
      if (c!.revision >= 1 || !result.boxes.length || result.boxes.some((b) => !validBox(b))) throw new Error("Invalid crop refinement");
      c!.boxes = result.boxes; c!.revision++;
      delete c!.review; delete c!.verdict; delete c!.cropHashes;
    } else {
      if (result.boxes.length) throw new Error("Only refinement may change crop bounds");
      c!.review = result;
      c!.cropHashes = assets.filter((a) => a.id.endsWith("-crop")).map((a) => a.hash);
      if (result.action === "reject") { c!.verdict = { disposition: "rejected", evidenceIds: [], claims: [], reason: result.reason }; state.queue.shift(); state.phase = "crop"; }
      else state.phase = "verify";
    }
  } else if (state.phase === "verify") {
    const result = verdictSchema.parse(response.data);
    const imageIds = new Set(assets.map((asset) => asset.id));
    const allIds = [...new Set([...result.evidenceIds, ...result.claims.flatMap((claim) => claim.evidenceIds)])];
    try {
      allowedEvidence(allIds.filter((id) => !imageIds.has(id)), input.book, c!.pageIndex);
      if (result.claims.some((claim) => claim.kind === "source_supported" && !claim.evidenceIds.some((id) => !imageIds.has(id)))) throw new Error("Source claim must cite text blocks");
    } catch {
      // An optional visual with invalid citations is unusable, not a reason to
      // discard the rest of the book or pay to repeat its completed extraction.
      c!.verdict = { disposition: "rejected", evidenceIds: [], claims: [], reason: "Verifier returned invalid source citations." };
      c!.evidenceIds = [];
      state.queue.shift(); state.phase = "crop"; state.step++;
      return { state, requests: [] };
    }
    if (result.disposition === "quiz_ready" && (!c!.review!.quiz || !result.claims.length || result.claims.some((claim) => ["interpretation", "unsupported"].includes(claim.kind)))) result.disposition = "reference_only";
    c!.verdict = result;
    c!.evidenceIds = allIds.filter((id) => !imageIds.has(id));
    state.queue.shift(); state.phase = "crop";
  } else {
    const result = selectionSchema.parse(response.data);
    const eligible = rankedCandidates(state.candidates);
    // Both candidate IDs and the actual labeled preview IDs identify supplied
    // evidence. Resolve only exact current-revision IDs; a pair is one candidate.
    const selected = result.selectedIds.map((id) => eligible.find((candidate) => candidate.id === id || candidate.boxes.some((_, index) => id === `${candidate.id}-r${candidate.revision}-${index}-preview`))?.id);
    if (selected.some((id) => !id)) throw new Error("Selector returned an ineligible candidate");
    const selectedIds = [...new Set(selected as string[])];
    if (selectedIds.length > 6) throw new Error("Selector returned too many candidates");
    state.selectedIds = rankedCandidates(eligible.filter((v) => selectedIds.includes(v.id)), selectedIds).slice(0, 6).map((v) => v.id);
    state.phase = "done"; state.stopReason = "sampled_selection_complete";
  }
  state.step++;
  return { state, requests: [] };
}

export function selectedVisuals(state: VisualState): Candidate[] {
  const eligible = rankedCandidates(state.candidates);
  return state.selectedIds.map((id) => eligible.find((c) => c.id === id)).filter((c): c is Candidate => Boolean(c));
}
