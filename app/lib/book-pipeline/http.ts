import { BookArtifactStore } from "./artifact-store";
import {
  DEFAULT_BOOK_PIPELINE_CONFIG,
  parseBookPipelineConfig,
  type BookPipelineConfig,
} from "./config";
import type { BookJobRecord, BookJobRepository } from "./job-repository";
import { BookJobRepository as D1BookJobRepository } from "./job-repository";
import type { SafeBookJobErrorCategory } from "./contracts";
import { publicStageFor } from "./state-machine";
import { MistralOcrProvider } from "./providers/mistral";
import {
  assertSameOrigin,
  createCapabilityToken,
  hashPrivateValue,
  readBearerToken,
  verifyPurposeToken,
} from "./security";
import { getBookPipelineRuntimeEnv } from "./runtime-env";
import { verifyTurnstile as verifyTurnstileResponse } from "./turnstile";

type RepositoryPort = Pick<
  BookJobRepository,
  | "createJob"
  | "getAuthorizedJob"
  | "countActiveJobs"
  | "admitAttempt"
  | "reserveDailyAdmission"
  | "claimStage"
  | "commitStage"
  | "requestCancellation"
  | "markTerminal"
  | "acknowledge"
  | "listExpiredJobs"
  | "markCleanupState"
>;

type StorePort = Pick<
  BookArtifactStore,
  "putSource" | "delete" | "deleteJobArtifacts" | "getJson" | "get"
>;

export type BookJobApiDependencies = {
  config: BookPipelineConfig;
  repository: RepositoryPort;
  store: StorePort;
  capabilityHmacKey: string;
  identityHmacKey: string;
  providerUrlHmacKey: string;
  verifyTurnstile(token: string, remoteIp: string): Promise<boolean>;
  now(): number;
  newId(): string;
  newCapability(): string;
  cleanupProviderArtifacts?(job: BookJobRecord): Promise<void>;
};

