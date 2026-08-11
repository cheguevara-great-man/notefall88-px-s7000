import { summarizePractice } from "./analytics";
import type { PracticeEvent, PracticeSession } from "./analytics";
import { MAX_TEMPO, MIN_TEMPO, normalizeTempo } from "./tempo";
import type { HandSelection, ParsedScore, PracticeMode } from "./types";

const MAX_SOURCE_SESSIONS = 24;
const MAX_MISSIONS = 3;
export const PRACTICE_CIRCUIT_STORAGE_KEY = "notefall88.practice-circuit.v1";

export interface PracticeMission {
  id: string;
  fromOccurrence: number;
  throughOccurrence: number;
  writtenMeasures: number[];
  start: number;
  end: number;
  hand: HandSelection;
  mode: Exclude<PracticeMode, "follow">;
  tempo: number;
  targetAccuracy: number;
  targetTimingMs?: number;
  targetDynamicsScore?: number;
  targetDurationCoverage?: number;
  minimumEvents: number;
  requiredPasses: number;
  consecutivePasses: number;
  attempts: number;
  severity: number;
  reason: string;
}

export interface PracticeCircuit {
  version: 1;
  id: string;
  scoreName: string;
  scoreFingerprint?: string;
  createdAt: number;
  activeIndex: number;
  completed: boolean;
  missions: PracticeMission[];
}

export interface MissionAssessment {
  circuit: PracticeCircuit;
  outcome: "invalid" | "retry" | "streak" | "advanced" | "completed";
  accuracy?: number;
  timingMs?: number;
  dynamicsScore?: number;
  durationCoverageScore?: number;
  message: string;
}

interface Bucket {
  rawEvents: number;
  hits: number;
  wrong: number;
  missed: number;
  timingTotal: number;
  timingWeight: number;
  leftHits: number;
  leftErrors: number;
  rightHits: number;
  rightErrors: number;
  dynamicsTotal: number;
  dynamicsWeight: number;
  articulationTotal: number;
  articulationWeight: number;
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function scoreIdentity(name: string, fingerprint?: string): string {
  return fingerprint ?? `legacy:${name}`;
}

function compatibleSessions(
  history: PracticeSession[],
  scoreName: string,
  scoreFingerprint?: string,
): PracticeSession[] {
  return history
    .filter((session) => scoreFingerprint
      ? session.context.scoreFingerprint === scoreFingerprint
      : session.context.scoreFingerprint === undefined && session.context.scoreName === scoreName)
    .slice(0, MAX_SOURCE_SESSIONS);
}

function occurrenceAt(starts: number[], seconds: number): number {
  let occurrence = 0;
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index] <= seconds + 1e-6) occurrence = index;
    else break;
  }
  return occurrence;
}

function emptyBucket(): Bucket {
  return {
    rawEvents: 0,
    hits: 0,
    wrong: 0,
    missed: 0,
    timingTotal: 0,
    timingWeight: 0,
    leftHits: 0,
    leftErrors: 0,
    rightHits: 0,
    rightErrors: 0,
    dynamicsTotal: 0,
    dynamicsWeight: 0,
    articulationTotal: 0,
    articulationWeight: 0,
  };
}

function addHandEvidence(bucket: Bucket, event: PracticeEvent, weight: number): void {
  if (!("hand" in event) || !event.hand) return;
  const side = event.hand;
  if (event.kind === "hit") bucket[side === "left" ? "leftHits" : "rightHits"] += weight;
  else bucket[side === "left" ? "leftErrors" : "rightErrors"] += weight;
}

