import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { persistValidGameThenAcknowledge, type ResumableBookJob } from "../../app/book-job-client";
import type { GameContent, Quest } from "../../app/game-package";
import { buildBookMapStage } from "../../app/lib/book-pipeline/book-map-stage";
import { chunkCanonicalBook } from "../../app/lib/book-pipeline/chunk-book";
import { DEFAULT_BOOK_PIPELINE_CONFIG } from "../../app/lib/book-pipeline/config";
import type { BookMap, CanonicalBook, EvidenceCard, QuestEvidenceContract } from "../../app/lib/book-pipeline/contracts";
import { mapEvidenceBatch } from "../../app/lib/book-pipeline/evidence-stage";
import { generateGameStage } from "../../app/lib/book-pipeline/generation-stage";
import { createBookJobApi } from "../../app/lib/book-pipeline/http";
import type { BookJobRecord } from "../../app/lib/book-pipeline/job-repository";
import { advanceOcrStage } from "../../app/lib/book-pipeline/mistral-stage";
import type { MistralOcrResponse, OcrBatch, OcrProvider } from "../../app/lib/book-pipeline/providers/mistral";
import type { StructuredOutputProvider } from "../../app/lib/book-pipeline/providers/openai";
import { retrieveQuestEvidenceStage, type EmbeddingProvider } from "../../app/lib/book-pipeline/retrieval";
import { verifyNextQuestStage } from "../../app/lib/book-pipeline/verification-stage";
import { advanceVisualStage } from "../../app/lib/book-pipeline/visual-stage";

class MemoryStore {
  readonly values = new Map<string, unknown>();
  private key(jobId: string, path: string) { return `${jobId}/${path}`; }
  async putSource(jobId: string, stream: ReadableStream<Uint8Array>) { this.values.set(this.key(jobId, "source.pdf"), new Uint8Array(await new Response(stream).arrayBuffer())); }
  async putJson(jobId: string, path: string, value: unknown) { this.values.set(this.key(jobId, path), structuredClone(value)); }
  async getJson<T>(jobId: string, path: string): Promise<T | null> { return (this.values.get(this.key(jobId, path)) as T | undefined) ?? null; }
  async get(jobId: string, path: string) {
    const value = this.values.get(this.key(jobId, path));
    if (!(value instanceof Uint8Array)) return null;
    const buffer = new Uint8Array(value).buffer;
    return { key: this.key(jobId, path), body: new Blob([buffer]).stream(), arrayBuffer: async () => buffer, text: async () => new TextDecoder().decode(value) };
  }
  async delete(jobId: string, path: string) { this.values.delete(this.key(jobId, path)); }
  async deleteJobArtifacts(jobId: string) { let count = 0; for (const key of [...this.values.keys()]) if (key.startsWith(`${jobId}/`)) { this.values.delete(key); count += 1; } return count; }
}

