import "./style.css";

import { PracticeAnalytics, PracticeSessionStore } from "./analytics";
import type { PracticeEvent, PracticeSession } from "./analytics";
import { recommendPractice } from "./coach";
import type { PracticeRecommendation } from "./coach";
import {
  commissioningReport,
  completeCommissioning,
  loadCommissioning,
  missingCommissioningEvidence,
  observeDevice,
  observeMidi,
  saveCommissioning,
} from "./commissioning";
import type { CommissioningState } from "./commissioning";
import {
  clampPianoNote,
  FIRST_PIANO_NOTE,
  normalizeKeyOffsets,
  pianoNoteName,
} from "./calibration";
import { DeviceLink } from "./device";
import { parseMidiFile } from "./midi";
import { MetronomePlayer } from "./metronome";
import { parseMusicXmlFile } from "./musicxml";
import { ScoreLibrary } from "./library";
import type { LibraryFolder, LibraryScore } from "./library";
import {
  PerformanceRecorder,
  recordingDuration,
  recordingToMidi,
} from "./performance";
import { loadPreferences, savePreferences } from "./preferences";
import {
  chordsInRange,
  filterNotesByHand,
  FollowAccompanimentPlanner,
  followWaitMs,
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
  Hand,
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
import {
  changeAccessPointPassword,
  fetchUpdateInfo,
  saveStationWifi,
  uploadUpdate,
  validateUpdateFile,
} from "./update";
import type { UpdateInfo, UpdateTarget } from "./update";

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
const metronomeEnabled = required<HTMLInputElement>("metronome-enabled");
const countInEnabled = required<HTMLInputElement>("count-in-enabled");
const loopEnabled = required<HTMLInputElement>("loop-enabled");
const loopStart = required<HTMLInputElement>("loop-start");
const loopEnd = required<HTMLInputElement>("loop-end");
const loopControls = required("loop-controls");
const deviceStatus = required<HTMLSpanElement>("device-status");
const pianoStatus = required<HTMLSpanElement>("piano-status");
const midiOutStatus = required<HTMLSpanElement>("midi-out-status");
const sustainStatus = required<HTMLSpanElement>("sustain-status");
const scoreName = required("score-name");
const scoreTime = required("score-time");
const scoreResult = required("score-result");
const recordResult = required("record-result");
const latencyStatus = required("latency-status");
const practicePanel = required("practice-panel");
const practiceInsights = required("practice-insights");
const sessionHistory = required("session-history");
const historySummary = required("history-summary");
const coachApply = required<HTMLButtonElement>("coach-apply");
const settingsPanel = required("settings-panel");
const commissioningPanel = required("commissioning-panel");
const commissioningStatus = required<HTMLSpanElement>("commissioning-status");
const updateStatus = required("update-status");
const updateProgress = required<HTMLProgressElement>("update-progress");
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
const sessionStore = new PracticeSessionStore();
const metronome = new MetronomePlayer();
const initialPreferences = loadPreferences();

let score: ParsedScore | undefined;
let sourceScore: ParsedScore | undefined;
let chords: Chord[] = [];
let waitIndex = 0;
let currentTarget: TargetNote[] = [];
let lastTargetSignature = "";
let pressed = new Set<number>();
let wrong = new Set<number>();
let mode: PracticeMode = initialPreferences.mode;
let hand: HandSelection = initialPreferences.hand;
let leadMs = initialPreferences.leadMs;
let lastScoreSeconds = 0;
let lastStatsSignature = "";
let lastRecording = recorder.snapshot();
let pianoWasConnected = false;
let scoreXml: string | undefined;
let transposeSemitones = 0;
let libraryFolders: LibraryFolder[] = [];
let libraryScores: LibraryScore[] = [];
let keyOffsets = normalizeKeyOffsets([]);
let followAdvanceTimer: number | undefined;
let followAdvancePending = false;
let midiOutAvailable = false;
let midiOutOwnedByThisPage = false;
let midiOutBlocked = false;
let followPlanner = new FollowAccompanimentPlanner([]);
let analytics: PracticeAnalytics | undefined;
let recentSessions: PracticeSession[] = [];
let currentRecommendation: PracticeRecommendation | undefined;
let countInGeneration = 0;
let countInTimer: number | undefined;
let needsCountIn = true;
let updateInfo: UpdateInfo | undefined;
let commissioning: CommissioningState = loadCommissioning();

modeSelect.value = mode;
handSelect.value = hand;
tempoSelect.value = String(initialPreferences.tempo);
leadTime.value = String(leadMs);
metronomeEnabled.checked = initialPreferences.metronome;
countInEnabled.checked = initialPreferences.countIn;
clock.speed = initialPreferences.tempo;
metronome.setEnabled(initialPreferences.metronome);
required("lead-value").textContent = `${(leadMs / 1000).toFixed(1)} 秒`;
required("metronome-status").textContent = initialPreferences.metronome
  ? "已开启 · 按乐谱拍号与速度"
  : "按乐谱拍号与速度";

function persistPreferences(): void {
  savePreferences({
    version: 1,
    mode,
    hand,
    tempo: Number(tempoSelect.value),
    leadMs,
    metronome: metronomeEnabled.checked,
    countIn: countInEnabled.checked,
  });
}

function formatEndpoint(value: number | undefined): string {
  return value ? `0x${value.toString(16).toUpperCase().padStart(2, "0")}` : "--";
}

function storeCommissioning(next: CommissioningState): void {
  if (JSON.stringify(next) === JSON.stringify(commissioning)) return;
  commissioning = next;
  saveCommissioning(commissioning);
  renderCommissioning();
}

function renderCommissioning(): void {
  const missing = missingCommissioningEvidence(commissioning);
  const manualComplete = Object.values(commissioning.manual).filter(Boolean).length;
  const observedComplete = [
    commissioning.observed.deviceSeen,
    commissioning.observed.pianoSeen,
    Boolean(commissioning.observed.usbInEndpoint),
    commissioning.observed.c4Seen,
  ].filter(Boolean).length;
  const completedCount = manualComplete + observedComplete;
  required<HTMLProgressElement>("commission-progress").value = completedCount;
  required("commission-progress-label").textContent = `${completedCount} / 12`;
  required("commission-device").textContent = commissioning.observed.deviceSeen
    ? `${commissioning.observed.firmware ?? "未知版本"} / 协议 v${commissioning.observed.protocol ?? "--"}`
    : "等待实际连接";
  required("commission-piano").textContent = commissioning.observed.pianoSeen
    ? `${formatHex(commissioning.observed.vid)}:${formatHex(commissioning.observed.pid)}`
    : "等待 USB 枚举";
  required("commission-in").textContent = commissioning.observed.usbInEndpoint
    ? `${formatEndpoint(commissioning.observed.usbInEndpoint)} · 已观测 ${commissioning.observed.inputPackets ?? 0} 包`
    : "--";
  required("commission-out").textContent = commissioning.observed.usbOutEndpoint
    ? formatEndpoint(commissioning.observed.usbOutEndpoint)
    : "设备未提供 / 尚未观测";
  required("commission-c4").textContent = commissioning.observed.c4Seen ? "已收到中央 C Note On" : "请在钢琴上弹中央 C";
  required("commission-missing").textContent = missing.length === 0
    ? "证据齐全。请完成验收并导出报告保存。"
    : `尚缺 ${missing.length} 项：${missing.slice(0, 4).join("、")}${missing.length > 4 ? "…" : ""}`;
  required<HTMLButtonElement>("commission-finish").disabled = missing.length > 0;
  const complete = missing.length === 0 && commissioning.completedAt !== undefined;
  setStatus(
    commissioningStatus,
    complete,
    complete ? `硬件已验收 · ${new Date(commissioning.completedAt!).toLocaleDateString("zh-CN")}` : "硬件尚未验收",
  );
  document.querySelectorAll<HTMLInputElement>("[data-commission]").forEach((checkbox) => {
    const key = checkbox.dataset.commission as keyof CommissioningState["manual"];
    checkbox.checked = commissioning.manual[key];
  });
}

function canUseMidiOut(): boolean {
  return midiOutAvailable && !midiOutBlocked;
}

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

function practicedFollowHand(): Hand {
  return hand === "left" ? "left" : "right";
}

function cancelFollowPlayback(sendPanic = true): void {
  window.clearTimeout(followAdvanceTimer);
  followAdvanceTimer = undefined;
  followAdvancePending = false;
  if (sendPanic) device.panicMidi();
  midiOutOwnedByThisPage = false;
}

function cancelCountIn(): void {
  countInGeneration += 1;
  window.clearTimeout(countInTimer);
  countInTimer = undefined;
  metronome.cancel();
}

async function startRealtimePlayback(): Promise<void> {
  if (!score) return;
  const now = performance.now();
  const start = clock.time(now);
  if (metronomeEnabled.checked && countInEnabled.checked && needsCountIn) {
    const generation = ++countInGeneration;
    try {
      const plan = await metronome.scheduleCountIn(score.beatMap ?? [], start, clock.speed);
      if (generation !== countInGeneration || mode !== "realtime") return;
      playButton.textContent = `预备 ${plan.count} 拍`;
      countInTimer = window.setTimeout(() => {
        if (generation !== countInGeneration || mode !== "realtime") return;
        countInTimer = undefined;
        metronome.reset(start);
        clock.play(performance.now());
        playButton.textContent = "暂停";
      }, plan.delayMs);
      needsCountIn = false;
      return;
    } catch (error) {
      required("metronome-status").textContent = error instanceof Error ? error.message : "音频不可用";
      metronomeEnabled.checked = false;
      metronome.setEnabled(false);
    }
  }
  metronome.reset(start);
  clock.play(now);
  playButton.textContent = "暂停";
  needsCountIn = false;
}

function sessionContext() {
  const loop = selectedLoop();
  return {
    scoreName: score?.name ?? "未命名乐谱",
    mode,
    hand,
    tempo: Number(tempoSelect.value),
    transpose: transposeSemitones,
    loop: loop ? { ...loop } : undefined,
  };
}

function beginPracticeSession(): void {
  analytics = score && chords.length > 0 ? new PracticeAnalytics(sessionContext()) : undefined;
  renderInsights();
}

async function finishPracticeSession(): Promise<void> {
  const completed = analytics?.finish();
  analytics = undefined;
  if (!completed) return;
  try {
    await sessionStore.save(completed);
    await refreshPracticeHistory();
  } catch (error) {
    historySummary.textContent = error instanceof Error ? error.message : "无法保存练习记录";
  }
}

function recordPracticeEvent(event: PracticeEvent): void {
  if (!analytics && score && chords.length > 0) analytics = new PracticeAnalytics(sessionContext());
  analytics?.record(event);
}

function recordMissedNotes(notes: ReturnType<RealtimeMatcher["advance"]>): void {
  for (const note of notes) {
    recordPracticeEvent({ kind: "missed", note: note.note, hand: note.hand, scoreTime: note.start });
  }
}

function timingLabel(value: number | undefined): string {
  if (value === undefined) return "等待实时数据";
  if (Math.abs(value) < 8) return "几乎正拍";
  return `${Math.abs(value).toFixed(0)} ms ${value < 0 ? "偏早" : "偏晚"}`;
}

function renderInsights(): void {
  const summary = analytics?.snapshot();
  required("insight-timing").textContent = summary ? timingLabel(summary.timingBiasMs) : "尚未开始";
  required("insight-spread").textContent = summary?.meanAbsTimingMs === undefined
    ? "--"
    : `平均 ${summary.meanAbsTimingMs.toFixed(0)} / P95 ${summary.p95AbsTimingMs?.toFixed(0) ?? "--"} ms`;
  required("insight-velocity").textContent = summary?.velocityMean === undefined
    ? "--"
    : `${summary.velocityMean.toFixed(0)} ± ${summary.velocityStdDev?.toFixed(0) ?? "0"}`;
  required("insight-streak").textContent = String(summary?.bestStreak ?? 0);
  const problems = summary?.problemNotes ?? [];
  required("insight-problems").textContent = problems.length === 0
    ? "暂无难点键"
    : problems.slice(0, 5).map((item) => `${pianoNoteName(item.note)} ${item.errors}次`).join(" · ");
  practiceInsights.dataset.active = String(Boolean(summary && (summary.hits + summary.wrong + summary.missed > 0)));
}

function renderPracticeHistory(): void {
  sessionHistory.replaceChildren();
  if (recentSessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "library-empty";
    empty.textContent = "完成一次练习后，这里会显示节奏、力度和难点变化。";
    sessionHistory.append(empty);
  } else {
    for (const session of recentSessions.slice(0, 8)) {
      const card = document.createElement("article");
      card.className = "history-item";
      const title = document.createElement("strong");
      title.textContent = session.context.scoreName;
      const result = document.createElement("span");
      result.textContent = `${session.summary.accuracy.toFixed(0)}% · 命中 ${session.summary.hits} · 错漏 ${session.summary.wrong + session.summary.missed}`;
      const detail = document.createElement("small");
      const modeLabel = session.context.mode === "realtime" ? "实时" : session.context.mode === "follow" ? "跟随我" : "等我弹";
      const timing = session.summary.meanAbsTimingMs === undefined ? "无节奏判定" : `平均偏差 ${session.summary.meanAbsTimingMs.toFixed(0)} ms`;
      detail.textContent = `${new Date(session.endedAt).toLocaleString("zh-CN")} · ${modeLabel} · ${Math.round(session.context.tempo * 100)}% · ${timing}`;
      card.append(title, result, detail);
      sessionHistory.append(card);
    }
  }
  const totalNotes = recentSessions.reduce((sum, session) => sum + session.summary.hits + session.summary.wrong + session.summary.missed, 0);
  historySummary.textContent = `${recentSessions.length} 次近期练习 · ${totalNotes} 个判定事件 · 数据只保存在本机`;
  renderCoach();
}

function renderCoach(): void {
  currentRecommendation = score ? recommendPractice(recentSessions, score.name, score.duration) : undefined;
  const recommendation = currentRecommendation;
  coachApply.disabled = !recommendation;
  if (!recommendation) {
    required("coach-title").textContent = score ? "完成一次练习后生成建议" : "先导入一首乐谱";
    required("coach-reason").textContent = "建议只使用当前乐谱的本机历史，不会把不同曲目混在一起。";
    required("coach-evidence").textContent = "尚无可用证据";
    return;
  }
  const modeLabel = recommendation.mode === "wait" ? "等我弹" : "实时";
  const handLabel = recommendation.hand === "both" ? "双手" : recommendation.hand === "left" ? "左手" : "右手";
  const loopLabel = recommendation.loop
    ? `${formatTime(recommendation.loop.start)}–${formatTime(recommendation.loop.end)}`
    : "全曲";
  required("coach-title").textContent = `${modeLabel} · ${handLabel} · ${Math.round(recommendation.tempo * 100)}% · ${loopLabel}`;
  required("coach-reason").textContent = recommendation.reason;
  const confidence = recommendation.confidence === "high" ? "高" : recommendation.confidence === "medium" ? "中" : "初步";
  required("coach-evidence").textContent = `${recommendation.evidence.sessions} 次 / ${recommendation.evidence.events} 事件 · 历史准确率 ${recommendation.evidence.accuracy.toFixed(1)}% · 置信度 ${confidence}`;
}

async function refreshPracticeHistory(): Promise<void> {
  recentSessions = await sessionStore.list(50);
  renderPracticeHistory();
}

async function refreshUpdateInfo(): Promise<void> {
  try {
    updateInfo = await fetchUpdateInfo();
    updateStatus.textContent = `固件 ${updateInfo.firmware} · 运行槽 ${updateInfo.running} · 固件上限 ${(updateInfo.firmwareMax / 1024 / 1024).toFixed(2)} MiB · 网页上限 ${(updateInfo.filesystemMax / 1024 / 1024).toFixed(2)} MiB`;
  } catch (error) {
    updateInfo = undefined;
    updateStatus.textContent = error instanceof Error ? error.message : "无法读取更新分区";
  }
}

function renderStats(): void {
  const stats = practiceScore.snapshot();
  renderInsights();
  const signature = `${stats.hits}:${stats.wrong}:${stats.missed}:${stats.accuracy.toFixed(1)}`;
  if (signature === lastStatsSignature) return;
  lastStatsSignature = signature;
  scoreResult.textContent =
    `命中 ${stats.hits} · 错 ${stats.wrong} · 漏 ${stats.missed} · ${Math.round(stats.accuracy)}%`;
}

function updateTarget(scoreSeconds: number): void {
  const loop = selectedLoop();
  const chord = mode === "realtime"
    ? nextRealtimeChord(chords, scoreSeconds, leadMs, loop)
    : (followAdvancePending ? undefined : currentWaitChord());
  currentTarget = targetNotes(chord);
  const signature = currentTarget.map((target) => `${target.note}:${target.hand}`).join(",");
  if (signature !== lastTargetSignature) {
    device.setTargets(currentTarget);
    lastTargetSignature = signature;
    if (mode !== "realtime") waitMatcher.setChord(chord);
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
  if (resetStats) void finishPracticeSession();
  cancelCountIn();
  cancelFollowPlayback();
  const start = rangeStart();
  clock.reset(start);
  waitIndex = 0;
  pressed = new Set();
  wrong = new Set();
  lastTargetSignature = "";
  lastScoreSeconds = start;
  needsCountIn = true;
  metronome.reset(start);
  if (resetStats) practiceScore.reset();
  realtimeMatcher.setChords(chords);
  waitMatcher.setChord(currentWaitChord());
  updateTarget(start);
  playButton.textContent = mode === "realtime" ? "播放" : "开始练习";
  renderStats();
  if (resetStats) beginPracticeSession();
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
      void finishPracticeSession();
      return;
    }
  }
  const next = currentWaitChord();
  if (next) clock.seek(next.start);
  lastTargetSignature = "";
  waitMatcher.setChord(next);
}

