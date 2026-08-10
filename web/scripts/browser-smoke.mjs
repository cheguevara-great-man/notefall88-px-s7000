import { closeSync, mkdirSync, openSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(WEB, "..");
const BROWSER = process.env.NOTEFALL_BROWSER || "chromium";
const EDITION = process.env.NOTEFALL_EDITION === "studio" ? "studio" : "core";
const ARTIFACTS = join(ROOT, "output", "playwright", `smoke-${EDITION}-${BROWSER}-${Date.now()}-${process.pid}`);
const SESSION = `notefall-smoke-${EDITION}-${BROWSER}-${process.pid}`;
const BASE_URL = "http://127.0.0.1:4173";
const viteCli = join(WEB, "node_modules", "vite", "bin", "vite.js");
const playwrightCli = join(WEB, "node_modules", "@playwright", "cli", "playwright-cli.js");

mkdirSync(ARTIFACTS, { recursive: true });
const serverLogPath = join(ARTIFACTS, "vite.log");
const serverLog = openSync(serverLogPath, "w");
const viteArguments = EDITION === "studio"
  ? [viteCli, "--config", "vite.studio.config.ts", "--host", "127.0.0.1", "--port", "4173", "--strictPort"]
  : [viteCli, "--host", "127.0.0.1", "--port", "4173", "--strictPort"];
const server = spawn(process.execPath, viteArguments, {
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
  const identity = evaluate(`() => JSON.stringify({
    edition: document.querySelector('meta[name="notefall-edition"]')?.content,
    studioToolbar: !document.querySelector('#studio-toolbar')?.hasAttribute('hidden'),
    studioSettingsNested: Boolean(document.querySelector('#settings-panel #studio-toolbar')),
    topLevelStudioToolbar: Boolean(document.querySelector('.app-shell > #studio-toolbar'))
  })`);
  assert(identity.edition === EDITION, `wrong application edition: ${JSON.stringify(identity)}`);
  assert(identity.studioToolbar === (EDITION === "studio"), "Studio toolbar visibility does not match edition");
  assert(identity.studioSettingsNested && !identity.topLevelStudioToolbar, "Studio connection controls escaped the device settings panel");
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
  const settingsRef = refFor(page, /button "设备设置"[^\n]*\[ref=(e\d+)\]/, "settings button");
  command(["click", settingsRef]);
  page = snapshot();
  if (EDITION === "studio") assert(page.includes('heading "连接 NoteFall Core"'), "Studio Core connection settings are missing");
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
  if (EDITION === "core") {
    assert(page.includes('option "五线谱" [selected]'), "Core MusicXML import did not select sheet view");
  }
  assert(page.includes('generic "五线谱"'), "OSMD sheet container did not render");
  const loadedMobile = evaluate(`() => JSON.stringify({
    overflow: document.documentElement.scrollWidth > innerWidth,
    score: document.querySelector('#score-name')?.textContent,
    duration: document.querySelector('#score-time')?.textContent,
    sheetVisible: !document.querySelector('#sheet-view')?.hasAttribute('hidden'),
    notation: Boolean(document.querySelector('#sheet-view svg')),
    view: document.querySelector('#view-mode')?.value,
    waterfallVisible: !document.querySelector('#waterfall')?.hasAttribute('hidden')
  })`);
  assert(!loadedMobile.overflow, "loaded mobile score overflows horizontally");
  assert(loadedMobile.score === "Parser Etude · 4 音符", "loaded score identity changed");
  assert(loadedMobile.duration === "00:00 / 00:04", "loaded score duration changed");
  assert(loadedMobile.sheetVisible && loadedMobile.notation, "sheet view is empty after MusicXML import");
  assert(loadedMobile.view === (EDITION === "studio" ? "split" : "sheet"), "MusicXML selected the wrong default view");
  assert(loadedMobile.waterfallVisible === (EDITION === "studio"), "split view did not expose the waterfall");
  const measureSeek = evaluate(`() => {
    const pills = [...document.querySelectorAll('#measure-rail button[data-occurrence]')];
    const target = pills.at(-1);
    target?.click();
    const seek = document.querySelector('#measure-seek');
    return JSON.stringify({
      pills: pills.length,
      label: seek?.textContent,
      disabled: seek?.disabled,
      hint: document.querySelector('#measure-nav-hint')?.textContent,
    });
  }`);
  assert(measureSeek.pills > 0 && measureSeek.label === "从 A 开始" && !measureSeek.disabled, "measure seek did not become available after selecting A");
  evaluate(`() => { document.querySelector('#measure-seek')?.click(); return JSON.stringify(document.querySelector('#measure-nav-hint')?.textContent); }`);
  assert(evaluate(`() => document.querySelector('#measure-nav-hint')?.textContent?.includes('已定位到')`), "measure seek did not start a fresh practice position");
  const theme = evaluate(`() => {
    const select = document.querySelector('#visual-theme');
    select.value = 'contrast';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ selected: select.value, stored: localStorage.getItem('notefall88.visual-theme.v1') });
  }`);
  assert(theme.selected === 'contrast' && theme.stored === 'contrast', "visual theme selection was not applied or persisted");
  const focusRef = refFor(page, /button "全屏演奏"[^\n]*\[ref=(e\d+)\]/, "fullscreen performance button");
  command(["click", focusRef]);
  await waitForCondition(
    `() => JSON.stringify({
      focused: document.querySelector('.app-shell')?.dataset.focus === 'true',
      exitVisible: !document.querySelector('#focus-exit')?.hasAttribute('hidden'),
      transportHidden: getComputedStyle(document.querySelector('.transport-card')).display === 'none',
      visualizerHeight: document.querySelector('#visualizer-card')?.getBoundingClientRect().height ?? 0
    })`,
    "focus mode did not transition",
  );
  const focusState = evaluate(`() => JSON.stringify({
    focused: document.querySelector('.app-shell')?.dataset.focus === 'true',
    exitVisible: !document.querySelector('#focus-exit')?.hasAttribute('hidden'),
    transportHidden: getComputedStyle(document.querySelector('.transport-card')).display === 'none',
    visualizerHeight: document.querySelector('#visualizer-card')?.getBoundingClientRect().height ?? 0
  })`);
  assert(focusState.focused && focusState.exitVisible && focusState.transportHidden, "focus mode does not hide controls safely");
  assert(focusState.visualizerHeight >= mobile.height - 14, "focus mode does not expand the practice surface");
  page = snapshot();
  const focusExitRef = refFor(page, /button "退出全屏"[^\n]*\[ref=(e\d+)\]/, "fullscreen performance exit button");
  command(["click", focusExitRef]);
  assert(evaluate(`() => document.querySelector('.app-shell')?.dataset.focus !== 'true'`), "focus mode does not exit");
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

  command(["resize", "1600", "1068"]);
  evaluate(`() => JSON.stringify(Boolean(window.scrollTo(0, 0) ?? true))`);
  let tabletSingleSheet = null;
  if (EDITION === "studio") {
    tabletSingleSheet = evaluate(`() => {
      const select = document.querySelector('#view-mode');
      select.value = 'waterfall';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.value = 'sheet';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const sheet = document.querySelector('#sheet-view');
      const notation = sheet?.querySelector('svg');
      return JSON.stringify({
        view: select.value,
        visible: sheet ? !sheet.hasAttribute('hidden') : false,
        overflow: sheet ? sheet.scrollWidth > sheet.clientWidth + 1 : true,
        sheetWidth: sheet?.getBoundingClientRect().width ?? 0,
        notationWidth: notation?.getBoundingClientRect().width ?? 0,
      });
    }`);
    assert(tabletSingleSheet.view === "sheet" && tabletSingleSheet.visible, "3:2 Studio single-sheet mode was not applied");
    assert(!tabletSingleSheet.overflow, "3:2 Studio single-sheet mode overflows horizontally");
    assert(tabletSingleSheet.notationWidth >= tabletSingleSheet.sheetWidth * 0.9, `3:2 Studio notation does not use the performance surface: ${JSON.stringify(tabletSingleSheet)}`);
    evaluate(`() => {
      const select = document.querySelector('#view-mode');
      select.value = 'split';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return JSON.stringify(select.value);
    }`);
  }
  const tablet = evaluate(`() => JSON.stringify({
    width: innerWidth,
    height: innerHeight,
    threeByTwoLayout: matchMedia('(min-width: 1000px) and (min-aspect-ratio: 7 / 5) and (max-aspect-ratio: 8 / 5)').matches,
    overflow: document.documentElement.scrollWidth > innerWidth,
    cardHeight: document.querySelector('#visualizer-card')?.getBoundingClientRect().height ?? 0,
    cardBottom: document.querySelector('#visualizer-card')?.getBoundingClientRect().bottom ?? 99999,
    waterfallHeight: document.querySelector('#waterfall')?.getBoundingClientRect().height ?? 0,
    sheetHorizontalOverflow: document.querySelector('#sheet-view') ? document.querySelector('#sheet-view').scrollWidth > document.querySelector('#sheet-view').clientWidth + 1 : true,
    view: document.querySelector('#view-mode')?.value
  })`);
  assert(tablet.width === 1600 && tablet.height === 1068 && tablet.threeByTwoLayout, "3:2 tablet viewport was not applied");
  assert(!tablet.overflow && !tablet.sheetHorizontalOverflow, "3:2 tablet layout overflows horizontally");
  assert(tablet.cardHeight >= 460 && tablet.cardBottom <= tablet.height + 1, `3:2 practice surface does not keep the keyboard in the first viewport: ${JSON.stringify(tablet)}`);
  if (EDITION === "studio") {
    assert(tablet.view === "split" && tablet.waterfallHeight >= 280, "3:2 Studio split does not reserve enough space for the waterfall keyboard");
  }
  command(["screenshot"]);

  command(["resize", "3200", "2136"]);
  const physicalPanelFallback = evaluate(`() => JSON.stringify({
    width: innerWidth,
    height: innerHeight,
    threeByTwoLayout: matchMedia('(min-width: 1000px) and (min-aspect-ratio: 7 / 5) and (max-aspect-ratio: 8 / 5)').matches,
    overflow: document.documentElement.scrollWidth > innerWidth,
    notation: Boolean(document.querySelector('#sheet-view svg')),
    sheetHorizontalOverflow: document.querySelector('#sheet-view') ? document.querySelector('#sheet-view').scrollWidth > document.querySelector('#sheet-view').clientWidth + 1 : true,
  })`);
  assert(physicalPanelFallback.width === 3200 && physicalPanelFallback.height === 2136 && physicalPanelFallback.threeByTwoLayout, "physical-panel fallback viewport was not applied");
  assert(!physicalPanelFallback.overflow && !physicalPanelFallback.sheetHorizontalOverflow && physicalPanelFallback.notation, `physical-panel fallback layout is invalid: ${JSON.stringify(physicalPanelFallback)}`);

  console.log(JSON.stringify({
    passed: true,
    edition: EDITION,
    browser: BROWSER,
    viewports: [[390, 844], [1280, 900], [1600, 1068], [3200, 2136]],
    tabletPhysicalPanel: [3200, 2136],
    tabletSingleSheet,
    physicalPanelFallback,
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
