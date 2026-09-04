import { it, expect } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { OpenAiResponsesProvider } from "../../app/lib/book-pipeline/providers/openai";
import { advanceExtraction, EXTRACTION_STATE_PATH, initialExtractionState, type ExtractionAsset, type ExtractionState } from "../../app/lib/book-pipeline/extraction/stage";
import type { PageRecord } from "../../app/lib/book-pipeline/extraction/page-extraction";
import { extractionRenderRequests } from "../../app/lib/book-pipeline/extraction/policy";
import { validateVisualAsset } from "../../app/lib/book-pipeline/visual-agent/assets";
import type { VisualStore } from "../../app/lib/book-pipeline/visual-agent/stage";

const root = "outputs/extraction-v3-browser";
const read = async <T,>(file: string): Promise<T | null> => {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
};

// Private diagnostic with the production orchestration/provider and genuine
// browser packets. Synthetic preceding cursors never export a canonical book.
// No implicit unknown-outcome retries; each page has a $0.60 admission ceiling.
it.skipIf(process.env.RUN_AUXILIARY_EXTRACTION_TEST !== "1")("checks v3 extraction on the same three source spreads with real browser assets", async () => {
  const env = parseEnv(await readFile(".env.local", "utf8"));
  if (!env.OPENAI_API_KEY) throw new Error("Local key missing");
  const provider = new OpenAiResponsesProvider(env.OPENAI_API_KEY);
  const followup = process.env.OCR_CONTINUATION_CHECK === "1";
  const runRoot = followup ? `${root}/continuation-check` : root;
  const report = [];
  for (const pageIndex of (followup ? [11] : [5, 11, 31])) {
    const dir = `${runRoot}/page-${pageIndex + 1}`;
    const file = (key: string) => `${dir}/${key}`;
    const store: VisualStore = {
      getJson: <T,>(_id: string, key: string) => read<T>(file(key)),
      putJson: async (_id, key, value) => { const target = file(key); await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true }); await writeFile(target, JSON.stringify(value, null, 2)); },
      putJsonIfAbsent: async (_id, key, value) => {
        const target = file(key); await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
        try { await writeFile(target, JSON.stringify(value, null, 2), { flag: "wx" }); return true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
      },
      getJsonVersion: async <T,>(id: string, key: string) => {
        const value = await store.getJson<T>(id, key); return value ? { value, etag: createHash("sha256").update(JSON.stringify(value)).digest("hex") } : null;
      },
      putJsonVersion: async (id, key, value, etag, expiry) => {
        if ((await store.getJsonVersion(id, key))?.etag !== etag) return false;
        await store.putJson(id, key, value, expiry); return true;
      },
    };
    const job = { id: `diagnostic-page-${pageIndex + 1}`, identityHash: "private-v3-source-check", originalFilename: "691f9193faa81670cd1a6f07d497bf8d.pdf", expiresAt: 2_000_000_000 };
    const packets = [];
    for (const revision of [0, 1, 2]) {
      const packet = await read<{ sourceFingerprint: string; pageIndex: number; revision: number; nativeText: string; orderReliable: boolean; images: unknown[] }>(`${root}/assets/${pageIndex}-${revision}.json`);
      if (!packet || packet.pageIndex !== pageIndex || packet.revision !== revision) throw new Error("Run the browser rendering check first");
      const requests = extractionRenderRequests(pageIndex, revision);
      expect(packet.images).toHaveLength(requests.length);
      const images: ExtractionAsset["images"] = [];
      for (let i = 0; i < requests.length; i++) {
        const image = await validateVisualAsset(packet.images[i], requests[i], packet.sourceFingerprint);
        images.push({ imageUrl: image.imageUrl, width: image.width, height: image.height, hash: image.hash, detail: "high", label: `PDF page ${pageIndex + 1}, full-page region ${JSON.stringify(requests[i].box ?? { x: 0, y: 0, width: 1, height: 1 })}` });
      }
      const asset: ExtractionAsset = { pageIndex, revision, nativeText: packet.nativeText, orderReliable: packet.orderReliable, images };
      await store.putJsonIfAbsent(job.id, `extraction/assets/${pageIndex}-${revision}.json`, asset, job.expiresAt);
      packets.push(packet);
    }
    expect(new Set(packets.map((packet) => packet.sourceFingerprint)).size).toBe(1);
    const state = initialExtractionState(packets[0].sourceFingerprint, pageIndex + 1, { maxMicros: 600_000, inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 });
    state.cursor = pageIndex; state.completed = Array.from({ length: pageIndex }, () => "diagnostic-only-not-extracted");
    if (followup) state.revision = 2; // Same final tiles; isolate the prompt correction in one call.
    await store.putJsonIfAbsent(job.id, EXTRACTION_STATE_PATH, state, job.expiresAt);
    for (let turn = 0; turn < 3; turn++) {
      const current = (await store.getJson<ExtractionState>(job.id, EXTRACTION_STATE_PATH))!;
      if (current.cursor > pageIndex || current.failure) break;
      const result = await advanceExtraction({ job, store, provider, now: Math.floor(Date.now() / 1000), isActive: async () => true });
      console.log(JSON.stringify({ page: pageIndex + 1, result }));
      if (result.outcome === "interrupted" || result.outcome === "waiting") break;
    }
    const final = (await store.getJson<ExtractionState>(job.id, EXTRACTION_STATE_PATH))!;
    const record = final.cursor > pageIndex ? await store.getJson<PageRecord>(job.id, final.completed[pageIndex]) : null;
    report.push({ page: pageIndex + 1, accepted: !!record, revision: record?.revision, omissions: record?.omittedAuxiliary, failure: final.failure, usage: final.usage });
    console.log(JSON.stringify(report.at(-1)));
    expect(await store.getJson(job.id, "canonical-book.json")).toBeNull();
  }
  await writeFile(`${runRoot}/report.json`, JSON.stringify({ sourceAuditRequired: true, sampleOnly: true, results: report }, null, 2));
}, 900_000);
