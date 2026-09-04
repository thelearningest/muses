import { BookArtifactStore } from "@/app/lib/book-pipeline/artifact-store";
import { buildBookMapStage } from "@/app/lib/book-pipeline/book-map-stage";
import { parseBookPipelineConfig } from "@/app/lib/book-pipeline/config";
import type { BookMap, CanonicalBook, EvidenceCard, QuestEvidenceContract } from "@/app/lib/book-pipeline/contracts";
import { mapEvidenceBatch } from "@/app/lib/book-pipeline/evidence-stage";
import { generateGameStage } from "@/app/lib/book-pipeline/generation-stage";
import { BookJobRepository } from "@/app/lib/book-pipeline/job-repository";
import { advanceOcrStage } from "@/app/lib/book-pipeline/mistral-stage";
import { MistralOcrProvider } from "@/app/lib/book-pipeline/providers/mistral";
import { OpenAiEmbeddingsProvider, OpenAiResponsesProvider } from "@/app/lib/book-pipeline/providers/openai";
import { retrieveQuestEvidenceStage, type StoredVisualAnnotation } from "@/app/lib/book-pipeline/retrieval";
import { getBookPipelineRuntimeEnv } from "@/app/lib/book-pipeline/runtime-env";
import {
  assertSameOrigin,
  createPurposeToken,
  hashPrivateValue,
  readBearerToken,
} from "@/app/lib/book-pipeline/security";
import { advanceVisualStage, MistralVisualAnnotationProvider } from "@/app/lib/book-pipeline/visual-stage";
import { verifyNextQuestStage } from "@/app/lib/book-pipeline/verification-stage";
import type { GameContent } from "@/app/game-package";
import { runVisualStage } from "@/app/lib/book-pipeline/visual-agent/stage";
import { questVisualImages, VisualQuestProvider } from "@/app/lib/book-pipeline/visual-agent/quest-provider";

type Context = { params: Promise<{ jobId: string }> };

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length < 16) throw new Error(`${name} is missing`);
  return value;
}

