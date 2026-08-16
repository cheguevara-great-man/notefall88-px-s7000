import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(webRoot, "..");
const studioRoot = resolve(webRoot, "../studio");
const outputDirectory = resolve(webRoot, "../dist/studio");

function outputFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory).flatMap((name) => {
    const absolute = resolve(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    return statSync(absolute).isDirectory() ? outputFiles(absolute, relative) : [relative];
  });
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export default defineConfig({
  base: "./",
  publicDir: resolve(studioRoot, "public"),
  plugins: [{
    name: "notefall-studio-identity",
    transformIndexHtml(html) {
      return html
        .replace('content="core"', 'content="studio"')
        .replace("<title>NoteFall 88</title>", "<title>NoteFall Studio</title>")
        // The bundled webmscore Emscripten runtime contains a dynamic-function
        // compatibility shim. Keep unsafe-eval limited to Studio; Core retains
        // the stricter policy from index.html.
        .replace("script-src 'self';", "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval';")
        .replace("</head>", '<link rel="manifest" href="./manifest.webmanifest" /><meta name="apple-mobile-web-app-capable" content="yes" /></head>');
    },
    closeBundle() {
      mkdirSync(outputDirectory, { recursive: true });
      const legalDirectory = resolve(outputDirectory, "legal");
      mkdirSync(legalDirectory, { recursive: true });
      copyFileSync(resolve(studioRoot, "LICENSE.md"), resolve(legalDirectory, "NOTEFALL-STUDIO-LICENSE.md"));
      copyFileSync(resolve(repositoryRoot, "THIRD_PARTY_NOTICES.md"), resolve(legalDirectory, "THIRD_PARTY_NOTICES.md"));
      const serviceWorkerOutput = resolve(outputDirectory, "sw.js");
      copyFileSync(resolve(studioRoot, "public/sw.js"), serviceWorkerOutput);
      const releaseFiles = outputFiles(outputDirectory)
        .filter((name) => !name.endsWith(".map") && name !== "sw.js" && name !== "asset-manifest.json")
        .sort();
      const records = releaseFiles.map((path) => {
        const bytes = readFileSync(resolve(outputDirectory, path));
        return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
      });
      const version = sha256(records.map((entry) => `${entry.path}\0${entry.sha256}`).join("\n")).slice(0, 16);
      const assetManifestBytes = Buffer.from(`${JSON.stringify({
        schemaVersion: 1,
        cacheVersion: version,
        files: records,
        totalBytes: records.reduce((total, entry) => total + entry.bytes, 0),
      }, null, 2)}\n`);
      writeFileSync(resolve(outputDirectory, "asset-manifest.json"), assetManifestBytes);
      const precache = [...releaseFiles, "asset-manifest.json"].map((name) => `./${name}`);
      const integrity = Object.fromEntries([
        ...records.map((entry) => [`./${entry.path}`, entry.sha256]),
        ["./asset-manifest.json", sha256(assetManifestBytes)],
      ]);
      const source = readFileSync(serviceWorkerOutput, "utf8")
        .replace("__NOTEFALL_CACHE_VERSION__", version)
        .replace("self.__NOTEFALL_PRECACHE__ ?? CORE_FALLBACK", JSON.stringify(precache))
        .replace("self.__NOTEFALL_INTEGRITY__ ?? {}", JSON.stringify(integrity));
      writeFileSync(serviceWorkerOutput, source);
    },
  }],
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    target: "es2022",
    // Production PWA/App bundles do not publish application source maps. They
    // add several MiB, disclose implementation source, and are not used by the
    // offline client; CI keeps source-level diagnostics from the build itself.
    sourcemap: false,
  },
  test: {
    environment: "node",
  },
});
