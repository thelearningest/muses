import { it, expect } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import path from "node:path";
import { generateGameStage } from "../../app/lib/book-pipeline/generation-stage";
import { verifyNextQuestStage } from "../../app/lib/book-pipeline/verification-stage";
import { VisualQuestProvider, questVisualImages } from "../../app/lib/book-pipeline/visual-agent/quest-provider";
import { generatePracticeImage, practiceImageRequest } from "../../app/lib/book-pipeline/visual-agent/practice-image";
import { OpenAiResponsesProvider, type StructuredOutputProvider } from "../../app/lib/book-pipeline/providers/openai";
import type { VisualStore } from "../../app/lib/book-pipeline/visual-agent/stage";
import type { BookMap, QuestEvidenceContract } from "../../app/lib/book-pipeline/contracts";
import { hasPlayableVisuals, isGamePackage, type GameContent, type GamePackage } from "../../app/game-package";

// Paid, opt-in only. Reuses the user's private extraction; no repeat OCR.
it.skipIf(process.env.RUN_VISUAL_FIRST !== "1")("creates a practice image and verifies three different book-image quests", async () => {
  const out = path.resolve("outputs/visual-first-v1");
  const prior = path.resolve("outputs/luna-sol-e2e-v2");
  const read = async <T,>(file: string): Promise<T | null> => {
    try { return JSON.parse(await readFile(file, "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  };
  const write = async (file: string, data: unknown) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); };
  const store: VisualStore = {
    getJson: async <T,>(_job: string, p: string) => (await read<T>(path.join(out, "artifacts", p))) ?? read<T>(path.join(prior, "artifacts", p)),
    putJson: async (_job, p, value) => write(path.join(out, "artifacts", p), value),
    putJsonIfAbsent: async (_job, p, value) => { const file = path.join(out, "artifacts", p); if (await read(file)) return false; await write(file, value); return true; },
    getJsonVersion: async () => { throw new Error("Use durable verification"); },
    putJsonVersion: async () => { throw new Error("Use durable verification"); },
  };
  let newCalls = 0;
  async function cached<T>(request: unknown, send: () => Promise<T>): Promise<T> {
    const hash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const file = path.join(out, "calls", `${hash}.json`);
    const previous = await read<T>(file); if (previous) return previous;
    if (++newCalls > 12) throw new Error("Bounded paid test exhausted");
    await mkdir(path.dirname(file), { recursive: true });
    // Never silently repeat a request whose outcome is unknown.
    try { await writeFile(`${file}.attempt`, "started", { flag: "wx" }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST" || process.env.CONFIRM_VISUAL_RETRY !== "1") throw e;
      await writeFile(`${file}.retry-attempt`, "explicit bounded retry", { flag: "wx" });
    }
    try { const result = await send(); await write(file, result); return result; }
    catch (e) { await write(`${file}.error`, { message: e instanceof Error ? e.message : "Unknown provider error" }); throw e; }
  }
  const env = parseEnv(await readFile(".env.local", "utf8"));
  if (!env.OPENAI_API_KEY) throw new Error("OpenAI key missing");
  const api = new OpenAiResponsesProvider(env.OPENAI_API_KEY);
  const provider: StructuredOutputProvider = {
    partition: () => provider,
    generateStructured: <T,>(request: Parameters<StructuredOutputProvider["generateStructured"]>[0]) => cached(request, async () => {
      console.log(`Calling ${request.model}: ${request.schemaName}`);
      const result = await api.generateStructured<T>(request);
      console.log(`Finished ${request.schemaName}: ${result.usage.totalTokens} tokens`);
      return result;
    }),
  };
  const originals = (await read<QuestEvidenceContract[]>(path.join(prior, "contracts.json")))!;
  const source = originals[1];
  const generated = { ...originals[0], id: "contract-practice-modular", conceptId: "practice-modular", centralClaim: "A modular grid organizes varied content through repeated alignment and shared units.", visualAnnotations: [] };
  const contracts = [source, originals[2], originals[3]];
  const request = practiceImageRequest(generated);
  console.log("Preparing one original image; reuse saved result if available");
  const practice = await cached({ kind: "image", request }, () => generatePracticeImage(env.OPENAI_API_KEY!, request));
  const job = { id: "private-visual-first", identityHash: "private-visual-first", originalFilename: "691f9193faa81670cd1a6f07d497bf8d.pdf", expiresAt: Math.floor(Date.now() / 1000) + 86400, batchCursor: 0 };
  await store.putJson(job.id, `practice-images/${generated.id}.json`, practice, job.expiresAt);
  await writeFile(path.join(out, "practice.jpg"), Buffer.from(practice.imageUrl.split(",")[1], "base64"));
  const bookMap: BookMap = { schemaVersion: 1, bookTitle: "Making and Breaking the Grid", thesis: "Practice visual composition", learningArc: ["Diagonal composition", "Modular alignment"], chapters: [], concepts: contracts.map((c, i) => ({ id: c.conceptId, name: i ? "Modular alignment" : "Diagonal composition", summary: c.centralClaim!, evidenceCardIds: [], prerequisiteConceptIds: [], relatedConceptIds: [], score: 0.8, confidence: 0.8 })), contradictions: [], visualOpportunities: [], omissions: [], proposedQuestConceptIds: contracts.map((c) => c.conceptId) };
  const repository = { commitStage: async () => true, markRecoverable: async (...args: unknown[]) => { await write(path.join(out, "interrupted.json"), args); return true; }, markTerminal: async (...args: unknown[]) => { await write(path.join(out, "terminal.json"), args); return true; }, appendOpenAiRequestId: async () => true };
  const questImages = await Promise.all(contracts.map((contract) => questVisualImages(store, job.id, [contract])));
  const result = await generateGameStage({ job, bookMap, contracts, questImages, provider, repository, store, config: { model: "gpt-5.6-sol", reasoningEffort: "low", parallel: true }, now: Math.floor(Date.now() / 1000) });
  expect(result.outcome).toBe("complete");
  const draft = (await store.getJson<{ game: GameContent }>(job.id, "game-draft.json"))!;
  const verification = await verifyNextQuestStage({ job, game: draft.game, contracts, repository, store,
    provider: new VisualQuestProvider(provider, store, job, { model: "gpt-5.6-sol", plannedQuests: 0, maxMicros: 2_000_000, inputUsdPerMillion: 5, outputUsdPerMillion: 20 }, true),
    config: { model: "gpt-5.6-luna", reasoningEffort: "none", maxRepairAttempts: 1, parallel: true }, now: Math.floor(Date.now() / 1000) });
  expect(verification.outcome).toBe("complete");
  const game = (await store.getJson<GamePackage>(job.id, "game.json"))!;
  expect(isGamePackage(game)).toBe(true); expect(hasPlayableVisuals(game)).toBe(true);
  expect(game.quests).toHaveLength(3);
  expect(new Set(game.quests.map((quest) => quest.visual!.sourceImages![0].imageUrl)).size).toBe(3);
  await write(path.join(out, "game.json"), game);
  await write(path.join(out, "summary.json"), { quests: game.quests.length, newCalls, visuals: game.quests.map((q) => ({ title: q.title, images: q.visual!.sourceImages!.map((i) => i.label) })) });
  console.log(`Saved ${game.quests.length} verified visual quests privately.`);
}, 600_000);
