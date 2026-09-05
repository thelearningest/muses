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
import { prepareBatchReferences } from "@/app/lib/book-pipeline/visual-agent/batch-references";
import { VisualQuestProvider } from "@/app/lib/book-pipeline/visual-agent/quest-provider";
import { advanceExtraction } from "@/app/lib/book-pipeline/extraction/stage";
import { advanceBatchExtraction, BATCH_STATE_PATH, PdfCoverageError, pendingBatchExtractionRequests, type BatchExtractionState } from "@/app/lib/book-pipeline/extraction/batch";
import { lunaLimits } from "@/app/lib/book-pipeline/extraction/http";
import { prepareDirectPdf, InvalidSourcePdf } from "@/app/lib/book-pipeline/extraction/direct-pdf";
import { BookOperationRepository } from "@/app/lib/book-pipeline/operation-repository";
import { durableStage } from "@/app/lib/book-pipeline/durable-stage";
import { operationHash } from "@/app/lib/book-pipeline/paid-call-journal";
import { prepareQuestImages } from "@/app/lib/book-pipeline/visual-agent/practice-image";

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
  let durable: ReturnType<typeof durableStage> | undefined;
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
    const openAi = () => new OpenAiResponsesProvider(
      required(env.OPENAI_API_KEY, "OPENAI_API_KEY"),
      fetch,
      env.OPENAI_SERVICE_TIER === "fast" ? "fast" : undefined,
    );
    const operations = new BookOperationRepository(env.DB);
    let store = new BookArtifactStore(env.BOOK_JOBS,operations);
    const ingestion = await store.getJson<{ provider: string; parallelQuests?: boolean; batchedExtraction?: boolean; directPdf?: boolean }>(job.id, "ingestion.json");
    const parallelQuests = ingestion?.parallelQuests === true;
    if (job.cancellationRequested || ["cancelled", "failed_terminal", "complete", "acknowledged", "cleaned"].includes(job.status)) return Response.json({ outcome: "inactive" });
    if (job.status === "uploaded" && ingestion?.directPdf) {
      try {
        const state = await prepareDirectPdf({ job, store, limits: lunaLimits(env, "BOOK_EXTRACTION"), maxPages: config.maxPages,
          isActive: async () => {
            const latest = await repository.getAuthorizedJob(jobId, capabilityHash);
            return !!latest && latest.status === "uploaded" && !latest.cancellationRequested && latest.expiresAt > Date.now() / 1000;
          } });
        if (!state) return Response.json({ outcome: "waiting" }, { status: 202 });
        await repository.claimStage({ jobId, capabilityHash, expectedStatus: "uploaded", claimedStatus: "extracting_pages", now: Math.floor(Date.now() / 1000) });
        return Response.json({ outcome: "advanced" });
      } catch (error) {
        if (!(error instanceof InvalidSourcePdf)) throw error;
        await repository.markTerminal(jobId, "failed_terminal", error.code, Math.floor(Date.now() / 1000), job.expiresAt, "uploaded");
        return Response.json({ outcome: "terminal" });
      }
    }
    let batchState: BatchExtractionState | null = null;
    if (job.status === "extracting_pages" && ingestion?.batchedExtraction) {
      batchState = await store.getJson<BatchExtractionState>(job.id, BATCH_STATE_PATH);
      if (!batchState) throw new Error("Extraction manifest missing");
      // Asset discovery is free, read-only work. Keep it outside the paid-stage
      // lease so a large PDF cannot expire a lease before any model call starts.
      const requests = await pendingBatchExtractionRequests({ jobId: job.id, state: batchState, store });
      if (requests.length) return Response.json({ outcome: "awaiting_extraction_assets", requests, sourceFingerprint: batchState.fingerprint }, { headers: { "cache-control": "no-store" } });
    }
    if ((job.status === "extracting_pages" && ingestion?.batchedExtraction) || ["mapping_evidence", "building_book_map", "retrieving_quest_evidence", "generating_game", "verifying_quests"].includes(job.status)) {
      const owner = await operations.acquire({ jobId: job.id, stage: job.status, cursor: job.batchCursor, retryConfirmed,
        policyHash: await operationHash({ version: parallelQuests ? "downstream-parallel-quests-v2" : "downstream-durable-v1", source: job.sourceFingerprint, config, visualLimits: lunaLimits(env,"BOOK_VISUAL") }) });
      if (!owner) {
        const run = await operations.state(`${job.id}:${job.status}:${job.batchCursor}`);
        const waiting = run?.state === "running" && run.lease_until > Math.floor(Date.now()/1000);
        if (!waiting) await operations.suspendExpired(`${job.id}:${job.status}:${job.batchCursor}`);
        return Response.json(waiting ? { outcome: "waiting" } : { error: { code: "manual_retry_required", message: "The previous operation stopped before its outcome was confirmed. Retry explicitly; it may already have been charged." } },{ status: waiting ? 202 : 409 });
      }
      durable = durableStage(operations,owner,store,repository,{ reserveUnits: job.status === "generating_game" && !parallelQuests ? Math.max(config.mapCostReserveUnits,4000) : config.mapCostReserveUnits, ceiling: config.maxProviderCostUnitsPerJob, retryConfirmed });
      store = durable.store;
    }
    const stageJob = job;
    const isStageActive = async () => {
      if (durable) return durable.isActive();
      const latest = await repository.getAuthorizedJob(stageJob.id, capabilityHash);
      return !!latest && latest.status === stageJob.status && latest.batchCursor === stageJob.batchCursor && !latest.cancellationRequested && latest.expiresAt > Date.now() / 1000;
    };
    if (job.status === "uploaded" && ingestion?.provider === "luna") return Response.json({ outcome: "awaiting_extraction_manifest", sourceFingerprint: job.sourceFingerprint, maxPages: config.maxPages }, { headers: { "cache-control": "no-store" } });
    if (job.status === "extracting_pages") {
      if (ingestion?.provider !== "luna") throw new Error("Extraction provider mismatch");
      if (ingestion.batchedExtraction) {
        const state = batchState ?? await store.getJson<BatchExtractionState>(job.id, BATCH_STATE_PATH);
        if (!state) throw new Error("Extraction manifest missing");
        try {
          const result = await advanceBatchExtraction({ job, state, store, isActive: isStageActive,
            provider: durable!.journal.structured(openAi()), assetsReady: true,
            sectionUrl: async (index) => {
              const sectionToken = await createPurposeToken({ jobId, purpose: "pdf-section", section: index, expiresAt: job.expiresAt }, required(env.BOOK_PROVIDER_URL_HMAC_KEY, "BOOK_PROVIDER_URL_HMAC_KEY"));
              return `${new URL(request.url).origin}/api/book-jobs/${encodeURIComponent(jobId)}/source?section=${index}&token=${encodeURIComponent(sectionToken)}`;
            } });
          if (result.outcome === "complete" && !await durable!.repository.commitStage({ jobId: job.id, expectedStatus: "extracting_pages", nextStatus: "annotating_visuals", batchCursor: 0, now })) return Response.json({ outcome: "inactive" });
          return Response.json(result, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          if (error instanceof PdfCoverageError) {
            await durable!.repository.markTerminal(job.id, "failed_terminal", "extraction_quality_insufficient", now, job.expiresAt, "extracting_pages");
            return Response.json({ outcome: "terminal" });
          }
          await durable!.repository.markRecoverable(job.id, "extracting_pages", "manual_retry_required", "manual_retry_required", now);
          return Response.json({ outcome: "interrupted", reason: "manual_retry_required" }, { headers: { "cache-control": "no-store" } });
        }
      }
      const extractionJob = job;
      const result = await advanceExtraction({ job, store,
        provider: openAi(), now, retryConfirmed,
        isActive: async () => {
          const latest = await repository.getAuthorizedJob(extractionJob.id, capabilityHash);
          return !!latest && latest.status === "extracting_pages" && !latest.cancellationRequested && latest.expiresAt > Date.now() / 1000;
        } });
      if (result.outcome === "complete") await repository.claimStage({ jobId: job.id, capabilityHash, expectedStatus: "extracting_pages", claimedStatus: "mapping_evidence", now: Math.floor(Date.now() / 1000) });
      if (result.outcome === "interrupted") await repository.interruptExtraction(job.id, result.reason, Math.floor(Date.now() / 1000));
      return Response.json(result, { headers: { "cache-control": "no-store" } });
    }
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
        provider: durable!.journal.structured(openAi()),
        repository: durable!.repository,
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
      const result = await buildBookMapStage({ job, canonical, repository: durable!.repository, store, now });
      return Response.json(result, { status: result.outcome === "interrupted" ? 409 : 200, headers: { "cache-control": "no-store" } });
    }
    if (job.status === "annotating_visuals") {
      const canonical = await store.getJson<CanonicalBook>(job.id, "canonical-book.json");
      if (!canonical) return Response.json({ error: { code: "canonical_book_missing" } }, { status: 409 });
      if (ingestion?.batchedExtraction) {
        const prepared = await prepareBatchReferences({ job, book: canonical, store, repository, now, isActive: isStageActive });
        if (prepared) return Response.json(prepared, { headers: { "cache-control": "no-store" } });
      }
      if (ingestion?.provider === "luna" || env.BOOK_VISUAL_PROVIDER === "luna") {
        const bookMap = await store.getJson<BookMap>(job.id, "book-map.json");
        const result = await runVisualStage({ job, book: canonical, cards: await loadEvidence(store, job.id), store, repository,
          provider: openAi(), maxPages: config.maxVisualPages,
          config: { model: "gpt-5.6-luna", maxCandidates: ingestion?.batchedExtraction ? 3 : 12, plannedQuests: Math.min(9, bookMap?.proposedQuestConceptIds.length ?? 9),
            ...lunaLimits(env, "BOOK_VISUAL") },
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
        provider: durable!.journal.embeddings(new OpenAiEmbeddingsProvider(required(env.OPENAI_API_KEY, "OPENAI_API_KEY"))),
        repository: durable!.repository,
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
      let questImages;
      try {
        questImages = await prepareQuestImages({ contracts: evidence.contracts, store, job, journal: durable!.journal, apiKey: required(env.OPENAI_API_KEY, "OPENAI_API_KEY") });
      } catch {
        console.warn("book_stage_interrupted", { jobId: job.id, stage: "generating_game", operation: "practice_image" });
        await durable!.repository.markRecoverable(job.id, "generating_game", "manual_retry_required", "manual_retry_required", now);
        return Response.json({ outcome: "interrupted", error: { code: "manual_retry_required", message: "Creating a practice image was interrupted. Your book reading is saved; resume to continue creating your quests." } }, { status: 409, headers: { "cache-control": "no-store" } });
      }
      if (!questImages) return Response.json({ outcome: "waiting" }, { status: 202, headers: { "cache-control": "no-store" } });
      const result = await generateGameStage({
        job,
        isActive: isStageActive,
        bookMap,
        contracts: evidence.contracts,
        images: parallelQuests ? undefined : questImages.flat(),
        questImages,
        provider: durable!.journal.structured(openAi()),
        repository: durable!.repository,
        store,
        config: {
          model: config.generationModel,
          reasoningEffort: parallelQuests ? "low" : config.generationReasoningEffort,
          parallel: parallelQuests,
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
        isActive: isStageActive,
        game: draft.game,
        contracts: evidence.contracts,
        provider: new VisualQuestProvider(durable!.journal.structured(openAi()), store, job,
          { model: "gpt-5.6-sol", plannedQuests: 0, maxMicros: 2_000_000, inputUsdPerMillion: 5, outputUsdPerMillion: 20 }, true),
        repository: durable!.repository,
        store,
        config: {
          model: config.verificationModel,
          reasoningEffort: config.verificationReasoningEffort,
          maxRepairAttempts: config.maxQuestRepairAttempts,
          parallel: parallelQuests,
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
  } finally { await durable?.release(); }
}
