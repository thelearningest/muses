import type { BookJobStatus, SafeBookJobErrorCategory } from "./contracts";
import type { D1DatabaseBinding, D1Result } from "./runtime-env";

export type StageOwner = { id: string; jobId: string; stage: BookJobStatus; cursor: number; owner: string };
export type VisualCallBudget = {
  micros: number; input: number; output: number;
  priorMicros: number; priorInput: number; priorOutput: number; priorCalls: number; maxMicros: number;
};
export type ProviderCall = { id: string; run_id: string; job_id: string; slot: number; attempt: number; request_hash: string; state: "pending" | "unknown" | "rejected" | "complete"; reserved_units: number; actual_units: number; result_path: string; created_at: number; expires_at: number };
const changed = (r: D1Result) => r.success && Number(r.meta?.changes) === 1;
const HASH = /^[a-f0-9]{64}$/;
const STAGES = new Set<BookJobStatus>(["mapping_evidence", "building_book_map", "retrieving_quest_evidence", "generating_game", "verifying_quests"]);

/** Ownership and accounting live in D1; raw responses remain immutable in R2.
 * All guards use the current clock, including after slow provider calls. */
export class BookOperationRepository {
  constructor(private readonly db: D1DatabaseBinding, private readonly clock = () => Math.floor(Date.now() / 1000)) {}

  async acquire(input: { jobId: string; stage: BookJobStatus; cursor: number; policyHash: string; retryConfirmed?: boolean }): Promise<StageOwner | null> {
    if (!STAGES.has(input.stage) || !Number.isSafeInteger(input.cursor) || input.cursor < 0 || !HASH.test(input.policyHash)) throw new Error("Invalid stage identity");
    const id = `${input.jobId}:${input.stage}:${input.cursor}`;
    const owner = crypto.randomUUID(); const now = this.clock();
    const result = await this.db.prepare(`
      INSERT INTO book_stage_runs (id,job_id,stage,cursor,policy_hash,owner,lease_until,state,expires_at)
      SELECT ?,id,?,?,?, ?,?,'running',expires_at FROM book_jobs
      WHERE id=? AND status=? AND batch_cursor=? AND cancellation_requested=0 AND expires_at>?
      ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until,state='running'
      WHERE policy_hash=excluded.policy_hash AND (state='idle' OR (state='running' AND lease_until<=? AND ?=1))
    `).bind(id,input.stage,input.cursor,input.policyHash,owner,now+120,input.jobId,input.stage,input.cursor,now,now,input.retryConfirmed ? 1 : 0).run();
    return changed(result) ? { id, jobId: input.jobId, stage: input.stage, cursor: input.cursor, owner } : null;
  }

  async state(runId: string): Promise<{ owner: string; lease_until: number; state: string; policy_hash: string } | null> {
    return this.db.prepare("SELECT owner,lease_until,state,policy_hash FROM book_stage_runs WHERE id=?").bind(runId).first();
  }

  async suspendExpired(runId: string): Promise<boolean> {
    const now = this.clock();
    return changed(await this.db.prepare(`UPDATE book_jobs SET resume_stage=status,status='manual_retry_required',terminal_error_category='manual_retry_required',updated_at=?
      WHERE cancellation_requested=0 AND expires_at>? AND EXISTS (SELECT 1 FROM book_stage_runs r
      WHERE r.id=? AND r.job_id=book_jobs.id AND r.stage=book_jobs.status AND r.cursor=book_jobs.batch_cursor AND r.state='running' AND r.lease_until<=?)`)
      .bind(now,now,runId,now).run());
  }

  private guard(): string {
    return `EXISTS (SELECT 1 FROM book_stage_runs r JOIN book_jobs j ON j.id=r.job_id
      WHERE r.id=? AND r.owner=? AND r.state='running' AND r.lease_until>?
      AND j.status=r.stage AND j.batch_cursor=r.cursor AND j.cancellation_requested=0 AND j.expires_at>?)`;
  }
  private guardValues(run: StageOwner, now = this.clock()) { return [run.id,run.owner,now,now]; }

  async isOwner(run: StageOwner): Promise<boolean> {
    return !!await this.db.prepare(`SELECT 1 AS active WHERE ${this.guard()}`).bind(...this.guardValues(run)).first();
  }
  async renew(run: StageOwner): Promise<boolean> {
    const now = this.clock();
    return changed(await this.db.prepare(`UPDATE book_stage_runs SET lease_until=? WHERE id=? AND ${this.guard()}`).bind(now+120,run.id,...this.guardValues(run,now)).run());
  }
  async release(run: StageOwner): Promise<boolean> {
    // A finished invocation can release only its own token. No expired/new owner
    // can be overwritten, even when the job already moved to the next stage.
    return changed(await this.db.prepare("UPDATE book_stage_runs SET state='idle' WHERE id=? AND owner=? AND state='running'").bind(run.id,run.owner).run());
  }

