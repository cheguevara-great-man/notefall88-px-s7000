import "./style.css";

import { DeviceLink } from "./device";
import { parseMidiFile } from "./midi";
import { groupChords, nextRealtimeChord, ScoreClock, targetNotes, WaitMatcher } from "./practice";
import type { Chord } from "./practice";
import type { DeviceStatus, MidiInputEvent, ParsedScore, PracticeMode, TargetNote } from "./types";
import { WaterfallRenderer } from "./waterfall";

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

const fileInput = required<HTMLInputElement>("midi-file");
const playButton = required<HTMLButtonElement>("play-button");
const resetButton = required<HTMLButtonElement>("reset-button");
const modeSelect = required<HTMLSelectElement>("practice-mode");
const tempoSelect = required<HTMLSelectElement>("tempo");
const deviceStatus = required<HTMLSpanElement>("device-status");
const pianoStatus = required<HTMLSpanElement>("piano-status");
const scoreName = required<HTMLElement>("score-name");
const scoreTime = required<HTMLElement>("score-time");
const scoreResult = required<HTMLElement>("score-result");
const latencyStatus = required<HTMLElement>("latency-status");
const settingsPanel = required<HTMLElement>("settings-panel");
const brightness = required<HTMLInputElement>("brightness");
const pixelOffset = required<HTMLInputElement>("pixel-offset");
const reversed = required<HTMLInputElement>("strip-reversed");
const renderer = new WaterfallRenderer(required<HTMLCanvasElement>("waterfall"));
const device = new DeviceLink();
const clock = new ScoreClock();
const matcher = new WaitMatcher();

let score: ParsedScore | undefined;
let chords: Chord[] = [];
let waitIndex = 0;
let currentTarget: TargetNote[] = [];
let lastTargetSignature = "";
let pressed = new Set<number>();
let wrong = new Set<number>();
let hits = 0;
let attempts = 0;
let mode: PracticeMode = "wait";

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remaining = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function setStatus(element: HTMLElement, online: boolean, label: string): void {
  element.dataset.state = online ? "online" : "offline";
  element.textContent = label;
}

function currentWaitChord(): Chord | undefined {
  return chords[waitIndex];
}

function updateTarget(scoreSeconds: number): void {
  const chord = mode === "wait" ? currentWaitChord() : nextRealtimeChord(chords, scoreSeconds, 900);
  currentTarget = targetNotes(chord);
  const signature = currentTarget.map((target) => `${target.note}:${target.hand}`).join(",");
  if (signature !== lastTargetSignature) {
    device.setTargets(currentTarget);
    lastTargetSignature = signature;
    matcher.setChord(chord);
  }
}

function resetPractice(): void {
  clock.reset(0);
  waitIndex = 0;
  pressed = new Set();
  wrong = new Set();
  hits = 0;
  attempts = 0;
  lastTargetSignature = "";
  matcher.setChord(currentWaitChord());
  updateTarget(0);
  playButton.textContent = "播放";
  scoreResult.textContent = "0 / 0";
}

function handleMidi(event: MidiInputEvent): void {
  if (event.note < 21 || event.note > 108) return;
  if (event.state === "on") {
    pressed.add(event.note);
    const result = matcher.noteOn(event.note);
    attempts += 1;
    if (result.correct) hits += 1;
    else wrong.add(event.note);
    if (mode === "wait" && result.complete && score) {
      waitIndex += 1;
      const next = currentWaitChord();
      if (next) clock.seek(Math.max(0, next.start - 0.02));
      else clock.seek(score.duration);
      lastTargetSignature = "";
      matcher.setChord(next);
    }
  } else {
    pressed.delete(event.note);
    wrong.delete(event.note);
    matcher.noteOff(event.note);
  }
  scoreResult.textContent = `${hits} / ${attempts}`;
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    score = parseMidiFile(await file.arrayBuffer(), file.name);
    chords = groupChords(score.notes);
    renderer.setScore(score);
    scoreName.textContent = `${score.name} · ${score.notes.length} 音符`;
    playButton.disabled = score.notes.length === 0;
    resetButton.disabled = score.notes.length === 0;
    resetPractice();
  } catch (error) {
    scoreName.textContent = `无法读取：${error instanceof Error ? error.message : "未知错误"}`;
  }
});

playButton.addEventListener("click", () => {
  if (!score) return;
  if (mode === "wait") {
    clock.seek(currentWaitChord()?.start ?? score.duration);
    playButton.textContent = "等待你弹";
    return;
  }
  if (clock.isRunning()) {
    clock.pause(performance.now());
    playButton.textContent = "继续";
  } else {
    clock.play(performance.now());
    playButton.textContent = "暂停";
  }
});

resetButton.addEventListener("click", resetPractice);
modeSelect.addEventListener("change", () => {
  mode = modeSelect.value as PracticeMode;
  resetPractice();
});
tempoSelect.addEventListener("change", () => clock.setSpeed(Number(tempoSelect.value), performance.now()));

required("settings-button").addEventListener("click", () => { settingsPanel.hidden = false; });
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
required("wifi-save").addEventListener("click", () => {
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
});
device.onMidi(handleMidi);
device.connect();

function frame(now: number): void {
  let scoreSeconds = clock.time(now);
  if (score) {
    if (mode === "wait") scoreSeconds = currentWaitChord()?.start ?? score.duration;
    if (scoreSeconds >= score.duration && mode === "realtime") {
      clock.pause(now);
      playButton.textContent = "重播";
    }
    updateTarget(scoreSeconds);
    scoreTime.textContent = `${formatTime(scoreSeconds)} / ${formatTime(score.duration)}`;
  }
  const expected = new Set(currentTarget.map((target) => target.note));
  renderer.setState(pressed, expected, wrong);
  renderer.render(scoreSeconds);
  latencyStatus.textContent = `WebSocket ${device.latencyMs === undefined ? "--" : Math.round(device.latencyMs)} ms`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