async function loadEvidence(store: BookArtifactStore, jobId: string): Promise<EvidenceCard[]> {
  const manifest = await store.getJson<{ batchCount: number }>(jobId, "evidence-manifest.json");
  if (!manifest || !Number.isSafeInteger(manifest.batchCount)) throw new Error("Evidence manifest is missing");
  const batches = await Promise.all(Array.from({ length: manifest.batchCount }, (_, index) =>
    store.getJson<{ cards: EvidenceCard[] }>(jobId, `evidence/${index}.json`),
  ));
  if (batches.some((batch) => !batch)) throw new Error("Evidence is incomplete");
  return batches.flatMap((batch) => batch?.cards ?? []);
}

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const { jobId } = await context.params;
    const token = readBearerToken(request);
    if (!token) return Response.json({ error: { code: "invalid_capability" } }, { status: 401 });
    const env = await getBookPipelineRuntimeEnv();
    const repository = new BookJobRepository(env.DB);
    const capabilityHash = await hashPrivateValue(
      token,
      required(env.BOOK_CAPABILITY_HMAC_KEY, "BOOK_CAPABILITY_HMAC_KEY"),
    );
    let job = await repository.getAuthorizedJob(jobId, capabilityHash);
    const now = Math.floor(Date.now() / 1_000);
    if (!job || job.expiresAt <= now) {
      return Response.json({ error: { code: "job_not_found" } }, { status: 404 });
    }
    let optionText = ""; let optionBytes = 0;
    const optionReader = request.body?.getReader();
    if (optionReader) {
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await optionReader.read(); if (chunk.done) break;
        optionBytes += chunk.value.length;
        if (optionBytes > 1024) { await optionReader.cancel(); return Response.json({ error: { code: "request_too_large" } }, { status: 413 }); }
        optionText += decoder.decode(chunk.value, { stream: true });
      }
      optionText += decoder.decode();
    }
    const retryConfirmed = optionText ? JSON.parse(optionText)?.retryConfirmed === true : false;
    if (job.status === "failed_recoverable" || job.status === "manual_retry_required") {
      if (job.status === "manual_retry_required" && !retryConfirmed) return Response.json({ error: { code: "manual_retry_required", message: "Retry explicitly: the previous request may have been charged." } }, { status: 409 });
      await repository.resumeRecoverable(job.id, capabilityHash, now);
      job = await repository.getAuthorizedJob(jobId, capabilityHash);
      if (!job) return Response.json({ error: { code: "job_not_found" } }, { status: 404 });
    }
    const stringEnv = Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    const config = parseBookPipelineConfig(stringEnv);
    const store = new BookArtifactStore(env.BOOK_JOBS);
    if (job.status === "mapping_evidence") {
      const canonical = await store.getJson<CanonicalBook>(job.id, "canonical-book.json");
      if (!canonical) {
        return Response.json(
          { error: { code: "canonical_book_missing" } },
          { status: 409 },
        );
      }
      const result = await mapEvidenceBatch({
        job: {
          id: job.id,
          status: "mapping_evidence",
          batchCursor: job.batchCursor,
          identityHash: job.identityHash,
          expiresAt: job.expiresAt,
        },
        canonical,
        provider: new OpenAiResponsesProvider(required(env.OPENAI_API_KEY, "OPENAI_API_KEY")),
        repository,
        store,
        config: {
          model: config.mapModel,
          reasoningEffort: config.mapReasoningEffort,
          sectionsPerBatch: config.evidenceSectionsPerBatch,
          reserveCostUnits: config.mapCostReserveUnits,
          maxCostUnits: config.maxProviderCostUnitsPerJob,
        },
        now,
      });
      return Response.json(result, {
        status: result.outcome === "interrupted" ? 409 : 200,
        headers: { "cache-control": "no-store" },
      });
    }
    if (job.status === "building_book_map") {
      const canonical = await store.getJson<CanonicalBook>(job.id, "canonical-book.json");
      if (!canonical) return Response.json({ error: { code: "canonical_book_missing" } }, { status: 409 });
      const result = await buildBookMapStage({ job, canonical, repository, store, now });
      return Response.json(result, { status: result.outcome === "interrupted" ? 409 : 200, headers: { "cache-control": "no-store" } });
    }
    if (job.status === "annotating_visuals") {
      const canonical = await store.getJson<CanonicalBook>(job.id, "canonical-book.json");
      if (!canonical) return Response.json({ error: { code: "canonical_book_missing" } }, { status: 409 });
      if (env.BOOK_VISUAL_PROVIDER === "luna") {
        const bookMap = await store.getJson<BookMap>(job.id, "book-map.json");
        const result = await runVisualStage({ job, book: canonical, cards: await loadEvidence(store, job.id), store, repository,
          provider: new OpenAiResponsesProvider(required(env.OPENAI_API_KEY, "OPENAI_API_KEY")), maxPages: config.maxVisualPages,
          config: { model: "gpt-5.6-luna", plannedQuests: Math.min(9, bookMap?.proposedQuestConceptIds.length ?? 9),
            maxMicros: Number(env.BOOK_VISUAL_MAX_USD) * 1_000_000,
            inputUsdPerMillion: Number(env.BOOK_VISUAL_INPUT_USD_PER_MILLION), outputUsdPerMillion: Number(env.BOOK_VISUAL_OUTPUT_USD_PER_MILLION) },
          maxCostUnits: config.maxProviderCostUnitsPerJob, now, retryConfirmed });
        return Response.json(result, { status: result.outcome === "interrupted" ? 409 : 200, headers: { "cache-control": "no-store" } });
      }
      const providerToken = await createPurposeToken(
        { jobId, purpose: "ocr-source", expiresAt: now + 900 },
        required(env.BOOK_PROVIDER_URL_HMAC_KEY, "BOOK_PROVIDER_URL_HMAC_KEY"),
      );
      const result = await advanceVisualStage({
        job,
        canonical,
        evidenceCards: await loadEvidence(store, job.id),
        provider: new MistralVisualAnnotationProvider(required(env.MISTRAL_API_KEY, "MISTRAL_API_KEY")),
        repository,
        store,
        config: { model: config.ocrModel, maxPages: config.maxVisualPages },
        sourceUrl: `${new URL(request.url).origin}/api/book-jobs/${encodeURIComponent(jobId)}/source?token=${encodeURIComponent(providerToken)}`,
        now,
      });
      return Response.json(result, { status: result.outcome === "interrupted" ? 409 : 200, headers: { "cache-control": "no-store" } });
    }
    if (job.status === "retrieving_quest_evidence") {
      const [canonical, bookMap, visualArtifact] = await Promise.all([
        store.getJson<CanonicalBook>(job.id, "canonical-book.json"),
        store.getJson<BookMap>(job.id, "book-map.json"),
        store.getJson<{ annotations: StoredVisualAnnotation[] }>(job.id, "visual-annotations.json"),
      ]);
      if (!canonical || !bookMap || !visualArtifact) return Response.json({ error: { code: "pipeline_artifact_missing" } }, { status: 409 });
      const result = await retrieveQuestEvidenceStage({
        job,
        canonical,
        bookMap,
        visualAnnotations: visualArtifact.annotations,
        provider: new OpenAiEmbeddingsProvider(required(env.OPENAI_API_KEY, "OPENAI_API_KEY")),
        repository,
        store,
        model: config.embeddingModel,
        reserveCostUnits: config.mapCostReserveUnits,
        maxCostUnits: config.maxProviderCostUnitsPerJob,
        now,
      });
      return Response.json(result, { status: result.outcome === "interrupted" ? 409 : 200, headers: { "cache-control": "no-store" } });
    }
    if (job.status === "generating_game") {
      const [bookMap, evidence] = await Promise.all([
        store.getJson<BookMap>(job.id, "book-map.json"),
        store.getJson<{ contracts: QuestEvidenceContract[] }>(job.id, "quest-evidence.json"),
      ]);
      if (!bookMap || !evidence) return Response.json({ error: { code: "pipeline_artifact_missing" } }, { status: 409 });
      const result = await generateGameStage({
        job,
        bookMap,
        contracts: evidence.contracts,
        images: await questVisualImages(store, job.id, evidence.contracts),
        provider: new OpenAiResponsesProvider(required(env.OPENAI_API_KEY, "OPENAI_API_KEY")),
        repository,
        store,
        config: {
          model: config.generationModel,
          reasoningEffort: config.generationReasoningEffort,
          reserveCostUnits: Math.max(config.mapCostReserveUnits, 4_000),
          maxCostUnits: config.maxProviderCostUnitsPerJob,
        },
        now,
      });
      return Response.json(result, { status: result.outcome === "interrupted" ? 409 : 200, headers: { "cache-control": "no-store" } });
    }
    if (job.status === "verifying_quests") {
      const [draft, evidence] = await Promise.all([
        store.getJson<{ game: GameContent }>(job.id, "game-draft.json"),
        store.getJson<{ contracts: QuestEvidenceContract[] }>(job.id, "quest-evidence.json"),
      ]);
      if (!draft || !evidence) return Response.json({ error: { code: "pipeline_artifact_missing" } }, { status: 409 });
      const result = await verifyNextQuestStage({
        job,
        game: draft.game,
        contracts: evidence.contracts,
        provider: new VisualQuestProvider(new OpenAiResponsesProvider(required(env.OPENAI_API_KEY, "OPENAI_API_KEY")), store, job,
          { model: "gpt-5.6-luna", plannedQuests: 0, maxMicros: Number(env.BOOK_VISUAL_MAX_USD) * 1_000_000,
            inputUsdPerMillion: Number(env.BOOK_VISUAL_INPUT_USD_PER_MILLION), outputUsdPerMillion: Number(env.BOOK_VISUAL_OUTPUT_USD_PER_MILLION) }),
        repository,
        store,
        config: {
          model: config.verificationModel,
          reasoningEffort: config.verificationReasoningEffort,
          maxRepairAttempts: config.maxQuestRepairAttempts,
          reserveCostUnits: config.mapCostReserveUnits,
          maxCostUnits: config.maxProviderCostUnitsPerJob,
        },
        now,
      });
      return Response.json(result, { status: result.outcome === "interrupted" ? 409 : 200, headers: { "cache-control": "no-store" } });
    }
    const providerToken = await createPurposeToken(
      { jobId, purpose: "ocr-source", expiresAt: now + 900 },
      required(env.BOOK_PROVIDER_URL_HMAC_KEY, "BOOK_PROVIDER_URL_HMAC_KEY"),
    );
    const result = await advanceOcrStage({
      job,
      provider: new MistralOcrProvider(required(env.MISTRAL_API_KEY, "MISTRAL_API_KEY")),
      repository,
      store,
      config: {
        model: config.ocrModel,
        maxPages: config.maxPages,
        reserveCostUnits: config.ocrCostReserveUnits,
        maxCostUnits: config.maxProviderCostUnitsPerJob,
      },
      sourceUrl: `${new URL(request.url).origin}/api/book-jobs/${encodeURIComponent(jobId)}/source?token=${encodeURIComponent(providerToken)}`,
      now,
    });
    return Response.json(result, {
      status: result.outcome === "waiting" ? 202 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: { code: "advance_failed", message: "The job could not advance safely." } },
      { status: 500 },
    );
  }
}
