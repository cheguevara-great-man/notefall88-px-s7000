import { closeSync, mkdirSync, openSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(WEB, "..");
const BROWSER = process.env.NOTEFALL_BROWSER || "chromium";
const ARTIFACTS = join(ROOT, "output", "playwright", `smoke-${BROWSER}-${Date.now()}-${process.pid}`);
const SESSION = `notefall-smoke-${BROWSER}-${process.pid}`;
const BASE_URL = "http://127.0.0.1:4173";
const viteCli = join(WEB, "node_modules", "vite", "bin", "vite.js");
const playwrightCli = join(WEB, "node_modules", "@playwright", "cli", "playwright-cli.js");

mkdirSync(ARTIFACTS, { recursive: true });
const serverLogPath = join(ARTIFACTS, "vite.log");
const serverLog = openSync(serverLogPath, "w");
const server = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
  cwd: WEB,
  stdio: ["ignore", serverLog, serverLog],
  windowsHide: true,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function command(args, { parse = true } = {}) {
  const completed = spawnSync(process.execPath, [playwrightCli, `-s=${SESSION}`, ...args, "--json"], {
    cwd: ARTIFACTS,
    encoding: "utf8",
    windowsHide: true,
  });
  if (completed.status !== 0) {
    throw new Error(`playwright-cli ${args.join(" ")} failed\n${completed.stdout}\n${completed.stderr}`);
  }
  if (!parse) return completed.stdout;
  const output = JSON.parse(completed.stdout);
  return output.result ?? "";
}

function snapshot() {
  command(["snapshot"], { parse: false });
  const snapshotDirectory = join(ARTIFACTS, ".playwright-cli");
  const latest = readdirSync(snapshotDirectory)
    .filter((name) => /^page-.*\.yml$/.test(name))
    .sort()
    .at(-1);
  assert(latest, "playwright-cli did not write a page snapshot");
  return readFileSync(join(snapshotDirectory, latest), "utf8");
}

function refFor(snapshotText, expression, label) {
  const match = snapshotText.match(expression);
  assert(match, `snapshot does not contain ${label}`);
  return match[1];
}

function evaluate(expression) {
  const parsed = JSON.parse(command(["eval", expression]));
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}

async function waitForCondition(expression, message, attempts = 80) {
  let last = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = evaluate(expression);
    if (last) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`${message}; last value: ${JSON.stringify(last)}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Vite did not become ready; see ${serverLogPath}`);
}