function advanceFollowMode(): void {
  const current = currentWaitChord();
  if (!score || !current || followAdvancePending) return;
  const loop = selectedLoop();
  const directNext = chords[waitIndex + 1];
  const wrappedNext = !directNext && loop && chords.length > 0 ? chords[0] : undefined;
  const next = directNext ?? wrappedNext;
  const windowEnd = directNext?.start ?? rangeEnd();
  const speed = Number(tempoSelect.value);
  const accompaniment = followPlanner.events(
    practicedFollowHand(),
    current.start,
    windowEnd,
    speed,
  );
  if (canUseMidiOut() && accompaniment.length > 0) device.scheduleMidi(accompaniment);

  if (!next) {
    advanceWaitMode();
    if (canUseMidiOut() && accompaniment.length > 0) {
      const releaseDelay = Math.max(...accompaniment.map((event) => event.delayMs)) + 120;
      followAdvanceTimer = window.setTimeout(() => {
        device.panicMidi();
        midiOutOwnedByThisPage = false;
      }, releaseDelay);
    }
    return;
  }
  const nextTimelineStart = directNext
    ? directNext.start
    : current.start + (rangeEnd() - current.start) + (next.start - rangeStart());
  const delayMs = followWaitMs(current.start, nextTimelineStart, speed);
  followAdvancePending = true;
  waitMatcher.setChord(undefined);
  currentTarget = [];
  device.setTargets([]);
  lastTargetSignature = "";
  playButton.textContent = canUseMidiOut() ? "跟随中" : "跟随中（无钢琴输出）";
  followAdvanceTimer = window.setTimeout(() => {
    if (mode !== "follow" || !followAdvancePending) return;
    followAdvancePending = false;
    advanceWaitMode();
    updateTarget(currentWaitChord()?.start ?? rangeEnd());
  }, delayMs);
}

