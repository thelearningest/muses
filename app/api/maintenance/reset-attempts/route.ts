import { getBookPipelineRuntimeEnv } from "@/app/lib/book-pipeline/runtime-env";
import { readBearerToken } from "@/app/lib/book-pipeline/security";

// Temporary, operator-configured grant: only the named attempt records can be
// reset. Expiry disables the grant; replay cannot remove any newer attempts.
export async function POST(request: Request) {
  const env = await getBookPipelineRuntimeEnv();
  const denied = () => Response.json({ error: "not_found" }, { status: 404 });
  if (typeof env.BOOK_ATTEMPT_RESET_GRANT !== "string") return denied();
  let grant: { tokenHash: string; attemptIds: string[]; expiresAt: number };
  try { grant = JSON.parse(env.BOOK_ATTEMPT_RESET_GRANT); } catch { return denied(); }
  if (!grant || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= Date.now() / 1000
    || !/^[a-f0-9]{64}$/.test(grant.tokenHash)
    || !Array.isArray(grant.attemptIds) || !grant.attemptIds.length || grant.attemptIds.length > 25
    || !grant.attemptIds.every(id => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id))) return denied();
  const token = readBearerToken(request);
  if (!token || token.length > 128) return denied();
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  if (tokenHash !== grant.tokenHash) return denied();
  const placeholders = grant.attemptIds.map(() => "?").join(",");
  const result = await env.DB.prepare(`DELETE FROM book_job_attempts WHERE id IN (${placeholders})`)
    .bind(...grant.attemptIds).run();
  if (!result.success) return Response.json({ error: "reset_failed" }, { status: 500 });
  return Response.json({ removedAttempts: result.meta?.changes ?? 0 }, { headers: { "cache-control": "no-store" } });
}
