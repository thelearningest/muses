import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Local test fixture only. No API key, provider calls, uploads or production routes.
const project = process.cwd();
export default defineConfig({
  root: path.join(project, "tests/manual/preview"),
  publicDir: path.join(project, "public"),
  plugins: [react(), { name: "private-diagnostic-game-fixture", configureServer(server) {
    server.middlewares.use("/__test_game.json", async (_request, response) => {
      try {
        // Only the integration runner's fully verified export is served.
        const game = await readFile(path.join(project, "outputs/luna-sol-e2e-v2/game.json"), "utf8");
        response.setHeader("content-type", "application/json"); response.setHeader("cache-control", "no-store"); response.end(game);
      } catch { response.statusCode = 404; response.end("No verified test game yet"); }
    });
  } }],
  server: { host: "127.0.0.1", port: 3000, strictPort: true, fs: { allow: [project] } },
});