function chooseHand(bucket: Bucket): HandSelection {
  const leftTotal = bucket.leftHits + bucket.leftErrors;
  const rightTotal = bucket.rightHits + bucket.rightErrors;
  if (leftTotal === 0 && rightTotal === 0) return "both";
  if (leftTotal === 0) return bucket.rightErrors > 0 ? "right" : "both";
  if (rightTotal === 0) return bucket.leftErrors > 0 ? "left" : "both";
  const leftRate = bucket.leftErrors / leftTotal;
  const rightRate = bucket.rightErrors / rightTotal;
  if (Math.abs(leftRate - rightRate) < 0.12) return "both";
  return leftRate > rightRate ? "left" : "right";
}

function severityOf(bucket: Bucket): number {
  const attempts = bucket.hits + bucket.wrong + bucket.missed;
  if (attempts <= 0) return 0;
  const weightedErrorRate = Math.min(1, (bucket.wrong + bucket.missed * 1.45) / attempts);
  const timing = bucket.timingWeight > 0 ? bucket.timingTotal / bucket.timingWeight : 0;
  const timingPenalty = Math.min(1, timing / 220);
  const dynamicsPenalty = bucket.dynamicsWeight > 0 ? bucket.dynamicsTotal / bucket.dynamicsWeight : 0;
  const articulationPenalty = bucket.articulationWeight > 0
    ? bucket.articulationTotal / bucket.articulationWeight : 0;
  const confidence = 0.72 + Math.min(0.28, bucket.rawEvents / 30);
  return round(Math.min(1, (
    weightedErrorRate * 0.62
      + timingPenalty * 0.16
      + dynamicsPenalty * 0.1
      + articulationPenalty * 0.12
  ) * confidence));
}

function missionRange(starts: number[], center: number): { from: number; through: number } {
  if (starts.length === 1) return { from: 0, through: 0 };
  if (center === 0) return { from: 0, through: 1 };
  return { from: center - 1, through: center };
}

function writtenMeasures(score: ParsedScore, from: number, through: number): number[] {
  const values = new Set<number>();
  for (let occurrence = from; occurrence <= through; occurrence += 1) {
    values.add((score.measureMap?.[occurrence] ?? occurrence) + 1);
  }
  return [...values];
}

function latestTempo(sessions: PracticeSession[]): number {
  return normalizeTempo(sessions[0]?.context.tempo ?? 1);
}

function missionTempo(base: number, severity: number): number {
  const reduction = severity >= 0.58 ? 0.2 : severity >= 0.38 ? 0.15 : 0.1;
  return normalizeTempo(Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, base - reduction)));
}

function rangeLabel(measures: number[]): string {
  if (measures.length === 1) return `M${measures[0]}`;
  return `M${measures[0]}–M${measures.at(-1)}`;
}

function expectedEvents(score: ParsedScore, start: number, end: number, hand: HandSelection): number {
  return score.notes.filter((note) => note.start >= start - 1e-6
    && note.start < end - 1e-6
    && (hand === "both" || note.hand === hand)).length;
}

