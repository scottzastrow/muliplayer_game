import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const clientDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(clientDirectory, "../..");

export default defineConfig({
  root: resolve(repositoryRoot, "tools/theme-preview"),
  resolve: {
    alias: {
      "/theme-preview.ts": resolve(repositoryRoot, "tools/theme-preview.ts")
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    fs: { allow: [repositoryRoot] }
  }
});
