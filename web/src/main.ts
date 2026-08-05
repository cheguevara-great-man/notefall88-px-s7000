import "./style.css";

import {
  clampPianoNote,
  FIRST_PIANO_NOTE,
  normalizeKeyOffsets,
  pianoNoteName,
} from "./calibration";
import { DeviceLink } from "./device";
import { parseMidiFile } from "./midi";
import { parseMusicXmlFile } from "./musicxml";
import { ScoreLibrary } from "./library";
import type { LibraryFolder, LibraryScore } from "./library";
import {
  PerformanceRecorder,
  recordingDuration,
  recordingToMidi,
} from "./performance";
import {
  chordsInRange,
  filterNotesByHand,
  groupChords,
  nextRealtimeChord,
  normalizeLoop,
  PracticeScore,
  RealtimeMatcher,
  ScoreClock,
  targetNotes,
  WaitMatcher,
} from "./practice";
import type { Chord, LoopRange } from "./practice";
import type {
  DeviceStatus,
  HandSelection,
  MidiControlEvent,
  MidiInputEvent,
  ParsedScore,
  PracticeMode,
  TargetNote,
} from "./types";
import { WaterfallRenderer } from "./waterfall";
import { SheetRenderer } from "./sheet";
import { transposeLabel, transposeScore } from "./transpose";

function required<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

const fileInput = required<HTMLInputElement>("midi-file");
const playButton = required<HTMLButtonElement>("play-button");
const resetButton = required<HTMLButtonElement>("reset-button");
const recordButton = required<HTMLButtonElement>("record-button");
const recordDownload = required<HTMLButtonElement>("record-download");
const modeSelect = required<HTMLSelectElement>("practice-mode");
const tempoSelect = required<HTMLSelectElement>("tempo");
const viewMode = required<HTMLSelectElement>("view-mode");
const handSelect = required<HTMLSelectElement>("hand-selection");
const leadTime = required<HTMLInputElement>("lead-time");
const transposeInput = required<HTMLInputElement>("transpose");
const loopEnabled = required<HTMLInputElement>("loop-enabled");
const loopStart = required<HTMLInputElement>("loop-start");
const loopEnd = required<HTMLInputElement>("loop-end");
const loopControls = required("loop-controls");
const deviceStatus = required<HTMLSpanElement>("device-status");
const pianoStatus = required<HTMLSpanElement>("piano-status");
const sustainStatus = required<HTMLSpanElement>("sustain-status");
const scoreName = required("score-name");
const scoreTime = required("score-time");
const scoreResult = required("score-result");
const recordResult = required("record-result");
const latencyStatus = required("latency-status");
const practicePanel = required("practice-panel");
const settingsPanel = required("settings-panel");
const libraryPanel = required("library-panel");
const libraryList = required("library-list");
const librarySummary = required("library-summary");
const librarySearch = required<HTMLInputElement>("library-search");
const libraryFolderFilter = required<HTMLSelectElement>("library-folder-filter");
const brightness = required<HTMLInputElement>("brightness");
const pixelOffset = required<HTMLInputElement>("pixel-offset");
const reversed = required<HTMLInputElement>("strip-reversed");
const keyNote = required<HTMLInputElement>("key-note");
const keyOffset = required<HTMLInputElement>("key-offset");
const waterfallCanvas = required<HTMLCanvasElement>("waterfall");
const visualizerCard = required("visualizer-card");
const sheetView = required("sheet-view");
const renderer = new WaterfallRenderer(waterfallCanvas);
const sheetRenderer = new SheetRenderer(sheetView);
const device = new DeviceLink();
const clock = new ScoreClock();
const waitMatcher = new WaitMatcher();
const practiceScore = new PracticeScore();
const realtimeMatcher = new RealtimeMatcher(practiceScore);
const recorder = new PerformanceRecorder();
const library = new ScoreLibrary();