class MemoryRepository {
  job: BookJobRecord | null = null;
  attempts: Array<{ identity: string; network: string; at: number }> = [];
  daily = new Map<string, number>();
  async createJob(input: { id: string; capabilityHash: string; identityHash: string; networkHash: string; sourceFingerprint: string; originalFilename: string; mimeType: string; byteSize: number; now: number; expiresAt: number }) {
    this.job = { ...input, pageCount: null, status: "created", currentStage: "created", resumeStage: null, batchCursor: 0, retryCount: 0, cancellationRequested: false, cleanupState: "pending", terminalErrorCategory: null, mistralBatchId: null, mistralInputFileId: null, mistralOutputFileId: null, openaiRequestIds: [], reservedCostUnits: 0, actualCostUnits: 0, createdAt: input.now, updatedAt: input.now, terminalAt: null };
  }
  async getAuthorizedJob(id: string, hash: string) { return this.job?.id === id && this.job.capabilityHash === hash ? this.job : null; }
  async getJob(id: string) { return this.job?.id === id ? this.job : null; }
  async countActiveJobs(identity: string) { return this.job?.identityHash === identity && !["complete", "acknowledged", "cancelled", "failed_terminal", "cleaned"].includes(this.job.status) ? 1 : 0; }
  async admitAttempt(input: { identityHash: string; networkHash: string; now: number; since: number; ceiling: number }) { const count = this.attempts.filter((item) => (item.identity === input.identityHash || item.network === input.networkHash) && item.at >= input.since).length; if (count >= input.ceiling) return false; this.attempts.push({ identity: input.identityHash, network: input.networkHash, at: input.now }); return true; }
  async reserveDailyAdmission(day: string, ceiling: number) { const count = this.daily.get(day) ?? 0; if (count >= ceiling) return false; this.daily.set(day, count + 1); return true; }
  async claimStage(input: { jobId: string; capabilityHash: string; expectedStatus: BookJobRecord["status"]; claimedStatus: BookJobRecord["status"]; now: number }) { if (!this.job || this.job.id !== input.jobId || this.job.capabilityHash !== input.capabilityHash || this.job.status !== input.expectedStatus) return false; this.job = { ...this.job, status: input.claimedStatus, currentStage: input.claimedStatus, updatedAt: input.now }; return true; }
  async commitStage(input: { jobId: string; expectedStatus: BookJobRecord["status"]; nextStatus: BookJobRecord["status"]; now: number; batchCursor?: number }) { if (!this.job || this.job.id !== input.jobId || this.job.status !== input.expectedStatus) return false; this.job = { ...this.job, status: input.nextStatus, currentStage: input.nextStatus, updatedAt: input.now, batchCursor: input.batchCursor ?? this.job.batchCursor }; return true; }
  async setMistralReferences(_id: string, refs: { batchId?: string; inputFileId?: string; outputFileId?: string }, now: number) { if (!this.job) return false; this.job = { ...this.job, mistralBatchId: refs.batchId ?? this.job.mistralBatchId, mistralInputFileId: refs.inputFileId ?? this.job.mistralInputFileId, mistralOutputFileId: refs.outputFileId ?? this.job.mistralOutputFileId, updatedAt: now }; return true; }
  async markRecoverable(_id: string, resume: BookJobRecord["status"], status: "failed_recoverable" | "manual_retry_required", category: BookJobRecord["terminalErrorCategory"], now: number) { if (!this.job) return false; this.job = { ...this.job, status, currentStage: resume, resumeStage: resume, terminalErrorCategory: category, retryCount: this.job.retryCount + 1, updatedAt: now }; return true; }
  async resumeRecoverable(_id: string, hash: string, now: number) { if (!this.job || this.job.capabilityHash !== hash || !this.job.resumeStage) return false; this.job = { ...this.job, status: this.job.resumeStage, currentStage: this.job.resumeStage, resumeStage: null, terminalErrorCategory: null, updatedAt: now }; return true; }
  async markTerminal(_id: string, status: "complete" | "cancelled" | "failed_terminal", category: BookJobRecord["terminalErrorCategory"], now: number, expiresAt: number) { if (!this.job) return false; this.job = { ...this.job, status, currentStage: status, terminalErrorCategory: category, terminalAt: now, updatedAt: now, expiresAt }; return true; }
  async reserveProviderCost(_id: string, units: number, ceiling: number, now: number) { if (!this.job || this.job.reservedCostUnits + this.job.actualCostUnits + units > ceiling) return false; this.job = { ...this.job, reservedCostUnits: this.job.reservedCostUnits + units, updatedAt: now }; return true; }
  async reconcileProviderCost(_id: string, reserved: number, actual: number, now: number) { if (!this.job) return false; this.job = { ...this.job, reservedCostUnits: Math.max(0, this.job.reservedCostUnits - reserved), actualCostUnits: this.job.actualCostUnits + actual, updatedAt: now }; return true; }
  async appendOpenAiRequestId(_id: string, requestId: string, now: number) { if (!this.job) return false; this.job = { ...this.job, openaiRequestIds: [...new Set([...this.job.openaiRequestIds, requestId])], updatedAt: now }; return true; }
  async requestCancellation() { if (!this.job) return false; this.job = { ...this.job, cancellationRequested: true }; return true; }
  async acknowledge(_id: string, hash: string, now: number) { if (!this.job || this.job.capabilityHash !== hash || this.job.status !== "complete") return false; this.job = { ...this.job, status: "acknowledged", currentStage: "acknowledged", updatedAt: now }; return true; }
  async listExpiredJobs() { return []; }
  async markCleanupState(_id: string, state: string, now: number) { if (!this.job) return false; this.job = { ...this.job, cleanupState: state, updatedAt: now }; return true; }
}

