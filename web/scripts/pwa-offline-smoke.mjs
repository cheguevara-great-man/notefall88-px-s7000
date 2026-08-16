import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(WEB, "..");
const DIST = resolve(ROOT, "dist", "studio");
const PORT = Number(process.env.NOTEFALL_PWA_PORT || 43000 + process.pid % 1000);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SESSION = `notefall-pwa-offline-${process.pid}`;
const ARTIFACTS = join(ROOT, "output", "playwright", `pwa-offline-${Date.now()}-${process.pid}`);
const viteCli = join(WEB, "node_modules", "vite", "bin", "vite.js");
const playwrightCli = join(WEB, "node_modules", "@playwright", "cli", "playwright-cli.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function command(args) {
  const completed = spawnSync(process.execPath, [playwrightCli, `-s=${SESSION}`, ...args, "--json"], {
    cwd: ARTIFACTS,
    encoding: "utf8",
    windowsHide: true,
  });
  if (completed.status !== 0) {
    throw new Error(`playwright-cli ${args.join(" ")} failed\n${completed.stdout}\n${completed.stderr}`);
  }
  const output = JSON.parse(completed.stdout);
  return output.result ?? "";
}

function evaluate(expression) {
  const result = JSON.parse(command(["eval", expression]));
  return typeof result === "string" ? JSON.parse(result) : result;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // Preview server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Studio preview server did not start");
}

async function waitForCondition(expression, message, attempts = 300) {
  let last = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = evaluate(expression);
    if (last === true || last?.done === true) return last;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`${message}; last value: ${JSON.stringify(last)}`);
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolveDelay) => setTimeout(resolveDelay, 2000))]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    child.kill("SIGKILL");
  }
}

const manifest = JSON.parse(readFileSync(join(DIST, "asset-manifest.json"), "utf8"));
mkdirSync(ARTIFACTS, { recursive: true });
const serverLogPath = join(ARTIFACTS, "vite-preview.log");
const serverLog = openSync(serverLogPath, "w");
const server = spawn(process.execPath, [
  viteCli,
  "preview",
  "--config", "vite.studio.config.ts",
  "--host", "127.0.0.1",
  "--port", String(PORT),
  "--strictPort",
], {
  cwd: WEB,
  stdio: ["ignore", serverLog, serverLog],
  windowsHide: true,
});

try {
  await waitForServer();
  command(["open", BASE_URL]);
  const installed = evaluate(`async () => {
    const registration = await navigator.serviceWorker.ready;
    for (let attempt = 0; attempt < 100 && !navigator.serviceWorker.controller; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    const cacheName = ${JSON.stringify(`notefall-studio-${manifest.cacheVersion}`)};
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    return JSON.stringify({
      controlled: Boolean(navigator.serviceWorker.controller),
      active: registration.active?.state,
      cacheName,
      entries: keys.length,
    });
  }`);
  assert(installed.controlled, "Studio page was not controlled by its installed service worker");
  assert(installed.active === "activated", `Service worker is not activated: ${JSON.stringify(installed)}`);
  assert(installed.entries === manifest.files.length + 1,
    `Precache entry count does not match the release manifest: ${JSON.stringify(installed)}`);

  command(["network-state-set", "offline"]);
  command(["reload"]);
  const offline = evaluate(`async () => {
    const release = await (await fetch('./asset-manifest.json', { cache: 'no-store' })).json();
    const results = await Promise.all(release.files.map(async (entry) => {
      const response = await fetch('./' + entry.path, { cache: 'no-store' });
      return { path: entry.path, ok: response.ok, bytes: (await response.arrayBuffer()).byteLength };
    }));
    return JSON.stringify({
      edition: document.querySelector('meta[name="notefall-edition"]')?.content,
      controlled: Boolean(navigator.serviceWorker.controller),
      cacheVersion: release.cacheVersion,
      failed: results.filter((result, index) => !result.ok || result.bytes !== release.files[index].bytes),
      checked: results.length,
    });
  }`);
  assert(offline.edition === "studio", `Offline navigation loaded the wrong edition: ${JSON.stringify(offline)}`);
  assert(offline.controlled, "Offline reload lost service-worker control");
  assert(offline.cacheVersion === manifest.cacheVersion, "Offline reload mixed two Studio releases");
  assert(offline.failed.length === 0, `Offline release has missing or truncated assets: ${JSON.stringify(offline.failed)}`);

  const conversionFixture = join(WEB, "test-fixtures", "notefall-minimal.mscx");
  command(["run-code", `async (page) => {
    await page.locator('#midi-file').setInputFiles(${JSON.stringify(conversionFixture)});
  }`]);
  await waitForCondition(
    `() => JSON.stringify({
      done: document.querySelector('#score-name')?.textContent === 'NoteFall Converter Test · 3 音符'
        && Boolean(document.querySelector('#sheet-view svg')),
      score: document.querySelector('#score-name')?.textContent,
      lifecycle: document.querySelector('#lifecycle-status')?.textContent,
      summary: document.querySelector('#library-summary')?.textContent,
    })`,
    "Offline webmscore conversion did not complete under the production CSP",
  );
  const converted = evaluate(`() => JSON.stringify({
    score: document.querySelector('#score-name')?.textContent,
    notation: Boolean(document.querySelector('#sheet-view svg')),
  })`);

  console.log(JSON.stringify({
    passed: true,
    cacheVersion: manifest.cacheVersion,
    cachedEntries: installed.entries,
    verifiedOfflineFiles: offline.checked,
    offlineConversion: converted,
    artifacts: ARTIFACTS,
  }, null, 2));
} finally {
  try { command(["network-state-set", "online"]); } catch { /* best effort */ }
  try { command(["close"]); } catch { /* best effort */ }
  await stopServer(server);
  closeSync(serverLog);
}
