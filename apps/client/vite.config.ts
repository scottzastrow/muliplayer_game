import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const serverTarget = `http://${env.HOST ?? "127.0.0.1"}:${env.PORT ?? "8082"}`;

  return {
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: serverTarget,
          changeOrigin: true
        },
        "/health": {
          target: serverTarget,
          changeOrigin: true
        },
        "/ws": {
          target: serverTarget,
          changeOrigin: true,
          ws: true
        }
      }
    },
    build: {
      outDir: "../../dist/client",
      emptyOutDir: true
    }
  };
});
