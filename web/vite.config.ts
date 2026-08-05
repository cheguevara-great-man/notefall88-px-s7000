import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const firmwareDataDirectory = resolve(currentDirectory, "../firmware/data");

function gzipFirmwareAssets() {
  return {
    name: "notefall-gzip-firmware-assets",
    apply: "build" as const,
    closeBundle(): void {
      const assetDirectory = resolve(firmwareDataDirectory, "assets");
      for (const name of readdirSync(assetDirectory)) {
        if (!/\.(css|js)$/i.test(name)) continue;
        if (Buffer.byteLength(`${name}.gz`, "utf8") > 31) {
          throw new Error(`LittleFS asset name exceeds the 31-byte packer limit: ${name}.gz`);
        }
        const path = resolve(assetDirectory, name);
        const source = readFileSync(path);
        writeFileSync(`${path}.gz`, gzipSync(source, { level: 9 }));
        unlinkSync(path);
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [gzipFirmwareAssets()],
  build: {
    outDir: firmwareDataDirectory,
    emptyOutDir: true,
    sourcemap: false,
    target: "es2020",
    rolldownOptions: {
      output: {
        // The PlatformIO mklittlefs 2.3 host tool uses a 31-byte filename
        // limit. Avoid dependency-derived chunk names such as the full OSMD
        // package name; content hashes still keep cache keys immutable.
        chunkFileNames: "assets/c-[hash].js",
      },
    },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        // These browser adapters are exercised by the Playwright desktop/mobile
        // smoke flow. The remaining product modules, including DeviceLink, must
        // appear in the unit-coverage denominator even before a test imports them.
        "src/main.ts",
        "src/sheet.ts",
        "src/waterfall.ts",
      ],
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 85,
        lines: 90,
      },
    },
  },
});
