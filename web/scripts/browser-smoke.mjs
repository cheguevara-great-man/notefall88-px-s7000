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
const PORT = Number(process.env.NOTEFALL_PORT || 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const viteCli = join(WEB, "node_modules", "vite", "bin", "vite.js");
const playwrightCli = join(WEB, "node_modules", "@playwright", "cli", "playwright-cli.js");

if (EDITION === "studio") {
  const synced = spawnSync(process.execPath, [join(WEB, "scripts", "sync-studio-vendor.mjs")], {
    cwd: WEB,
    encoding: "utf8",
    windowsHide: true,
  });
  if (synced.status !== 0) throw new Error(`Studio vendor sync failed\n${synced.stdout}\n${synced.stderr}`);
}

mkdirSync(ARTIFACTS, { recursive: true });
const longScorePath = join(ARTIFACTS, "long-follow-study.musicxml");
const dynamicsScorePath = join(ARTIFACTS, "dynamics-visual-probe.musicxml");
const repeatCursorScorePath = join(ARTIFACTS, "repeat-cursor-probe.musicxml");
const midiNotationPath = join(ARTIFACTS, "notefall-midi-sheet-test.mid");
const midiTrack = Buffer.from([
  0x00, 0xff, 0x03, 0x18, ...Buffer.from("NoteFall MIDI Sheet Test", "ascii"),
  0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
  0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
  0x00, 0x90, 0x3c, 0x64, 0x83, 0x60, 0x80, 0x3c, 0x00,
  0x00, 0x90, 0x40, 0x64, 0x83, 0x60, 0x80, 0x40, 0x00,
  0x00, 0x90, 0x43, 0x64, 0x83, 0x60, 0x80, 0x43, 0x00,
  0x00, 0xff, 0x2f, 0x00,
]);
const midiTrackLength = Buffer.alloc(4);
midiTrackLength.writeUInt32BE(midiTrack.length);
writeFileSync(midiNotationPath, Buffer.concat([
  Buffer.from([0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0]),
  Buffer.from([0x4d, 0x54, 0x72, 0x6b]),
  midiTrackLength,
  midiTrack,
]));
writeFileSync(repeatCursorScorePath, `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Repeat Cursor Probe</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="60"/></direction><direction><direction-type><pedal type="start" line="yes"/></direction-type></direction><direction><direction-type><pedal type="stop" line="yes"/></direction-type><offset>2</offset></direction><barline location="left"><repeat direction="forward"/></barline>${["C", "D", "E", "F"].map((step) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`).join("")}</measure><measure number="2">${["G", "A", "B", "C"].map((step, index) => `<note><pitch><step>${step}</step><octave>${index === 3 ? 5 : 4}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`).join("")}<barline location="right"><repeat direction="backward" times="2"/></barline></measure></part></score-partwise>`);
writeFileSync(dynamicsScorePath, `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Dynamics Visual Probe</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><sound tempo="60"/></direction><forward><duration>2</duration></forward><direction><direction-type><dynamics><p/></dynamics></direction-type><staff>1</staff></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><backup><duration>1</duration></backup><direction><direction-type><dynamics><fff/></dynamics></direction-type><staff>2</staff></direction><note><pitch><step>C</step><octave>6</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff></note></measure></part></score-partwise>`);
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
  ? [viteCli, "--config", "vite.studio.config.ts", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"]
  : [viteCli, "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"];
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
    overflow: document.documentElement.scrollWidth > innerWidth,
    overflowing: [...document.querySelectorAll('*')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > innerWidth + 0.5 || rect.left < -0.5 || element.scrollWidth > element.clientWidth + 1;
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        className: typeof element.className === 'string' ? element.className : '',
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
      }))
  })`);
  assert(mobile.width === 390 && mobile.height === 844, `mobile viewport was not applied: ${JSON.stringify(mobile)}`);
  assert(!mobile.overflow && mobile.documentWidth === 390 && mobile.bodyWidth === 390, `mobile page overflows horizontally: ${JSON.stringify(mobile)}`);

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
  let studioConversion = null;
  let studioMidiNotation = null;
  if (EDITION === "studio") {
    const advancedAccept = evaluate(`() => JSON.stringify(document.querySelector('#midi-file')?.getAttribute('accept') ?? '')`);
    assert(advancedAccept.includes('.mscz') && advancedAccept.includes('.gp5'), `Studio advanced formats are absent: ${advancedAccept}`);
    command(["click", importRef]);
    command(["upload", join(WEB, "test-fixtures", "notefall-minimal.mscx")]);
    await waitForCondition(
      `() => JSON.stringify(
        document.querySelector('#score-name')?.textContent === 'NoteFall Converter Test · 3 音符'
        && Boolean(document.querySelector('#sheet-view svg'))
      )`,
      "offline MSCX conversion and rendering did not finish before the deadline",
      600,
    );
    studioConversion = evaluate(`() => JSON.stringify({
      score: document.querySelector('#score-name')?.textContent,
      resources: performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.includes('webmscore')),
    })`);
    // Worker-internal WASM fetches have their own Resource Timing context;
    // the page can directly observe the local worker module entry only.
    assert(studioConversion.resources.length >= 1, `bundled webmscore runtime was not loaded: ${JSON.stringify(studioConversion)}`);
    assert(studioConversion.resources.every((url) => url.startsWith(`${BASE_URL}/vendor/webmscore-0.21.0-a/`)),
      `Studio conversion escaped to a public CDN: ${JSON.stringify(studioConversion)}`);

    command(["click", importRef]);
    command(["upload", midiNotationPath]);
    await waitForCondition(
      `() => JSON.stringify(
        document.querySelector('#score-name')?.textContent === 'NoteFall MIDI Sheet Test · 3 音符'
        && Boolean(document.querySelector('#sheet-view svg'))
      )`,
      "native MIDI notation companion did not render before the deadline",
      600,
    );
    studioMidiNotation = evaluate(`async () => {
      const scores = await new Promise((resolve, reject) => {
        const request = indexedDB.open('notefall88-library');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction('scores', 'readonly');
          const all = tx.objectStore('scores').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => resolve(all.result);
        };
      });
      const stored = scores.find((score) => score.fileName === 'notefall-midi-sheet-test.mid');
      return JSON.stringify({
        score: document.querySelector('#score-name')?.textContent,
        view: document.querySelector('#view-mode')?.value,
        format: stored?.format,
        sourceBytes: stored?.sourceBytes,
        notationBytes: stored?.notationBytes,
        notationRoot: stored?.notationXml?.includes('<score-partwise'),
      });
    }`);
    assert(studioMidiNotation.format === 'midi'
      && studioMidiNotation.sourceBytes > 0
      && studioMidiNotation.notationBytes > 0
      && studioMidiNotation.notationRoot
      && studioMidiNotation.view === 'split',
    `MIDI source/notation dual-track persistence failed: ${JSON.stringify(studioMidiNotation)}`);
  }
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
  const demonstrationPreview = evaluate(`() => {
    const tempo = document.querySelector('#tempo');
    const listen = document.querySelector('#listen-button');
    if (!tempo || !listen) return JSON.stringify({ missing: true });
    tempo.value = '150';
    tempo.dispatchEvent(new Event('change', { bubbles: true }));
    listen.click();
    return JSON.stringify({
      missing: false,
      active: listen.dataset.active,
      label: listen.textContent,
      playDisabled: document.querySelector('#play-button')?.disabled,
      recordDisabled: document.querySelector('#record-button')?.disabled,
    });
  }`);
  assert(!demonstrationPreview.missing
    && demonstrationPreview.active === 'true'
    && demonstrationPreview.label.includes('停止示范')
    && demonstrationPreview.playDisabled
    && demonstrationPreview.recordDisabled,
  `silent piano demonstration preview did not start safely: ${JSON.stringify(demonstrationPreview)}`);
  await waitForCondition(
    `() => JSON.stringify(['00:01 / 00:04', '00:02 / 00:04', '00:03 / 00:04', '00:04 / 00:04']
      .includes(document.querySelector('#score-time')?.textContent ?? ''))`,
    "piano demonstration timeline did not advance",
    30,
  );
  const demonstrationStopped = evaluate(`() => {
    const listen = document.querySelector('#listen-button');
    if (listen?.dataset.active === 'true') listen.click();
    const tempo = document.querySelector('#tempo');
    if (tempo) {
      tempo.value = '100';
      tempo.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return JSON.stringify({
      active: listen?.dataset.active,
      label: listen?.textContent,
      playDisabled: document.querySelector('#play-button')?.disabled,
      recordDisabled: document.querySelector('#record-button')?.disabled,
      time: document.querySelector('#score-time')?.textContent,
    });
  }`);
  assert(demonstrationStopped.active === 'false'
    && demonstrationStopped.label === '示范当前声部'
    && demonstrationStopped.playDisabled === false
    && demonstrationStopped.recordDisabled === false,
  `piano demonstration preview did not stop safely: ${JSON.stringify(demonstrationStopped)}`);
  const judgementProfile = evaluate(`() => {
    const select = document.querySelector('#timing-profile');
    const status = document.querySelector('#timing-profile-status');
    if (!select || !status) return JSON.stringify({ missing: true });
    select.value = 'strict';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const strict = {
      selected: select.value,
      stored: JSON.parse(localStorage.getItem('notefall88.preferences.v1') ?? '{}').timingProfile,
      status: status.textContent,
    };
    select.value = 'adaptive';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ strict, restored: select.value });
  }`);
  assert(!judgementProfile.missing
    && judgementProfile.strict.selected === 'strict'
    && judgementProfile.strict.stored === 'strict'
    && judgementProfile.strict.status.includes('ms')
    && judgementProfile.restored === 'adaptive',
  `adaptive judgement profile did not apply or persist: ${JSON.stringify(judgementProfile)}`);
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
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
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
    sheetScrollWidth: document.querySelector('#sheet-view')?.scrollWidth ?? 0,
    sheetClientWidth: document.querySelector('#sheet-view')?.clientWidth ?? 0,
    notationWidth: document.querySelector('#sheet-view svg')?.getBoundingClientRect().width ?? 0,
    cursorLeft: document.querySelector('#sheet-view img[id*="cursor"]')?.getBoundingClientRect().left ?? -1,
    cursorWidth: document.querySelector('#sheet-view img[id*="cursor"]')?.getBoundingClientRect().width ?? -1,
    view: document.querySelector('#view-mode')?.value
  })`);
  assert(tablet.width === 1600 && tablet.height === 1068 && tablet.threeByTwoLayout, "3:2 tablet viewport was not applied");
  assert(!tablet.overflow && !tablet.sheetHorizontalOverflow, `3:2 tablet layout overflows horizontally: ${JSON.stringify(tablet)}`);
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

  command(["click", importRef]);
  command(["upload", repeatCursorScorePath]);
  await waitForCondition(
    `() => JSON.stringify(document.querySelector('#score-name')?.textContent?.startsWith('Repeat Cursor Probe'))`,
    "repeat-aware cursor score did not render",
  );
  const repeatCursor = evaluate(`async () => {
    const sample = async (seconds) => {
      window.dispatchEvent(new CustomEvent('notefall:test-score-seek', { detail: { seconds } }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const sheet = document.querySelector('#sheet-view');
      const cursor = sheet?.querySelector('img[id*="cursor"]');
      return {
        occurrence: sheet?.dataset.cursorOccurrence,
        quarter: sheet?.dataset.cursorQuarter,
        steps: Number(sheet?.dataset.cursorSteps ?? -1),
        actualMeasure: sheet?.dataset.cursorActualMeasure,
        actualQuarter: sheet?.dataset.cursorActualQuarter,
        left: cursor?.getBoundingClientRect().left ?? -1,
      };
    };
    const first = await sample(.01);
    const repeated = await sample(8.01);
    const pedalCueTotal = Number(document.querySelector('#waterfall')?.dataset.pedalCueTotal ?? -1);
    window.dispatchEvent(new CustomEvent('notefall:test-score-seek', { detail: { clear: true } }));
    return JSON.stringify({ first, repeated, pedalCueTotal });
  }`);
  assert(repeatCursor.first.occurrence === '0' && repeatCursor.repeated.occurrence === '2'
    && repeatCursor.first.actualMeasure === '1' && repeatCursor.repeated.actualMeasure === '1',
    `score cursor did not traverse the repeated playback occurrence: ${JSON.stringify(repeatCursor)}`);
  assert(Math.abs(repeatCursor.first.left - repeatCursor.repeated.left) < 2,
    `repeated written measure did not return to the same notation position: ${JSON.stringify(repeatCursor)}`);
  assert(repeatCursor.pedalCueTotal === 4,
    `expanded MusicXML pedal cues were not delivered to the waterfall: ${JSON.stringify(repeatCursor)}`);
  const measureHeat = evaluate(`async () => {
    const mode = document.querySelector('#practice-mode');
    mode.value = 'realtime';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    const emit = (detail) => window.dispatchEvent(new CustomEvent('notefall:test-practice-event', { detail }));
    const pedal = (detail) => window.dispatchEvent(new CustomEvent('notefall:test-pedal-control', { detail }));
    pedal({ value: 127, scoreTime: .02, pass: 0 });
    pedal({ value: 0, scoreTime: 2.02, pass: 0 });
    emit({ kind: 'hit', note: 60, hand: 'right', velocity: 92, scoreTime: .2, timingMs: 10 });
    emit({ kind: 'hit', note: 67, hand: 'right', velocity: 86, scoreTime: 4.2, timingMs: 140 });
    emit({ kind: 'missed', note: 69, hand: 'right', scoreTime: 4.4 });
    [40, 60, 80, 100].forEach((targetVelocity, index) => emit({
      kind: 'hit', note: 60 + index, hand: 'right', velocity: targetVelocity + 10,
      targetVelocity, scoreTime: .6 + index, timingMs: 12,
      targetDurationMs: 500, keyDurationMs: 500, soundingDurationMs: 500, sustained: false,
    }));
    [2.15, 2.55, 2.95, 3.35].forEach((scoreTime, index) => {
      emit({ kind: 'hit', note: 48 + index, hand: 'left', velocity: 82, scoreTime, timingMs: 0 });
      emit({ kind: 'hit', note: 72 + index, hand: 'right', velocity: 84, scoreTime, timingMs: 20 });
    });
    window.dispatchEvent(new CustomEvent('notefall:test-score-seek', { detail: { seconds: 4.3 } }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const overview = [...document.querySelectorAll('#measure-overview .measure-heat')];
    const current = overview.find((item) => item.dataset.current === 'true');
    const result = {
      count: overview.length,
      tones: overview.map((item) => item.dataset.tone),
      currentTone: current?.dataset.tone,
      currentOccurrence: current?.dataset.occurrence,
      currentHeight: current?.getBoundingClientRect().height ?? 0,
      overviewHeight: document.querySelector('#measure-overview')?.getBoundingClientRect().height ?? 0,
      weakPill: document.querySelector('.measure-pill[data-occurrence="1"]')?.dataset.tone,
      expression: document.querySelector('#insight-velocity')?.textContent,
      articulation: document.querySelector('#insight-articulation')?.textContent,
      pedal: document.querySelector('#insight-pedal')?.textContent,
      scorePedal: document.querySelector('#insight-score-pedal')?.textContent,
      coordination: document.querySelector('#insight-coordination')?.textContent,
      handAlignment: document.querySelector('#insight-hand-alignment')?.textContent,
      practiceQueueItems: document.querySelectorAll('#practice-queue [data-score-id]').length,
      practiceQueueText: document.querySelector('#practice-queue [data-score-id]')?.textContent,
    };
    window.dispatchEvent(new CustomEvent('notefall:test-score-seek', { detail: { clear: true } }));
    return JSON.stringify(result);
  }`);
  assert(measureHeat.count === 4 && measureHeat.tones[0] === 'clean' && measureHeat.tones[1] === 'weak',
    `measure heat ribbon did not encode clean and weak measures: ${JSON.stringify(measureHeat)}`);
  assert(measureHeat.currentOccurrence === '1' && measureHeat.currentTone === 'weak'
    && measureHeat.currentHeight > measureHeat.overviewHeight,
    `measure heat ribbon did not emphasize the current weak measure: ${JSON.stringify(measureHeat)}`);
  assert(measureHeat.expression?.includes('轮廓 100%') && measureHeat.expression?.includes('基准 +10'),
    `relative dynamics insight did not separate contour and touch offset: ${JSON.stringify(measureHeat)}`);
  assert(measureHeat.articulation?.includes('覆盖 100%') && measureHeat.articulation?.includes('释放 100%')
      && measureHeat.pedal?.includes('未检测到踏板延音'),
    `pedal-aware articulation insight did not render: ${JSON.stringify(measureHeat)}`);
  assert(measureHeat.scorePedal?.includes('100%') && measureHeat.scorePedal?.includes('命中 2/2')
      && measureHeat.scorePedal?.includes('20 ms'),
    `score-aware pedal insight did not render: ${JSON.stringify(measureHeat)}`);
  assert(measureHeat.coordination?.includes('100%') && measureHeat.coordination?.includes('平均 20')
      && measureHeat.handAlignment?.includes('100%') && measureHeat.handAlignment?.includes('右手晚 20 ms'),
    `chord and cross-hand synchronization insight did not render: ${JSON.stringify(measureHeat)}`);
  assert(measureHeat.practiceQueueItems >= 1 && measureHeat.practiceQueueText?.includes('分钟'),
    `cross-score practice queue was not rendered from local library/history evidence: ${JSON.stringify(measureHeat)}`);
  evaluate(`() => { document.querySelector('#reset-button')?.click(); return JSON.stringify(true); }`);
  await waitForCondition(
    `() => JSON.stringify(!document.querySelector('#circuit-start')?.disabled)`,
    "practice history did not unlock the evidence-backed weak-passage circuit",
  );
  const circuit = evaluate(`() => {
    document.querySelector('#practice-options-button')?.click();
    document.querySelector('#circuit-start')?.click();
    document.querySelector('#practice-options-button')?.click();
    const stored = JSON.parse(localStorage.getItem('notefall88.practice-circuit.v1') ?? 'null');
    const active = document.querySelector('#practice-circuit .circuit-step[data-state="active"]');
    return JSON.stringify({
      storedMissions: stored?.missions?.length ?? 0,
      activeIndex: stored?.activeIndex,
      visible: getComputedStyle(document.querySelector('#practice-circuit')).display,
      activeLabel: active?.querySelector('strong')?.textContent,
      activeTarget: active?.querySelector('small')?.textContent,
      loop: document.querySelector('#loop-enabled')?.checked,
      loopStart: Number(document.querySelector('#loop-start')?.value),
      loopEnd: Number(document.querySelector('#loop-end')?.value),
      hand: document.querySelector('#hand-selection')?.value,
      mode: document.querySelector('#practice-mode')?.value,
      assessmentEnabled: !document.querySelector('#circuit-assess')?.disabled,
    });
  }`);
  assert(circuit.storedMissions >= 1 && circuit.activeIndex === 0 && circuit.visible === 'grid',
    `weak-passage circuit was not generated and persisted: ${JSON.stringify(circuit)}`);
  assert(circuit.loop && circuit.loopStart === 0 && circuit.loopEnd === 8
    && circuit.hand === 'right' && circuit.mode === 'realtime' && circuit.assessmentEnabled,
    `weak-passage circuit did not apply its first evidence-backed mission: ${JSON.stringify(circuit)}`);
  assert(circuit.activeLabel?.includes('M1–M2') && circuit.activeTarget?.includes('连续 2 次'),
    `weak-passage circuit does not expose a readable mastery contract: ${JSON.stringify(circuit)}`);
  evaluate(`() => {
    const emit = (detail) => window.dispatchEvent(new CustomEvent('notefall:test-practice-event', { detail }));
    for (let index = 0; index < 8; index += 1) {
      emit({ kind: 'hit', note: 60 + index % 8, hand: 'right', velocity: 90, scoreTime: index + .2, timingMs: 20 });
    }
    document.querySelector('#circuit-assess')?.click();
    return JSON.stringify(true);
  }`);
  await waitForCondition(
    `() => JSON.stringify(JSON.parse(localStorage.getItem('notefall88.practice-circuit.v1') ?? 'null')?.missions?.[0]?.consecutivePasses === 1)`,
    "a complete clean circuit pass did not advance the consecutive mastery counter",
  );
  const circuitPass = evaluate(`() => JSON.stringify({
    status: document.querySelector('#circuit-status')?.textContent,
    target: document.querySelector('#practice-circuit .circuit-step[data-state="active"] small')?.textContent,
    progress: document.querySelector('#circuit-progress')?.textContent,
  })`);
  assert(circuitPass.status?.includes('再连续通过 1 次') && circuitPass.target?.includes('已 1 次') && circuitPass.progress === '0 / 1',
    `weak-passage circuit did not expose its consecutive mastery progress: ${JSON.stringify(circuitPass)}`);
  command(["screenshot"]);
  evaluate(`() => { document.querySelector('#practice-close')?.click(); return JSON.stringify(true); }`);
  const sheetFeedback = evaluate(`async () => {
    window.dispatchEvent(new CustomEvent('notefall:test-feedback', { detail: { kind: 'hit', note: 60, timingMs: -90 } }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sheet = document.querySelector('#sheet-view');
    const feedback = sheet?.querySelector('.sheet-feedback');
    const box = feedback?.getBoundingClientRect();
    const viewport = sheet?.getBoundingClientRect();
    return JSON.stringify({
      text: feedback?.textContent,
      tone: feedback?.dataset.tone,
      visible: Boolean(box && viewport && box.width > 0 && box.left >= viewport.left && box.right <= viewport.right),
    });
  }`);
  assert(sheetFeedback.tone === 'early' && sheetFeedback.text?.startsWith('早') && sheetFeedback.visible,
    `sheet-only timing feedback is missing or outside the notation viewport: ${JSON.stringify(sheetFeedback)}`);
  command(["screenshot"]);

  command(["click", importRef]);
  command(["upload", dynamicsScorePath]);
  await waitForCondition(
    `() => JSON.stringify(document.querySelector('#score-name')?.textContent?.startsWith('Dynamics Visual Probe'))`,
    "dynamics visual score did not render",
  );
  const dynamicsPixels = evaluate(`() => {
    const select = document.querySelector('#view-mode');
    select.value = 'waterfall';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const hand = document.querySelector('#hand-selection');
    hand.value = 'both';
    hand.dispatchEvent(new Event('change', { bubbles: true }));
    const loop = document.querySelector('#loop-enabled');
    loop.checked = false;
    loop.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ selected: select.value, hand: hand.value, loop: loop.checked });
  }`);
  assert(dynamicsPixels.selected === 'waterfall' && dynamicsPixels.hand === 'both' && !dynamicsPixels.loop,
    "dynamics visual probe did not select the full-score waterfall");
  evaluate(`async () => {
    window.dispatchEvent(new CustomEvent('notefall:test-score-seek', { detail: { seconds: .5 } }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return JSON.stringify(true);
  }`);
  const chordGuidePixels = evaluate(`() => {
    const canvas = document.querySelector('#waterfall');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return JSON.stringify({ available: false });
    const keyboardTop = canvas.height * .78;
    const previewSeconds = Number(document.querySelector('#preview-seconds')?.value ?? 4.2);
    const noteY = keyboardTop - (1.5 / previewSeconds) * keyboardTop;
    const firstX = (23.5 / 52) * canvas.width;
    const lastX = (37.5 / 52) * canvas.width;
    const regionLeft = Math.round(firstX + (lastX - firstX) * .25);
    const regionTop = Math.max(0, Math.round(noteY - 36));
    const regionWidth = Math.max(17, Math.round((lastX - firstX) * .5));
    const regionHeight = 38;
    const pixels = context.getImageData(regionLeft, regionTop, regionWidth, regionHeight);
    let luminous = 0;
    let maximum = 0;
    let maximumAt = [0, 0];
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const red = pixels.data[offset];
      const green = pixels.data[offset + 1];
      const blue = pixels.data[offset + 2];
      if (red + green + blue > maximum) {
        maximum = red + green + blue;
        const pixel = offset / 4;
        maximumAt = [regionLeft + pixel % regionWidth, regionTop + Math.floor(pixel / regionWidth)];
      }
      if (red + green + blue > 330 && (blue > red + 8 || Math.max(red, green, blue) - Math.min(red, green, blue) < 45)) luminous += 1;
    }
    window.dispatchEvent(new CustomEvent('notefall:test-score-seek', { detail: { clear: true } }));
    return JSON.stringify({
      available: true, luminous, maximum, maximumAt, noteY, firstX, lastX, previewSeconds,
      theme: document.querySelector('#visual-theme')?.value,
      drawn: canvas.dataset.chordGuides,
      total: canvas.dataset.chordGuideTotal,
    });
  }`);
  assert(chordGuidePixels.available && chordGuidePixels.luminous >= 2 && chordGuidePixels.maximum >= 230,
    `the cross-hand chord constellation is not visible between note bars: ${JSON.stringify(chordGuidePixels)}`);
  const dynamicsSamples = evaluate(`() => {
    const canvas = document.querySelector('#waterfall');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return JSON.stringify({ available: false });
    const sample = (whiteIndex) => {
      const center = Math.round((whiteIndex + .5) / 52 * canvas.width);
      const radius = Math.max(5, Math.floor(canvas.width / 52 * .35));
      const height = Math.floor(canvas.height * .76);
      const pixels = context.getImageData(center - radius, 0, radius * 2 + 1, height);
      let maximum = 0;
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        maximum = Math.max(maximum, (pixels.data[offset] + pixels.data[offset + 1] + pixels.data[offset + 2]) / 3);
      }
      return maximum;
    };
    return JSON.stringify({ available: true, soft: sample(23), forte: sample(37) });
  }`);
  assert(dynamicsSamples.available && dynamicsSamples.forte >= dynamicsSamples.soft + 28,
    `target dynamics are not visibly encoded at the note head: ${JSON.stringify(dynamicsSamples)}`);
  const timingPixels = evaluate(`async () => {
    window.dispatchEvent(new CustomEvent('notefall:test-feedback', { detail: { kind: 'hit', note: 60, timingMs: -90 } }));
    window.dispatchEvent(new CustomEvent('notefall:test-feedback', { detail: { kind: 'hit', note: 84, timingMs: 110 } }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = document.querySelector('#waterfall');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return JSON.stringify({ available: false });
    const keyboardTop = Math.floor(canvas.height * .78);
    const countTone = (whiteIndex, tone) => {
      const center = Math.round((whiteIndex + .5) / 52 * canvas.width);
      const radius = Math.max(5, Math.floor(canvas.width / 52 * .38));
      const top = Math.max(0, keyboardTop - Math.floor(canvas.height * .06));
      const pixels = context.getImageData(center - radius, top, radius * 2 + 1, keyboardTop - top);
      let count = 0;
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const red = pixels.data[offset];
        const green = pixels.data[offset + 1];
        const blue = pixels.data[offset + 2];
        if (tone === 'early' ? blue > red + 35 && green > red + 25 : red > blue + 55 && green > blue + 25) count += 1;
      }
      return count;
    };
    return JSON.stringify({ available: true, earlyBlue: countTone(23, 'early'), lateOrange: countTone(37, 'late') });
  }`);
  assert(timingPixels.available && timingPixels.earlyBlue >= 5 && timingPixels.lateOrange >= 5,
    `early/late timing cues are not visible beside their keys: ${JSON.stringify(timingPixels)}`);
  const releasePixels = evaluate(`async () => {
    window.dispatchEvent(new CustomEvent('notefall:test-feedback', { detail: { kind: 'release-good', note: 48, timingMs: 100 } }));
    window.dispatchEvent(new CustomEvent('notefall:test-feedback', { detail: { kind: 'release-early', note: 96, timingMs: 40 } }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = document.querySelector('#waterfall');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return JSON.stringify({ available: false });
    const keyboardTop = Math.floor(canvas.height * .78);
    const countTone = (whiteIndex, tone) => {
      const center = Math.round((whiteIndex + .5) / 52 * canvas.width);
      const radius = Math.max(5, Math.floor(canvas.width / 52 * .38));
      const pixels = context.getImageData(center - radius, keyboardTop - 90, radius * 2, 90);
      let count = 0;
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const red = pixels.data[offset];
        const green = pixels.data[offset + 1];
        const blue = pixels.data[offset + 2];
        if (tone === 'good'
          ? green > red + 55 && blue > red + 40
          : red > blue + 70 && green > blue + 25) count += 1;
      }
      return count;
    };
    return JSON.stringify({ available: true, releaseGood: countTone(16, 'good'), releaseEarly: countTone(44, 'early') });
  }`);
  assert(releasePixels.available && releasePixels.releaseGood >= 5 && releasePixels.releaseEarly >= 5,
    `release coverage cues are not visibly distinct: ${JSON.stringify(releasePixels)}`);
  command(["screenshot"]);

  command(["resize", "1600", "1068"]);
  page = snapshot();
  const longImportRef = refFor(page, /generic \[ref=(e\d+)\][^\n]*: 导入乐谱/, "long score import control");
  command(["click", longImportRef]);
  command(["upload", longScorePath]);
  await waitForCondition(
    `() => JSON.stringify(document.querySelector('#score-name')?.textContent === 'Long Follow Study · 240 音符')`,
    "synthetic long score did not render",
  );
  const noteCursor = evaluate(`async () => {
    const sample = async (seconds) => {
      window.dispatchEvent(new CustomEvent('notefall:test-score-seek', { detail: { seconds } }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const sheet = document.querySelector('#sheet-view');
      const cursor = sheet?.querySelector('img[id*="cursor"]');
      return {
        occurrence: sheet?.dataset.cursorOccurrence,
        quarter: sheet?.dataset.cursorQuarter,
        hand: sheet?.dataset.cursorHand,
        sourceHash: [...(cursor?.getAttribute('src') ?? '')].reduce((hash, character) => (hash * 33 + character.charCodeAt(0)) >>> 0, 5381),
        left: cursor?.getBoundingClientRect().left ?? -1,
      };
    };
    const first = await sample(.005);
    const second = await sample(.03);
    window.dispatchEvent(new CustomEvent('notefall:test-score-seek', { detail: { clear: true } }));
    return JSON.stringify({ first, second });
  }`);
  assert(noteCursor.first.occurrence === '0' && noteCursor.second.occurrence === '0',
    `score cursor escaped its measure during the note-level probe: ${JSON.stringify(noteCursor)}`);
  assert(noteCursor.first.quarter === '0' && noteCursor.second.quarter === '1'
    && noteCursor.second.left > noteCursor.first.left + 2,
    `score cursor did not advance between notes in one measure: ${JSON.stringify(noteCursor)}`);
  assert(noteCursor.first.hand === 'both' && noteCursor.second.hand === 'right'
    && noteCursor.first.sourceHash !== noteCursor.second.sourceHash,
    `score cursor did not encode the active hand color: ${JSON.stringify(noteCursor)}`);
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
  assert(followAfter.scrollTop > followBefore.scrollTop + 150, `long-score following did not keep pace with a later system: ${JSON.stringify({ followBefore, followAfter })}`);
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
    dynamicsPixels: dynamicsSamples,
    chordGuidePixels,
    timingPixels,
    releasePixels,
    score: "Long Follow Study",
    notes: 240,
    longScoreFollow: { before: followBefore, after: followAfter },
    noteCursor,
    repeatCursor,
    measureHeat,
    sheetFeedback,
    phraseMapSamples,
    studioConversion,
    studioMidiNotation,
    demonstrationPreview: { started: demonstrationPreview, stopped: demonstrationStopped },
    artifacts: ARTIFACTS,
  }, null, 2));
} finally {
  try { command(["close"], { parse: false }); } catch { /* best effort */ }
  if (!server.killed) server.kill();
  closeSync(serverLog);
}