function buildMission(
  score: ParsedScore,
  starts: number[],
  bucket: Bucket,
  center: number,
  baseTempo: number,
  ordinal: number,
): PracticeMission {
  const severity = severityOf(bucket);
  const { from, through } = missionRange(starts, center);
  const start = starts[from];
  const end = starts[through + 1] ?? score.duration;
  const hand = chooseHand(bucket);
  const mode = severity >= 0.38 ? "wait" : "realtime";
  const measures = writtenMeasures(score, from, through);
  const expected = expectedEvents(score, start, end, hand);
  const targetAccuracy = severity >= 0.58 ? 85 : severity >= 0.34 ? 90 : 94;
  const targetTimingMs = mode === "realtime" ? (severity >= 0.28 ? 120 : 90) : undefined;
  const dynamicsPenalty = bucket.dynamicsWeight > 0 ? bucket.dynamicsTotal / bucket.dynamicsWeight : 0;
  const articulationPenalty = bucket.articulationWeight > 0
    ? bucket.articulationTotal / bucket.articulationWeight : 0;
  const targetDynamicsScore = bucket.dynamicsWeight >= 4 && dynamicsPenalty >= 0.3 ? 70 : undefined;
  const targetDurationCoverage = bucket.articulationWeight >= 4 && articulationPenalty >= 0.2 ? 85 : undefined;
  const timing = bucket.timingWeight > 0 ? bucket.timingTotal / bucket.timingWeight : undefined;
  const reason = `${rangeLabel(measures)} 的加权薄弱度 ${Math.round(severity * 100)}%`
    + `${bucket.missed > bucket.wrong
      ? "，漏音是主要问题"
      : bucket.wrong > 0
        ? "，多余按键需要先清理"
        : targetDurationCoverage !== undefined
          ? "，提前收音使谱面时值没有完整覆盖"
          : targetDynamicsScore !== undefined
            ? "，谱面强弱轮廓需要更清楚"
            : "，重点收紧拍点"}`
    + `${timing === undefined ? "" : `（平均偏差约 ${Math.round(timing)} ms）`}`;
  return {
    id: `mission-${ordinal}-${from}-${through}`,
    fromOccurrence: from,
    throughOccurrence: through,
    writtenMeasures: measures,
    start,
    end,
    hand,
    mode,
    tempo: missionTempo(baseTempo, severity),
    targetAccuracy,
    targetTimingMs,
    targetDynamicsScore,
    targetDurationCoverage,
    minimumEvents: Math.max(3, Math.min(20_000, expected)),
    requiredPasses: 2,
    consecutivePasses: 0,
    attempts: 0,
    severity,
    reason,
  };
}

function consolidationMission(score: ParsedScore, baseTempo: number): PracticeMission {
  const lastOccurrence = Math.max(0, (score.measureStarts?.length ?? 1) - 1);
  const measures = writtenMeasures(score, 0, lastOccurrence);
  return {
    id: "mission-consolidation",
    fromOccurrence: 0,
    throughOccurrence: lastOccurrence,
    writtenMeasures: measures,
    start: 0,
    end: score.duration,
    hand: "both",
    mode: "realtime",
    tempo: normalizeTempo(Math.min(MAX_TEMPO, baseTempo + 0.05)),
    targetAccuracy: 96,
    targetTimingMs: 75,
    minimumEvents: Math.max(3, Math.min(20_000, score.notes.length)),
    requiredPasses: 1,
    consecutivePasses: 0,
    attempts: 0,
    severity: 0,
    reason: "近期没有明显薄弱小节，改为全曲稳定性挑战并小幅提速。",
  };
}

