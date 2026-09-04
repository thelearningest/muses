import { defineConfig } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { validateVisualAsset } from "../../../app/lib/book-pipeline/visual-agent/assets";
import { extractionRenderRequests } from "../../../app/lib/book-pipeline/extraction/policy";

const project = process.cwd();
const output = path.join(project, "outputs/extraction-v3-browser/assets");
// Explicitly launched loopback-only diagnostic. Never loaded by the website.
export default defineConfig({
  root: path.join(project, "tests/manual/extraction-preview"),
  plugins: [{ name: "local-extraction-assets", configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (!["/__source.pdf", "/__asset"].includes(request.url ?? "")) return next();
      response.setHeader("cache-control", "no-store");
      try {
        if (request.url === "/__source.pdf" && request.method === "GET") {
          response.setHeader("content-type", "application/pdf");
          response.end(await readFile(path.join(project, "691f9193faa81670cd1a6f07d497bf8d.pdf"))); return;
        }
        if (request.method !== "POST" || request.headers.origin !== "http://127.0.0.1:3002") throw new Error("Not a local diagnostic request");
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length; if (bytes > 4_500_000) throw new Error("Packet too large"); chunks.push(chunk);
        }
        const packet = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (![5, 11, 31].includes(packet.pageIndex) || ![0, 1, 2].includes(packet.revision)) throw new Error("Outside sample");
        const requests = extractionRenderRequests(packet.pageIndex, packet.revision);
        if (packet.images.length !== requests.length || packet.nativeText !== "" || packet.orderReliable !== false) throw new Error("Unexpected scanned source packet");
        for (let i = 0; i < requests.length; i++) await validateVisualAsset(packet.images[i], requests[i], packet.sourceFingerprint);
        await mkdir(output, { recursive: true });
        const file = path.join(output, `${packet.pageIndex}-${packet.revision}.json`);
        const encoded = JSON.stringify(packet);
        try { await writeFile(file, encoded, { flag: "wx" }); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(file, "utf8") !== encoded) throw error;
        }
        response.end("saved");
      } catch { response.statusCode = 400; response.end("Diagnostic request rejected"); }
    });
  } }],
  server: { host: "127.0.0.1", port: 3002, strictPort: true, fs: { allow: [project] } },
});
