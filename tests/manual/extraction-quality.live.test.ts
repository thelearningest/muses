import { it, expect } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import { OpenAiResponsesProvider } from "../../app/lib/book-pipeline/providers/openai";
import { PAGE_EXTRACTION_INSTRUCTIONS, PAGE_EXTRACTION_JSON_SCHEMA, parseExtractedPage } from "../../app/lib/book-pipeline/extraction/page-extraction";
import type { ExtractionAsset } from "../../app/lib/book-pipeline/extraction/stage";

// Targeted paid diagnostic. Cached exact requests never repeat a known call;
// an uncertain intent fails closed. Does not modify the website's failed job.
it.skipIf(process.env.RUN_EXTRACTION_QUALITY_TEST !== "1")("checks page-six extraction with explicit tile and decorative-text guidance", async () => {
  const root = "outputs/extraction-quality-v2";
  await mkdir(root, { recursive: true });
  const asset: ExtractionAsset = JSON.parse(await readFile("outputs/full-book-local/c7f9488e-16d6-4386-b859-6b209b9b56c1/extraction/assets/5-2.json", "utf8"));
  const env = parseEnv(await readFile(".env.local", "utf8"));
  if (!env.OPENAI_API_KEY) throw new Error("Local OpenAI key missing");
  const model = process.env.EXTRACTION_DIAGNOSTIC_MODEL === "gpt-5.6-sol" ? "gpt-5.6-sol" : "gpt-5.6-luna";
  const request = {
    model, reasoningEffort: "none" as const, schemaName: "book_page_extraction", schema: PAGE_EXTRACTION_JSON_SCHEMA,
    instructions: `${PAGE_EXTRACTION_INSTRUCTIONS}\nThese tiles jointly cover the entire original page. A tile boundary is not a missing source edge: join overlapping content across tiles. Large background lettering, graphic ornaments, and intentionally faint decorative typography are not substantive body text. Do not require a refinement solely because such decoration is cropped in the original photograph. Transcribe all real headings, body text, lists, labels and captions. Text-box coordinates are OPTIONAL: return null whenever uncertain about mapping a tile back to the full page. Spatial uncertainty alone does not make legible text unreadable. Do not guess a word that remains illegible.`,
    input: JSON.stringify({ pageIndex: 5, revision: 2, nativeText: "" }), images: asset.images, maxOutputTokens: 10000, safetyIdentifier: "private-extraction-quality-test",
  };
  const key = createHash("sha256").update(JSON.stringify(request)).digest("hex");
  const resultPath = `${root}/${key}.json`;
  let response;
  try { response = JSON.parse(await readFile(resultPath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(`${root}/${key}.attempt.json`, JSON.stringify({ model: request.model, at: new Date().toISOString(), maxOutputTokens: request.maxOutputTokens }), { flag: "wx" });
    response = await new OpenAiResponsesProvider(env.OPENAI_API_KEY).generateStructured(request);
    await writeFile(resultPath, JSON.stringify(response, null, 2));
  }
  console.log(JSON.stringify({ quality: response.data.quality, warnings: response.data.warnings, usage: response.usage, resultPath }));
  const page = parseExtractedPage(response.data, 5);
  expect(page.quality).toBe("readable");
  // Human-inspected source fidelity sentinel. This is an evaluation assertion,
  // never part of the model prompt or a replacement for the extracted source.
  expect(page.blocks.map((block) => block.text).join("\n")).toContain("Nonstructural Design Approaches");
}, 110000);