/** Builds a repeat-aware, evidence-backed sequence of non-overlapping weak passages. */
export function buildPracticeCircuit(
  history: PracticeSession[],
  score: ParsedScore,
  scoreFingerprint?: string,
  createdAt = Date.now(),
): PracticeCircuit | undefined {
  const starts = score.measureStarts ?? [];
  if (starts.length === 0 || !(score.duration > 0)) return undefined;
  const sessions = compatibleSessions(history, score.name, scoreFingerprint);
  if (sessions.length === 0) return undefined;
  const buckets = starts.map(emptyBucket);
  for (const [sessionIndex, session] of sessions.entries()) {
    const weight = 0.88 ** Math.min(sessionIndex, 12);
    for (const event of session.events) {
      if (!Number.isFinite(event.scoreTime)) continue;
      const bucket = buckets[occurrenceAt(starts, event.scoreTime)];
      if (!bucket) continue;
      bucket.rawEvents += 1;
      if (event.kind === "hit") {
        bucket.hits += weight;
        if (Number.isFinite(event.timingMs)) {
          bucket.timingTotal += Math.abs(event.timingMs!) * weight;
          bucket.timingWeight += weight;
        }
        if (event.targetVelocity !== undefined && Number.isFinite(event.targetVelocity)) {
          const residual = Math.abs((event.velocity - event.targetVelocity) - (session.summary.velocityBias ?? 0));
          const penalty = Math.min(1, residual / 24);
          bucket.dynamicsTotal += penalty * weight;
          bucket.dynamicsWeight += weight;
          if (event.hand) bucket[event.hand === "left" ? "leftErrors" : "rightErrors"] += penalty * weight;
        }
        if (event.targetDurationMs !== undefined && event.soundingDurationMs !== undefined
            && event.targetDurationMs >= 60 && event.soundingDurationMs >= 0) {
          const coverage = Math.max(0, Math.min(1, event.soundingDurationMs / event.targetDurationMs));
          const penalty = coverage < 0.8 ? 1 : Math.max(0, (0.95 - coverage) / 0.15);
          bucket.articulationTotal += penalty * weight;
          bucket.articulationWeight += weight;
          if (event.hand) bucket[event.hand === "left" ? "leftErrors" : "rightErrors"] += penalty * weight;
        }
      } else if (event.kind === "wrong") bucket.wrong += weight;
      else bucket.missed += weight;
      addHandEvidence(bucket, event, weight);
    }
  }

  const ranked = buckets
    .map((bucket, occurrence) => ({ bucket, occurrence, severity: severityOf(bucket) }))
    .filter((candidate) => candidate.bucket.rawEvents >= 2 && candidate.severity >= 0.05)
    .sort((a, b) => b.severity - a.severity || b.bucket.missed - a.bucket.missed || a.occurrence - b.occurrence);
  const selected: typeof ranked = [];
  for (const candidate of ranked) {
    const range = missionRange(starts, candidate.occurrence);
    if (selected.some((item) => {
      const existing = missionRange(starts, item.occurrence);
      return range.from <= existing.through && existing.from <= range.through;
    })) continue;
    selected.push(candidate);
    if (selected.length >= MAX_MISSIONS) break;
  }
  const baseTempo = latestTempo(sessions);
  const missions = selected.length > 0
    ? selected.map((candidate, index) => buildMission(score, starts, candidate.bucket, candidate.occurrence, baseTempo, index))
    : [consolidationMission(score, baseTempo)];
  return {
    version: 1,
    id: `${scoreIdentity(score.name, scoreFingerprint)}:${createdAt}`,
    scoreName: score.name,
    scoreFingerprint,
    createdAt,
    activeIndex: 0,
    completed: false,
    missions,
  };
}

function missionSessionCompatible(circuit: PracticeCircuit, mission: PracticeMission, session: PracticeSession): boolean {
  const identityMatches = circuit.scoreFingerprint
    ? session.context.scoreFingerprint === circuit.scoreFingerprint
    : session.context.scoreFingerprint === undefined && session.context.scoreName === circuit.scoreName;
  const loop = session.context.loop;
  return identityMatches
    && session.context.mode === mission.mode
    && session.context.hand === mission.hand
    && !!loop
    && Math.abs(loop.start - mission.start) < 0.02
    && Math.abs(loop.end - mission.end) < 0.02
    && session.context.tempo + 0.021 >= mission.tempo;
}

function assessmentEvents(session: PracticeSession, mission: PracticeMission): PracticeEvent[] {
  return session.events.filter((event) => event.scoreTime >= mission.start - 1e-6 && event.scoreTime < mission.end);
}

