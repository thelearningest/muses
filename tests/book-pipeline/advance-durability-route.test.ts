import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ env: {} as Record<string,unknown> }));
vi.mock("../../app/lib/book-pipeline/runtime-env", () => ({ getBookPipelineRuntimeEnv: async () => f.env }));
import { POST } from "../../app/api/book-jobs/[jobId]/advance/route";
import { BookArtifactStore } from "../../app/lib/book-pipeline/artifact-store";
import { BookJobRepository } from "../../app/lib/book-pipeline/job-repository";
import { BookOperationRepository } from "../../app/lib/book-pipeline/operation-repository";
import { hashPrivateValue } from "../../app/lib/book-pipeline/security";
import { chunkCanonicalBook } from "../../app/lib/book-pipeline/chunk-book";
import type { BookJobStatus, BookMap, CanonicalBook, EvidenceCard, QuestEvidenceContract } from "../../app/lib/book-pipeline/contracts";
import type { GameContent, Quest } from "../../app/game-package";
import type { VisualState } from "../../app/lib/book-pipeline/visual-agent/schema";
import { VISUAL_STATE_PATH } from "../../app/lib/book-pipeline/visual-agent/stage";
import { MigratedD1 } from "./sqlite-d1";
import { ConditionalR2 } from "./durable-fixture";

const quest = (i: number): Quest => {
  const choices = ["a","b","c"].map((id,index) => ({ id,label: `${id} option ${i}`,feedback: index ? "Contradicts evidence." : "Uses evidence.",correct: index === 0 }));
  return { id: `q${i}`,number: String(i+1),title: `Trial ${i}`,gallery: `Lab ${i}`,story: `Situation ${i}.`,objective: `Apply ${i}.`,clue: `Inspect ${i}.`,artifact: "console",xp: 100,
    observationTools: [`meter ${i}`,`log ${i}`,`map ${i}`], diagnosis: choices,repairs: choices,principle: { name: `Concept ${i}`,summary: `Claim ${i}` },
    visual: { mode: i === 0 ? "3d" : "diagram",form: "console",accent: "green",title: `Console ${i}`,problemLabel: `Fault ${i}`,repairLabel: `Fix ${i}`,elements: [`sensor ${i}`,`signal ${i}`,`switch ${i}`] },
    sourceAnchors: [{ label: `Page ${i+1}`,pageStart: i+1,pageEnd: i+1 }] };
};
const game: GameContent = { sourceTitle: "Source",title: "Game",subtitle: "Learn",setting: "Lab",quests: [0,1,2,3].map(quest) };
const canonical: CanonicalBook = { schemaVersion: 1,source: { fingerprint: "f",filename: "source.pdf",pageCount: 4 },pages: [0,1,2,3].map((index) => ({ index,blockIds: [`b${index}`],visualReferences: [],warnings: [] })),
  blocks: [0,1,2,3].map((pageIndex) => ({ id: `b${pageIndex}`,pageIndex,type: "paragraph",readingOrder: pageIndex,text: `Observe before deciding ${pageIndex}.`,ancestorHeadings: [],visualReferenceIds: [] })),warnings: [] };
const section = chunkCanonicalBook(canonical).sections[0];
const cards: EvidenceCard[] = [0,1,2,3].map((i) => ({ id: `card${i}`,sectionId: section.id,concept: `Concept ${i}`,supportedClaim: `Observe before deciding ${i}.`,sources: [{ pageStart: i,pageEnd: i,canonicalBlockIds: [`b${i}`],boundedExcerpt: `Observe before deciding ${i}.` }],playerVerbs: ["observe"],applicableProcess: ["record"],successfulExamples: ["record first"],failureModes: ["guess"],misconceptions: [],prerequisites: [],causalLinks: [],tradeoffs: [],visualReferenceIds: [],importanceSignals: [],confidence: 0.9,uncertainty: [],contradictions: [] }));
const bookMap: BookMap = { schemaVersion: 1,thesis: "Observe first",learningArc: [],chapters: [],concepts: cards.map((c,i) => ({ id: `c${i}`,name: c.concept,summary: c.supportedClaim,evidenceCardIds: [c.id],prerequisiteConceptIds: [],relatedConceptIds: [],score: 1,confidence: 1 })),contradictions: [],visualOpportunities: [],omissions: [],proposedQuestConceptIds: ["c0","c1","c2","c3"] };
const contracts: QuestEvidenceContract[] = cards.map((c,i) => ({ id: `contract${i}`,conceptId: `c${i}`,centralClaim: c.supportedClaim,playerActions: c.playerVerbs,sources: c.sources,visualAnnotations: [],confidence: 0.9,missingEvidence: [] }));

