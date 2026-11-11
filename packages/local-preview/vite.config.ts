import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index"
    },
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      external: ["@multiplayer-game/protocol", "@multiplayer-game/theme-sdk"]
    }
  }
});