/** Grades one explicitly submitted circuit attempt and advances only after consecutive evidence-backed passes. */
export function assessPracticeMission(circuit: PracticeCircuit, session: PracticeSession): MissionAssessment {
  const mission = circuit.missions[circuit.activeIndex];
  if (circuit.completed || !mission) {
    return { circuit, outcome: "invalid", message: "这组弱点巡回已经完成。" };
  }
  if (!missionSessionCompatible(circuit, mission, session)) {
    return { circuit, outcome: "invalid", message: "本轮设置与当前关卡不一致，请重新应用当前关卡后再评估。" };
  }
  const events = assessmentEvents(session, mission);
  if (events.length < mission.minimumEvents) {
    return {
      circuit,
      outcome: "invalid",
      message: `有效判定只有 ${events.length} 个，至少需要 ${mission.minimumEvents} 个；请完整练完片段再评估。`,
    };
  }
  const hits = events.filter((event) => event.kind === "hit").length;
  const accuracy = round((hits / events.length) * 100, 1);
  const timings = events
    .filter((event): event is Extract<PracticeEvent, { kind: "hit" }> => event.kind === "hit")
    .map((event) => event.timingMs)
    .filter((value): value is number => Number.isFinite(value));
  const timingMs = timings.length > 0 ? round(timings.reduce((sum, value) => sum + Math.abs(value), 0) / timings.length, 1) : undefined;
  const timingPassed = mission.targetTimingMs === undefined
    || (timings.length >= Math.min(3, mission.minimumEvents) && timingMs !== undefined && timingMs <= mission.targetTimingMs);
  const expressive = summarizePractice(events);
  const dynamicsScore = expressive.dynamicsScore;
  const durationCoverageScore = expressive.durationCoverageScore;
  const dynamicsPassed = mission.targetDynamicsScore === undefined
    || (dynamicsScore !== undefined && dynamicsScore >= mission.targetDynamicsScore);
  const durationPassed = mission.targetDurationCoverage === undefined
    || (durationCoverageScore !== undefined && durationCoverageScore >= mission.targetDurationCoverage);
  const passed = accuracy >= mission.targetAccuracy && timingPassed && dynamicsPassed && durationPassed;
  const missions = circuit.missions.map((item, index) => index === circuit.activeIndex
    ? {
      ...item,
      attempts: item.attempts + 1,
      consecutivePasses: passed ? item.consecutivePasses + 1 : 0,
    }
    : { ...item });
  const updatedMission = missions[circuit.activeIndex];
  const mastered = passed && updatedMission.consecutivePasses >= updatedMission.requiredPasses;
  const activeIndex = mastered ? circuit.activeIndex + 1 : circuit.activeIndex;
  const completed = activeIndex >= missions.length;
  const updated: PracticeCircuit = { ...circuit, missions, activeIndex, completed };
  const metrics = `${accuracy.toFixed(1)}%${mission.targetTimingMs === undefined ? "" : ` / ${timingMs === undefined ? "无节奏样本" : `${Math.round(timingMs)} ms`}`}`
    + `${mission.targetDynamicsScore === undefined ? "" : ` / 力度 ${dynamicsScore === undefined ? "无样本" : `${Math.round(dynamicsScore)}%`}`}`
    + `${mission.targetDurationCoverage === undefined ? "" : ` / 时值 ${durationCoverageScore === undefined ? "无样本" : `${Math.round(durationCoverageScore)}%`}`}`;
  if (!passed) {
    const accuracyHint = accuracy < mission.targetAccuracy ? `准确率需达到 ${mission.targetAccuracy}%` : "准确率已达标";
    const timingHint = mission.targetTimingMs === undefined ? "" : `，平均拍点需在 ${mission.targetTimingMs} ms 内`;
    const dynamicsHint = mission.targetDynamicsScore === undefined ? "" : `，力度轮廓需达到 ${mission.targetDynamicsScore}%`;
    const durationHint = mission.targetDurationCoverage === undefined ? "" : `，时值覆盖需达到 ${mission.targetDurationCoverage}%`;
    return {
      circuit: updated,
      outcome: "retry",
      accuracy,
      timingMs,
      dynamicsScore,
      durationCoverageScore,
      message: `本轮 ${metrics}：${accuracyHint}${timingHint}${dynamicsHint}${durationHint}，连续达标计数已重置。`,
    };
  }
  if (!mastered) {
    return {
      circuit: updated,
      outcome: "streak",
      accuracy,
      timingMs,
      dynamicsScore,
      durationCoverageScore,
      message: `本轮 ${metrics} 达标；再连续通过 ${updatedMission.requiredPasses - updatedMission.consecutivePasses} 次即可进阶。`,
    };
  }
  if (completed) return {
    circuit: updated, outcome: "completed", accuracy, timingMs, dynamicsScore, durationCoverageScore,
    message: `本轮 ${metrics} 达标，全部弱点关卡已完成。`,
  };
  return {
    circuit: updated, outcome: "advanced", accuracy, timingMs, dynamicsScore, durationCoverageScore,
    message: `本轮 ${metrics} 达标，已自动进入下一处弱点。`,
  };
}

