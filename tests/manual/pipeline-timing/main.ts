import { BookJobClient, driveBookJob, loadResumableJob, saveResumableJob, RESUMABLE_JOB_KEY, type ResumableBookJob } from "../../../app/book-job-client";
import { createVisualPageRenderer } from "../../../app/visual-page-renderer";

const status = document.querySelector<HTMLPreElement>("#status")!;
const run = document.querySelector<HTMLButtonElement>("#run")!;
const resume = document.querySelector<HTMLButtonElement>("#resume")!;
let file: File;
document.querySelector("#load")!.addEventListener("click", async () => {
  const response = await fetch("/__source.pdf");
  if (!response.ok) throw new Error("Source fixture unavailable");
  file = new File([await response.blob()], "grid-first-100.pdf", { type: "application/pdf" });
  status.textContent = `Source loaded (${file.size} bytes). The timed run has not started.`;
  run.disabled = false;
  resume.disabled = !loadResumableJob(sessionStorage);
});
async function execute(resuming: boolean) {
  run.disabled = resume.disabled = true;
  const start = performance.now(), startedAt = new Date().toISOString();
  const events: Array<{ stage: string; seconds: number }> = [];
  const log = (stage: string) => { events.push({ stage, seconds: (performance.now() - start) / 1000 }); status.textContent = JSON.stringify(events, null, 2); };
  const client = new BookJobClient();
  let renderer: Promise<Awaited<ReturnType<typeof createVisualPageRenderer>>> | undefined;
  let job: ResumableBookJob | undefined;
  const documentFor = () => renderer ??= createVisualPageRenderer(file);
  try {
    log("creating_and_uploading");
    job = resuming ? loadResumableJob(sessionStorage) ?? undefined : await client.create({ file, rightsConfirmed: true, browserToken: crypto.randomUUID(), turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" });
    if (!job) throw new Error("No saved timing job");
    saveResumableJob(sessionStorage, job);
    if (resuming) await client.advance(job, true);
    else await client.upload(job, file);
    log("uploaded");
    let previous = "";
    const outcome = await driveBookJob({ job, client, signal: new AbortController().signal,
      onStatus(value) { if (value.stage !== previous) { previous = value.stage; log(value.stage); } },
      prepareExtractionManifest: async (fingerprint, maxPages) => {
        const pdf = await documentFor();
        if (pdf.pageCount !== 100 || pdf.pageCount > maxPages) throw new Error("Expected exactly 100 PDF pages");
        await client.initializeExtraction(job!, { sourceFingerprint: fingerprint, pageCount: pdf.pageCount });
      },
      prepareExtractionPage: async (request, fingerprint) => client.uploadExtractionAsset(job!, await (await documentFor()).prepareExtraction(request, fingerprint)),
      renderAssets: async (requests, fingerprint) => { for (const request of requests) await client.uploadVisualAsset(job!, await (await documentFor()).render(request, fingerprint)); },
      saveGame: async (game) => {
        const seconds = (performance.now() - start) / 1000;
        const response = await fetch("/__result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job!.jobId, startedAt, seconds, fresh: !resuming, passed: !resuming && seconds < 120, pages: 100, sourceBytes: file.size, events, game }) });
        if (!response.ok) throw new Error("Could not save timing result");
      }, clear() { sessionStorage.removeItem(RESUMABLE_JOB_KEY); },
    });
    log(outcome);
  } catch (error) { log(`FAILED: ${String(error)}`); }
  finally { await (await renderer)?.destroy(); resume.disabled = !loadResumableJob(sessionStorage); }
}
run.addEventListener("click", () => void execute(false));
resume.addEventListener("click", () => void execute(true));
