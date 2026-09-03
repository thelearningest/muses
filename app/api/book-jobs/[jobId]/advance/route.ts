import { BookArtifactStore } from "@/app/lib/book-pipeline/artifact-store";
import { parseBookPipelineConfig } from "@/app/lib/book-pipeline/config";
import { BookJobRepository } from "@/app/lib/book-pipeline/job-repository";
import { advanceOcrStage } from "@/app/lib/book-pipeline/mistral-stage";
import { MistralOcrProvider } from "@/app/lib/book-pipeline/providers/mistral";
import { getBookPipelineRuntimeEnv } from "@/app/lib/book-pipeline/runtime-env";
import {
  assertSameOrigin,
  createPurposeToken,
  hashPrivateValue,
  readBearerToken,
} from "@/app/lib/book-pipeline/security";

type Context = { params: Promise<{ jobId: string }> };

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length < 16) throw new Error(`${name} is missing`);
  return value;
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
    if (job.status === "failed_recoverable" || job.status === "manual_retry_required") {
      await repository.resumeRecoverable(job.id, capabilityHash, now);
      job = await repository.getAuthorizedJob(jobId, capabilityHash);
      if (!job) return Response.json({ error: { code: "job_not_found" } }, { status: 404 });
    }
    const stringEnv = Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    const config = parseBookPipelineConfig(stringEnv);
    const providerToken = await createPurposeToken(
      { jobId, purpose: "ocr-source", expiresAt: now + 900 },
      required(env.BOOK_PROVIDER_URL_HMAC_KEY, "BOOK_PROVIDER_URL_HMAC_KEY"),
    );
    const result = await advanceOcrStage({
      job,
      provider: new MistralOcrProvider(required(env.MISTRAL_API_KEY, "MISTRAL_API_KEY")),
      repository,
      store: new BookArtifactStore(env.BOOK_JOBS),
      config: { model: config.ocrModel, maxPages: config.maxPages },
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