let score: ParsedScore | undefined;
let sourceScore: ParsedScore | undefined;
let chords: Chord[] = [];
let waitIndex = 0;
let currentTarget: TargetNote[] = [];
let lastTargetSignature = "";
let pressed = new Set<number>();
let wrong = new Set<number>();
let mode: PracticeMode = "wait";
let hand: HandSelection = "both";
let leadMs = 900;
let lastScoreSeconds = 0;
let lastStatsSignature = "";
let lastRecording = recorder.snapshot();
let pianoWasConnected = false;
let scoreXml: string | undefined;
let transposeSemitones = 0;
let libraryFolders: LibraryFolder[] = [];
let libraryScores: LibraryScore[] = [];
let keyOffsets = normalizeKeyOffsets([]);

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remaining = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function formatHex(value: number | undefined, width = 4): string {
  if (value === undefined || value === 0) return "--";
  return value.toString(16).toUpperCase().padStart(width, "0");
}

function setStatus(element: HTMLElement, online: boolean, label: string): void {
  element.dataset.state = online ? "online" : "offline";
  element.textContent = label;
}

function selectedLoop(): LoopRange | undefined {
  if (!score || !loopEnabled.checked) return undefined;
  return normalizeLoop(Number(loopStart.value), Number(loopEnd.value), score.duration);
}

function rangeStart(): number {
  return selectedLoop()?.start ?? 0;
}

function rangeEnd(): number {
  return selectedLoop()?.end ?? score?.duration ?? 0;
}

function currentWaitChord(): Chord | undefined {
  return chords[waitIndex];
}

function renderStats(): void {
  const stats = practiceScore.snapshot();
  const signature = `${stats.hits}:${stats.wrong}:${stats.missed}:${stats.accuracy.toFixed(1)}`;
  if (signature === lastStatsSignature) return;
  lastStatsSignature = signature;
  scoreResult.textContent =
    `命中 ${stats.hits} · 错 ${stats.wrong} · 漏 ${stats.missed} · ${Math.round(stats.accuracy)}%`;
}

function updateTarget(scoreSeconds: number): void {
  const loop = selectedLoop();
  const chord = mode === "wait"
    ? currentWaitChord()
    : nextRealtimeChord(chords, scoreSeconds, leadMs, loop);
  currentTarget = targetNotes(chord);
  const signature = currentTarget.map((target) => `${target.note}:${target.hand}`).join(",");
  if (signature !== lastTargetSignature) {
    device.setTargets(currentTarget);
    lastTargetSignature = signature;
    if (mode === "wait") waitMatcher.setChord(chord);
  }
}

function updateScoreLabel(): void {
  if (!score) return;
  const selectedCount = filterNotesByHand(score.notes, hand).length;
  const suffix = selectedCount === score.notes.length ? "" : ` · 当前声部 ${selectedCount}`;
  const transposeSuffix = transposeSemitones === 0 ? "" : ` · ${transposeLabel(transposeSemitones)}`;
  scoreName.textContent = `${score.name} · ${score.notes.length} 音符${suffix}${transposeSuffix}`;
}

function resetPractice(resetStats = true): void {
  const start = rangeStart();
  clock.reset(start);
  waitIndex = 0;
  pressed = new Set();
  wrong = new Set();
  lastTargetSignature = "";
  lastScoreSeconds = start;
  if (resetStats) practiceScore.reset();
  realtimeMatcher.setChords(chords);
  waitMatcher.setChord(currentWaitChord());
  updateTarget(start);
  playButton.textContent = mode === "wait" ? "开始练习" : "播放";
  renderStats();
}

function rebuildPractice(): void {
  if (!score) return;
  const filtered = filterNotesByHand(score.notes, hand);
  chords = chordsInRange(groupChords(filtered), selectedLoop());
  renderer.setPracticeView(hand, selectedLoop());
  playButton.disabled = chords.length === 0;
  resetButton.disabled = chords.length === 0;
  updateScoreLabel();
  resetPractice(true);
}

function configureLoopInputs(): void {
  if (!score) return;
  const duration = Math.max(0.5, score.duration);
  loopStart.max = String(duration);
  loopEnd.max = String(duration);
  loopStart.value = "0";
  loopEnd.value = String(score.duration);
  loopStart.disabled = !loopEnabled.checked;
  loopEnd.disabled = !loopEnabled.checked;
  loopControls.setAttribute("aria-disabled", String(!loopEnabled.checked));
  updateLoopLabels();
}