class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class PdfStreamProblem extends Error {
  constructor(readonly kind: "magic" | "size", message: string) {
    super(message);
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function problem(error: unknown): Response {
  if (error instanceof HttpProblem) {
    return json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return json(
    { error: { code: "unexpected_failure", message: "The request could not be completed." } },
    500,
  );
}

function requireMutationOrigin(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    throw new HttpProblem(403, "same_origin_required", "This request must come from this site.");
  }
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function streamValidatedPdf(
  source: ReadableStream<Uint8Array>,
  maximumBytes: number,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let byteCount = 0;
  let checkedMagic = false;
  let initial = new Uint8Array(0);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!checkedMagic) {
        while (initial.byteLength < 5) {
          const { done, value } = await reader.read();
          if (done) {
            controller.error(new PdfStreamProblem("magic", "Invalid PDF magic bytes"));
            return;
          }
          const combined = new Uint8Array(initial.byteLength + value.byteLength);
          combined.set(initial);
          combined.set(value, initial.byteLength);
          initial = combined;
        }
        if (new TextDecoder().decode(initial.slice(0, 5)) !== "%PDF-") {
          controller.error(new PdfStreamProblem("magic", "Invalid PDF magic bytes"));
          return;
        }
        checkedMagic = true;
        byteCount += initial.byteLength;
        if (byteCount > maximumBytes) {
          controller.error(new PdfStreamProblem("size", "PDF exceeds the size limit"));
          return;
        }
        controller.enqueue(initial);
        initial = new Uint8Array(0);
        return;
      }

      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      byteCount += value.byteLength;
      if (byteCount > maximumBytes) {
        controller.error(new PdfStreamProblem("size", "PDF exceeds the size limit"));
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

function isCreateBody(value: unknown): value is {
  filename: string;
  mimeType: string;
  byteSize: number;
  sourceFingerprint: string;
  browserToken: string;
  turnstileToken: string;
  rightsConfirmed: true;
} {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.filename === "string" &&
    body.filename.length > 0 &&
    body.filename.length <= 255 &&
    body.filename.toLowerCase().endsWith(".pdf") &&
    body.mimeType === "application/pdf" &&
    Number.isSafeInteger(body.byteSize) &&
    (body.byteSize as number) > 0 &&
    typeof body.sourceFingerprint === "string" &&
    body.sourceFingerprint.length >= 8 &&
    body.sourceFingerprint.length <= 128 &&
    typeof body.browserToken === "string" &&
    body.browserToken.length >= 16 &&
    body.browserToken.length <= 256 &&
    typeof body.turnstileToken === "string" &&
    body.turnstileToken.length > 0 &&
    body.rightsConfirmed === true
  );
}

function terminalErrorFor(error: PdfStreamProblem): SafeBookJobErrorCategory {
  return error.kind === "size" ? "pdf_too_large" : "invalid_pdf";
}

export function createBookJobApi(dependencies: BookJobApiDependencies) {
  const authorize = async (jobId: string, request: Request): Promise<BookJobRecord> => {
    const token = readBearerToken(request);
    if (!token) throw new HttpProblem(401, "invalid_capability", "A job capability is required.");
    const capabilityHash = await hashPrivateValue(token, dependencies.capabilityHmacKey);
    const job = await dependencies.repository.getAuthorizedJob(jobId, capabilityHash);
    if (!job || job.expiresAt <= dependencies.now()) {
      throw new HttpProblem(404, "job_not_found", "This job is unavailable or expired.");
    }
    return job;
  };

  const sweepExpired = async () => {
    const expired = await dependencies.repository.listExpiredJobs(dependencies.now(), 2);
    for (const job of expired) {
      await dependencies.cleanupProviderArtifacts?.(job);
      await dependencies.store.deleteJobArtifacts(job.id);
      await dependencies.repository.markCleanupState(job.id, "complete", dependencies.now());
    }
  };

  return {
    async create(request: Request): Promise<Response> {
      try {
        await sweepExpired();
        requireMutationOrigin(request);
        if (!dependencies.config.generationEnabled) {
          throw new HttpProblem(503, "generation_disabled", "Book generation is temporarily unavailable.");
        }
        const rawBody: unknown = await request.json();
        if (!isCreateBody(rawBody)) {
          throw new HttpProblem(400, "invalid_request", "Valid PDF details and rights confirmation are required.");
        }
        if (rawBody.byteSize > dependencies.config.maxPdfBytes) {
          throw new HttpProblem(413, "pdf_too_large", "The PDF exceeds the upload limit.");
        }
        const remoteIp = request.headers.get("cf-connecting-ip");
        if (!remoteIp) throw new HttpProblem(400, "network_signal_required", "A network signal is required.");
        if (!(await dependencies.verifyTurnstile(rawBody.turnstileToken, remoteIp))) {
          throw new HttpProblem(403, "turnstile_failed", "Please complete the verification challenge again.");
        }

        const identityHash = await hashPrivateValue(
          rawBody.browserToken,
          dependencies.identityHmacKey,
        );
        const networkHash = await hashPrivateValue(remoteIp, dependencies.identityHmacKey);
        const now = dependencies.now();
        if (
          (await dependencies.repository.countActiveJobs(identityHash, now)) >=
          dependencies.config.maxActiveJobsPerIdentity
        ) {
          throw new HttpProblem(429, "active_job_exists", "Finish or cancel the active job first.");
        }
        if (
          !(await dependencies.repository.admitAttempt({
            attemptId: crypto.randomUUID(),
            identityHash,
            networkHash,
            now,
            since: now - 86_400,
            ceiling: dependencies.config.maxAttemptsPerRollingDay,
          }))
        ) {
          throw new HttpProblem(429, "identity_quota_reached", "The five-attempt rolling limit has been reached.");
        }
        const utcDay = new Date(now * 1_000).toISOString().slice(0, 10);
        if (
          !(await dependencies.repository.reserveDailyAdmission(
            utcDay,
            dependencies.config.maxGlobalJobsPerUtcDay,
            now,
          ))
        ) {
          throw new HttpProblem(503, "global_capacity_reached", "Today's generation capacity has been reached.");
        }

        const capabilityToken = dependencies.newCapability();
        const jobId = dependencies.newId();
        await dependencies.repository.createJob({
          id: jobId,
          capabilityHash: await hashPrivateValue(
            capabilityToken,
            dependencies.capabilityHmacKey,
          ),
          identityHash,
          networkHash,
          sourceFingerprint: rawBody.sourceFingerprint,
          originalFilename: rawBody.filename,
          mimeType: rawBody.mimeType,
          byteSize: rawBody.byteSize,
          now,
          expiresAt: now + dependencies.config.sourceRecoveryHours * 3_600,
        });
        return json({ jobId, capabilityToken }, 201);
      } catch (error) {
        return problem(error);
      }
    },

    async upload(jobId: string, request: Request): Promise<Response> {
      try {
        await sweepExpired();
        requireMutationOrigin(request);
        const job = await authorize(jobId, request);
        const contentLength = parsePositiveInteger(request.headers.get("content-length"));
        if (contentLength === null) throw new HttpProblem(411, "content_length_required", "Content-Length is required.");
        if (contentLength > dependencies.config.maxPdfBytes) {
          throw new HttpProblem(413, "pdf_too_large", "The PDF exceeds the upload limit.");
        }
        if (contentLength !== job.byteSize) {
          throw new HttpProblem(400, "size_mismatch", "The upload size does not match the admitted job.");
        }
        if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/pdf") {
          throw new HttpProblem(415, "invalid_content_type", "Upload an application/pdf body.");
        }
        if (!request.body) throw new HttpProblem(400, "empty_upload", "The upload body is empty.");
        const claimed = await dependencies.repository.claimStage({
          jobId,
          capabilityHash: job.capabilityHash,
          expectedStatus: "created",
          claimedStatus: "uploading",
          now: dependencies.now(),
        });
        if (!claimed) throw new HttpProblem(409, "job_not_ready", "This job cannot accept an upload.");

        try {
          await dependencies.store.putSource(
            jobId,
            streamValidatedPdf(request.body, dependencies.config.maxPdfBytes),
            job.expiresAt,
          );
        } catch (error) {
          await dependencies.store.delete(jobId, "source.pdf");
          const streamError = error instanceof PdfStreamProblem
            ? error
            : new PdfStreamProblem("magic", "The PDF upload could not be validated");
          await dependencies.repository.markTerminal(
            jobId,
            "failed_terminal",
            terminalErrorFor(streamError),
            dependencies.now(),
            job.expiresAt,
          );
          throw new HttpProblem(
            streamError.kind === "size" ? 413 : 400,
            terminalErrorFor(streamError),
            streamError.message,
          );
        }

        await dependencies.repository.commitStage({
          jobId,
          expectedStatus: "uploading",
          nextStatus: "uploaded",
          now: dependencies.now(),
        });
        return json({ stage: "preparing" }, 202);
      } catch (error) {
        return problem(error);
      }
    },

    async status(jobId: string, request: Request): Promise<Response> {
      try {
        await sweepExpired();
        const job = await authorize(jobId, request);
        const game = job.status === "complete"
          ? await dependencies.store.getJson(jobId, "game.json")
          : null;
        return json({
          jobId,
          stage: publicStageFor(job.status),
          recoverable:
            job.status === "failed_recoverable" || job.status === "manual_retry_required",
          progress: { completedUnits: job.batchCursor },
          error: job.terminalErrorCategory
            ? { code: job.terminalErrorCategory, message: "This job could not continue." }
            : null,
          ...(game ? { game } : {}),
        });
      } catch (error) {
        return problem(error);
      }
    },

    async cancel(jobId: string, request: Request): Promise<Response> {
      try {
        await sweepExpired();
        requireMutationOrigin(request);
        const job = await authorize(jobId, request);
        if (job.status === "cancelled" || job.status === "cleaned") return new Response(null, { status: 204 });
        await dependencies.repository.requestCancellation(jobId, job.capabilityHash, dependencies.now());
        await dependencies.repository.markTerminal(
          jobId,
          "cancelled",
          null,
          dependencies.now(),
          job.expiresAt,
        );
        await dependencies.cleanupProviderArtifacts?.(job);
        await dependencies.store.deleteJobArtifacts(jobId);
        await dependencies.repository.markCleanupState(jobId, "complete", dependencies.now());
        return new Response(null, { status: 204 });
      } catch (error) {
        return problem(error);
      }
    },

    async acknowledge(jobId: string, request: Request): Promise<Response> {
      try {
        await sweepExpired();
        requireMutationOrigin(request);
        const job = await authorize(jobId, request);
        if (job.status === "acknowledged" || job.status === "cleaned") {
          return new Response(null, { status: 204 });
        }
        if (!(await dependencies.repository.acknowledge(jobId, job.capabilityHash, dependencies.now()))) {
          throw new HttpProblem(409, "game_not_ready", "The game must be saved before acknowledgment.");
        }
        await dependencies.store.deleteJobArtifacts(jobId);
        await dependencies.repository.markCleanupState(jobId, "complete", dependencies.now());
        return new Response(null, { status: 204 });
      } catch (error) {
        return problem(error);
      }
    },

    async source(jobId: string, request: Request): Promise<Response> {
      try {
        await sweepExpired();
        const token = new URL(request.url).searchParams.get("token");
        if (!token) throw new HttpProblem(401, "invalid_provider_token", "A provider token is required.");
        await verifyPurposeToken(
          token,
          jobId,
          "ocr-source",
          dependencies.now(),
          dependencies.providerUrlHmacKey,
        );
        const object = await dependencies.store.get(jobId, "source.pdf");
        if (!object) throw new HttpProblem(404, "source_not_found", "The source is unavailable.");
        const body = object.body ?? (await object.arrayBuffer());
        return new Response(body, {
          headers: {
            "content-type": "application/pdf",
            "cache-control": "private, no-store",
          },
        });
      } catch (error) {
        return problem(error);
      }
    },
  };
}

function requireSecret(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length < 16) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export async function createRuntimeBookJobApi() {
  const env = await getBookPipelineRuntimeEnv();
  const stringEnv = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const turnstileSecret = requireSecret(env.TURNSTILE_SECRET_KEY, "TURNSTILE_SECRET_KEY");
  const mistralApiKey = typeof env.MISTRAL_API_KEY === "string" ? env.MISTRAL_API_KEY : null;
  return createBookJobApi({
    config: parseBookPipelineConfig(stringEnv) ?? DEFAULT_BOOK_PIPELINE_CONFIG,
    repository: new D1BookJobRepository(env.DB),
    store: new BookArtifactStore(env.BOOK_JOBS),
    capabilityHmacKey: requireSecret(env.BOOK_CAPABILITY_HMAC_KEY, "BOOK_CAPABILITY_HMAC_KEY"),
    identityHmacKey: requireSecret(env.BOOK_IDENTITY_HMAC_KEY, "BOOK_IDENTITY_HMAC_KEY"),
    providerUrlHmacKey: requireSecret(env.BOOK_PROVIDER_URL_HMAC_KEY, "BOOK_PROVIDER_URL_HMAC_KEY"),
    verifyTurnstile: (token, remoteIp) =>
      verifyTurnstileResponse(token, turnstileSecret, remoteIp),
    now: () => Math.floor(Date.now() / 1_000),
    newId: () => crypto.randomUUID(),
    newCapability: createCapabilityToken,
    cleanupProviderArtifacts: async (job) => {
      if (!mistralApiKey || !job.mistralBatchId) return;
      const provider = new MistralOcrProvider(mistralApiKey);
      await Promise.allSettled([
        provider.cancel(job.mistralBatchId),
        provider.deleteBatch(job.mistralBatchId),
        ...(job.mistralInputFileId ? [provider.deleteFile(job.mistralInputFileId)] : []),
        ...(job.mistralOutputFileId ? [provider.deleteFile(job.mistralOutputFileId)] : []),
      ]);
    },
  });
}
