import { fingerprintFile } from "./book-job-client";
import type { RenderRequest } from "./lib/book-pipeline/visual-agent/schema";
import type { ExtractionPageRequest } from "./lib/book-pipeline/extraction/stage";
import { extractionRenderRequests, nativeTextUsable } from "./lib/book-pipeline/extraction/policy";

type PdfJs = typeof import("pdfjs-dist");
let pdfRuntimePromise: Promise<{ pdfjs: PdfJs; workerUrl: string }> | undefined;

export function preloadVisualPageRenderer() {
  pdfRuntimePromise ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([pdfjs, worker]) => ({ pdfjs, workerUrl: worker.default }));
  return pdfRuntimePromise;
}

export async function createVisualPageRenderer(file: File) {
  const fingerprint = await fingerprintFile(file);
  const { pdfjs, workerUrl } = await preloadVisualPageRenderer();
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loading.promise;
  const renderer = {
    fingerprint,
    pageCount: pdf.numPages,
    destroy: () => loading.destroy(),
    async prepareExtraction(request: ExtractionPageRequest, sourceFingerprint: string, options?: { retry?: 0 | 1 | 2 | 3 }) {
      if (fingerprint !== sourceFingerprint) throw new Error("Select the same PDF used for this job.");
      const requests = extractionRenderRequests(request.pageIndex, request.revision);
      if (request.parts !== requests.length || request.allowNative !== (request.revision === 0) || request.pageIndex >= pdf.numPages) throw new Error("Invalid page preparation request");
      let nativeText = "", orderReliable = false;
      if (request.allowNative) {
        const page = await pdf.getPage(request.pageIndex + 1);
        try {
          const content = await page.getTextContent();
          const items = content.items.filter((item) => "str" in item);
          // Only simple, unrotated single-column reading order qualifies.
          // Ambiguous layouts fall back to vision without guessing or dropping text.
          orderReliable = page.rotate === 0 && items.length > 0;
          let previousY = Infinity, previousX = -Infinity;
          const lineStarts: number[] = [];
          for (const item of items) {
            const [a, b, c, d, x, y] = item.transform;
            const newLine = Math.abs(y - previousY) > Math.max(2, Math.abs(d) * 0.4);
            if (item.dir !== "ltr" || a <= 0 || d <= 0 || Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || y > previousY + 2 || (!newLine && x < previousX - 2)) orderReliable = false;
            if (newLine) { lineStarts.push(x); if (nativeText && !nativeText.endsWith("\n")) nativeText += "\n"; }
            nativeText += item.str + (item.hasEOL ? "\n" : " ");
            previousY = y; previousX = x;
          }
          if (lineStarts.length < 3 || Math.max(...lineStarts) - Math.min(...lineStarts) > page.view[2] * 0.12) orderReliable = false;
          // Never pass truncated text off as a complete native extraction.
          if (nativeText.length > 30000) { nativeText = ""; orderReliable = false; }
        } finally { page.cleanup(); }
      }
      const images = [];
      if (!nativeTextUsable(nativeText, orderReliable)) {
        const retryLimits = [
          undefined,
          { edge: 1000, bytes: 256 * 1024, format: "png" as const },
          { edge: 900, bytes: 128 * 1024, format: "jpeg" as const },
          { edge: 640, bytes: 96 * 1024, format: "jpeg" as const },
        ];
        const limits = options?.retry
          ? retryLimits[options.retry]
          : request.compact ? { edge: 1400, bytes: 192 * 1024, format: "jpeg" as const } : undefined;
        for (const part of requests) images.push(await renderer.render(part, sourceFingerprint, limits));
      }
      return { sourceFingerprint, pageIndex: request.pageIndex, revision: request.revision, nativeText, orderReliable, images };
    },
    async render(request: RenderRequest, sourceFingerprint: string, limits?: { edge: number; bytes: number; format?: "jpeg" | "png" }) {
      if (fingerprint !== sourceFingerprint) throw new Error("Select the same PDF used for this job.");
      const page = await pdf.getPage(request.pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      const edge = limits?.edge ?? (request.kind === "thumbnail" ? 512 : request.box ? 4096 : 2048);
      const maxBytes = limits?.bytes ?? 768 * 1024;
      const scaled = page.getViewport({ scale: edge / Math.max(viewport.width, viewport.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(scaled.width); canvas.height = Math.ceil(scaled.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      const output = document.createElement("canvas");
      try {
        await page.render({ canvas, canvasContext: context, viewport: scaled }).promise;
        const box = request.box ?? { x: 0, y: 0, width: 1, height: 1 };
        const width = box.width * canvas.width, height = box.height * canvas.height;
        let scale = Math.min(1, 2048 / Math.max(width, height));
        if (request.kind === "preview") scale = Math.min(1, 360 / width, 240 / height);
        let imageUrl = "";
        // Resampling only; no generative alteration of the source artwork.
        for (let attempt = 0; attempt < 5; attempt++) {
          output.width = Math.max(1, Math.floor(width * scale)); output.height = Math.max(1, Math.floor(height * scale));
          output.getContext("2d")!.drawImage(canvas, box.x * canvas.width, box.y * canvas.height, width, height, 0, 0, output.width, output.height);
          imageUrl = limits?.format === "jpeg" ? output.toDataURL("image/jpeg", 0.82) : output.toDataURL("image/png");
          if ((imageUrl.length - imageUrl.indexOf(",") - 1) * 3 / 4 <= maxBytes) break;
          scale *= 0.75;
        }
        if ((imageUrl.length - imageUrl.indexOf(",") - 1) * 3 / 4 > maxBytes) throw new Error("Page image exceeds the upload limit");
        return { id: request.id, sourceFingerprint, imageUrl, width: output.width, height: output.height, rotation: scaled.rotation, renderer: `pdfjs-${pdfjs.version}` };
      } finally { canvas.width = canvas.height = output.width = output.height = 0; page.cleanup(); }
    },
  };
  return renderer;
}