function updateLoopLabels(): void {
  if (!score) {
    required("loop-start-value").textContent = "00:00";
    required("loop-end-value").textContent = "00:00";
    return;
  }
  const normalized = normalizeLoop(Number(loopStart.value), Number(loopEnd.value), score.duration);
  loopStart.value = String(normalized.start);
  loopEnd.value = String(normalized.end);
  required("loop-start-value").textContent = formatTime(normalized.start);
  required("loop-end-value").textContent = formatTime(normalized.end);
}

function advanceWaitMode(): void {
  waitIndex += 1;
  if (waitIndex >= chords.length) {
    if (selectedLoop() && chords.length > 0) waitIndex = 0;
    else {
      clock.seek(rangeEnd());
      waitMatcher.setChord(undefined);
      lastTargetSignature = "";
      playButton.textContent = "已完成";
      return;
    }
  }
  const next = currentWaitChord();
  if (next) clock.seek(next.start);
  lastTargetSignature = "";
  waitMatcher.setChord(next);
}

function handleMidi(event: MidiInputEvent): void {
  if (event.note < 21 || event.note > 108) return;
  if (event.state === "on") {
    pressed.add(event.note);
    if (score && mode === "wait" && currentWaitChord()) {
      const result = waitMatcher.noteOn(event.note);
      if (result.newlyMatched) practiceScore.recordHit();
      else if (!result.correct) {
        practiceScore.recordWrong();
        wrong.add(event.note);
      }
      if (result.complete) advanceWaitMode();
    } else if (score && mode === "realtime" && clock.isRunning()) {
      const result = realtimeMatcher.noteOn(event.note, lastScoreSeconds);
      if (!result.correct) wrong.add(event.note);
    }
  } else {
    pressed.delete(event.note);
    wrong.delete(event.note);
    waitMatcher.noteOff(event.note);
  }
  recorder.handleMidi(event, performance.now());
  renderStats();
}

function handleControl(event: MidiControlEvent): void {
  recorder.handleControl(event, performance.now());
  if (event.controller === 64) {
    const down = event.value >= 64;
    setStatus(sustainStatus, down, down ? "延音踏板踩下" : "延音踏板松开");
  } else if (event.controller === 120 || event.controller === 123) {
    pressed.clear();
    wrong.clear();
  }
}

function finishRecording(): void {
  lastRecording = recorder.stop(performance.now());
  const duration = recordingDuration(lastRecording);
  recordButton.textContent = "录制演奏";
  recordDownload.disabled = lastRecording.length === 0;
  recordResult.textContent = lastRecording.length === 0
    ? "没有收到音符"
    : `${lastRecording.length} 音符 · ${formatTime(duration)}`;
}

recordButton.addEventListener("click", () => {
  if (recorder.isRecording()) {
    finishRecording();
    return;
  }
  recorder.start(performance.now());
  lastRecording = [];
  recordButton.textContent = "停止录制";
  recordDownload.disabled = true;
  recordResult.textContent = "正在录制…";
});

recordDownload.addEventListener("click", () => {
  if (lastRecording.length === 0) return;
  const name = `${score?.name ?? "NoteFall"} - 演奏 ${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const bytes = recordingToMidi(lastRecording, name);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.mid`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
});

function parseScoreSource(buffer: ArrayBuffer, fileName: string): { parsed: ParsedScore; xml?: string } {
  if (/\.(mid|midi)$/i.test(fileName)) return { parsed: parseMidiFile(buffer, fileName) };
  if (/\.(xml|musicxml|mxl)$/i.test(fileName)) {
    const result = parseMusicXmlFile(buffer, fileName);
    return { parsed: result.score, xml: result.xml };
  }
  throw new Error("支持 MIDI、MusicXML、XML 和 MXL 文件");
}

async function activateScore(parsed: ParsedScore, xml?: string): Promise<void> {
  sourceScore = parsed;
  score = transposeScore(parsed, transposeSemitones);
  scoreXml = xml;
  if (xml) {
    viewMode.value = "sheet";
    // OSMD must render into a visible, non-zero-width container. Rendering
    // while the sheet panel is still hidden can cause pathological layout.
    updateViewMode();
    await sheetRenderer.load(xml, score, transposeSemitones);
  } else {
    sheetRenderer.clear();
    viewMode.value = "waterfall";
  }
  updateViewMode();
  renderer.setScore(score);
  configureLoopInputs();
  rebuildPractice();
}