function webRequest(path: string, init: RequestInit = {}) {
  return new Request(`https://books.example${path}`, { ...init, headers: { origin: "https://books.example", ...init.headers } });
}

function makeQuest(index: number, contract: QuestEvidenceContract): Quest {
  const choice = (id: string, correct: boolean) => ({ id, label: `${id} option ${index}`, feedback: correct ? "Uses the evidence." : "Conflicts with the evidence.", correct });
  return { id: `q-${index}`, number: String(index + 1), title: `Evidence trial ${index + 1}`, gallery: `Station ${index + 1}`, story: `A decision at station ${index + 1} needs evidence.`, objective: `Apply ${contract.playerActions[0]}.`, clue: "Inspect the two highlighted regions.", artifact: "console", xp: 100, observationTools: [`record ${index}`, `measure ${index}`, `trace ${index}`], diagnosis: [choice("a", true), choice("b", false), choice("c", false)], repairs: [choice("a", true), choice("b", false), choice("c", false)], diagnosisQuestion: `Which visible region shows the stronger signal ${index}?`, repairQuestion: `Which visible reference should guide repair ${index}?`, principle: { name: `Concept ${index + 1}`, summary: contract.centralClaim ?? "Grounded claim" }, visual: { mode: "source-image", form: "console", accent: "green", title: `Station console ${index}`, problemLabel: `Fault signal ${index}`, repairLabel: `Evidence fix ${index}`, elements: [`sensor ${index}`, `record ${index}`, `switch ${index}`], regions: [{ imageIndex: 0, label: `Left ${index}`, x: 0, y: 0, width: 0.5, height: 1 }, { imageIndex: 0, label: `Right ${index}`, x: 0.5, y: 0, width: 0.5, height: 1 }] }, sourceAnchors: contract.sources.slice(0, 1).map((source) => ({ label: `Page ${source.pageStart + 1}`, pageStart: source.pageStart + 1, pageEnd: source.pageEnd + 1 })) };
}

