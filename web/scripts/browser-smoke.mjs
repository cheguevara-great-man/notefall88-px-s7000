import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
const longScorePath = join(ARTIFACTS, "long-follow-study.musicxml");
const longMeasures = Array.from({ length: 48 }, (_, index) => {
  const number = index + 1;
  const setup = number === 1
    ? `<attributes><divisions>1</divisions><staves>2</staves><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>2400</per-minute></metronome></direction-type><sound tempo="2400"/></direction>`
    : number % 4 === 1 ? `<print new-system="yes"/>` : "";
  const octave = 4 + Math.floor((index % 8) / 4);
  const notes = ["C", "E", "G", "D"].map((step) => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`).join("");
  const bass = `<backup><duration>4</duration></backup><note><pitch><step>C</step><octave>${2 + index % 2}</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>`;
  return `<measure number="${number}">${setup}${notes}${bass}</measure>`;
}).join("");
writeFileSync(longScorePath, `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Long Follow Study</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${longMeasures}</part></score-partwise>`);
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
  const preview = evaluate(`() => {
    const select = document.querySelector('#preview-seconds');
    if (!select) return JSON.stringify({ missing: true });
    select.value = '6.5';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({
      selected: select.value,
      stored: JSON.parse(localStorage.getItem('notefall88.preferences.v1') ?? '{}').previewSeconds,
    });
  }`);
  assert(!preview.missing && preview.selected === '6.5' && preview.stored === 6.5, "waterfall preview horizon was not applied or persisted");
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
  const tabletFocus = evaluate(`() => {
    document.querySelector('#focus-button')?.click();
    const shell = document.querySelector('.app-shell');
    const card = document.querySelector('#visualizer-card');
    return JSON.stringify({
      focused: shell?.dataset.focus === 'true',
      entryHidden: getComputedStyle(document.querySelector('#focus-button')).display === 'none',
      exitVisible: getComputedStyle(document.querySelector('#focus-exit')).display !== 'none',
      topbarHidden: getComputedStyle(document.querySelector('.topbar')).display === 'none',
      transportHidden: getComputedStyle(document.querySelector('.transport-card')).display === 'none',
      scoreStripHidden: getComputedStyle(document.querySelector('.score-strip')).display === 'none',
      cardHeight: card?.getBoundingClientRect().height ?? 0,
      cardTop: card?.getBoundingClientRect().top ?? -1,
    });
  }`);
  assert(tabletFocus.focused && tabletFocus.entryHidden && tabletFocus.exitVisible, `3200x2136 focus controls are invalid: ${JSON.stringify(tabletFocus)}`);
  assert(tabletFocus.topbarHidden && tabletFocus.transportHidden && tabletFocus.scoreStripHidden, `3200x2136 focus mode leaves top controls in layout: ${JSON.stringify(tabletFocus)}`);
  assert(tabletFocus.cardHeight >= 2122 && tabletFocus.cardTop <= 7, `3200x2136 focus surface does not fill the panel: ${JSON.stringify(tabletFocus)}`);
  command(["screenshot"]);
  evaluate(`() => { document.querySelector('#focus-exit')?.click(); return JSON.stringify(true); }`);

  command(["resize", "1600", "1068"]);
  page = snapshot();
  const longImportRef = refFor(page, /generic \[ref=(e\d+)\][^\n]*: 导入乐谱/, "long score import control");
  command(["click", longImportRef]);
  command(["upload", longScorePath]);
  await waitForCondition(
    `() => JSON.stringify(document.querySelector('#score-name')?.textContent === 'Long Follow Study · 240 音符')`,
    "synthetic long score did not render",
  );
  const followBefore = evaluate(`() => JSON.stringify({
    scrollTop: document.querySelector('#sheet-view')?.scrollTop ?? -1,
    scrollHeight: document.querySelector('#sheet-view')?.scrollHeight ?? 0,
    clientHeight: document.querySelector('#sheet-view')?.clientHeight ?? 0,
    svgHeight: document.querySelector('#sheet-view svg')?.getBoundingClientRect().height ?? 0,
  })`);
  assert(followBefore.scrollHeight > followBefore.clientHeight, `synthetic long score is not scrollable: ${JSON.stringify(followBefore)}`);
  const longPlayback = evaluate(`() => {
    const mode = document.querySelector('#practice-mode');
    mode.value = 'realtime';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    const countIn = document.querySelector('#count-in-enabled');
    countIn.checked = false;
    countIn.dispatchEvent(new Event('change', { bubbles: true }));
    const autoFullscreen = document.querySelector('#auto-fullscreen');
    autoFullscreen.checked = true;
    autoFullscreen.dispatchEvent(new Event('change', { bubbles: true }));
    const play = document.querySelector('#play-button');
    play.click();
    const stored = JSON.parse(localStorage.getItem('notefall88.preferences.v1') ?? '{}');
    return JSON.stringify({
      mode: mode.value,
      button: play.textContent,
      countIn: countIn.checked,
      autoFullscreen: autoFullscreen.checked,
      storedAutoFullscreen: stored.autoFullscreen,
      focused: document.querySelector('.app-shell')?.dataset.focus === 'true',
    });
  }`);
  assert(longPlayback.mode === 'realtime' && longPlayback.countIn === false, `long-score realtime mode did not start: ${JSON.stringify(longPlayback)}`);
  assert(longPlayback.autoFullscreen && longPlayback.storedAutoFullscreen && longPlayback.focused, `automatic fullscreen preference did not persist or activate: ${JSON.stringify(longPlayback)}`);
  await waitForCondition(
    `() => JSON.stringify((document.querySelector('#sheet-view')?.scrollTop ?? 0) > 20)`,
    "score cursor did not advance the long sheet to a later system",
    100,
  );
  const followAfter = evaluate(`() => JSON.stringify({
    scrollTop: document.querySelector('#sheet-view')?.scrollTop ?? -1,
    currentMeasure: document.querySelector('#measure-current')?.textContent,
  })`);
  assert(followAfter.scrollTop > followBefore.scrollTop, `long-score following did not move forward: ${JSON.stringify({ followBefore, followAfter })}`);
  let phraseMapSamples = null;
  if (EDITION === "studio") {
    phraseMapSamples = evaluate(`() => {
      const canvas = document.querySelector('#waterfall');
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return JSON.stringify({ available: false, colored: 0 });
      const keyboardTop = canvas.height * .78;
      const railWidth = Math.max(12, Math.min(22, canvas.width * .012));
      const railX = canvas.width - railWidth - Math.max(6, canvas.width * .004);
      const leftX = Math.round(railX + railWidth * .25);
      const rightX = Math.round(railX + railWidth * .75);
      let coloredLeft = 0;
      let coloredRight = 0;
      for (let index = 0; index < 72; index += 1) {
        const y = Math.round(Math.max(12, keyboardTop * .025) + (index + .5) * (keyboardTop - Math.max(12, keyboardTop * .025) - 12) / 72);
        const left = context.getImageData(leftX, y, 1, 1).data;
        const right = context.getImageData(rightX, y, 1, 1).data;
        if (Math.max(left[0], left[1], left[2]) - Math.min(left[0], left[1], left[2]) > 28) coloredLeft += 1;
        if (Math.max(right[0], right[1], right[2]) - Math.min(right[0], right[1], right[2]) > 28) coloredRight += 1;
      }
      return JSON.stringify({ available: true, coloredLeft, coloredRight });
    }`);
    assert(phraseMapSamples.available && phraseMapSamples.coloredLeft >= 8 && phraseMapSamples.coloredRight >= 8, `whole-score phrase map is not visible in both Canvas hand lanes: ${JSON.stringify(phraseMapSamples)}`);
  }
  command(["screenshot"]);

  console.log(JSON.stringify({
    passed: true,
    edition: EDITION,
    browser: BROWSER,
    viewports: [[390, 844], [1280, 900], [1600, 1068], [3200, 2136]],
    tabletPhysicalPanel: [3200, 2136],
    tabletSingleSheet,
    physicalPanelFallback,
    tabletFocus,
    score: "Long Follow Study",
    notes: 240,
    longScoreFollow: { before: followBefore, after: followAfter },
    phraseMapSamples,
    artifacts: ARTIFACTS,
  }, null, 2));
} finally {
  try { command(["close"], { parse: false }); } catch { /* best effort */ }
  if (!server.killed) server.kill();
  closeSync(serverLog);
}