function validStoredMission(value: unknown): value is PracticeMission {
  if (!value || typeof value !== "object") return false;
  const mission = value as Partial<PracticeMission>;
  return typeof mission.id === "string"
    && Number.isInteger(mission.fromOccurrence)
    && Number.isInteger(mission.throughOccurrence)
    && Number.isFinite(mission.start)
    && Number.isFinite(mission.end)
    && mission.end! > mission.start!
    && (mission.hand === "both" || mission.hand === "left" || mission.hand === "right")
    && (mission.mode === "wait" || mission.mode === "realtime")
    && Number.isFinite(mission.tempo)
    && Number.isFinite(mission.targetAccuracy)
    && (mission.targetDynamicsScore === undefined
      || (Number.isFinite(mission.targetDynamicsScore) && mission.targetDynamicsScore! >= 0 && mission.targetDynamicsScore! <= 100))
    && (mission.targetDurationCoverage === undefined
      || (Number.isFinite(mission.targetDurationCoverage) && mission.targetDurationCoverage! >= 0 && mission.targetDurationCoverage! <= 100))
    && Number.isInteger(mission.minimumEvents)
    && mission.minimumEvents! >= 3
    && Number.isInteger(mission.requiredPasses)
    && mission.requiredPasses! >= 1
    && Number.isInteger(mission.consecutivePasses)
    && mission.consecutivePasses! >= 0
    && Number.isInteger(mission.attempts)
    && mission.attempts! >= 0
    && Array.isArray(mission.writtenMeasures)
    && typeof mission.reason === "string";
}

function validStoredCircuit(value: unknown): value is PracticeCircuit {
  if (!value || typeof value !== "object") return false;
  const circuit = value as Partial<PracticeCircuit>;
  if (!(circuit.version === 1
    && typeof circuit.id === "string"
    && typeof circuit.scoreName === "string"
    && Number.isInteger(circuit.activeIndex)
    && typeof circuit.completed === "boolean"
    && Array.isArray(circuit.missions)
    && circuit.missions.length > 0
    && circuit.missions.every(validStoredMission))) return false;
  const activeIndex = circuit.activeIndex!;
  return activeIndex >= 0
    && (circuit.completed ? activeIndex === circuit.missions.length : activeIndex < circuit.missions.length);
}

export function savePracticeCircuit(circuit: PracticeCircuit, storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(PRACTICE_CIRCUIT_STORAGE_KEY, JSON.stringify(circuit)); } catch { /* Optional coaching state must not block practice. */ }
}

export function loadPracticeCircuit(
  scoreName: string,
  scoreFingerprint?: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): PracticeCircuit | undefined {
  try {
    const raw = storage.getItem(PRACTICE_CIRCUIT_STORAGE_KEY);
    if (!raw) return undefined;
    const circuit: unknown = JSON.parse(raw);
    if (!validStoredCircuit(circuit)) return undefined;
    const matches = scoreFingerprint
      ? circuit.scoreFingerprint === scoreFingerprint
      : circuit.scoreFingerprint === undefined && circuit.scoreName === scoreName;
    return matches ? structuredClone(circuit) : undefined;
  } catch {
    return undefined;
  }
}

export function clearPracticeCircuit(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try { storage.removeItem(PRACTICE_CIRCUIT_STORAGE_KEY); } catch { /* Optional coaching state must not block practice. */ }
}