  async latestCall(run: StageOwner, slot: number): Promise<ProviderCall | null> {
    return this.db.prepare("SELECT * FROM book_provider_calls WHERE run_id=? AND slot=? ORDER BY attempt DESC LIMIT 1").bind(run.id,slot).first<ProviderCall>();
  }

  async claimCall(run: StageOwner, input: { slot: number; requestHash: string; reserveUnits: number; ceiling: number; retryConfirmed?: boolean; visual?: VisualCallBudget }): Promise<ProviderCall | null> {
    if (!Number.isSafeInteger(input.slot) || input.slot < 0 || input.slot > 8 || !HASH.test(input.requestHash) ||
      ![input.reserveUnits,input.ceiling].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error("Invalid call admission");
    if (input.visual && Object.values(input.visual).some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error("Invalid visual admission");
    const v = input.visual;
    const visual = v ? { micros: v.micros, input: v.input, output: v.output, calls: 1 } : {};
    const prior = await this.latestCall(run,input.slot); const now = this.clock();
    if (prior && (prior.request_hash !== input.requestHash || prior.attempt >= 1 || prior.state === "complete" || !input.retryConfirmed || (prior.state === "pending" && prior.created_at + 120 > now))) return null;
    const id = crypto.randomUUID(); const attempt = prior ? prior.attempt+1 : 0;
    const resultPath = `operations/calls/${id}.json`;
    const result = await this.db.prepare(`
      INSERT INTO book_provider_calls (id,run_id,job_id,slot,attempt,request_hash,state,reserved_units,actual_units,result_path,created_at,expires_at,visual_budget)
      SELECT ?,?,j.id,?,?,?,'pending',?,0,?,?,j.expires_at,? FROM book_jobs j
      WHERE j.id=? AND ${this.guard()}
        AND j.reserved_cost_units+j.actual_cost_units+COALESCE((SELECT SUM(reserved_units+actual_units) FROM book_provider_calls WHERE job_id=j.id),0)+?<=?
        AND NOT EXISTS (SELECT 1 FROM book_provider_calls WHERE run_id=? AND slot=? AND attempt>=?)
        AND (?=0 OR EXISTS (SELECT 1 FROM book_provider_calls WHERE id=? AND request_hash=? AND state IN ('pending','unknown','rejected')))
        AND (?=0 OR (
          COALESCE((SELECT SUM(json_extract(visual_budget,'$.micros')) FROM book_provider_calls WHERE job_id=j.id),0)+?<=?
          AND COALESCE((SELECT SUM(json_extract(visual_budget,'$.input')) FROM book_provider_calls WHERE job_id=j.id),0)+?<=120000
          AND COALESCE((SELECT SUM(json_extract(visual_budget,'$.output')) FROM book_provider_calls WHERE job_id=j.id),0)+?<=40000
          AND COALESCE((SELECT SUM(json_extract(visual_budget,'$.calls')) FROM book_provider_calls WHERE job_id=j.id),0)+?<=40))
      ON CONFLICT DO NOTHING
    `).bind(id,run.id,input.slot,attempt,input.requestHash,input.reserveUnits,resultPath,now,JSON.stringify(visual),run.jobId,...this.guardValues(run,now),input.reserveUnits,input.ceiling,run.id,input.slot,attempt,attempt,prior?.id ?? "",input.requestHash,v ? 1 : 0,(v?.priorMicros ?? 0)+(v?.micros ?? 0),v?.maxMicros ?? 0,(v?.priorInput ?? 0)+(v?.input ?? 0),(v?.priorOutput ?? 0)+(v?.output ?? 0),(v?.priorCalls ?? 0)+1).run();
    if (!changed(result)) return null;
    return this.latestCall(run,input.slot);
  }

  async settle(run: StageOwner, call: ProviderCall, actualUnits: number, visual?: { micros: number; input: number; output: number }): Promise<boolean> {
    if (!Number.isSafeInteger(actualUnits) || actualUnits < 0) throw new Error("Invalid call accounting");
    if (visual && Object.values(visual).some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error("Invalid visual accounting");
    const result = await this.db.prepare(`UPDATE book_provider_calls SET state='complete',reserved_units=0,actual_units=?,visual_budget=COALESCE(?,visual_budget)
      WHERE id=? AND run_id=? AND state IN ('pending','unknown') AND ${this.guard()}
      AND NOT EXISTS (SELECT 1 FROM book_provider_calls newer WHERE newer.run_id=book_provider_calls.run_id AND newer.slot=book_provider_calls.slot AND newer.attempt>book_provider_calls.attempt)
    `).bind(actualUnits,visual ? JSON.stringify({ ...visual, calls: 1 }) : null,call.id,run.id,...this.guardValues(run)).run();
    if (changed(result)) return true;
    const latest = await this.latestCall(run,call.slot);
    return latest?.id === call.id && latest.state === "complete" && latest.actual_units === actualUnits && await this.isOwner(run);
  }

  async failCall(run: StageOwner, call: ProviderCall, knownRejected: boolean): Promise<boolean> {
    return changed(await this.db.prepare(`UPDATE book_provider_calls SET state=?,reserved_units=CASE WHEN ?=1 THEN 0 ELSE reserved_units END,visual_budget=CASE WHEN ?=1 THEN '{}' ELSE visual_budget END
      WHERE id=? AND run_id=? AND state='pending' AND ${this.guard()}
      AND NOT EXISTS (SELECT 1 FROM book_provider_calls newer WHERE newer.run_id=book_provider_calls.run_id AND newer.slot=book_provider_calls.slot AND newer.attempt>book_provider_calls.attempt)
    `).bind(knownRejected ? "rejected" : "unknown",knownRejected ? 1 : 0,knownRejected ? 1 : 0,call.id,run.id,...this.guardValues(run)).run());
  }

  private publication(run: StageOwner, logicalPath: string, resultPath: string, now: number) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,250}$/.test(logicalPath) || logicalPath.split("/").some((s) => !s || s === "." || s === "..") || !/^operations\/artifacts\/[a-f0-9-]+\.json$/.test(resultPath)) throw new Error("Invalid artifact reference");
    return this.db.prepare(`INSERT INTO book_artifact_refs (id,job_id,logical_path,result_path,run_id,owner,expires_at)
      SELECT ?,j.id,?,?,?,?,j.expires_at FROM book_jobs j WHERE j.id=? AND ${this.guard()}
      ON CONFLICT(id) DO UPDATE SET result_path=excluded.result_path,run_id=excluded.run_id,owner=excluded.owner,expires_at=excluded.expires_at
    `).bind(`${run.jobId}:${logicalPath}`,logicalPath,resultPath,run.id,run.owner,run.jobId,...this.guardValues(run,now));
  }
  async artifactPath(jobId: string, logicalPath: string): Promise<string | null> {
    const row = await this.db.prepare("SELECT result_path FROM book_artifact_refs WHERE job_id=? AND logical_path=? AND expires_at>?").bind(jobId,logicalPath,this.clock()).first<{ result_path: string }>();
    return row?.result_path ?? null;
  }