describe("actual advance route durable paid-call acceptance", () => {
  let db: MigratedD1; let repository: BookJobRepository; let store: BookArtifactStore;
  const call = (retryConfirmed = false) => POST(new Request("https://books.test/api/book-jobs/job/advance",{ method: "POST",headers: { origin: "https://books.test",authorization: "Bearer capability" },body: JSON.stringify({ retryConfirmed }) }),{ params: Promise.resolve({ jobId: "job" }) });
  beforeEach(async () => {
    db = new MigratedD1(); repository = new BookJobRepository(db);
    const bucket = new ConditionalR2(); store = new BookArtifactStore(bucket,new BookOperationRepository(db));
    f.env = { DB: db,BOOK_JOBS: bucket,OPENAI_API_KEY: "local-test-openai-key",BOOK_CAPABILITY_HMAC_KEY: "local-test-capability-key" };
    const now = Math.floor(Date.now()/1000);
    await repository.createJob({ id: "job",capabilityHash: await hashPrivateValue("capability",String(f.env.BOOK_CAPABILITY_HMAC_KEY)),identityHash: "identity",networkHash: "net",sourceFingerprint: "f",originalFilename: "source.pdf",mimeType: "application/pdf",byteSize: 100,now,expiresAt: now+3600 });
    for (const [path,value] of Object.entries({ "ingestion.json": { provider: "luna" },"canonical-book.json": canonical,"book-map.json": bookMap,"evidence-manifest.json": { batchCount: 1 },"evidence/0.json": { cards },"visual-annotations.json": { annotations: [] },"quest-evidence.json": { contracts },"game-draft.json": { game } })) await store.putJson("job",path,value,now+3600);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close(); });
  function stage(status: BookJobStatus) { db.database.prepare("UPDATE book_jobs SET status=?,current_stage=?").run(status,status); }
  function reply(payload: Record<string,unknown>, data: unknown) {
    if (payload.encoding_format === "float" && Array.isArray(payload.input)) return Response.json({ data: payload.input.map((_,index) => ({ index,embedding: [1,0] })) });
    return Response.json({ id: "resp-test",status: "completed",output_text: JSON.stringify(data),usage: { input_tokens: 100,output_tokens: 10,total_tokens: 110 } });
  }
  async function seedVisual(usedCalls = 5) {
    const expiry = Math.floor(Date.now()/1000)+3600;
    const state: VisualState = { schemaVersion: 1,promptVersion: "visual-v1",sourceFingerprint: "f",phase: "done",step: 5,pages: [0],queue: [],selectedIds: ["v0"],stopReason: "sampled_selection_complete",
      usage: { calls: usedCalls,inputTokens: 100,outputTokens: 100,estimatedMicros: 100,reservedMicros: 0 },
      candidates: [{ id: "v0",pageIndex: 0,title: "Grid",concept: "grid",boxes: [{ x: 0,y: 0,width: 0.5,height: 1 },{ x: 0.5,y: 0,width: 0.5,height: 1 }],evidenceIds: ["b0"],revision: 0,cropHashes: ["hash0","hash1"],verdict: { disposition: "reference_only",evidenceIds: ["b0"],claims: [],reason: "Reference only" } }] };
    const evidence = structuredClone(contracts);
    evidence[0].visualAnnotations = [{ visualReferenceId: "v0",description: "Paired reference",source: evidence[0].sources[0],visualAgent: { candidateId: "v0",revision: 0,disposition: "reference_only",limitations: ["Small text is illegible"] } }];
    await store.putJson("job","quest-evidence.json",{ contracts: evidence },expiry);
    await store.putJson("job",VISUAL_STATE_PATH,state,expiry);
    for (let i = 0; i < 2; i++) await store.putJson("job",`visual-agent/assets/v0-r0-${i}-crop.json`,{ id: `v0-r0-${i}-crop`,hash: `hash${i}`,width: 300,height: 200,imageUrl: `data:image/png;base64,${i}`,renderer: "fixture",rotation: 0 },expiry);
    return state;
  }
  it.each(["mapping_evidence","retrieving_quest_evidence","generating_game","verifying_quests"] as const)("admits exactly one provider call under competing HTTP requests: %s", async (status) => {
    stage(status);
    if (status === "mapping_evidence") await store.delete("job","evidence/0.json");
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>((r) => { entered = r; }); const gate = new Promise<void>((r) => { release = r; });
    const fetcher = vi.fn(async (_url: string,init: RequestInit) => { entered(); await gate; return reply(JSON.parse(String(init.body)),status === "mapping_evidence" ? { cards } : status === "generating_game" ? game : { accepted: true,issues: [] }); });
    vi.stubGlobal("fetch",fetcher);
    const first = call(); await started;
    const second = await call(); expect(second.status).toBe(202); expect(await second.json()).toEqual({ outcome: "waiting" });
    release(); const result = await first; expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ outcome: status === "verifying_quests" ? "advanced" : "complete" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(db.database.prepare("SELECT COUNT(*) AS n FROM book_provider_calls WHERE state='complete'").get()?.n).toBe(1);
    expect(db.database.prepare("SELECT COUNT(*) AS n FROM book_artifact_refs").get()?.n).toBeGreaterThan(0);
  });
  it("replays verification and repair after failed publication without repeating any of its three calls", async () => {
    stage("verifying_quests");
    let count = 0;
    const fetcher = vi.fn(async (_url: string,init: RequestInit) => { count++; return reply(JSON.parse(String(init.body)),count === 1 ? { accepted: false,issues: ["Fix clue"] } : count === 2 ? { ...quest(0),clue: "Inspect the recorded evidence." } : { accepted: true,issues: [] }); });
    vi.stubGlobal("fetch",fetcher);
    vi.spyOn(db,"batch").mockRejectedValueOnce(new Error("simulated transaction outage"));
    expect(await (await call()).json()).toMatchObject({ outcome: "interrupted" });
    expect((await repository.getJob("job"))?.status).toBe("manual_retry_required");
    expect(await store.getJson("job","game-draft.json")).toEqual({ game });
    expect(await (await call(true)).json()).toMatchObject({ outcome: "advanced" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await store.getJson<{ game: GameContent }>("job","game-draft.json"))?.game.quests[0].clue).toBe("Inspect the recorded evidence.");
  });
  it("does not resume an uncertain call without explicit retry", async () => {
    stage("generating_game"); const fetcher = vi.fn(async () => { throw new Error("connection lost"); }); vi.stubGlobal("fetch",fetcher);
    expect(await (await call()).json()).toMatchObject({ outcome: "interrupted" });
    expect((await call()).status).toBe(409); expect(fetcher).toHaveBeenCalledTimes(1);
    await call(true); await call(true); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("journals the final visual-enriched request and replays it without charging or duplicating visual usage", async () => {
    stage("verifying_quests"); await seedVisual();
    const fetcher = vi.fn(async (_url: string,init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      expect(payload.model).toBe("gpt-5.6-luna"); expect(payload.reasoning.effort).toBe("none"); expect(payload.max_output_tokens).toBe(1000);
      expect(payload.visualBudget).toBeUndefined();
      const images = payload.input[0].content.filter((c: { type: string }) => c.type === "input_image");
      expect(images.map((i: { image_url: string }) => i.image_url)).toEqual(["data:image/png;base64,0","data:image/png;base64,1"]);
      expect(payload.input[0].content.some((c: { text?: string }) => c.text?.includes("Small text is illegible"))).toBe(true);
      return reply(payload,{ accepted: true,issues: [] });
    });
    vi.stubGlobal("fetch",fetcher);
    vi.spyOn(db,"batch").mockRejectedValueOnce(new Error("publication outage"));
    expect(await (await call()).json()).toMatchObject({ outcome: "interrupted" });
    expect(await (await call(true)).json()).toMatchObject({ outcome: "advanced" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const ledger = db.database.prepare("SELECT state,visual_budget FROM book_provider_calls").all();
    expect(ledger).toHaveLength(1); expect(ledger[0].state).toBe("complete");
    expect(JSON.parse(String(ledger[0].visual_budget))).toEqual({ micros: 37,input: 100,output: 10,calls: 1 });
    expect((await store.getJson<VisualState>("job",VISUAL_STATE_PATH))?.usage.calls).toBe(5);
  });
  it("rejects changed visual pixels on replay without another provider call", async () => {
    stage("verifying_quests"); const visual = await seedVisual();
    const fetcher = vi.fn(async (_url: string,init: RequestInit) => reply(JSON.parse(String(init.body)),{ accepted: true,issues: [] })); vi.stubGlobal("fetch",fetcher);
    vi.spyOn(db,"batch").mockRejectedValueOnce(new Error("publication outage")); await call();
    visual.candidates[0].cropHashes![0] = "changed-hash";
    await store.putJson("job",VISUAL_STATE_PATH,visual,Math.floor(Date.now()/1000)+3600);
    await store.putJson("job","visual-agent/assets/v0-r0-0-crop.json",{ id: "v0-r0-0-crop",hash: "changed-hash",width: 300,height: 200,imageUrl: "data:image/png;base64,CHANGED",renderer: "fixture",rotation: 0 },Math.floor(Date.now()/1000)+3600);
    expect(await (await call(true)).json()).toMatchObject({ outcome: "interrupted" });
    expect(fetcher).toHaveBeenCalledTimes(1); expect((await repository.getJob("job"))?.batchCursor).toBe(0);
  });
  it("enforces the shared visual extraction/verification ceiling before dispatch", async () => {
    stage("verifying_quests"); await seedVisual(40); const fetcher = vi.fn(); vi.stubGlobal("fetch",fetcher);
    expect(await (await call()).json()).toMatchObject({ outcome: "interrupted" });
    expect(fetcher).not.toHaveBeenCalled(); expect(db.database.prepare("SELECT id FROM book_provider_calls").all()).toHaveLength(0);
  });
});
