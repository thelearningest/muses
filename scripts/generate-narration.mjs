import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { NARRATION_MODEL, NARRATION_VOICES, NARRATION_INSTRUCTIONS, NARRATION_SAMPLES } from "../app/narration/catalog.mjs";
import { GALLERY_NARRATION_SAMPLES } from "../app/narration/gallery.mjs";

const root = new URL("../", import.meta.url);
const output = new URL("public/audio/narration/", root);
const receipts = new URL("outputs/narration/receipts/", root);
const write = process.argv.includes("--write");
const collection = process.argv.find(argument => argument.startsWith("--collection="))?.slice(13) ?? "preview";
if (!["preview", "gallery"].includes(collection)) throw new Error("Choose --collection=preview or --collection=gallery");
const catalog = collection === "gallery" ? GALLERY_NARRATION_SAMPLES : NARRATION_SAMPLES;
const requestedVoice = process.argv.find(argument => argument.startsWith("--voice="))?.slice(8);
if (requestedVoice && !NARRATION_VOICES.includes(requestedVoice)) throw new Error("Choose --voice=cedar or --voice=marin");
const voices = requestedVoice ? [requestedVoice] : collection === "gallery" ? ["marin"] : NARRATION_VOICES;
const requestedSample = process.argv.find(argument => argument.startsWith("--sample="))?.slice(9);
if (requestedSample && !catalog.some(sample => sample.id === requestedSample)) throw new Error("Choose a sample ID from the selected collection for --sample.");
const samples = requestedSample ? catalog.filter(sample => sample.id === requestedSample) : catalog;
// Dry runs never read a key or call the API. Generation requires --write.
const clips = samples.flatMap(sample => voices.map(voice => {
  const request = { model: NARRATION_MODEL, voice, input: sample.text, instructions: sample.instructions ?? NARRATION_INSTRUCTIONS, response_format: "mp3" };
  const id = createHash("sha256").update(JSON.stringify(request)).digest("hex");
  return { sample, voice, request, id, file: new URL(`${id}.mp3`, output) };
}));
const pending = [];
for (const clip of clips) {
  try { await access(clip.file); } catch { pending.push(clip); }
}
const inputCharacters = pending.reduce((sum, clip) => sum + clip.sample.text.length, 0);
if (pending.length > 30 || inputCharacters > 10_000) throw new Error("Generation is limited to 30 clips and 10,000 input characters per run. Split a larger script into batches.");
console.log(`${clips.length} clips planned; ${pending.length} need generation; ${inputCharacters} input characters.`);
if (!write) {
  console.log("Dry run. Add --write to generate and save audio using the project’s existing OpenAI key.");
} else {
  let key = process.env.OPENAI_API_KEY;
  if (!key) {
    const env = await readFile(new URL(".env.local", root), "utf8");
    const value = env.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)$/m)?.[1]?.trim();
    key = value?.startsWith('"') || value?.startsWith("'") ? value.slice(1, value.indexOf(value[0], 1)) : value?.split(/\s+#/)[0]?.trim();
  }
  if (!key) throw new Error("OPENAI_API_KEY is missing. No generation was requested.");
  await mkdir(output, { recursive: true });
  await mkdir(receipts, { recursive: true });
  for (const clip of pending) {
    const marker = new URL(`${clip.id}.pending`, receipts);
    // An uncertain paid request is never automatically retried on the next run.
    await writeFile(marker, `${new Date().toISOString()} ${clip.voice} ${clip.sample.id}\n`, { flag: "wx" });
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(clip.request),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      // DNS failure/connection refusal happen before dispatch. Other transport
      // outcomes remain marked so a rerun cannot duplicate an uncertain charge.
      if (["ENOTFOUND", "ECONNREFUSED"].includes(error.cause?.code)) await unlink(marker);
      throw new Error(`OpenAI speech could not connect (${error.cause?.code ?? "transport error"}). No automatic retry was made.`);
    }
    if (!response.ok) throw new Error(`OpenAI speech returned HTTP ${response.status}. Generation stopped without retrying. Request ID: ${response.headers.get("x-request-id") ?? "unavailable"}`);
    if (!response.headers.get("content-type")?.startsWith("audio/")) throw new Error("OpenAI returned unexpected content. Generation stopped without retrying.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 100) throw new Error("OpenAI returned an empty audio clip. Generation stopped without retrying.");
    await writeFile(clip.file, bytes, { flag: "wx" });
    await unlink(marker);
    console.log(`Saved ${clip.voice}: ${clip.sample.title} (${bytes.length} bytes).`);
  }
  const manifestPath = new URL("manifest.json", output);
  let existing = [];
  try {
    const previous = JSON.parse(await readFile(manifestPath, "utf8"));
    existing = (previous.clips ?? []).map(clip => ({ ...clip, model: clip.model ?? previous.model }));
  } catch { /* First generation. */ }
  const next = clips.map(clip => ({ id: clip.sample.id, text: clip.sample.text, voice: clip.voice, model: clip.request.model, src: `/audio/narration/${clip.id}.mp3` }));
  const updated = [...existing.filter(clip => !next.some(item => item.id === clip.id && item.voice === clip.voice)), ...next];
  await writeFile(manifestPath, JSON.stringify({ version: 1, model: NARRATION_MODEL, generatedAt: new Date().toISOString(), clips: updated }, null, 2) + "\n");
  console.log(`Manifest saved at ${fileURLToPath(manifestPath)}. Replaying these clips makes no API call.`);
}