  async transition(run: StageOwner, next: { status: BookJobStatus; cursor?: number; resumeStage?: BookJobStatus; error?: SafeBookJobErrorCategory | null; terminal?: boolean }, artifacts: Record<string, string> = {}): Promise<boolean> {
    const now = this.clock();
    const update = this.db.prepare(`UPDATE book_jobs SET status=?,current_stage=?,batch_cursor=COALESCE(?,batch_cursor),resume_stage=?,terminal_error_category=?,updated_at=?,terminal_at=CASE WHEN ?=1 THEN ? ELSE terminal_at END
      WHERE id=? AND ${this.guard()}
    `).bind(next.status,next.status,next.cursor ?? null,next.resumeStage ?? null,next.error ?? null,now,next.terminal ? 1 : 0,now,run.jobId,...this.guardValues(run,now));
    // D1 batch is transactional. Readers cannot observe a repaired draft without
    // its matching cursor. Unpublished R2 objects are harmless expiring orphans.
    const results = await this.db.batch([...Object.entries(artifacts).map(([path, result]) => this.publication(run,path,result,now)),update]);
    return changed(results[results.length-1]);
  }

  async cleanup(jobId: string): Promise<void> {
    // Only metadata for a cancelled/expired/cleaned job; R2 prefix cleanup owns
    // actual objects. Never erase active budget reservations via this method.
    const now = this.clock();
    await this.db.batch(["book_artifact_refs","book_provider_calls","book_stage_runs"].map((table) => this.db.prepare(`DELETE FROM ${table} WHERE job_id=? AND EXISTS (SELECT 1 FROM book_jobs WHERE id=? AND (expires_at<=? OR status IN ('cancelled','cleaning','cleaned','acknowledged')))` ).bind(jobId,jobId,now)));
  }
}
