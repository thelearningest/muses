import { createVisualPageRenderer } from "../../../app/visual-page-renderer";
import { createRecoverableRenderer } from "../../../app/recoverable-renderer";
import { BookJobClient, driveBookJob } from "../../../app/book-job-client";

const run = document.querySelector<HTMLButtonElement>("#run")!;
const cancel = document.querySelector<HTMLButtonElement>("#cancel")!;
const status = document.querySelector<HTMLPreElement>("#status")!;
let controller: AbortController;
cancel.onclick = () => controller.abort();
run.onclick = async () => {
  controller = new AbortController();
  run.disabled = true; cancel.disabled = false;
  const started = performance.now();
  let phase = "Loading local source", completed = 0, count = 210;
  const draw = () => { status.textContent = JSON.stringify({ phase, completed, total: count, hidden: document.hidden, seconds: Math.round((performance.now() - started) / 1000) }, null, 2); };
  document.addEventListener("visibilitychange", draw);
  draw();
  const session = createRecoverableRenderer({ signal: controller.signal, open: async () => {
    const response = await fetch("/__source.pdf", { signal: controller.signal });
    return createVisualPageRenderer(new File([await response.blob()], "design book 2.pdf"), controller.signal, (value) => { phase = value; draw(); });
  }, onRestart: () => { phase = "Restarting renderer"; draw(); } });
  try {
    const fingerprint = await session.run(async (renderer) => { count = renderer.pageCount; return renderer.fingerprint; });
    if (count !== 210) throw new Error("Expected supplied 210-page PDF");
    const client = new BookJobClient();
    const job = { jobId: "local-preparation", capabilityToken: "local-test-only", filename: "design book 2.pdf", stage: "reading_source" as const };
    // Server receipts persist across refreshes for this manually launched test.
    await client.initializeExtraction(job, { sourceFingerprint: fingerprint, pageCount: count }, controller.signal);
    const receipts = new Set<number>();
    await driveBookJob({ job, signal: controller.signal,
      client: {
        status: async () => ({ jobId: job.jobId, stage: "reading_source", recoverable: false }),
        acknowledge: async () => undefined,
        advance: async () => {
          const saved = await fetch("/__receipts").then((response) => response.json()) as number[];
          saved.forEach((index) => receipts.add(index));
          const requests = Array.from({ length: count }, (_, pageIndex) => ({ pageIndex, revision: 0, parts: 1 as const, allowNative: true, compact: true })).filter((request) => !receipts.has(request.pageIndex));
          if (!requests.length) controller.abort();
          return { outcome: "awaiting_extraction_assets", requests, sourceFingerprint: fingerprint };
        },
      },
      prepareExtractionPage: async (request, sourceFingerprint) => {
        const packet = await session.run((renderer) => renderer.prepareExtraction(request, sourceFingerprint));
        await client.uploadExtractionAsset(job, packet, controller.signal);
      },
      onPreparationProgress: () => undefined,
      onStatus: async () => { completed = (await fetch("/__receipts").then((response) => response.json()) as number[]).length; draw(); },
      saveGame: () => undefined, clear: () => undefined,
    });
    completed = (await fetch("/__receipts").then((response) => response.json()) as number[]).length;
    phase = completed === count ? "PASS: every page validated and acknowledged" : "Cancelled; acknowledged pages retained for resume";
  } catch (error) { phase = `FAILED: ${String(error)}`; }
  finally {
    await session.destroy(); draw(); run.disabled = false; cancel.disabled = true;
    document.removeEventListener("visibilitychange", draw);
  }
};