try {
  await waitForServer();
  command(BROWSER === "chromium" ? ["open", BASE_URL] : ["open", BASE_URL, "--browser", BROWSER]);
  command(["resize", "390", "844"]);
  let page = snapshot();
  assert(page.includes("NoteFall 88"), "mobile page did not render NoteFall 88");
  assert(page.includes("硬件尚未验收"), "offline commissioning state is not visible");

  const mobile = evaluate(`() => JSON.stringify({
    width: innerWidth,
    height: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    overflow: document.documentElement.scrollWidth > innerWidth
  })`);
  assert(mobile.width === 390 && mobile.height === 844, `mobile viewport was not applied: ${JSON.stringify(mobile)}`);
  assert(!mobile.overflow && mobile.documentWidth === 390 && mobile.bodyWidth === 390, "mobile page overflows horizontally");

  const practiceRef = refFor(page, /button "练习选项"[^\n]*\[ref=(e\d+)\]/, "practice options button");
  command(["click", practiceRef]);
  page = snapshot();
  assert(page.includes('heading "练习选项"'), "practice panel did not open");
  const drawer = evaluate(`() => {
    const panel = document.querySelector('#practice-panel:not([hidden])');
    const close = panel?.querySelector('button');
    const p = panel?.getBoundingClientRect();
    const c = close?.getBoundingClientRect();
    return JSON.stringify({
      visible: Boolean(panel && p && p.width > 0 && p.height > 0),
      contained: Boolean(p && p.left >= 0 && p.right <= innerWidth && p.top >= 0 && p.bottom <= innerHeight),
      closeVisible: Boolean(c && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight),
      overflow: document.documentElement.scrollWidth > innerWidth
    });
  }`);
  assert(drawer.visible && drawer.contained && drawer.closeVisible && !drawer.overflow, "mobile practice panel escapes the viewport");
  const closeRef = refFor(page, /button "关闭"[^\n]*\[ref=(e\d+)\]/, "panel close button");
  command(["click", closeRef]);

  page = snapshot();
  const settingsRef = refFor(page, /button "灯带校准"[^\n]*\[ref=(e\d+)\]/, "settings button");
  command(["click", settingsRef]);
  page = snapshot();
  const currentPasswordRef = refFor(
    page,
    /textbox "当前热点密码"[^\n]*\[ref=(e\d+)\]/,
    "current hotspot password input",
  );
  const unlockRef = refFor(
    page,
    /button "解锁本标签页控制"[^\n]*\[ref=(e\d+)\]/,
    "session control unlock button",
  );
  command(["fill", currentPasswordRef, "short"]);
  command(["click", unlockRef]);
  page = snapshot();
  assert(page.includes("当前热点密码必须为 8–63 字节"), "station control password validation is not visible");
  const settingsCloseRef = refFor(page, /button "关闭"[^\n]*\[ref=(e\d+)\]/, "settings close button");
  command(["click", settingsCloseRef]);

  page = snapshot();
  const importRef = refFor(page, /generic \[ref=(e\d+)\][^\n]*: 导入乐谱/, "score import control");
  command(["click", importRef]);
  command(["upload", join(WEB, "test-fixtures", "parser-etude.musicxml")]);
  await waitForCondition(
    `() => JSON.stringify(
      document.querySelector('#score-name')?.textContent === 'Parser Etude · 4 音符'
      && document.querySelector('#score-time')?.textContent === '00:00 / 00:04'
      && Boolean(document.querySelector('#sheet-view svg'))
    )`,
    "MusicXML import and OSMD rendering did not finish before the deadline",
  );
  page = snapshot();
  assert(page.includes("Parser Etude · 4 音符"), "MusicXML score summary is missing or incorrect");
  assert(page.includes('option "五线谱" [selected]'), "MusicXML import did not select sheet view");
  assert(page.includes('generic "五线谱"'), "OSMD sheet container did not render");
  const loadedMobile = evaluate(`() => JSON.stringify({
    overflow: document.documentElement.scrollWidth > innerWidth,
    score: document.querySelector('#score-name')?.textContent,
    duration: document.querySelector('#score-time')?.textContent,
    sheetVisible: !document.querySelector('#sheet-view')?.hasAttribute('hidden'),
    notation: Boolean(document.querySelector('#sheet-view svg'))
  })`);
  assert(!loadedMobile.overflow, "loaded mobile score overflows horizontally");
  assert(loadedMobile.score === "Parser Etude · 4 音符", "loaded score identity changed");
  assert(loadedMobile.duration === "00:00 / 00:04", "loaded score duration changed");
  assert(loadedMobile.sheetVisible && loadedMobile.notation, "sheet view is empty after MusicXML import");
  command(["screenshot"]);

  command(["resize", "1280", "900"]);
  const desktop = evaluate(`() => JSON.stringify({
    width: innerWidth,
    height: innerHeight,
    overflow: document.documentElement.scrollWidth > innerWidth,
    score: document.querySelector('#score-name')?.textContent,
    notation: Boolean(document.querySelector('#sheet-view svg'))
  })`);
  assert(desktop.width === 1280 && desktop.height === 900, "desktop viewport was not applied");
  assert(!desktop.overflow && desktop.notation, "desktop score layout is invalid");
  assert(desktop.score === "Parser Etude · 4 音符", "desktop score state was not preserved");
  command(["screenshot"]);

  console.log(JSON.stringify({
    passed: true,
    browser: BROWSER,
    viewports: [[390, 844], [1280, 900]],
    score: "Parser Etude",
    notes: 4,
    durationSeconds: 4,
    artifacts: ARTIFACTS,
  }, null, 2));
} finally {
  try { command(["close"], { parse: false }); } catch { /* best effort */ }
  if (!server.killed) server.kill();
  closeSync(serverLog);
}