async function loadScoreBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  saveToLibrary: boolean,
): Promise<void> {
  const { parsed, xml } = parseScoreSource(buffer, fileName);
  if (saveToLibrary) await library.saveScore(buffer, parsed, fileName);
  await activateScore(parsed, xml);
}

fileInput.addEventListener("change", async () => {
  const files = [...(fileInput.files ?? [])];
  if (files.length === 0) return;
  try {
    scoreName.textContent = "正在解析乐谱…";
    let first: { parsed: ParsedScore; xml?: string } | undefined;
    let added = 0;
    let duplicates = 0;
    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const parsed = parseScoreSource(buffer, file.name);
      if (!first) first = parsed;
      const saved = await library.saveScore(buffer, parsed.parsed, file.name);
      if (saved.duplicate) duplicates += 1;
      else added += 1;
    }
    if (first) await activateScore(first.parsed, first.xml);
    await refreshLibrary();
    if (files.length > 1) librarySummary.textContent = `批量导入完成：新增 ${added}，重复 ${duplicates}`;
  } catch (error) {
    scoreName.textContent = `无法读取：${error instanceof Error ? error.message : "未知错误"}`;
  } finally {
    fileInput.value = "";
  }
});

function updateViewMode(): void {
  const wantsSheet = viewMode.value === "sheet";
  const showSheet = wantsSheet && !!scoreXml;
  if (wantsSheet && !scoreXml) viewMode.value = "waterfall";
  waterfallCanvas.hidden = showSheet;
  sheetView.hidden = !showSheet;
  visualizerCard.dataset.view = showSheet ? "sheet" : "waterfall";
}

viewMode.addEventListener("change", updateViewMode);

function formatLibraryDuration(seconds: number): string {
  return formatTime(seconds);
}

