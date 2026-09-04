import { it, expect } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { advanceExtraction, initialExtractionState, EXTRACTION_STATE_PATH, type ExtractionAsset, type ExtractionState } from "../../app/lib/book-pipeline/extraction/stage";
import type { PageRecord } from "../../app/lib/book-pipeline/extraction/page-extraction";
import type { VisualStore } from "../../app/lib/book-pipeline/visual-agent/stage";
import { OpenAiResponsesProvider } from "../../app/lib/book-pipeline/providers/openai";

// Single-process paid regression using production orchestration, existing exact
// page-6 tiles and persistent attempts. Never exports a synthetic full book.
it.skipIf(process.env.RUN_SELECTIVE_EXTRACTION_TEST !== "1")("extracts the failed contents page through the selective production policy", async () => {
  const root = "outputs/selective-extraction-v2";
  const read = async <T,>(p: string): Promise<T | null> => {
    try { return JSON.parse(await readFile(path.join(root, p), "utf8")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  };
  const versions = new Map<string, number>();
  const store: VisualStore = {
    getJson: async <T,>(_id: string, p: string) => read<T>(p),
    putJson: async (_id, p, value) => { const file = path.join(root, p); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2)); versions.set(p, (versions.get(p) ?? 1) + 1); },
    putJsonIfAbsent: async (_id, p, value) => {
      const file = path.join(root, p); await mkdir(path.dirname(file), { recursive: true });
      try { await writeFile(file, JSON.stringify(value), { flag: "wx" }); versions.set(p, 1); return true; }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return false; throw e; }
    },
    getJsonVersion: async <T,>(_id: string, p: string) => { const value = await read<T>(p); return value ? { value, etag: String(versions.get(p) ?? 1) } : null; },
    putJsonVersion: async (id, p, value, etag, expiry) => { if (String(versions.get(p) ?? 1) !== etag) return false; await store.putJson(id, p, value, expiry); return true; },
  };
  const now = Math.floor(Date.now() / 1000);
  const job = { id: "selective-page-six-test", identityHash: "private-selective-page-test", originalFilename: "source.pdf", expiresAt: now + 3600 };
  const state = initialExtractionState("page-six-diagnostic-only", 6, { maxMicros: 500000, inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 });
  state.cursor = 5; state.revision = 2; state.completed = Array.from({ length: 5 }, (_, i) => `not-evaluated/${i}`);
  await store.putJsonIfAbsent(job.id, EXTRACTION_STATE_PATH, state, job.expiresAt);
  const asset: ExtractionAsset = JSON.parse(await readFile("outputs/full-book-local/c7f9488e-16d6-4386-b859-6b209b9b56c1/extraction/assets/5-2.json", "utf8"));
  await store.putJsonIfAbsent(job.id, "extraction/assets/5-2.json", asset, job.expiresAt);
  const env = parseEnv(await readFile(".env.local", "utf8"));
  if (!env.OPENAI_API_KEY) throw new Error("Local OpenAI key missing");
  if ((await read<ExtractionState>(EXTRACTION_STATE_PATH))?.cursor === 5) {
    expect(await advanceExtraction({ job, store, now, provider: new OpenAiResponsesProvider(env.OPENAI_API_KEY), isActive: async () => true })).toMatchObject({ outcome: "advanced", completedPages: 6 });
  }
  const record = await read<PageRecord>("extraction/pages/5-2-0.json");
  expect(record?.method).toBe("sol"); expect(record?.page.quality).toBe("readable");
  expect(record?.page.blocks.every((b) => b.box === null)).toBe(true);
  // Source-inspected assertion, never supplied in the extraction prompt.
  expect(record?.page.blocks.map((b) => b.text).join("\n")).toContain("Nonstructural Design Approaches");
  console.log(JSON.stringify({ quality: record?.page.quality, model: record?.model, usage: (await read<ExtractionState>(EXTRACTION_STATE_PATH))?.usage }));
}, 110000);
