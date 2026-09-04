import { BookArtifactStore } from "@/app/lib/book-pipeline/artifact-store";
import { BookJobRepository } from "@/app/lib/book-pipeline/job-repository";
import { getBookPipelineRuntimeEnv } from "@/app/lib/book-pipeline/runtime-env";
import { assertSameOrigin, hashPrivateValue, readBearerToken } from "@/app/lib/book-pipeline/security";
import { renderRequests } from "@/app/lib/book-pipeline/visual-agent/agent";
import { MAX_VISUAL_ASSET_BYTES, validateVisualAsset } from "@/app/lib/book-pipeline/visual-agent/assets";
import { VISUAL_STATE_PATH } from "@/app/lib/book-pipeline/visual-agent/stage";
import type { VisualState } from "@/app/lib/book-pipeline/visual-agent/schema";

export async function PUT(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    assertSameOrigin(request);
    const token = readBearerToken(request);
    if (!token) return Response.json({ error: { code: "invalid_capability" } }, { status: 401 });
    const env = await getBookPipelineRuntimeEnv();
    if (!env.BOOK_CAPABILITY_HMAC_KEY) throw new Error("Missing authorization configuration");
    const { jobId } = await context.params;
    const job = await new BookJobRepository(env.DB).getAuthorizedJob(jobId, await hashPrivateValue(token, env.BOOK_CAPABILITY_HMAC_KEY));
    if (!job || job.expiresAt <= Date.now() / 1000 || job.status !== "annotating_visuals" || job.cancellationRequested) return Response.json({ error: { code: "job_not_found" } }, { status: 404 });
    const limit = Math.ceil(MAX_VISUAL_ASSET_BYTES * 4 / 3) + 4096;
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing asset body");
    let text = ""; let bytes = 0; const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > limit) { await reader.cancel(); return Response.json({ error: { code: "asset_too_large" } }, { status: 413 }); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const value = JSON.parse(text);
    const store = new BookArtifactStore(env.BOOK_JOBS);
    const state = await store.getJson<VisualState>(job.id, VISUAL_STATE_PATH);
    const expected = state && renderRequests(state).find((r) => r.id === value.id);
    if (!state || !expected) return Response.json({ error: { code: "unexpected_render_asset" } }, { status: 409 });
    const asset = await validateVisualAsset(value, expected, state.sourceFingerprint);
    await store.putJsonIfAbsent(job.id, `visual-agent/assets/${asset.id}.json`, asset, job.expiresAt);
    return Response.json({ accepted: true }, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: { code: "invalid_visual_asset", message: "The page image could not be accepted." } }, { status: 400 }); }
}