function createLibraryItem(item: LibraryScore): HTMLElement {
  const card = document.createElement("article");
  card.className = "library-item";
  card.dataset.scoreId = item.id;
  const head = document.createElement("div");
  head.className = "library-item-head";
  const title = document.createElement("div");
  title.className = "library-item-title";
  const strong = document.createElement("strong");
  strong.textContent = item.title;
  const details = document.createElement("small");
  details.textContent = `${item.format === "musicxml" ? "MusicXML" : "MIDI"} · ${item.noteCount} 音符 · ${formatLibraryDuration(item.duration)} · ${Math.ceil(item.sourceBytes / 1024)} KiB`;
  title.append(strong, details);
  const actions = document.createElement("div");
  actions.className = "library-item-actions";
  for (const [action, label] of [["open", "打开"], ["rename", "重命名"], ["delete", "删除"]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.textContent = label;
    if (action === "open") button.className = "primary";
    actions.append(button);
  }
  head.append(title, actions);
  const folder = document.createElement("select");
  folder.dataset.action = "move";
  const rootOption = document.createElement("option");
  rootOption.value = "";
  rootOption.textContent = "未分类";
  folder.append(rootOption);
  for (const available of libraryFolders) {
    const option = document.createElement("option");
    option.value = available.id;
    option.textContent = available.name;
    folder.append(option);
  }
  folder.value = item.folderId ?? "";
  folder.setAttribute("aria-label", `移动 ${item.title} 到文件夹`);
  card.append(head, folder);
  return card;
}

function renderLibrary(): void {
  const query = librarySearch.value.trim().toLocaleLowerCase("zh-CN");
  const selectedFolder = libraryFolderFilter.value;
  const filtered = libraryScores.filter((item) => {
    const matchesText = !query || `${item.title}\n${item.fileName}`.toLocaleLowerCase("zh-CN").includes(query);
    const matchesFolder = selectedFolder === "all"
      || (selectedFolder === "root" ? item.folderId === null : item.folderId === selectedFolder);
    return matchesText && matchesFolder;
  });
  libraryList.replaceChildren();
  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "library-empty";
    empty.textContent = libraryScores.length === 0 ? "曲库为空；点击“导入乐谱”即可加入。" : "没有符合筛选条件的乐谱。";
    libraryList.append(empty);
  } else {
    filtered.forEach((item) => libraryList.append(createLibraryItem(item)));
  }
  const bytes = libraryScores.reduce((sum, item) => sum + item.sourceBytes, 0);
  librarySummary.textContent = `${libraryScores.length} 首 · ${libraryFolders.length} 个文件夹 · ${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

async function refreshLibrary(): Promise<void> {
  [libraryFolders, libraryScores] = await Promise.all([library.listFolders(), library.listScores()]);
  const current = libraryFolderFilter.value || "all";
  libraryFolderFilter.replaceChildren();
  for (const [value, label] of [["all", "全部文件夹"], ["root", "未分类"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    libraryFolderFilter.append(option);
  }
  for (const folder of libraryFolders) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    libraryFolderFilter.append(option);
  }
  libraryFolderFilter.value = [...libraryFolderFilter.options].some((option) => option.value === current) ? current : "all";
  renderLibrary();
}

librarySearch.addEventListener("input", renderLibrary);
libraryFolderFilter.addEventListener("change", renderLibrary);
libraryList.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  const card = button?.closest<HTMLElement>("[data-score-id]");
  const id = card?.dataset.scoreId;
  if (!button || !id) return;
  try {
    if (button.dataset.action === "open") {
      const stored = await library.getScore(id);
      if (!stored) throw new Error("乐谱不存在");
      await loadScoreBuffer(stored.source, stored.fileName, false);
      libraryPanel.hidden = true;
    } else if (button.dataset.action === "rename") {
      const stored = libraryScores.find((item) => item.id === id);
      const next = window.prompt("新的乐谱名称", stored?.title ?? "");
      if (next !== null) await library.renameScore(id, next);
    } else if (button.dataset.action === "delete") {
      const stored = libraryScores.find((item) => item.id === id);
      if (window.confirm(`从当前浏览器删除“${stored?.title ?? "这首乐谱"}”？请先确认已经备份。`)) {
        await library.deleteScore(id);
      }
    }
    await refreshLibrary();
  } catch (error) {
    librarySummary.textContent = error instanceof Error ? error.message : "曲库操作失败";
  }
});
libraryList.addEventListener("change", async (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>("select[data-action='move']");
  const id = select?.closest<HTMLElement>("[data-score-id]")?.dataset.scoreId;
  if (!select || !id) return;
  try {
    await library.moveScore(id, select.value || null);
    await refreshLibrary();
  } catch (error) {
    librarySummary.textContent = error instanceof Error ? error.message : "无法移动乐谱";
  }
});

required<HTMLFormElement>("folder-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = required<HTMLInputElement>("folder-name");
  try {
    await library.createFolder(input.value);
    input.value = "";
    await refreshLibrary();
  } catch (error) {
    librarySummary.textContent = error instanceof Error ? error.message : "无法创建文件夹";
  }
});

required("library-backup").addEventListener("click", async () => {
  try {
    const backup = await library.exportBackup();
    const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `notefall88-library-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) {
    librarySummary.textContent = error instanceof Error ? error.message : "无法导出备份";
  }
});

required<HTMLInputElement>("library-restore").addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const result = await library.importBackup(JSON.parse(await file.text()));
    await refreshLibrary();
    librarySummary.textContent = `恢复完成：${result.foldersAdded} 个文件夹，${result.scoresAdded} 首乐谱，跳过 ${result.duplicatesSkipped} 个重复文件`;
  } catch (error) {
    librarySummary.textContent = error instanceof Error ? error.message : "备份恢复失败";
  } finally {
    input.value = "";
  }
});

playButton.addEventListener("click", () => {
  if (!score || chords.length === 0) return;
  if (mode === "wait") {
    clock.seek(currentWaitChord()?.start ?? rangeEnd());
    playButton.textContent = "等待你弹";
    return;
  }
  if (clock.isRunning()) {
    clock.pause(performance.now());
    playButton.textContent = "继续";
  } else {
    if (lastScoreSeconds >= rangeEnd()) clock.seek(rangeStart());
    clock.play(performance.now());
    playButton.textContent = "暂停";
  }
});

