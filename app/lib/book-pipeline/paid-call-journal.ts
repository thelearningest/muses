import type { BookArtifactStore } from "./artifact-store";
import { BookOperationRepository, type StageOwner, type VisualCallBudget } from "./operation-repository";
import { OpenAiBackgroundPending, OpenAiIndeterminateRequestError, OpenAiOutputLimitError, OpenAiRejectedRequestError, type StructuredOutputProvider, type StructuredResponse } from "./providers/openai";
import type { EmbeddingProvider } from "./retrieval";

export async function operationHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map((b) => b.toString(16).padStart(2,"0")).join("");
}
type VisualActual = { micros: number; input: number; output: number };
type Saved<T> = { version: 1; requestHash: string; actualUnits: number; result: T; visual?: VisualActual };

/** Deterministic call sequences; each concurrent quest gets its own slot range.
 * Request drift is rejected, not permission for another paid operation. */
export class PaidCallJournal {
  private slot = 0;
  constructor(private readonly operations: BookOperationRepository, private readonly owner: StageOwner,
    private readonly store: Pick<BookArtifactStore,"getJson" | "putJsonIfAbsent">,
    private readonly limits: { reserveUnits: number; ceiling: number; retryConfirmed: boolean }, private readonly baseSlot = 0) {}

  async execute<T>(request: unknown, send: () => Promise<T>, units: (result: T) => number, visual?: VisualCallBudget, actualVisual?: (result: T) => VisualActual,
    background?: { start(): Promise<string>; collect(id: string): Promise<T>; remove?(id: string): Promise<void> }, reservedTokenUnits?: number): Promise<T> {
    if (this.slot >= 10) throw new Error("Operation call sequence exhausted");
    const slot = this.baseSlot + this.slot++;
    const requestHash = await operationHash(request);
    if (!await this.operations.renew(this.owner)) throw new OpenAiIndeterminateRequestError();
    const prior = await this.operations.latestCall(this.owner,slot);
    let receipt: { requestHash: string; responseId: string } | null = null;
    if (prior) {
      if (prior.request_hash !== requestHash) throw new OpenAiIndeterminateRequestError();
      const saved = await this.store.getJson<Saved<T>>(this.owner.jobId,prior.result_path);
      if (saved) {
        if (saved.version !== 1 || saved.requestHash !== requestHash || !await this.operations.settle(this.owner,prior,saved.actualUnits,saved.visual)) throw new OpenAiIndeterminateRequestError();
        return saved.result;
      }
      // A completed call without its response cannot safely be repeated.
      if (prior.state === "complete") throw new OpenAiIndeterminateRequestError();
      if (background) {
        receipt = await this.store.getJson(this.owner.jobId, `${prior.result_path}.pending.json`);
        if (receipt && receipt.requestHash !== requestHash) throw new OpenAiIndeterminateRequestError();
        // A known terminal failure needs explicit retry; a pending response is
        // polled under the same reservation, including after a browser reload.
        if (prior.state !== "pending") receipt = null;
      }
    }
    const call = receipt ? prior! : await this.operations.claimCall(this.owner,{ slot, requestHash, ...this.limits,
      ...(reservedTokenUnits === undefined ? {} : { reserveUnits: reservedTokenUnits }), visual });
    if (!call) throw new OpenAiIndeterminateRequestError();
    let received = false;
    try {
      if (background && !receipt) {
        const responseId = await background.start();
        receipt = { requestHash, responseId };
        if (!await this.store.putJsonIfAbsent(this.owner.jobId, `${call.result_path}.pending.json`, receipt, call.expires_at)) throw new OpenAiIndeterminateRequestError();
        if (!await this.operations.isOwner(this.owner)) {
          await background.remove?.(responseId);
          throw new OpenAiIndeterminateRequestError();
        }
        throw new OpenAiBackgroundPending();
      }
      if (background) received = true;
      const result = background ? await background.collect(receipt!.responseId) : await send(); received = true;
      const actualUnits = units(result);
      if (!Number.isSafeInteger(actualUnits) || actualUnits < 0) throw new OpenAiIndeterminateRequestError();
      // Persist before settlement. A crash here replays this result and settles
      // the same call once. Each attempt has a distinct, immutable object key.
      const saved: Saved<T> = { version: 1, requestHash, actualUnits, result, ...(actualVisual ? { visual: actualVisual(result) } : {}) };
      if (!await this.store.putJsonIfAbsent(this.owner.jobId,call.result_path,saved,call.expires_at)) throw new OpenAiIndeterminateRequestError();
      if (!await this.operations.settle(this.owner,call,actualUnits,saved.visual)) throw new OpenAiIndeterminateRequestError();
      if (receipt) await background?.remove?.(receipt.responseId).catch(() => {});
      return result;
    } catch (error) {
      if (error instanceof OpenAiBackgroundPending) throw error;
      await this.operations.failCall(this.owner,call,!received && error instanceof OpenAiRejectedRequestError);
      if (error instanceof OpenAiOutputLimitError) throw error;
      // Generic storage/SDK exceptions after dispatch are not proof of a free
      // request. The stage must stop for explicit user action in all such cases.
      throw new OpenAiIndeterminateRequestError();
    }
  }

  structured(provider: StructuredOutputProvider): StructuredOutputProvider {
    return { countInputTokens: provider.countInputTokens?.bind(provider), partition: (index: number) => {
      if (this.baseSlot !== 0 || !Number.isSafeInteger(index) || index < 0 || index >= 64) throw new Error("Invalid operation partition");
      return new PaidCallJournal(this.operations,this.owner,this.store,this.limits,(index + 1) * 10).structured(provider);
    }, generateStructured: <T>(request: Parameters<StructuredOutputProvider["generateStructured"]>[0]) => {
      const { visualBudget, reservedTokenUnits, ...payload } = request;
      if (request.background && (!provider.startBackground || !provider.collectBackground)) throw new Error("Background provider required");
      return this.execute<StructuredResponse<T>>({ kind: "responses", request: payload },() => provider.generateStructured<T>(payload),
        (r) => Math.max(1,Math.ceil(r.usage.totalTokens / 1000)),visualBudget,visualBudget ? (r) => ({ micros: Math.ceil(r.usage.inputTokens*visualBudget.inputPrice*1.25+r.usage.outputTokens*visualBudget.outputPrice), input: r.usage.inputTokens, output: r.usage.outputTokens }) : undefined,
        request.background ? { start: () => provider.startBackground!(payload), collect: (id) => provider.collectBackground!<T>(id), remove: provider.deleteBackground?.bind(provider) } : undefined, reservedTokenUnits);
    } };
  }
  embeddings(provider: EmbeddingProvider): EmbeddingProvider {
    // Existing embedding accounting is conservative reservation units, not a
    // dollar estimate. Keep that convention rather than inventing token usage.
    return { embed: (request) => this.execute({ kind: "embeddings", request },() => provider.embed(request),() => this.limits.reserveUnits) };
  }
}