function handleMidi(event: MidiInputEvent): void {
  if (event.note < 21 || event.note > 108) return;
  if (event.state === "on" && event.note === 60) storeCommissioning(observeMidi(commissioning, event));
  if (event.state === "on") {
    pressed.add(event.note);
    if (score && mode !== "realtime" && !followAdvancePending && currentWaitChord()) {
      const result = waitMatcher.noteOn(event.note);
      if (result.newlyMatched) {
        practiceScore.recordHit();
        const expected = currentWaitChord()?.notes.find((note) => note.note === event.note);
        recordPracticeEvent({
          kind: "hit",
          note: event.note,
          hand: expected?.hand,
          velocity: event.velocity,
          scoreTime: currentWaitChord()?.start ?? lastScoreSeconds,
        });
      }
      else if (!result.correct) {
        practiceScore.recordWrong();
        wrong.add(event.note);
        recordPracticeEvent({ kind: "wrong", note: event.note, velocity: event.velocity, scoreTime: lastScoreSeconds });
      }
      if (result.complete) {
        if (mode === "follow") advanceFollowMode();
        else advanceWaitMode();
      }
    } else if (score && mode === "realtime" && clock.isRunning()) {
      const result = realtimeMatcher.noteOn(event.note, lastScoreSeconds);
      recordMissedNotes(result.missed);
      if (result.newlyMatched) {
        recordPracticeEvent({
          kind: "hit",
          note: event.note,
          hand: result.matched?.hand,
          velocity: event.velocity,
          scoreTime: result.matched?.start ?? lastScoreSeconds,
          timingMs: result.timingMs,
        });
      } else if (!result.correct) {
        recordPracticeEvent({ kind: "wrong", note: event.note, velocity: event.velocity, scoreTime: lastScoreSeconds });
      }
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
  followPlanner = new FollowAccompanimentPlanner(score.notes);
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
  renderCoach();
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
  if (mode !== "realtime") {
    clock.seek(currentWaitChord()?.start ?? rangeEnd());
    playButton.textContent = mode === "follow"
      ? (canUseMidiOut() ? "等待你弹（钢琴伴奏）" : "等待你弹（无钢琴输出）")
      : "等待你弹";
    return;
  }
  if (clock.isRunning()) {
    clock.pause(performance.now());
    metronome.cancel();
    playButton.textContent = "继续";
  } else {
    if (countInTimer !== undefined) {
      cancelCountIn();
      playButton.textContent = "播放";
      needsCountIn = true;
      return;
    }
    if (lastScoreSeconds >= rangeEnd()) {
      clock.seek(rangeStart());
      needsCountIn = true;
    }
    void startRealtimePlayback();
  }
});

resetButton.addEventListener("click", () => resetPractice(true));
modeSelect.addEventListener("change", () => {
  mode = modeSelect.value as PracticeMode;
  if (mode === "follow" && hand === "both") {
    hand = "right";
    handSelect.value = hand;
    rebuildPractice();
  } else {
    resetPractice(true);
  }
  persistPreferences();
});
tempoSelect.addEventListener("change", () => {
  clock.setSpeed(Number(tempoSelect.value), performance.now());
  if (mode === "follow") resetPractice(true);
  persistPreferences();
});
metronomeEnabled.addEventListener("change", () => {
  metronome.setEnabled(metronomeEnabled.checked);
  required("metronome-status").textContent = metronomeEnabled.checked
    ? "已开启 · 按乐谱拍号与速度"
    : "按乐谱拍号与速度";
  if (metronomeEnabled.checked) void metronome.unlock().catch((error: unknown) => {
    required("metronome-status").textContent = error instanceof Error ? error.message : "音频不可用";
  });
  else cancelCountIn();
  persistPreferences();
});
countInEnabled.addEventListener("change", persistPreferences);
handSelect.addEventListener("change", () => {
  hand = handSelect.value as HandSelection;
  if (mode === "follow" && hand === "both") {
    hand = "right";
    handSelect.value = hand;
  }
  rebuildPractice();
  persistPreferences();
});
leadTime.addEventListener("input", () => {
  leadMs = Number(leadTime.value);
  required("lead-value").textContent = `${(leadMs / 1000).toFixed(1)} 秒`;
  lastTargetSignature = "";
  persistPreferences();
});
transposeInput.addEventListener("input", () => {
  transposeSemitones = Number(transposeInput.value);
  required("transpose-value").textContent = transposeLabel(transposeSemitones);
  if (!sourceScore) return;
  score = transposeScore(sourceScore, transposeSemitones);
  followPlanner = new FollowAccompanimentPlanner(score.notes);
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
  commissioningPanel.hidden = true;
  practicePanel.hidden = false;
});
required("practice-close").addEventListener("click", () => { practicePanel.hidden = true; });
required("history-export").addEventListener("click", async () => {
  try {
    const payload = await sessionStore.exportHistory();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `notefall88-practice-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) {
    historySummary.textContent = error instanceof Error ? error.message : "无法导出练习记录";
  }
});
coachApply.addEventListener("click", () => {
  const recommendation = currentRecommendation;
  if (!recommendation || !score) return;
  mode = recommendation.mode;
  modeSelect.value = mode;
  hand = recommendation.hand;
  if (mode === "follow" && hand === "both") hand = "right";
  handSelect.value = hand;
  tempoSelect.value = String(recommendation.tempo);
  clock.setSpeed(recommendation.tempo, performance.now());
  loopEnabled.checked = Boolean(recommendation.loop);
  loopStart.disabled = !recommendation.loop;
  loopEnd.disabled = !recommendation.loop;
  loopControls.setAttribute("aria-disabled", String(!recommendation.loop));
  if (recommendation.loop) {
    loopStart.value = String(recommendation.loop.start);
    loopEnd.value = String(recommendation.loop.end);
  }
  updateLoopLabels();
  rebuildPractice();
  persistPreferences();
  coachApply.textContent = "已应用";
  window.setTimeout(() => { coachApply.textContent = "一键应用"; }, 1_200);
});
required("settings-button").addEventListener("click", () => {
  practicePanel.hidden = true;
  libraryPanel.hidden = true;
  commissioningPanel.hidden = true;
  settingsPanel.hidden = false;
  void refreshUpdateInfo();
});
required("settings-close").addEventListener("click", () => { settingsPanel.hidden = true; });
required("library-button").addEventListener("click", () => {
  practicePanel.hidden = true;
  settingsPanel.hidden = true;
  commissioningPanel.hidden = true;
  libraryPanel.hidden = false;
  void refreshLibrary().catch((error: unknown) => {
    librarySummary.textContent = error instanceof Error ? error.message : "无法打开曲库";
  });
});
required("library-close").addEventListener("click", () => { libraryPanel.hidden = true; });

required("commissioning-button").addEventListener("click", () => {
  practicePanel.hidden = true;
  settingsPanel.hidden = true;
  libraryPanel.hidden = true;
  commissioningPanel.hidden = false;
  renderCommissioning();
});
required("commissioning-close").addEventListener("click", () => { commissioningPanel.hidden = true; });
commissioningPanel.addEventListener("change", (event) => {
  const checkbox = (event.target as HTMLElement).closest<HTMLInputElement>("input[data-commission]");
  if (!checkbox) return;
  const key = checkbox.dataset.commission as keyof CommissioningState["manual"];
  const next = structuredClone(commissioning);
  next.manual[key] = checkbox.checked;
  next.completedAt = undefined;
  storeCommissioning(next);
});
commissioningPanel.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-commission-test]");
  if (button) device.testNote(Number(button.dataset.commissionTest));
});
required("commission-blackout").addEventListener("click", () => device.blackout());
required("commission-finish").addEventListener("click", () => {
  try {
    storeCommissioning(completeCommissioning(commissioning));
    required("commission-missing").textContent = "实机验收已完成。建议立即导出报告，与当前固件版本一起保存。";
  } catch (error) {
    required("commission-missing").textContent = error instanceof Error ? error.message : "无法完成验收";
  }
});
required("commission-export").addEventListener("click", () => {
  const report = commissioningReport(commissioning);
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `notefall88-commissioning-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
});

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
required<HTMLFormElement>("wifi-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const ssid = required<HTMLInputElement>("wifi-ssid").value.trim();
  const password = required<HTMLInputElement>("wifi-password").value;
  const current = required<HTMLInputElement>("ap-current-password");
  try {
    await saveStationWifi(ssid, password, current.value);
    updateStatus.textContent = "家庭 Wi-Fi 已保存，设备正在重启；NoteFall-88 热点仍会保留。";
    required<HTMLInputElement>("wifi-password").value = "";
    current.value = "";
  } catch (error) {
    updateStatus.textContent = error instanceof Error ? error.message : "无法保存家庭 Wi-Fi";
    current.value = "";
  }
});

required<HTMLFormElement>("ap-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const current = required<HTMLInputElement>("ap-current-password");
  const next = required<HTMLInputElement>("ap-new-password");
  try {
    if (!current.value) throw new Error("请输入当前热点密码");
    await changeAccessPointPassword(current.value, next.value);
    updateStatus.textContent = "热点密码已保存，设备正在重启；请用新密码重新连接 NoteFall-88。";
    current.value = "";
    next.value = "";
  } catch (error) {
    updateStatus.textContent = error instanceof Error ? error.message : "无法修改热点密码";
    current.value = "";
  }
});

