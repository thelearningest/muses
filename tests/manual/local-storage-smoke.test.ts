import { it, expect } from "vitest";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createHmac, randomUUID, randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import path from "node:path";
import type { CanonicalBook, EvidenceCard } from "../../app/lib/book-pipeline/contracts";
import type { GameContent, Quest } from "../../app/game-package";
import { isGamePackage } from "../../app/game-package";

// Runs against the already-running localhost website and its real Miniflare
// D1/R2 bindings. Synthetic setup deliberately skips paid stages. This proves
// storage/route integration, NOT PDF ingestion, extraction or game quality.
it.skipIf(process.env.RUN_LOCAL_STORAGE_SMOKE !== "1")("publishes and retrieves immutable artifacts through real local D1/R2, then removes the temporary job", async () => {
  const production = process.env.LOCAL_STORAGE_SMOKE_TARGET === "production";
  const origin = production ? "http://localhost:3003" : "http://localhost:3000";
  const persistRoot = path.resolve(production ? ".wrangler/production-smoke" : ".wrangler/state");
  const configPath = path.resolve(production ? "dist/server/wrangler.json" : ".wrangler/book-local.json");
  expect((await fetch(origin)).status).toBe(200);
  const env = production ? { BOOK_CAPABILITY_HMAC_KEY: "local-integration-only-capability-key-20260904" }
    : { ...parseEnv(await readFile(".env","utf8")), ...parseEnv(await readFile(".env.local","utf8")) };
  if (!env.BOOK_CAPABILITY_HMAC_KEY) throw new Error("Local capability configuration missing");
  const jobId = `storage-smoke-${randomUUID()}`;
  const token = randomBytes(32).toString("base64url");
  const capabilityHash = createHmac("sha256",env.BOOK_CAPABILITY_HMAC_KEY).update(token).digest("base64url");
  const root = path.resolve("outputs/local-storage-smoke",jobId); await mkdir(root,{ recursive: true });
  const now = Math.floor(Date.now()/1000), expires = now+900;
  const cli = (...args: string[]) => execFileSync(process.execPath,["node_modules/wrangler/bin/wrangler.js",...args,"--local","--persist-to",persistRoot,"--config",configPath],{ encoding: "utf8",windowsHide: true,timeout: 60000 });
  async function sql(query: string) { const file = path.join(root,`${randomUUID()}.sql`); await writeFile(file,query,{ flag: "wx" }); cli("d1","execute","site-creator-d1","--file",file); }
  async function put(relative: string,value: unknown) { const file = path.join(root,`${randomUUID()}.json`); await writeFile(file,JSON.stringify(value),{ flag: "wx" }); cli("r2","object","put",`site-creator-r2/book-jobs/${jobId}/${relative}`,"--file",file,"--content-type","application/json"); }
  const request = (suffix = "",method = "GET") => fetch(`${origin}/api/book-jobs/${jobId}${suffix}`,{ method,headers: { origin,authorization: `Bearer ${token}`,"content-type": "application/json" },...(method === "POST" ? { body: "{}" } : {}) });
  const databaseDir = path.join(persistRoot,"v3/d1/miniflare-D1DatabaseObject");
  const filename = (await readdir(databaseDir)).find((p) => /^[a-f0-9]{64}\.sqlite$/.test(p));
  if (!filename) throw new Error("Local D1 database missing");
  const inspect = <T,>(query: string): T[] => { const db = new DatabaseSync(path.join(databaseDir,filename),{ readOnly: true }); try { return db.prepare(query).all(jobId) as T[]; } finally { db.close(); } };
  const cards: EvidenceCard[] = [0,1,2,3].map((i) => ({ id: `card${i}`,sectionId: "section-1",concept: `Observe ${i}`,supportedClaim: `Record evidence ${i} before deciding.`,sources: [{ pageStart: i,pageEnd: i,canonicalBlockIds: [`b${i}`],boundedExcerpt: `Record evidence ${i} before deciding.` }],playerVerbs: ["observe"],applicableProcess: ["record"],successfulExamples: ["record first"],failureModes: ["guess"],misconceptions: [],prerequisites: [],causalLinks: [],tradeoffs: [],visualReferenceIds: [],importanceSignals: [],confidence: 0.9,uncertainty: [],contradictions: [] }));
  const book: CanonicalBook = { schemaVersion: 1,source: { fingerprint: "synthetic-smoke-only",filename: "synthetic-smoke.pdf",pageCount: 4 },pages: [0,1,2,3].map((index) => ({ index,blockIds: [`b${index}`],visualReferences: [],warnings: [] })),blocks: cards.map((c,i) => ({ id: `b${i}`,pageIndex: i,type: "paragraph",readingOrder: i,text: c.supportedClaim,ancestorHeadings: [],visualReferenceIds: [] })),warnings: ["Synthetic local storage smoke; not the user's book."] };
  const quests: Quest[] = [0,1,2,3].map((i) => {
    const choices = ["a","b","c"].map((id,n) => ({ id,label: `${id} option ${i}`,feedback: n ? "Contradicts evidence." : "Uses evidence.",correct: n === 0 }));
    return { id: `q${i}`,number: String(i+1),title: `Trial ${i}`,gallery: `Lab ${i}`,story: `Situation ${i}.`,objective: `Apply ${i}.`,clue: `Inspect ${i}.`,artifact: "console",xp: 100,observationTools: [`meter ${i}`,`log ${i}`,`map ${i}`],diagnosis: choices,repairs: choices,principle: { name: `Concept ${i}`,summary: `Claim ${i}` },visual: { mode: i ? "diagram" : "3d",form: "console",accent: "green",title: `Console ${i}`,problemLabel: `Fault ${i}`,repairLabel: `Fix ${i}`,elements: [`sensor ${i}`,`signal ${i}`,`switch ${i}`] },sourceAnchors: [{ label: `Page ${i+1}`,pageStart: i+1,pageEnd: i+1 }] };
  });
  const game: GameContent = { sourceTitle: "Synthetic storage test",title: "Storage smoke",subtitle: "Not a generated book adaptation",setting: "Test lab",quests };
  let seeded = false;
  const results: Record<string,unknown> = { jobId,synthetic: true,productionWorker: production,providerCalls: 0,startedAt: new Date().toISOString() };
  try {
    await sql(`INSERT INTO book_jobs (id,capability_hash,identity_hash,network_hash,source_fingerprint,original_filename,mime_type,byte_size,status,current_stage,batch_cursor,created_at,updated_at,expires_at) VALUES ('${jobId}','${capabilityHash}','synthetic-smoke','synthetic-smoke','synthetic-smoke-only','synthetic-smoke.pdf','application/pdf',100,'building_book_map','building_book_map',1,${now},${now},${expires});`); seeded = true;
    await put("ingestion.json",{ provider: "luna" }); await put("canonical-book.json",book); await put("evidence/0.json",{ cards });
    const built = await request("/advance","POST"); expect(built.status).toBe(200); expect(await built.json()).toMatchObject({ outcome: "complete",conceptCount: 4 });
    const refs = inspect<{ logical_path: string; result_path: string }>("SELECT logical_path,result_path FROM book_artifact_refs WHERE job_id=?"); expect(refs).toHaveLength(2);
    for (const ref of refs) {
      const target = path.join(root,ref.logical_path);
      cli("r2","object","get",`site-creator-r2/book-jobs/${jobId}/${ref.result_path}`,"--file",target);
      const content = JSON.parse(await readFile(target,"utf8"));
      if (ref.logical_path === "book-map.json") expect(content.proposedQuestConceptIds).toHaveLength(4);
      else expect(content).toEqual({ batchCount: 1 });
    }
    results.bookMapReferences = refs.length;
    // Test only final publication/retrieval. Do not claim this synthetic job's
    // quests passed model verification: setup jumps past those paid steps.
    await put("game-draft.json",{ game }); await put("quest-evidence.json",{ contracts: [] });
    await sql(`UPDATE book_jobs SET status='verifying_quests',current_stage='verifying_quests',batch_cursor=4 WHERE id='${jobId}' AND status='annotating_visuals';`);
    expect(inspect<{ batch_cursor: number }>("SELECT batch_cursor FROM book_jobs WHERE id=?")[0].batch_cursor).toBe(4);
    const finished = await request("/advance","POST"); expect(finished.status).toBe(200); expect(await finished.json()).toMatchObject({ outcome: "complete" });
    const response = await request(); expect(response.status).toBe(200); const status = await response.json();
    expect(status.stage).toBe("ready"); expect(isGamePackage(status.game)).toBe(true); expect(status.game.title).toBe(game.title);
    results.finalGameRetrieved = true;
    expect(inspect("SELECT id FROM book_provider_calls WHERE job_id=?")).toHaveLength(0);
    expect((await request("/acknowledge","POST")).status).toBe(204);
    for (const table of ["book_artifact_refs","book_provider_calls","book_stage_runs"]) expect(inspect(`SELECT id FROM ${table} WHERE job_id=?`)).toHaveLength(0);
    const r2Dir = path.join(persistRoot,"v3/r2/miniflare-R2BucketObject");
    for (const file of (await readdir(r2Dir)).filter((p) => /^[a-f0-9]+\.sqlite$/.test(p))) {
      const db = new DatabaseSync(path.join(r2Dir,file),{ readOnly: true });
      try { expect(db.prepare("SELECT key FROM _mf_objects WHERE key LIKE ?").all(`book-jobs/${jobId}/%`)).toHaveLength(0); } finally { db.close(); }
    }
    results.temporaryArtifactsRemoved = true;
    await writeFile(path.join(root,"result.json"),JSON.stringify(results,null,2));
  } finally {
    if (seeded && !results.temporaryArtifactsRemoved) {
      const cleanup = await request("","DELETE");
      await writeFile(path.join(root,"cleanup.json"),JSON.stringify({ jobId,status: cleanup.status }));
    }
  }
}, 240000);
