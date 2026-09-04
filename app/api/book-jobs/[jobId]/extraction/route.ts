import { BookArtifactStore } from "@/app/lib/book-pipeline/artifact-store";
import { BookJobRepository } from "@/app/lib/book-pipeline/job-repository";
import { parseBookPipelineConfig } from "@/app/lib/book-pipeline/config";
import { createExtractionApi, lunaLimits } from "@/app/lib/book-pipeline/extraction/http";
import { getBookPipelineRuntimeEnv } from "@/app/lib/book-pipeline/runtime-env";

async function handle(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const env = await getBookPipelineRuntimeEnv();
    if (!env.BOOK_CAPABILITY_HMAC_KEY) throw new Error("Missing authorization configuration");
    const config = parseBookPipelineConfig(Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
    return createExtractionApi({ repository: new BookJobRepository(env.DB), store: new BookArtifactStore(env.BOOK_JOBS), capabilityHmacKey: env.BOOK_CAPABILITY_HMAC_KEY, maxPages: config.maxPages, limits: lunaLimits(env, "BOOK_EXTRACTION"), now: () => Math.floor(Date.now() / 1000) })(request, (await context.params).jobId);
  } catch { return Response.json({ error: { code: "extraction_unavailable" } }, { status: 503 }); }
}
export const POST = handle;
export const PUT = handle;
