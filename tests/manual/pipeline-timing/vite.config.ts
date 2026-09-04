import { defineConfig } from "vite";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const project = process.cwd();
export default defineConfig({
  root: path.join(project, "tests/manual/pipeline-timing"),
  plugins: [{ name: "local-pipeline-timing", configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (!["/__source.pdf", "/__result"].includes(request.url ?? "")) return next();
      if (request.headers.host !== "127.0.0.1:3002") { response.writeHead(403).end(); return; }
      response.setHeader("cache-control", "no-store");
      if (request.url === "/__source.pdf" && request.method === "GET") {
        response.setHeader("content-type", "application/pdf");
        createReadStream(path.join(project, "tmp/pdfs/grid-first-100.pdf")).pipe(response); return;
      }
      try {
        if (request.method !== "POST" || request.headers.origin !== "http://127.0.0.1:3002") throw new Error("Invalid request");
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 2_000_000) throw new Error("Too large"); chunks.push(chunk); }
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!/^[a-f0-9-]{36}$/.test(result.jobId) || result.pages !== 100) throw new Error("Invalid result");
        const folder = path.join(project, "outputs/pipeline-timing"); await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, `${result.jobId}.json`), JSON.stringify(result, null, 2), { flag: "wx" });
        response.end("saved");
      } catch { response.writeHead(400).end("Rejected"); }
    });
  } }],
  server: { host: "127.0.0.1", port: 3002, strictPort: true, fs: { allow: [project] }, proxy: {
    "/api": { target: "http://localhost:3003", changeOrigin: true, headers: { origin: "http://localhost:3003" } },
  } },
});