describe("mocked upload-to-play pipeline", () => {
  it("survives queueing and refresh, repairs one quest, then deletes every temporary artifact", async () => {
    const pdf = await readFile(new URL("../fixtures/scanned-book.pdf", import.meta.url));
    const ocr = JSON.parse(await readFile(new URL("../fixtures/mistral-ocr-result.json", import.meta.url), "utf8")) as MistralOcrResponse;
    const repository = new MemoryRepository();
    const store = new MemoryStore();
    const turnstile = vi.fn(async () => true);
    let jobCounter = 0;
    const api = createBookJobApi({ config: DEFAULT_BOOK_PIPELINE_CONFIG, repository, store, capabilityHmacKey: "capability-key-long-enough", identityHmacKey: "identity-key-long-enough", providerUrlHmacKey: "provider-key-long-enough", verifyTurnstile: turnstile, now: () => 1_000, newId: () => `job-${++jobCounter}`, newCapability: () => "capability-token-long-enough" });

    const create = await api.create(webRequest("/api/book-jobs", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.10" }, body: JSON.stringify({ filename: "scanned-book.pdf", mimeType: "application/pdf", byteSize: pdf.byteLength, sourceFingerprint: "fixture-fingerprint", browserToken: "browser-token-long-enough", turnstileToken: "passed", rightsConfirmed: true }) }));
    expect(create.status).toBe(201);
    expect(turnstile).toHaveBeenCalledOnce();
    const created = await create.json() as { jobId: string; capabilityToken: string };
    const auth = { authorization: `Bearer ${created.capabilityToken}` };
    const upload = await api.upload(created.jobId, webRequest(`/api/book-jobs/${created.jobId}/source`, { method: "PUT", headers: { ...auth, "content-type": "application/pdf", "content-length": String(pdf.byteLength) }, body: new Blob([pdf]).stream(), duplex: "half" } as RequestInit));
    expect(upload.status).toBe(202);

    let inspections = 0;
    const deleteBatch = vi.fn(async () => undefined);
    const deleteFile = vi.fn(async () => undefined);
    const ocrProvider: OcrProvider = {
      submit: vi.fn(async (): Promise<OcrBatch> => ({ id: "batch", status: "queued", inputFileIds: ["input"] })),
      inspect: vi.fn(async (): Promise<OcrBatch> => ++inspections === 1 ? { id: "batch", status: "queued", inputFileIds: ["input"] } : { id: "batch", status: "success", inputFileIds: ["input"], outputFileId: "output" }),
      collect: vi.fn(async () => ocr), cancel: vi.fn(), deleteBatch, deleteFile,
    };
    const advanceOcr = async () => advanceOcrStage({ job: repository.job!, provider: ocrProvider, repository, store, config: { model: "mistral-ocr-4-1", maxPages: 300 }, sourceUrl: "https://books.example/source", now: 1_001 });
    await advanceOcr();
    expect((await advanceOcr()).outcome).toBe("waiting");
    const refreshedJob = structuredClone(repository.job);
    expect(refreshedJob?.status).toBe("ocr_queued");
    await advanceOcr(); await advanceOcr(); await advanceOcr();
    expect(ocrProvider.submit).toHaveBeenCalledOnce();
    expect(ocrProvider.collect).toHaveBeenCalledOnce();

    const canonical = await store.getJson<CanonicalBook>(created.jobId, "canonical-book.json");
    expect(canonical?.pages).toHaveLength(2);
    const sourceBlock = canonical!.blocks.find((block) => block.type === "paragraph")!;
    const section = chunkCanonicalBook(canonical!).sections.find((item) => item.blockIds.includes(sourceBlock.id))!;
    const cards: EvidenceCard[] = Array.from({ length: 4 }, (_, index) => ({ id: `card-${index}`, sectionId: section.id, concept: `Concept ${index + 1}`, supportedClaim: `Grounded claim ${index + 1}`, sources: [{ pageStart: sourceBlock.pageIndex, pageEnd: sourceBlock.pageIndex, canonicalBlockIds: [sourceBlock.id], boundedExcerpt: sourceBlock.text.slice(0, 480) }], playerVerbs: ["observe"], applicableProcess: ["compare evidence"], successfulExamples: ["a supported decision"], failureModes: ["guessing"], misconceptions: [], prerequisites: index ? [`Concept ${index}`] : [], causalLinks: [], tradeoffs: [], visualReferenceIds: index === 0 ? [canonical!.pages[0].visualReferences[0].id] : [], importanceSignals: ["chapter"], confidence: 0.9, uncertainty: [], contradictions: [] }));
    const evidenceProvider: StructuredOutputProvider = { async generateStructured<T>() { return { responseId: "evidence-response", data: { cards } as T, usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 } }; } };
    await mapEvidenceBatch({ job: { id: created.jobId, status: "mapping_evidence", batchCursor: repository.job!.batchCursor, identityHash: repository.job!.identityHash, expiresAt: repository.job!.expiresAt }, canonical: canonical!, provider: evidenceProvider, repository, store, config: { model: "gpt-5.4-mini", reasoningEffort: "low", sectionsPerBatch: 3 }, now: 1_002 });
    await buildBookMapStage({ job: repository.job!, canonical: canonical!, repository, store, now: 1_003 });
    await advanceVisualStage({ job: repository.job!, canonical: canonical!, evidenceCards: cards, provider: { annotate: async ({ pages }) => pages.map((page) => ({ visualReferenceId: `${page}:0`, pageIndex: page, description: "A feedback loop linking observation and response.", role: "causal comparison", confidence: 0.9 })) }, repository, store, config: { model: "mistral-ocr-4-1", maxPages: 12 }, sourceUrl: "https://books.example/source", now: 1_004 });
    await advanceVisualStage({ job: repository.job!, canonical: canonical!, evidenceCards: cards, provider: { annotate: vi.fn() }, repository, store, config: { model: "mistral-ocr-4-1", maxPages: 12 }, sourceUrl: "https://books.example/source", now: 1_005 });

    const bookMap = await store.getJson<BookMap>(created.jobId, "book-map.json");
    const visual = await store.getJson<{ annotations: [] }>(created.jobId, "visual-annotations.json");
    const embeddings: EmbeddingProvider = { embed: async ({ values }) => ({ vectors: values.map((_, index) => [index + 1, 1]), requestId: "embedding-request" }) };
    await retrieveQuestEvidenceStage({ job: repository.job!, canonical: canonical!, bookMap: bookMap!, visualAnnotations: visual!.annotations, provider: embeddings, repository, store, model: "text-embedding-3-small", now: 1_006 });
    const evidence = await store.getJson<{ contracts: QuestEvidenceContract[] }>(created.jobId, "quest-evidence.json");
    const generated: GameContent = { sourceTitle: "Field Notes", title: "Evidence Stations", subtitle: "Decide from what you can support", setting: "A field laboratory", quests: evidence!.contracts.map((contract, index) => makeQuest(index, contract)) };
    const generationProvider: StructuredOutputProvider = { async generateStructured<T>() { return { responseId: "generation-response", data: generated as T, usage: { inputTokens: 200, outputTokens: 300, totalTokens: 500 } }; } };
    const questImages = evidence!.contracts.map((_, index) => [{ imageUrl: `data:image/png;base64,A${index}==`, width: 300, height: 200, label: `Fixture page ${index + 1}` }]);
    await generateGameStage({ job: repository.job!, bookMap: bookMap!, contracts: evidence!.contracts, provider: generationProvider, questImages, repository, store, config: { model: "gpt-5.6-sol", reasoningEffort: "high" }, now: 1_007 });

    let firstRejected = false;
    let repairs = 0;
    const verifier: StructuredOutputProvider = { async generateStructured<T>(input: Parameters<StructuredOutputProvider["generateStructured"]>[0]) {
      if (input.schemaName === "repaired_quest") { repairs += 1; const supplied = JSON.parse(input.input) as { quest: Quest }; return { responseId: `repair-${repairs}`, data: { ...supplied.quest, story: "A repaired, evidence-bounded situation." } as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }; }
      if (!firstRejected) { firstRejected = true; return { responseId: "verify-fail", data: { accepted: false, issues: ["unsupported wording"] } as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }; }
      return { responseId: "verify-pass", data: { accepted: true, issues: [] } as T, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    } };
    while (repository.job?.status === "verifying_quests") {
      const draft = await store.getJson<{ game: GameContent }>(created.jobId, "game-draft.json");
      await verifyNextQuestStage({ job: repository.job, game: draft!.game, contracts: evidence!.contracts, provider: verifier, repository, store, config: { model: "gpt-5.4-mini", reasoningEffort: "low", maxRepairAttempts: 2 }, now: 1_008 + repository.job.batchCursor });
    }
    expect(repairs).toBe(1);
    expect(repository.job?.status).toBe("complete");

    const statusResponse = await api.status(created.jobId, webRequest(`/api/book-jobs/${created.jobId}`, { headers: auth }));
    const status = await statusResponse.json();
    const resumable: ResumableBookJob = { ...created, filename: "scanned-book.pdf", stage: "ready" };
    const saved: unknown[] = [];
    await persistValidGameThenAcknowledge({ status, job: resumable, saveGame: (game) => { saved.push(game); }, acknowledge: async () => { const response = await api.acknowledge(created.jobId, webRequest(`/api/book-jobs/${created.jobId}/acknowledge`, { method: "POST", headers: auth })); expect(response.status).toBe(204); }, clear: vi.fn() });
    expect(saved).toHaveLength(1);
    expect(store.values.size).toBe(0);
    expect(deleteBatch).toHaveBeenCalledWith("batch");
    expect(deleteFile).toHaveBeenCalledWith("input");
    expect(deleteFile).toHaveBeenCalledWith("output");
  });

  it("enforces five rolling attempts and twenty daily admissions in the state layer", async () => {
    const repository = new MemoryRepository();
    const attempts = await Promise.all(Array.from({ length: 6 }, (_, index) => repository.admitAttempt({ identityHash: "identity", networkHash: "network", now: 10_000 + index, since: 0, ceiling: 5 })));
    expect(attempts).toEqual([true, true, true, true, true, false]);
    const admissions = await Promise.all(Array.from({ length: 21 }, () => repository.reserveDailyAdmission("2026-09-03", 20)));
    expect(admissions.filter(Boolean)).toHaveLength(20);
    expect(admissions.at(-1)).toBe(false);
  });
});