required<HTMLFormElement>("update-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const fileInput = required<HTMLInputElement>("update-file");
  const target = required<HTMLSelectElement>("update-target").value as UpdateTarget;
  const password = required<HTMLInputElement>("ap-current-password");
  const submit = required<HTMLButtonElement>("update-submit");
  const file = fileInput.files?.[0];
  try {
    if (!file) throw new Error("请选择 .bin 更新镜像");
    if (!password.value) throw new Error("请在上方输入当前热点密码");
    const validation = validateUpdateFile(file, target, updateInfo);
    if (validation) throw new Error(validation);
    const label = target === "firmware" ? "固件" : "网页文件系统";
    if (!window.confirm(`确认更新${label}？上传期间不要断电；设备确认后会自动重启。`)) return;
    submit.disabled = true;
    updateProgress.hidden = false;
    updateProgress.value = 0;
    updateStatus.textContent = `正在上传${label}…`;
    const result = await uploadUpdate(file, target, password.value, (proportion) => {
      updateProgress.value = proportion;
      updateStatus.textContent = `正在上传${label}… ${Math.round(proportion * 100)}%`;
    });
    updateStatus.textContent = `设备确认成功：写入 ${Math.ceil(result.written / 1024)} KiB，正在重启。`;
    fileInput.value = "";
  } catch (error) {
    updateStatus.textContent = error instanceof Error ? error.message : "更新失败";
  } finally {
    password.value = "";
    submit.disabled = false;
  }
});

