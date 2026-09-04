import { it, expect } from "vitest";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import path from "node:path";
import { generateGameStage } from "../../app/lib/book-pipeline/generation-stage";
import { verifyNextQuestStage } from "../../app/lib/book-pipeline/verification-stage";
import { questVisualImages, VisualQuestProvider } from "../../app/lib/book-pipeline/visual-agent/quest-provider";
import { selectedVisuals } from "../../app/lib/book-pipeline/visual-agent/agent";
import { VISUAL_STATE_PATH, type VisualStore } from "../../app/lib/book-pipeline/visual-agent/stage";
import type { VisualState } from "../../app/lib/book-pipeline/visual-agent/schema";
import type { BookMap, QuestEvidenceContract } from "../../app/lib/book-pipeline/contracts";
import { OpenAiResponsesProvider, type StructuredOutputProvider, type StructuredResponse } from "../../app/lib/book-pipeline/providers/openai";
import { isGamePackage, type GameContent } from "../../app/game-package";

// A paid integration test, never part of the default unit-test run. It starts
// from existing extraction artifacts, not a fresh upload or production OCR.
it.skipIf(process.env.RUN_LUNA_SOL_TEST !== "1")("tests cached Luna visuals -> Sol RPG -> actual Luna verification", async () => {
  const root = process.cwd();
  const out = path.join(root, "outputs/luna-sol-e2e-v2");
  await mkdir(path.join(out, "calls"), { recursive: true });
  const read = async <T,>(relative: string): Promise<T | null> => {
    try { return JSON.parse(await readFile(path.join(out, relative), "utf8")) as T; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  };
  const write = async (relative: string, value: unknown) => {
    const file = path.join(out, relative); await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2));
  };
  const versions = new Map<string, number>();
  const store: VisualStore = {
    getJson: async <T,>(_job: string, p: string) => read<T>(`artifacts/${p}`),
    putJson: async (_job, p, v) => { await write(`artifacts/${p}`, v); versions.set(p, (versions.get(p) ?? 0) + 1); },
    putJsonIfAbsent: async (_job, p, v) => {
      const file = path.join(out, "artifacts", p); await mkdir(path.dirname(file), { recursive: true });
      try { await writeFile(file, JSON.stringify(v), { flag: "wx" }); versions.set(p, 1); return true; }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return false; throw e; }
    },
    getJsonVersion: async <T,>(_job: string, p: string) => { const value = await read<T>(`artifacts/${p}`); return value ? { value, etag: String(versions.get(p) ?? 1) } : null; },
    putJsonVersion: async (job, p, v, etag, expiry) => { if (String(versions.get(p) ?? 1) !== etag) return false; await store.putJson(job, p, v, expiry); return true; },
  };
  const job = { id: "private-luna-sol-test", identityHash: "private-luna-sol-test", originalFilename: "691f9193faa81670cd1a6f07d497bf8d.pdf", expiresAt: Math.floor(Date.now() / 1000) + 86400, batchCursor: 0 };
  const original: VisualState = JSON.parse(await readFile(path.join(root, "outputs/luna-visual-agent-v1/state.json"), "utf8"));
  expect(original.phase).toBe("done");
  expect(createHash("sha256").update(await readFile(path.join(root, job.originalFilename))).digest("hex")).toBe(original.sourceFingerprint);
  await store.putJsonIfAbsent(job.id, VISUAL_STATE_PATH, original, job.expiresAt);
  const selected = selectedVisuals(original);
  expect(selected).toHaveLength(4);
  const contracts: QuestEvidenceContract[] = [];
  for (const c of selected) {
    const page = c.pageIndex + 1;
    const text = JSON.parse(await readFile(path.join(root, `outputs/luna-benchmark/page-${page}.transcription.json`), "utf8"));
    const blocks = [text.main_text, text.figure_text].flatMap((t: string) => t.match(/[\s\S]{1,1100}/g) ?? []);
    const sources = c.evidenceIds.map((id) => {
      const index = Number(id.split("-b")[1]); expect(blocks[index]).toBeTruthy();
      return { pageStart: c.pageIndex, pageEnd: c.pageIndex, canonicalBlockIds: [id], boundedExcerpt: blocks[index].slice(0, 480) };
    });
    const claims = c.verdict!.claims.filter((x) => x.kind === "visible" || x.kind === "source_supported").map((x) => x.claim).join(" ");
    contracts.push({ id: `contract-${c.id}`, conceptId: c.id, centralClaim: claims, playerActions: ["inspect", "compare", "diagnose", "repair"], sources, confidence: 0.7, missingEvidence: [],
      visualAnnotations: [{ visualReferenceId: c.id, description: claims, source: { pageStart: c.pageIndex, pageEnd: c.pageIndex, canonicalBlockIds: c.evidenceIds },
        visualAgent: { candidateId: c.id, revision: c.revision, disposition: c.verdict!.disposition, limitations: c.review!.limitations } }] });
    for (let i = 0; i < c.boxes.length; i++) {
      const id = `${c.id}-r${c.revision}-${i}-crop`;
      const png = await readFile(path.join(root, `outputs/luna-visual-agent-v1/assets/${id}.png`));
      const hash = createHash("sha256").update(png).digest("hex"); expect(hash).toBe(c.cropHashes![i]);
      await store.putJsonIfAbsent(job.id, `visual-agent/assets/${id}.json`, { id, hash, width: png.readUInt32BE(16), height: png.readUInt32BE(20), rotation: 0, renderer: "poppler-local", imageUrl: `data:image/png;base64,${png.toString("base64")}` }, job.expiresAt);
    }
  }
  const map: BookMap = { schemaVersion: 1, bookTitle: "Making and Breaking the Grid — six-page sample", thesis: "Apply supported visual organization principles in original design situations.", learningArc: selected.map((c) => c.concept), chapters: [],
    concepts: selected.map((c, i) => ({ id: c.id, name: c.concept, summary: contracts[i].centralClaim!, evidenceCardIds: [], prerequisiteConceptIds: [], relatedConceptIds: [], score: 0.8, confidence: 0.7 })),
    contradictions: [], visualOpportunities: selected.map((c) => c.concept), omissions: ["Private integration fixture built from four verified visual candidates; not the full-book map or retrieval stage."], proposedQuestConceptIds: selected.map((c) => c.id) };
  await write("contracts.json", contracts); await write("book-map.json", map);
  const env = parseEnv(await readFile(path.join(root, ".env.local"), "utf8"));
  if (!env.OPENAI_API_KEY) throw new Error("Local OpenAI key missing");
  const api = new OpenAiResponsesProvider(env.OPENAI_API_KEY);
  const provider: StructuredOutputProvider = { async generateStructured<T>(request: Parameters<StructuredOutputProvider["generateStructured"]>[0]): Promise<StructuredResponse<T>> {
    const effective = { ...request, maxOutputTokens: request.maxOutputTokens ?? 16000 };
    const hash = createHash("sha256").update(JSON.stringify(effective)).digest("hex");
    const saved = await read<StructuredResponse<T>>(`calls/${hash}.json`); if (saved) return saved;
    const files = (await readdir(path.join(out, "calls"))).filter((p) => p.endsWith(".attempt.json"));
    let spent = 0;
    for (const f of files) {
      const attempt = await read<{ reservedMicros: number; model: string }>(`calls/${f}`);
      const result = await read<StructuredResponse<unknown>>(`calls/${f.replace(".attempt.json", ".json")}`);
      const inputPrice = attempt!.model === "gpt-5.6-sol" ? 5 : 0.25;
      const outputPrice = attempt!.model === "gpt-5.6-sol" ? 20 : 1.2;
      spent += result ? Math.ceil(result.usage.inputTokens * inputPrice + result.usage.outputTokens * outputPrice) : attempt!.reservedMicros;
    }
    const sol = effective.model === "gpt-5.6-sol";
    if (!sol && effective.model !== "gpt-5.6-luna") throw new Error("Unexpected paid model");
    const bound = Buffer.byteLength(effective.instructions + effective.input + JSON.stringify(effective.schema) + (effective.images ?? []).map((i) => i.label).join(" ")) + (effective.images?.length ?? 0) * 10000 + 1000;
    const reservedMicros = Math.ceil(bound * (sol ? 5 : 0.25) + effective.maxOutputTokens * (sol ? 20 : 1.2));
    if (bound > 120000 || files.length >= 14 || spent + reservedMicros > 5000000) throw new Error("Local test $5 admission ceiling exceeded");
    await writeFile(path.join(out, `calls/${hash}.attempt.json`), JSON.stringify({ model: effective.model, schema: effective.schemaName, reservedMicros, at: new Date().toISOString() }), { flag: "wx" });
    console.log(`Calling ${effective.model} ${effective.schemaName}; reserved upper estimate $${(reservedMicros / 1000000).toFixed(3)}`);
    try {
      const result = await api.generateStructured<T>(effective);
      await write(`calls/${hash}.json`, result);
      console.log(`Completed ${effective.schemaName}: input=${result.usage.inputTokens}, output=${result.usage.outputTokens}`);
      return result;
    } catch (e) { await write(`calls/${hash}.error.json`, { message: e instanceof Error ? e.message : "Unknown error" }); throw e; }
  } };
  const repository = { commitStage: async () => true, markRecoverable: async (...args: unknown[]) => { await write("interruption.json", args); return true; }, markTerminal: async (...args: unknown[]) => { await write("terminal.json", args); return true; }, appendOpenAiRequestId: async () => true, reserveProviderCost: async () => true, reconcileProviderCost: async () => true };
  let draft = await store.getJson<{ game: GameContent }>(job.id, "game-draft.json");
  if (!draft) {
    const generated = await generateGameStage({ job, bookMap: map, contracts, images: await questVisualImages(store, job.id, contracts), provider, repository, store, config: { model: "gpt-5.6-sol", reasoningEffort: "high" }, now: Math.floor(Date.now() / 1000) });
    expect(generated.outcome, "Inspect saved responses/interruption; do not silently repeat the call").toBe("complete");
  }
  const verifier = new VisualQuestProvider(provider, store, job, { model: "gpt-5.6-luna", plannedQuests: 0, maxMicros: 150000, inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 });
  const outcomes: Array<{ quest: number; outcome: string }> = [];
  for (let i = 0; i < contracts.length; i++) {
    if (await store.getJson(job.id, `verification/${i}.json`)) { outcomes.push({ quest: i + 1, outcome: "previously_verified" }); continue; }
    draft = await store.getJson<{ game: GameContent }>(job.id, "game-draft.json");
    const result = await verifyNextQuestStage({ job: { ...job, batchCursor: i }, game: draft!.game, contracts, provider: verifier, repository, store,
      config: { model: "gpt-5.6-luna", reasoningEffort: "none", maxRepairAttempts: 2 }, now: Math.floor(Date.now() / 1000) });
    outcomes.push({ quest: i + 1, outcome: result.outcome });
    // Match the production cursor: never advance past a failed quest.
    if (!["advanced", "complete"].includes(result.outcome)) break;
  }
  await write("quest-outcomes.json", outcomes);
  expect(outcomes.every((x) => ["advanced", "complete", "previously_verified"].includes(x.outcome)), "One or more quests failed; no verified fixture exported").toBe(true);
  const game = await store.getJson(job.id, "game.json"); expect(isGamePackage(game)).toBe(true);
  await write("game.json", game);
  expect(JSON.stringify(game)).not.toMatch(/data:image|image_url|OPENAI_API_KEY|base64/);
  console.log("Verified game package saved privately to outputs/luna-sol-e2e-v2/game.json");
}, 900000);
