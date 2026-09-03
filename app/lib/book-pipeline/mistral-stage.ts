import { canonicalizeMistralOcr } from "./canonicalize";
import type { BookJobStatus, SafeBookJobErrorCategory } from "./contracts";
import type { BookJobRepository } from "./job-repository";
import {
  MistralIndeterminateSubmissionError,
  type MistralOcrResponse,
  type OcrProvider,
} from "./providers/mistral";

type OcrStageJob = {
  id: string;
  capabilityHash?: string;
  status: BookJobStatus;
  mistralBatchId: string | null;
  mistralInputFileId: string | null;
  mistralOutputFileId: string | null;
  sourceFingerprint: string;
  originalFilename: string;
  expiresAt: number;
};

type RepositoryPort = Pick<
  BookJobRepository,
  | "claimStage"
  | "commitStage"
  | "setMistralReferences"
  | "markTerminal"
  | "markRecoverable"
> &
  Partial<
    Pick<BookJobRepository, "reserveProviderCost" | "reconcileProviderCost">
  >;

type StorePort = {
  putJson(jobId: string, path: string, value: unknown, expiresAt: number): Promise<void>;
  getJson<T>(jobId: string, path: string): Promise<T | null>;
  deleteJobArtifacts?(jobId: string): Promise<number>;
};

export type OcrAdvanceResult = {
  outcome: "advanced" | "waiting" | "terminal" | "interrupted";
  status: BookJobStatus;
};

async function markFailure(
  repository: RepositoryPort,
  job: OcrStageJob,
  resumeStage: BookJobStatus,
  category: SafeBookJobErrorCategory,
  now: number,
  manual = false,
): Promise<OcrAdvanceResult> {
  await repository.markRecoverable(
    job.id,
    resumeStage,
    manual ? "manual_retry_required" : "failed_recoverable",
    category,
    now,
  );
  return {
    outcome: "interrupted",
    status: manual ? "manual_retry_required" : "failed_recoverable",
  };
}

