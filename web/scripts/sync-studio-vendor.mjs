import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDirectory, "..");
const packageRoot = resolve(webRoot, "node_modules/webmscore-webpack5");
const destination = resolve(webRoot, "../studio/public/vendor/webmscore-0.21.0-a");
const files = ["webmscore.mjs", "webmscore.lib.data", "webmscore.lib.mem.wasm", "webmscore.lib.wasm"];

mkdirSync(destination, { recursive: true });
const copiedFiles = files.map((name) => {
  const source = resolve(packageRoot, name);
  const target = resolve(destination, name);
  copyFileSync(source, target);
  const bytes = readFileSync(target);
  return {
    name,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});

const packageInfo = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
writeFileSync(resolve(destination, "vendor-manifest.json"), JSON.stringify({
  package: packageInfo.name,
  version: packageInfo.version,
  license: packageInfo.license,
  source: packageInfo.repository?.url,
  files: copiedFiles,
}, null, 2) + "\n");

console.log(`Synced ${packageInfo.name}@${packageInfo.version} to ${destination}`);