device.onConnection((connected) => {
  if (!connected) {
    cancelFollowPlayback(false);
    midiOutOwnedByThisPage = false;
  }
  setStatus(deviceStatus, connected, connected ? "ESP 已连接" : "ESP 未连接");
});
device.onStatus((status: DeviceStatus) => {
  storeCommissioning(observeDevice(commissioning, status));
  midiOutAvailable = Boolean(status.usbOut);
  const midiOutOwnedElsewhere = Boolean(status.usbOutOwned) && !midiOutOwnedByThisPage;
  midiOutBlocked = midiOutOwnedElsewhere;
  setStatus(
    midiOutStatus,
    midiOutAvailable && !midiOutOwnedElsewhere,
    !midiOutAvailable
      ? "钢琴伴奏不可用"
      : (midiOutOwnedByThisPage ? "钢琴伴奏输出中" : (midiOutOwnedElsewhere ? "伴奏被其他页面占用" : "钢琴伴奏可用")),
  );
  setStatus(pianoStatus, status.piano, status.piano ? "钢琴 USB 已连接" : "钢琴未连接");
  if (pianoWasConnected && !status.piano) {
    cancelFollowPlayback(false);
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
  required("diag-out-endpoint").textContent = status.usbOutEndpoint
    ? `0x${formatHex(status.usbOutEndpoint, 2)} / ${status.usbOutPacketSize ?? "--"} B`
    : (status.piano ? "设备未提供" : "--");
  required("diag-packets").textContent = String(status.usbPackets ?? "--");
  required("diag-errors").textContent = `${status.usbDropped ?? "--"} / ${status.usbErrors ?? "--"}`;
  required("diag-out-packets").textContent = `${status.usbOutPackets ?? "--"} / ${status.usbOutQueued ?? "--"}`;
  required("diag-out-errors").textContent = `${status.usbOutDropped ?? "--"} / ${status.usbOutErrors ?? "--"}`;
  required("diag-echo").textContent = String(status.usbEchoSuppressed ?? "--");
  required("diag-connections").textContent = String(status.usbConnections ?? "--");
  required("diag-web-rejected").textContent = `${status.webRejected ?? "--"} / ${device.browserRejectedMessages}`;
  required("diag-web-midi-dropped").textContent = String(status.webMidiDropped ?? "--");
  required("diag-led-latency").textContent = status.ledInputLatencySamples
    ? `${((status.ledInputLatencyAvgUs ?? 0) / 1000).toFixed(2)} 平均 / ${((status.ledInputLatencyMaxUs ?? 0) / 1000).toFixed(2)} 最大 ms · ${status.ledInputLatencySamples} 次`
    : "等待钢琴按键";
  required("diag-heap").textContent = status.freeHeap === undefined
    ? "--"
    : `${Math.round(status.freeHeap / 1024)} KiB`;
  required("diag-psram").textContent = status.psramBytes
    ? `${(status.freePsram ?? 0) / 1024 / 1024 > 0
      ? ((status.freePsram ?? 0) / 1024 / 1024).toFixed(1)
      : "0.0"} / ${(status.psramBytes / 1024 / 1024).toFixed(1)} MiB`
    : "未检测到";
  required("diag-nvs").textContent = status.nvsReady === undefined
    ? "--"
    : status.nvsReady ? "正常" : "异常（设置无法保存）";
  required("diag-reset").textContent = status.resetReason ?? "--";
  required("diag-rssi").textContent = status.rssi ? `${status.rssi} dBm` : "热点模式";
  if (status.protocol !== undefined && status.protocol !== 5) {
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
device.onMidiOutResult((result) => {
  midiOutOwnedByThisPage = result.ok;
  midiOutBlocked = result.busy;
  if (result.busy) {
    setStatus(midiOutStatus, false, "伴奏被其他页面占用");
  } else if (result.ok) {
    setStatus(midiOutStatus, true, `钢琴伴奏输出中 · 队列 ${result.queued}`);
  }
});
renderCommissioning();
device.connect();
void refreshLibrary().catch((error: unknown) => {
  librarySummary.textContent = error instanceof Error ? error.message : "无法打开曲库";
});
void refreshPracticeHistory().catch((error: unknown) => {
  historySummary.textContent = error instanceof Error ? error.message : "无法打开练习历史";
});

function frame(now: number): void {
  let scoreSeconds = clock.time(now);
  if (score) {
    const loop = selectedLoop();
    if (mode !== "realtime") {
      scoreSeconds = currentWaitChord()?.start ?? rangeEnd();
    } else if (clock.isRunning() && loop && scoreSeconds >= loop.end) {
      recordMissedNotes(realtimeMatcher.advance(loop.end + 0.251));
      const span = loop.end - loop.start;
      scoreSeconds = loop.start + ((scoreSeconds - loop.start) % span);
      clock.seek(scoreSeconds, now);
      realtimeMatcher.restartPass();
      metronome.reset(scoreSeconds);
      lastTargetSignature = "";
    } else if (scoreSeconds >= score.duration) {
      recordMissedNotes(realtimeMatcher.advance(score.duration + 0.251));
      clock.pause(now);
      scoreSeconds = score.duration;
      playButton.textContent = "重播";
      metronome.cancel();
      needsCountIn = true;
      void finishPracticeSession();
    }
    if (mode === "realtime" && clock.isRunning()) {
      recordMissedNotes(realtimeMatcher.advance(scoreSeconds));
      metronome.schedule(score.beatMap ?? [], scoreSeconds, clock.speed);
    }
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
