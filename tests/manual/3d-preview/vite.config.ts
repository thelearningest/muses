import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Separate, loopback-only prototype. Does not load application data or APIs.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  envDir: false,
  publicDir: false,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 3016,
    strictPort: true,
    watch: { useFsEvents: false, usePolling: true },
    fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] },
  },
  build: { outDir: "../../../outputs/3d-preview", emptyOutDir: true },
});
