import type { CanonicalBook, EvidenceCard } from "../contracts";
import type { BookArtifactStore } from "../artifact-store";
import type { BookJobRepository } from "../job-repository";
import { OpenAiIndeterminateRequestError, type StructuredOutputProvider, type StructuredResponse } from "../providers/openai";
import { advanceVisualAgent, selectedVisuals, type VisualConfig } from "./agent";
import { initialVisualState } from "./policy";
import type { VisualAsset, VisualState } from "./schema";

export type VisualStore = Pick<BookArtifactStore, "getJson" | "putJson" | "putJsonIfAbsent" | "getJsonVersion" | "putJsonVersion">;
class VisualCallBusy extends Error {}
export const VISUAL_STATE_PATH = "visual-agent/state.json";
export async function runVisualStage(input: {
  job: { id: string; expiresAt: number; identityHash: string };
  book: CanonicalBook; cards: EvidenceCard[]; store: VisualStore;
  repository: Pick<BookJobRepository, "commitStage" | "markRecoverable" | "reserveProviderCost" | "reconcileProviderCost">;
  provider: StructuredOutputProvider; config: VisualConfig; maxPages: number; maxCostUnits: number; now: number;
  retryConfirmed?: boolean;
}) {
  const { job, store } = input;
  await store.putJsonIfAbsent(job.id, VISUAL_STATE_PATH, initialVisualState(input.book, input.cards, input.maxPages), job.expiresAt);
  let checkpoint = await store.getJsonVersion<VisualState>(job.id, VISUAL_STATE_PATH);
  if (!checkpoint) throw new Error("Visual state missing");
  let state = checkpoint.value;
  if (input.retryConfirmed && (state.retryCount ?? 0) < 1) {
    const prefix = `visual-agent/calls/${state.step}-${state.retryCount ?? 0}`;
    const prior = await store.getJson<{ at: number; reservedMicros: number; inputTokenBound?: number }>(job.id, `${prefix}.attempt.json`);
    const completed = await store.getJson(job.id, `${prefix}.json`);
    if (prior && !completed && input.now - prior.at >= 120) {
      // A confirmed retry retains the worst-case prior charge and call allowance.
      state = structuredClone(state); state.retryCount = 1; state.usage.calls++;
      state.usage.estimatedMicros += prior.reservedMicros;
      state.usage.inputTokens += prior.inputTokenBound ?? 120000;
      state.usage.outputTokens += 2000;
      if (!await store.putJsonVersion(job.id, VISUAL_STATE_PATH, state, checkpoint.etag, job.expiresAt)) return { outcome: "waiting" as const };
      checkpoint = await store.getJsonVersion<VisualState>(job.id, VISUAL_STATE_PATH);
      if (!checkpoint) throw new Error("Visual checkpoint missing");
      state = checkpoint.value;
    }
  }
  try {
    const result = await advanceVisualAgent({ state, book: input.book, config: input.config, safetyIdentifier: job.identityHash, ports: {
      asset: async (request) => store.getJson<VisualAsset>(job.id, `visual-agent/assets/${request.id}.json`),
      call: async (step, request, reservedMicros, inputTokenBound) => {
        const prefix = `visual-agent/calls/${step}-${state.retryCount ?? 0}`;
        const resultPath = `${prefix}.json`;
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(request))));
        const requestHash = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
        const existing = await store.getJson<{ requestHash: string; response: StructuredResponse<unknown> }>(job.id, resultPath);
        if (existing) {
          if (existing.requestHash !== requestHash) throw new OpenAiIndeterminateRequestError();
          return existing.response;
        }
        const claimed = await store.putJsonIfAbsent(job.id, `${prefix}.attempt.json`, { step, requestHash, reservedMicros, inputTokenBound, model: request.model, promptVersion: state.promptVersion, at: input.now }, job.expiresAt);
        if (!claimed) {
          const attempt = await store.getJson<{ at: number }>(job.id, `${prefix}.attempt.json`);
          if (attempt && input.now - attempt.at < 120) throw new VisualCallBusy();
          throw new OpenAiIndeterminateRequestError();
        }
        // Existing global units are admission units, not USD. Charge a fixed conservative
        // stage unit separately from the module's real token/micro-dollar ledger.
        const reserveUnits = 1000;
        if (!await input.repository.reserveProviderCost(job.id, reserveUnits, input.maxCostUnits, input.now)) throw new Error("Global provider budget exhausted");
        const response = await input.provider.generateStructured(request);
        await store.putJson(job.id, resultPath, { requestHash, response }, job.expiresAt);
        await input.repository.reconcileProviderCost(job.id, reserveUnits, Math.max(1, Math.ceil(response.usage.totalTokens / 1000)), input.now);
        return response;
      },
    } });
    state = result.state;
    if (state.step !== checkpoint.value.step) state.retryCount = 0;
    if (result.requests.length) return { outcome: "awaiting_assets" as const, renderRequests: result.requests, sourceFingerprint: state.sourceFingerprint };
    if (!await store.putJsonVersion(job.id, VISUAL_STATE_PATH, state, checkpoint.etag, job.expiresAt)) return { outcome: "waiting" as const };
    if (state.phase === "done") {
      const annotations = selectedVisuals(state).map((c) => ({
        visualReferenceId: c.id, pageIndex: c.pageIndex,
        description: `${c.title}. ${c.verdict!.claims.filter((claim) => ["visible", "source_supported"].includes(claim.kind)).map((claim) => claim.claim).join(" ")}`,
        role: c.verdict!.disposition, confidence: 0.7,
        canonicalBlockIds: c.evidenceIds, visualAgent: { candidateId: c.id, revision: c.revision, disposition: c.verdict!.disposition, limitations: [...c.review!.limitations, c.verdict!.reason] },
      }));
      await store.putJson(job.id, "visual-annotations.json", { selectedPages: state.pages, annotations }, job.expiresAt);
      await input.repository.commitStage({ jobId: job.id, expectedStatus: "annotating_visuals", nextStatus: "retrieving_quest_evidence", batchCursor: 0, now: input.now });
      return { outcome: "complete" as const, selectedVisuals: annotations.length };
    }
    return { outcome: "advanced" as const, inspectedCandidates: state.candidates.length, phase: state.phase };
  } catch (error) {
    if (error instanceof VisualCallBusy) return { outcome: "waiting" as const };
    const manual = error instanceof OpenAiIndeterminateRequestError;
    await input.repository.markRecoverable(job.id, "annotating_visuals", manual ? "manual_retry_required" : "failed_recoverable", manual ? "manual_retry_required" : "grounding_quality_insufficient", input.now);
    return { outcome: "interrupted" as const };
  }
}