export async function advanceOcrStage(input: {
  job: OcrStageJob;
  provider: OcrProvider;
  repository: RepositoryPort;
  store: StorePort;
  config: {
    model: string;
    maxPages: number;
    reserveCostUnits?: number;
    maxCostUnits?: number;
  };
  sourceUrl: string;
  now: number;
}): Promise<OcrAdvanceResult> {
  const { job, provider, repository, store, config, now } = input;

  if (job.status === "uploaded") {
    const claimed = await repository.claimStage({
      jobId: job.id,
      capabilityHash: job.capabilityHash ?? "",
      expectedStatus: "uploaded",
      claimedStatus: "ocr_submitting",
      now,
    });
    if (!claimed) return { outcome: "waiting", status: "uploaded" };
    if (
      config.reserveCostUnits &&
      config.maxCostUnits &&
      repository.reserveProviderCost &&
      !(await repository.reserveProviderCost(
        job.id,
        config.reserveCostUnits,
        config.maxCostUnits,
        now,
      ))
    ) {
      await repository.markTerminal(
        job.id,
        "failed_terminal",
        "global_capacity_reached",
        now,
        job.expiresAt,
      );
      return { outcome: "terminal", status: "failed_terminal" };
    }
    try {
      const batch = await provider.submit({
        customId: job.id,
        model: config.model,
        sourceUrl: input.sourceUrl,
      });
      await repository.setMistralReferences(
        job.id,
        {
          batchId: batch.id,
          inputFileId: batch.inputFileIds[0],
          outputFileId: batch.outputFileId,
        },
        now,
      );
      await repository.commitStage({
        jobId: job.id,
        expectedStatus: "ocr_submitting",
        nextStatus: "ocr_queued",
        now,
      });
      return { outcome: "advanced", status: "ocr_queued" };
    } catch (error) {
      return markFailure(
        repository,
        job,
        "ocr_submitting",
        error instanceof MistralIndeterminateSubmissionError
          ? "manual_retry_required"
          : "provider_unavailable",
        now,
        error instanceof MistralIndeterminateSubmissionError,
      );
    }
  }

  if (job.status === "ocr_submitting" && job.mistralBatchId) {
    await repository.commitStage({
      jobId: job.id,
      expectedStatus: "ocr_submitting",
      nextStatus: "ocr_queued",
      now,
    });
    return { outcome: "advanced", status: "ocr_queued" };
  }

  if (job.status === "ocr_queued" && job.mistralBatchId) {
    try {
      const batch = await provider.inspect(job.mistralBatchId);
      if (batch.status === "queued" || batch.status === "running" || batch.status === "cancelling") {
        return { outcome: "waiting", status: "ocr_queued" };
      }
      if (batch.status === "failed" || batch.status === "cancelled") {
        await repository.markTerminal(
          job.id,
          batch.status === "cancelled" ? "cancelled" : "failed_terminal",
          batch.status === "cancelled" ? null : "provider_rejected_source",
          now,
          job.expiresAt,
        );
        await Promise.allSettled([
          ...(batch.errorFileId ? [provider.deleteFile(batch.errorFileId)] : []),
          provider.deleteBatch(batch.id),
        ]);
        return { outcome: "terminal", status: batch.status === "cancelled" ? "cancelled" : "failed_terminal" };
      }
      if (!batch.outputFileId) throw new Error("Successful OCR batch has no output file");
      await repository.setMistralReferences(job.id, { outputFileId: batch.outputFileId }, now);
      await repository.commitStage({
        jobId: job.id,
        expectedStatus: "ocr_queued",
        nextStatus: "ocr_collecting",
        now,
      });
      return { outcome: "advanced", status: "ocr_collecting" };
    } catch {
      return markFailure(repository, job, "ocr_queued", "provider_unavailable", now);
    }
  }

  if (job.status === "ocr_collecting" && job.mistralOutputFileId && job.mistralBatchId) {
    try {
      const storedResult = await store.getJson<MistralOcrResponse>(job.id, "ocr.json");
      if (!storedResult) {
        const result = await provider.collect(job.mistralOutputFileId, job.id);
        await store.putJson(job.id, "ocr.json", result, job.expiresAt);
      }
      await Promise.allSettled([
        provider.deleteFile(job.mistralOutputFileId),
        ...(job.mistralInputFileId ? [provider.deleteFile(job.mistralInputFileId)] : []),
        provider.deleteBatch(job.mistralBatchId),
      ]);
      await repository.commitStage({
        jobId: job.id,
        expectedStatus: "ocr_collecting",
        nextStatus: "canonicalizing",
        now,
      });
      return { outcome: "advanced", status: "canonicalizing" };
    } catch {
      return markFailure(repository, job, "ocr_collecting", "provider_unavailable", now);
    }
  }

  if (job.status === "canonicalizing") {
    const ocr = await store.getJson<MistralOcrResponse>(job.id, "ocr.json");
    if (!ocr) return markFailure(repository, job, "canonicalizing", "extraction_quality_insufficient", now);
    const canonical = await canonicalizeMistralOcr(
      ocr,
      job.sourceFingerprint,
      job.originalFilename,
    );
    if (canonical.source.pageCount > config.maxPages) {
      await repository.markTerminal(
        job.id,
        "failed_terminal",
        "page_limit_exceeded",
        now,
        job.expiresAt,
      );
      if (store.deleteJobArtifacts) await store.deleteJobArtifacts(job.id);
      return { outcome: "terminal", status: "failed_terminal" };
    }
    if (canonical.pages.length === 0 || canonical.blocks.length === 0) {
      await repository.markTerminal(
        job.id,
        "failed_terminal",
        "extraction_quality_insufficient",
        now,
        job.expiresAt,
      );
      return { outcome: "terminal", status: "failed_terminal" };
    }
    await store.putJson(job.id, "canonical-book.json", canonical, job.expiresAt);
    if (config.reserveCostUnits && repository.reconcileProviderCost) {
      await repository.reconcileProviderCost(
        job.id,
        config.reserveCostUnits,
        Math.max(1, canonical.source.pageCount),
        now,
      );
    }
    await repository.commitStage({
      jobId: job.id,
      expectedStatus: "canonicalizing",
      nextStatus: "mapping_evidence",
      now,
    });
    return { outcome: "advanced", status: "mapping_evidence" };
  }

  return { outcome: "waiting", status: job.status };
}
