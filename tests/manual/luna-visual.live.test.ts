import { it, expect } from "vitest";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import path from "node:path";
import { advanceVisualAgent, selectedVisuals, type AgentCall } from "../../app/lib/book-pipeline/visual-agent/agent";
import { initialVisualState } from "../../app/lib/book-pipeline/visual-agent/policy";
import type { RenderRequest, VisualState } from "../../app/lib/book-pipeline/visual-agent/schema";
import { OpenAiResponsesProvider, type StructuredResponse } from "../../app/lib/book-pipeline/providers/openai";
import type { CanonicalBook } from "../../app/lib/book-pipeline/contracts";

const enabled = process.env.RUN_LUNA_VISUAL_BENCHMARK === "1";
it.skipIf(!enabled)("runs the six-page private Luna visual benchmark (paid, opt-in)", async () => {
  const root = process.cwd();
  const output = path.join(root, "outputs/luna-visual-agent-v1");
  const source = path.join(root, "691f9193faa81670cd1a6f07d497bf8d.pdf");
  const pages = [12,20,32,50,80,96];
  await mkdir(path.join(output, "assets"), { recursive: true });
  const fingerprint = createHash("sha256").update(await readFile(source)).digest("hex");
  const book: CanonicalBook = { schemaVersion: 1, source: { fingerprint, filename: path.basename(source), pageCount: 109 }, pages: [], blocks: [], warnings: ["Six-page sample; OCR folios and caption attribution are untrusted."] };
  for (const page of pages) {
    const extracted = JSON.parse(await readFile(path.join(root, `outputs/luna-benchmark/page-${page}.transcription.json`), "utf8"));
    const texts = [extracted.main_text, extracted.figure_text].flatMap((t: string) => t.match(/[\s\S]{1,1100}/g) ?? []);
    book.pages.push({ index: page - 1, blockIds: texts.map((_, i) => `p${page}-b${i}`), visualReferences: [], warnings: [] });
    texts.forEach((text, i) => book.blocks.push({ id: `p${page}-b${i}`, pageIndex: page - 1, readingOrder: i, type: "paragraph", text, ancestorHeadings: [], visualReferenceIds: [] }));
  }
  const env = parseEnv(await readFile(path.join(root, ".env.local"), "utf8"));
  if (!env.OPENAI_API_KEY) throw new Error("Local OpenAI key is missing");
  const provider = new OpenAiResponsesProvider(env.OPENAI_API_KEY);
  const config = { model: "gpt-5.6-luna", inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, maxMicros: 150000, plannedQuests: 0 };
  let state: VisualState = initialVisualState(book, [], 6);
  try { state = JSON.parse(await readFile(path.join(output, "state.json"), "utf8")); } catch { /* fresh explicit benchmark */ }
  if (process.env.RESUME_LUNA_VISUAL_BUDGET_STOP === "1" && state.phase === "done" && state.stopReason === "budget_exhausted") {
    await writeFile(path.join(output, "first-budget-stop.json"), JSON.stringify(state, null, 2), { flag: "wx" });
    const last = state.candidates.at(-1);
    state.phase = last && !last.verdict ? (last.review ? "verify" : "review") : state.queue.length ? "crop" : "select";
    state.stopReason = null; state.selectedIds = [];
  }
  async function asset(request: RenderRequest) {
    const file = path.join(output, "assets", `${request.id}.png`);
    let bytes: Buffer;
    try { bytes = await readFile(file); }
    catch {
      const original = await readFile(path.join(root, `outputs/luna-benchmark/pages/page-${request.pageIndex + 1}.png`));
      const fullWidth = original.readUInt32BE(16), fullHeight = original.readUInt32BE(20);
      let scale = request.kind === "thumbnail" ? 512 / Math.max(fullWidth, fullHeight) : 2048 / Math.max(fullWidth, fullHeight);
      if (request.kind === "preview" && request.box) scale = Math.min(360 / (fullWidth * request.box.width), 240 / (fullHeight * request.box.height));
      for (let attempt = 0; attempt < 5; attempt++) {
        const edge = Math.max(64, Math.floor(Math.max(fullWidth, fullHeight) * scale));
        const args = ["-f", String(request.pageIndex + 1), "-l", String(request.pageIndex + 1), "-singlefile", "-png", "-scale-to", String(edge)];
        if (request.box) {
          const width = fullWidth * edge / Math.max(fullWidth, fullHeight), height = fullHeight * edge / Math.max(fullWidth, fullHeight);
          args.push("-x", String(Math.floor(request.box.x * width)), "-y", String(Math.floor(request.box.y * height)), "-W", String(Math.max(1, Math.floor(request.box.width * width))), "-H", String(Math.max(1, Math.floor(request.box.height * height))));
        }
        execFileSync("pdftoppm", [...args, source, file.slice(0,-4)], { windowsHide: true, timeout: 60000, stdio: "pipe" });
        bytes = await readFile(file);
        if (bytes.length <= 1024 * 1024) break;
        scale *= 0.75;
      }
      bytes = await readFile(file);
    }
    return { id: request.id, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), hash: createHash("sha256").update(bytes).digest("hex"), imageUrl: `data:image/png;base64,${bytes.toString("base64")}`, rotation: 0, renderer: "poppler-local-2048" };
  }
  const started = Date.now();
  for (let i = 0; i < 50 && state.phase !== "done"; i++) {
    const result = await advanceVisualAgent({ state, book, config, safetyIdentifier: "private-visual-agent-evaluation", ports: { asset, call: async (step: number, request: AgentCall, reservedMicros: number) => {
      const file = path.join(output, `call-${step}.json`);
      try { return JSON.parse(await readFile(file, "utf8")) as StructuredResponse<unknown>; } catch { /* no completed response */ }
      const attemptFile = path.join(output, `call-${step}.attempt.json`);
      try { await access(attemptFile); throw new Error("An earlier call has an indeterminate result; do not retry automatically"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await writeFile(attemptFile, JSON.stringify({ step, schema: request.schemaName, reservedMicros, startedAt: new Date().toISOString() }), { flag: "wx" });
      const response = await provider.generateStructured(request);
      await writeFile(file, JSON.stringify(response, null, 2));
      console.log(`Completed ${request.schemaName}: input=${response.usage.inputTokens}, output=${response.usage.outputTokens}`);
      return response;
    } } });
    state = result.state;
    await writeFile(path.join(output, "state.json"), JSON.stringify(state, null, 2));
  }
  await writeFile(path.join(output, "report.json"), JSON.stringify({ samplePdfPages: pages, lastSessionSeconds: (Date.now() - started) / 1000, selected: selectedVisuals(state), usage: state.usage, estimatedUsdUpperBound: state.usage.estimatedMicros / 1000000, stopReason: state.stopReason, note: "Automated private six-page sample; not whole-book coverage, not an RPG-generation test. USD estimate conservatively bills all input at the cache-write rate." }, null, 2));
  expect(state.phase).toBe("done");
  console.log(`Visual benchmark selected ${state.selectedIds.length}; estimated upper spend $${(state.usage.estimatedMicros / 1000000).toFixed(4)}`);
}, 900000);
