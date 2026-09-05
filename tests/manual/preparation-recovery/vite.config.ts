import { defineConfig } from "vite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateBatchVisualAsset } from "../../../app/lib/book-pipeline/visual-agent/assets";
import { extractionRenderRequests, nativeTextUsable } from "../../../app/lib/book-pipeline/extraction/policy";

const project = process.cwd();
const receipts = new Set<number>();
let fingerprint = "";
// Explicit loopback diagnostic; never imported by the production application.
export default defineConfig({ root: path.join(project, "tests/manual/preparation-recovery"),
  plugins: [{ name: "preparation-regression", configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const route = request.url?.split("?")[0];
      if (!["/__source.pdf", "/__receipts", "/api/book-jobs/local-preparation/extraction"].includes(route ?? "")) return next();
      response.setHeader("cache-control", "no-store");
      try {
        if (request.method === "GET" && route === "/__source.pdf") {
          response.setHeader("content-type", "application/pdf"); response.end(await readFile(path.join(project, "design book 2.pdf"))); return;
        }
        response.setHeader("content-type", "application/json");
        if (request.method === "GET" && route === "/__receipts") { response.end(JSON.stringify([...receipts])); return; }
        if (request.headers.origin !== "http://127.0.0.1:3003") throw new Error("Local origin required");
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 1_000_000) throw new Error("Packet too large"); chunks.push(chunk); }
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (request.method === "POST") {
          if (value.pageCount !== 210) throw new Error("Wrong source length");
          if (fingerprint && fingerprint !== value.sourceFingerprint) throw new Error("Wrong source");
          fingerprint = value.sourceFingerprint;
        } else if (request.method === "PUT") {
          if (value.sourceFingerprint !== fingerprint || !Number.isInteger(value.pageIndex) || value.pageIndex < 0 || value.pageIndex >= 210 || value.revision !== 0 || value.skipped) throw new Error("Invalid page");
          const native = nativeTextUsable(value.nativeText, value.orderReliable);
          if (value.images.length !== (native ? 0 : 1)) throw new Error("Incomplete page");
          if (!native) await validateBatchVisualAsset(value.images[0], extractionRenderRequests(value.pageIndex, 0)[0], fingerprint);
          receipts.add(value.pageIndex);
        } else throw new Error("Invalid method");
        response.end(JSON.stringify({ accepted: true }));
      } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: { code: "invalid_extraction_asset", message: String(error) } })); }
    });
  } }], server: { host: "127.0.0.1", port: 3003, strictPort: true, fs: { allow: [project] } },
});
