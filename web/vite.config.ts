import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    outDir: resolve(currentDirectory, "../firmware/data"),
    emptyOutDir: true,
    sourcemap: false,
    target: "es2020",
  },
  test: {
    environment: "node",
  },
});