resetButton.addEventListener("click", () => resetPractice(true));
modeSelect.addEventListener("change", () => {
  mode = modeSelect.value as PracticeMode;
  resetPractice(true);
});
tempoSelect.addEventListener("change", () => clock.setSpeed(Number(tempoSelect.value), performance.now()));
handSelect.addEventListener("change", () => {
  hand = handSelect.value as HandSelection;
  rebuildPractice();
});
leadTime.addEventListener("input", () => {
  leadMs = Number(leadTime.value);
  required("lead-value").textContent = `${(leadMs / 1000).toFixed(1)} 秒`;
  lastTargetSignature = "";
});
transposeInput.addEventListener("input", () => {
  transposeSemitones = Number(transposeInput.value);
  required("transpose-value").textContent = transposeLabel(transposeSemitones);
  if (!sourceScore) return;
  score = transposeScore(sourceScore, transposeSemitones);
  renderer.setScore(score);
  if (scoreXml) sheetRenderer.setTranspose(transposeSemitones);
  rebuildPractice();
});
loopEnabled.addEventListener("change", () => {
  loopStart.disabled = !loopEnabled.checked;
  loopEnd.disabled = !loopEnabled.checked;
  loopControls.setAttribute("aria-disabled", String(!loopEnabled.checked));
  rebuildPractice();
});
for (const input of [loopStart, loopEnd]) {
  input.addEventListener("input", () => {
    updateLoopLabels();
    rebuildPractice();
  });
}

required("practice-options-button").addEventListener("click", () => {
  settingsPanel.hidden = true;
  libraryPanel.hidden = true;
  practicePanel.hidden = false;
});
required("practice-close").addEventListener("click", () => { practicePanel.hidden = true; });
required("settings-button").addEventListener("click", () => {
  practicePanel.hidden = true;
  libraryPanel.hidden = true;
  settingsPanel.hidden = false;
});
required("settings-close").addEventListener("click", () => { settingsPanel.hidden = true; });
required("library-button").addEventListener("click", () => {
  practicePanel.hidden = true;
  settingsPanel.hidden = true;
  libraryPanel.hidden = false;
  void refreshLibrary().catch((error: unknown) => {
    librarySummary.textContent = error instanceof Error ? error.message : "无法打开曲库";
  });
});
required("library-close").addEventListener("click", () => { libraryPanel.hidden = true; });

function sendCalibration(): void {
  required("brightness-value").textContent = `${brightness.value} / 4`;
  required("offset-value").textContent = pixelOffset.value;
  device.configure(Number(brightness.value), Number(pixelOffset.value), reversed.checked);
}

function updateKeyCalibration(): void {
  const note = clampPianoNote(Number(keyNote.value));
  keyNote.value = String(note);
  keyOffset.value = String(keyOffsets[note - FIRST_PIANO_NOTE] ?? 0);
  required("key-note-value").textContent = `${pianoNoteName(note)} (${note})`;
  required("key-offset-value").textContent = keyOffset.value;
}

function selectCalibrationNote(note: number): void {
  keyNote.value = String(clampPianoNote(note));
  updateKeyCalibration();
}

brightness.addEventListener("input", sendCalibration);
pixelOffset.addEventListener("input", sendCalibration);
reversed.addEventListener("change", sendCalibration);
required("test-a0").addEventListener("click", () => device.testNote(21));
required("test-c4").addEventListener("click", () => device.testNote(60));
required("test-c8").addEventListener("click", () => device.testNote(108));
required("blackout").addEventListener("click", () => device.blackout());
keyNote.addEventListener("input", updateKeyCalibration);
keyOffset.addEventListener("input", () => {
  const note = clampPianoNote(Number(keyNote.value));
  const offset = Number(keyOffset.value);
  keyOffsets[note - FIRST_PIANO_NOTE] = offset;
  required("key-offset-value").textContent = String(offset);
  device.setKeyOffset(note, offset);
  device.testNote(note);
});
required("key-previous").addEventListener("click", () => selectCalibrationNote(Number(keyNote.value) - 1));
required("key-next").addEventListener("click", () => selectCalibrationNote(Number(keyNote.value) + 1));
required("key-test").addEventListener("click", () => device.testNote(Number(keyNote.value)));
required("key-reset").addEventListener("click", () => {
  keyOffset.value = "0";
  keyOffset.dispatchEvent(new Event("input"));
});
required<HTMLFormElement>("wifi-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const ssid = required<HTMLInputElement>("wifi-ssid").value.trim();
  const password = required<HTMLInputElement>("wifi-password").value;
  if (ssid) device.saveWifi(ssid, password);
});

