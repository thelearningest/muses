import { defineConfig } from "vite";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const project = process.cwd();
const sourcePath = path.resolve(project, process.env.PIPELINE_PDF ?? "tmp/pdfs/grid-first-100.pdf");
const expectedPages = Number(process.env.PIPELINE_EXPECTED_PAGES ?? 100);
const appOrigin = process.env.PIPELINE_APP_ORIGIN ?? "http://localhost:3003";
const harnessPort = Number(process.env.PIPELINE_HARNESS_PORT ?? 3002);
if (!Number.isSafeInteger(expectedPages) || expectedPages < 1 || expectedPages > 300) throw new Error("PIPELINE_EXPECTED_PAGES must be between 1 and 300");
if (!Number.isSafeInteger(harnessPort) || harnessPort < 1024 || harnessPort > 65535) throw new Error("Invalid PIPELINE_HARNESS_PORT");
export default defineConfig({
  root: path.join(project, "tests/manual/pipeline-timing"),
  plugins: [{ name: "local-pipeline-timing", configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (!["/__source.pdf", "/__metadata", "/__result"].includes(request.url ?? "")) return next();
      if (request.headers.host !== `127.0.0.1:${harnessPort}`) { response.writeHead(403).end(); return; }
      response.setHeader("cache-control", "no-store");
      if (request.url === "/__source.pdf" && request.method === "GET") {
        response.setHeader("content-type", "application/pdf");
        createReadStream(sourcePath).pipe(response); return;
      }
      if (request.url === "/__metadata" && request.method === "GET") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ filename: path.basename(sourcePath), expectedPages })); return;
      }
      try {
        if (request.method !== "POST" || request.headers.origin !== `http://127.0.0.1:${harnessPort}`) throw new Error("Invalid request");
        const chunks: Buffer[] = []; let bytes = 0;
        // Three player-visible source crops can legitimately make a complete
        // timing record several megabytes. This endpoint is local-only.
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 10_000_000) throw new Error("Too large"); chunks.push(chunk); }
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!/^[a-f0-9-]{36}$/.test(result.jobId) || result.pages !== expectedPages) throw new Error("Invalid result");
        const folder = path.join(project, "outputs/pipeline-timing"); await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, `${result.jobId}.json`), JSON.stringify(result, null, 2), { flag: "wx" });
        response.end("saved");
      } catch { response.writeHead(400).end("Rejected"); }
    });
  } }],
  server: { host: "127.0.0.1", port: harnessPort, strictPort: true, fs: { allow: [project] }, proxy: {
    "/api": { target: appOrigin, changeOrigin: true, headers: { origin: appOrigin } },
  } },
});
