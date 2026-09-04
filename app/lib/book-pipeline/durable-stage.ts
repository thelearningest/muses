import type { BookArtifactStore } from "./artifact-store";
import type { BookJobRepository } from "./job-repository";
import { BookOperationRepository, type StageOwner } from "./operation-repository";
import { PaidCallJournal } from "./paid-call-journal";
import { OpenAiIndeterminateRequestError } from "./providers/openai";

/** Stage-local writes stay private until the job transition publishes their
 * pointers in the same D1 transaction. Crash recovery replays raw paid results. */
export function durableStage(operations: BookOperationRepository, owner: StageOwner, baseStore: BookArtifactStore,
  baseRepository: BookJobRepository, limits: { reserveUnits: number; ceiling: number; retryConfirmed: boolean }) {
  const artifacts: Record<string,string> = {};
  const local = new Map<string,unknown>();
  const journal = new PaidCallJournal(operations,owner,baseStore,limits);
  const store = new Proxy(baseStore, { get(target,key) {
    if (key === "putJson") return async (jobId: string, path: string, value: unknown, expires: number) => {
      if (jobId !== owner.jobId || !await operations.renew(owner)) throw new OpenAiIndeterminateRequestError();
      const resultPath = `operations/artifacts/${crypto.randomUUID()}.json`;
      if (!await target.putJsonIfAbsent(jobId,resultPath,value,expires)) throw new OpenAiIndeterminateRequestError();
      artifacts[path] = resultPath; local.set(path,structuredClone(value));
    };
    if (key === "getJson") return async <T>(jobId: string, path: string): Promise<T | null> =>
      jobId === owner.jobId && local.has(path) ? structuredClone(local.get(path)) as T : target.getJson<T>(jobId,path);
    const value = Reflect.get(target,key); return typeof value === "function" ? value.bind(target) : value;
  } });
  // Legacy stage accounting is intentionally disabled: each actual call now
  // reserves and settles in the operation ledger, including every repair.
  const repository = {
    appendOpenAiRequestId: baseRepository.appendOpenAiRequestId.bind(baseRepository),
    commitStage: async (input: Parameters<BookJobRepository["commitStage"]>[0]) =>
      input.jobId === owner.jobId && input.expectedStatus === owner.stage &&
      operations.transition(owner,{ status: input.nextStatus, cursor: input.batchCursor },artifacts),
    markTerminal: async (...args: Parameters<BookJobRepository["markTerminal"]>) =>
      args[0] === owner.jobId && operations.transition(owner,{ status: args[1], error: args[2], terminal: true },args[1] === "complete" ? artifacts : {}),
    markRecoverable: async (...args: Parameters<BookJobRepository["markRecoverable"]>) =>
      args[0] === owner.jobId && operations.transition(owner,{ status: "manual_retry_required", resumeStage: args[1], error: "manual_retry_required" }),
  };
  return { store, repository, journal, isActive: () => operations.isOwner(owner), release: () => operations.release(owner) };
}