device.onConnection((connected) => {
  setStatus(deviceStatus, connected, connected ? "ESP 已连接" : "ESP 未连接");
});
device.onStatus((status: DeviceStatus) => {
  setStatus(pianoStatus, status.piano, status.piano ? "钢琴 USB 已连接" : "钢琴未连接");
  if (pianoWasConnected && !status.piano) {
    pressed.clear();
    wrong.clear();
    recorder.allNotesOff(performance.now());
    setStatus(sustainStatus, false, "延音踏板松开");
  }
  pianoWasConnected = status.piano;
  brightness.value = String(status.brightness);
  pixelOffset.value = String(status.offset);
  reversed.checked = status.reversed;
  required("brightness-value").textContent = `${status.brightness} / 4`;
  required("offset-value").textContent = String(status.offset);
  required("diag-version").textContent = `${status.firmware ?? "--"} / v${status.protocol ?? "--"}`;
  required("diag-usb-id").textContent = `${formatHex(status.usbVid)}:${formatHex(status.usbPid)}`;
  required("diag-endpoint").textContent = status.usbEndpoint
    ? `0x${formatHex(status.usbEndpoint, 2)} / ${status.usbPacketSize ?? "--"} B`
    : "--";
  required("diag-packets").textContent = String(status.usbPackets ?? "--");
  required("diag-errors").textContent = `${status.usbDropped ?? "--"} / ${status.usbErrors ?? "--"}`;
  required("diag-connections").textContent = String(status.usbConnections ?? "--");
  required("diag-heap").textContent = status.freeHeap === undefined
    ? "--"
    : `${Math.round(status.freeHeap / 1024)} KiB`;
  required("diag-psram").textContent = status.psramBytes
    ? `${(status.freePsram ?? 0) / 1024 / 1024 > 0
      ? ((status.freePsram ?? 0) / 1024 / 1024).toFixed(1)
      : "0.0"} / ${(status.psramBytes / 1024 / 1024).toFixed(1)} MiB`
    : "未检测到";
  required("diag-rssi").textContent = status.rssi ? `${status.rssi} dBm` : "热点模式";
  if (status.protocol !== undefined && status.protocol !== 4) {
    deviceStatus.textContent = `协议不兼容 v${status.protocol}`;
    deviceStatus.dataset.state = "offline";
  }
});
device.onMidi(handleMidi);
device.onControl(handleControl);
device.onCalibration((calibration) => {
  keyOffsets = normalizeKeyOffsets(calibration.offsets);
  updateKeyCalibration();
});
device.connect();
void refreshLibrary().catch((error: unknown) => {
  librarySummary.textContent = error instanceof Error ? error.message : "无法打开曲库";
});

function frame(now: number): void {
  let scoreSeconds = clock.time(now);
  if (score) {
    const loop = selectedLoop();
    if (mode === "wait") {
      scoreSeconds = currentWaitChord()?.start ?? rangeEnd();
    } else if (clock.isRunning() && loop && scoreSeconds >= loop.end) {
      realtimeMatcher.advance(loop.end + 0.251);
      const span = loop.end - loop.start;
      scoreSeconds = loop.start + ((scoreSeconds - loop.start) % span);
      clock.seek(scoreSeconds, now);
      realtimeMatcher.restartPass();
      lastTargetSignature = "";
    } else if (scoreSeconds >= score.duration) {
      realtimeMatcher.advance(score.duration + 0.251);
      clock.pause(now);
      scoreSeconds = score.duration;
      playButton.textContent = "重播";
    }
    if (mode === "realtime" && clock.isRunning()) realtimeMatcher.advance(scoreSeconds);
    lastScoreSeconds = scoreSeconds;
    updateTarget(scoreSeconds);
    scoreTime.textContent = `${formatTime(scoreSeconds)} / ${formatTime(score.duration)}`;
    renderStats();
  }
  const expected = new Set(currentTarget.map((target) => target.note));
  if (viewMode.value === "sheet" && scoreXml) {
    sheetRenderer.seek(lastScoreSeconds);
  } else {
    renderer.setState(pressed, expected, wrong);
    renderer.render(lastScoreSeconds);
  }
  latencyStatus.textContent =
    `WebSocket ${device.latencyMs === undefined ? "--" : Math.round(device.latencyMs)} ms`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
