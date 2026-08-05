import "./style.css";

import { DeviceLink } from "./device";
import { parseMidiFile } from "./midi";
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
  MidiInputEvent,
  ParsedScore,
  PracticeMode,
  TargetNote,
} from "./types";
import { WaterfallRenderer } from "./waterfall";

function required<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

const fileInput = required<HTMLInputElement>("midi-file");
const playButton = required<HTMLButtonElement>("play-button");
const resetButton = required<HTMLButtonElement>("reset-button");
const modeSelect = required<HTMLSelectElement>("practice-mode");
const tempoSelect = required<HTMLSelectElement>("tempo");
const handSelect = required<HTMLSelectElement>("hand-selection");
const leadTime = required<HTMLInputElement>("lead-time");
const loopEnabled = required<HTMLInputElement>("loop-enabled");
const loopStart = required<HTMLInputElement>("loop-start");
const loopEnd = required<HTMLInputElement>("loop-end");
const loopControls = required("loop-controls");
const deviceStatus = required<HTMLSpanElement>("device-status");
const pianoStatus = required<HTMLSpanElement>("piano-status");
const scoreName = required("score-name");
const scoreTime = required("score-time");
const scoreResult = required("score-result");
const latencyStatus = required("latency-status");
const practicePanel = required("practice-panel");
const settingsPanel = required("settings-panel");
const brightness = required<HTMLInputElement>("brightness");
const pixelOffset = required<HTMLInputElement>("pixel-offset");
const reversed = required<HTMLInputElement>("strip-reversed");
const renderer = new WaterfallRenderer(required<HTMLCanvasElement>("waterfall"));
const device = new DeviceLink();
const clock = new ScoreClock();
const waitMatcher = new WaitMatcher();
const practiceScore = new PracticeScore();
const realtimeMatcher = new RealtimeMatcher(practiceScore);

let score: ParsedScore | undefined;
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
  scoreName.textContent = `${score.name} · ${score.notes.length} 音符${suffix}`;
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
  renderStats();
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    score = parseMidiFile(await file.arrayBuffer(), file.name);
    renderer.setScore(score);
    configureLoopInputs();
    rebuildPractice();
  } catch (error) {
    scoreName.textContent = `无法读取：${error instanceof Error ? error.message : "未知错误"}`;
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
  practicePanel.hidden = false;
});
required("practice-close").addEventListener("click", () => { practicePanel.hidden = true; });
required("settings-button").addEventListener("click", () => {
  practicePanel.hidden = true;
  settingsPanel.hidden = false;
});
required("settings-close").addEventListener("click", () => { settingsPanel.hidden = true; });

function sendCalibration(): void {
  required("brightness-value").textContent = `${brightness.value} / 4`;
  required("offset-value").textContent = pixelOffset.value;
  device.configure(Number(brightness.value), Number(pixelOffset.value), reversed.checked);
}
brightness.addEventListener("input", sendCalibration);
pixelOffset.addEventListener("input", sendCalibration);
reversed.addEventListener("change", sendCalibration);
required("test-a0").addEventListener("click", () => device.testNote(21));
required("test-c4").addEventListener("click", () => device.testNote(60));
required("test-c8").addEventListener("click", () => device.testNote(108));
required("blackout").addEventListener("click", () => device.blackout());
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
  required("diag-rssi").textContent = status.rssi ? `${status.rssi} dBm` : "热点模式";
  if (status.protocol !== undefined && status.protocol !== 2) {
    deviceStatus.textContent = `协议不兼容 v${status.protocol}`;
    deviceStatus.dataset.state = "offline";
  }
});
device.onMidi(handleMidi);
device.connect();

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
  renderer.setState(pressed, expected, wrong);
  renderer.render(lastScoreSeconds);
  latencyStatus.textContent =
    `WebSocket ${device.latencyMs === undefined ? "--" : Math.round(device.latencyMs)} ms`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
