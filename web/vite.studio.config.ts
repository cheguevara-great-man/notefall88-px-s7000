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

export default defineConfig({
  base: "./",
  publicDir: resolve(studioRoot, "public"),
  plugins: [{
    name: "notefall-studio-identity",
    transformIndexHtml(html) {
      return html
        .replace('content="core"', 'content="studio"')
        .replace("<title>NoteFall 88</title>", "<title>NoteFall Studio</title>")
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
      const precache = outputFiles(outputDirectory)
        .filter((name) => !name.endsWith(".map") && name !== "sw.js")
        .map((name) => `./${name}`)
        .sort();
      const version = createHash("sha256").update(precache.join("\n")).digest("hex").slice(0, 12);
      const source = readFileSync(serviceWorkerOutput, "utf8")
        .replace('const CACHE = "notefall-studio-dev";', `const CACHE = "notefall-studio-${version}";`)
        .replace("self.__NOTEFALL_PRECACHE__ ?? CORE_FALLBACK", JSON.stringify(precache));
      writeFileSync(serviceWorkerOutput, source);
    },
  }],
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "node",
  },
});
