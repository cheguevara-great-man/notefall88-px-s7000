import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(WEB, "..");
const DIST = resolve(ROOT, "dist/studio");
const VENDOR = resolve(DIST, "vendor/webmscore-0.21.0-a");
const REQUIRED_LEGAL = [
  "legal/GPL-3.0.txt",
  "legal/NOTEFALL-STUDIO-LICENSE.md",
  "legal/THIRD_PARTY_NOTICES.md",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function filesBelow(directory, prefix = "") {
  return readdirSync(directory).flatMap((name) => {
    const absolute = resolve(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    return statSync(absolute).isDirectory() ? filesBelow(absolute, relative) : [relative];
  });
}

assert(existsSync(resolve(DIST, "index.html")), "Studio distribution is missing index.html");
assert(existsSync(resolve(DIST, "sw.js")), "Studio distribution is missing its service worker");
for (const relative of REQUIRED_LEGAL) {
  assert(existsSync(resolve(DIST, relative)), `Studio distribution is missing ${relative}`);
}

const manifestPath = resolve(VENDOR, "vendor-manifest.json");
assert(existsSync(manifestPath), "Studio distribution is missing the converter manifest");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert(manifest.package === "webmscore-webpack5", "Unexpected converter package");
assert(manifest.version === "0.21.0-a", "Unexpected converter version");
assert(/^GPL/.test(manifest.license), "Converter manifest no longer declares a GPL license");
assert(Array.isArray(manifest.files) && manifest.files.length === 4, "Converter manifest must contain exactly four runtime files");

for (const entry of manifest.files) {
  assert(typeof entry?.name === "string" && !entry.name.includes("/"), "Invalid converter file name");
  const bytes = readFileSync(resolve(VENDOR, entry.name));
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert(bytes.byteLength === entry.bytes, `Size mismatch for ${entry.name}`);
  assert(digest === entry.sha256, `SHA-256 mismatch for ${entry.name}`);
}

const serviceWorker = readFileSync(resolve(DIST, "sw.js"), "utf8");
const requiredOffline = [
  ...REQUIRED_LEGAL,
  "vendor/webmscore-0.21.0-a/vendor-manifest.json",
  ...manifest.files.map((entry) => `vendor/webmscore-0.21.0-a/${entry.name}`),
];
for (const relative of requiredOffline) {
  assert(serviceWorker.includes(`./${relative}`), `Service worker does not precache ${relative}`);
}

const distributionFiles = filesBelow(DIST);
const totalBytes = distributionFiles.reduce((total, relative) => total + statSync(resolve(DIST, relative)).size, 0);
assert(totalBytes < 64 * 1024 * 1024, "Studio distribution exceeds the 64 MiB release budget");

const coreFiles = filesBelow(resolve(ROOT, "firmware/data"));
assert(!coreFiles.some((name) => /webmscore|GPL-3\.0/i.test(name)), "GPL converter files leaked into MIT Core");

console.log(JSON.stringify({
  verified: true,
  package: `${manifest.package}@${manifest.version}`,
  runtimeFiles: manifest.files.length,
  distributionFiles: distributionFiles.length,
  totalBytes,
  offlineEntries: requiredOffline.length,
}, null, 2));
