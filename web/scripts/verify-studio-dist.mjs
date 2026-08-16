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
const MAX_DISTRIBUTION_BYTES = 24 * 1024 * 1024;
const MAX_APPLICATION_JAVASCRIPT_BYTES = 2 * 1024 * 1024;

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
const assetManifestPath = resolve(DIST, "asset-manifest.json");
assert(existsSync(assetManifestPath), "Studio distribution is missing asset-manifest.json");
const assetManifest = JSON.parse(readFileSync(assetManifestPath, "utf8"));
assert(assetManifest.schemaVersion === 1, "Unexpected Studio asset manifest schema");
assert(/^[a-f0-9]{16}$/.test(assetManifest.cacheVersion), "Invalid content-addressed cache version");
assert(serviceWorker.includes(`const INJECTED_VERSION = "${assetManifest.cacheVersion}"`),
  "Service worker cache version does not match asset-manifest.json");
assert(serviceWorker.includes('key.startsWith(CACHE_PREFIX)'),
  "Service worker cleanup is not scoped to NoteFall caches");
assert(!serviceWorker.includes("skipWaiting("),
  "Service worker must not replace an open page with a different cached release");
assert(serviceWorker.includes("precache integrity mismatch"),
  "Service worker does not verify build-time asset integrity");
assert(!serviceWorker.includes("caches.match(event.request)"),
  "Service worker must not use an unscoped cross-cache lookup");
const requiredOffline = [
  ...REQUIRED_LEGAL,
  "vendor/webmscore-0.21.0-a/vendor-manifest.json",
  ...manifest.files.map((entry) => `vendor/webmscore-0.21.0-a/${entry.name}`),
];
for (const relative of requiredOffline) {
  assert(serviceWorker.includes(`./${relative}`), `Service worker does not precache ${relative}`);
}

const distributionFiles = filesBelow(DIST);
assert(!distributionFiles.some((name) => name.endsWith(".map")),
  "Studio production distribution must not publish source maps");
const manifestFiles = assetManifest.files.map((entry) => entry.path);
const expectedManifestFiles = distributionFiles
  .filter((name) => name !== "sw.js" && name !== "asset-manifest.json")
  .sort();
assert(JSON.stringify(manifestFiles) === JSON.stringify(expectedManifestFiles),
  "Asset manifest does not cover the exact Studio release payload");
for (const entry of assetManifest.files) {
  assert(typeof entry?.path === "string" && !entry.path.startsWith("/") && !entry.path.includes(".."),
    "Invalid asset manifest path");
  const bytes = readFileSync(resolve(DIST, entry.path));
  assert(bytes.byteLength === entry.bytes, `Asset manifest size mismatch for ${entry.path}`);
  assert(createHash("sha256").update(bytes).digest("hex") === entry.sha256,
    `Asset manifest SHA-256 mismatch for ${entry.path}`);
  assert(serviceWorker.includes(`./${entry.path}`), `Service worker does not precache ${entry.path}`);
  assert(serviceWorker.includes(entry.sha256), `Service worker lacks integrity data for ${entry.path}`);
}
assert(serviceWorker.includes('./asset-manifest.json'),
  "Service worker does not precache asset-manifest.json");
assert(serviceWorker.includes(createHash("sha256").update(readFileSync(assetManifestPath)).digest("hex")),
  "Service worker lacks integrity data for asset-manifest.json");
const totalBytes = distributionFiles.reduce((total, relative) => total + statSync(resolve(DIST, relative)).size, 0);
const applicationJavaScriptBytes = distributionFiles
  .filter((name) => name.startsWith("assets/") && name.endsWith(".js"))
  .reduce((total, relative) => total + statSync(resolve(DIST, relative)).size, 0);
assert(totalBytes < MAX_DISTRIBUTION_BYTES, "Studio distribution exceeds the 24 MiB release budget");
assert(applicationJavaScriptBytes < MAX_APPLICATION_JAVASCRIPT_BYTES,
  "Studio application JavaScript exceeds the 2 MiB release budget");
assert(assetManifest.totalBytes === assetManifest.files.reduce((total, entry) => total + entry.bytes, 0),
  "Asset manifest totalBytes is inconsistent");

const coreFiles = filesBelow(resolve(ROOT, "firmware/data"));
assert(!coreFiles.some((name) => /webmscore|GPL-3\.0/i.test(name)), "GPL converter files leaked into MIT Core");

console.log(JSON.stringify({
  verified: true,
  package: `${manifest.package}@${manifest.version}`,
  runtimeFiles: manifest.files.length,
  distributionFiles: distributionFiles.length,
  totalBytes,
  applicationJavaScriptBytes,
  cacheVersion: assetManifest.cacheVersion,
  offlineEntries: requiredOffline.length,
}, null, 2));
