import type { PracticeSession } from "./analytics";
import type { HandSelection, PracticeMode } from "./types";

const TEMPO_STEPS = [0.5, 0.75, 1, 1.25, 1.5] as const;
const MAX_SOURCE_SESSIONS = 20;

export interface PracticeRecommendation {
  scoreName: string;
  mode: PracticeMode;
  hand: HandSelection;
  tempo: number;
  loop?: { start: number; end: number };
  confidence: "low" | "medium" | "high";
  reason: string;
  evidence: {
    sessions: number;
    events: number;
    accuracy: number;
    errorsInLoop: number;
  };
}

function nearestTempoIndex(value: number): number {
  let result = 0;
  let distance = Number.POSITIVE_INFINITY;
  TEMPO_STEPS.forEach((candidate, index) => {
    const candidateDistance = Math.abs(candidate - value);
    if (candidateDistance < distance) {
      distance = candidateDistance;
      result = index;
    }
  });
  return result;
}

function recommendedTempo(current: number, accuracy: number, timingMs?: number): number {
  const index = nearestTempoIndex(current);
  if (accuracy < 70) return TEMPO_STEPS[Math.max(0, index - 1)];
  if (accuracy < 88 || (timingMs !== undefined && timingMs > 120)) {
    return TEMPO_STEPS[Math.max(0, index - (index > 1 ? 1 : 0))];
  }
  if (accuracy >= 96 && (timingMs === undefined || timingMs < 65)) {
    return TEMPO_STEPS[Math.min(TEMPO_STEPS.length - 1, index + 1)];
  }
  return TEMPO_STEPS[index];
}

function chooseHand(sessions: PracticeSession[]): HandSelection {
  const counts = {
    left: { hits: 0, errors: 0 },
    right: { hits: 0, errors: 0 },
  };
  for (const session of sessions) {
    for (const event of session.events) {
      if (!("hand" in event) || !event.hand) continue;
      if (event.kind === "hit") counts[event.hand].hits += 1;
      else counts[event.hand].errors += 1;
    }
  }
  const leftTotal = counts.left.hits + counts.left.errors;
  const rightTotal = counts.right.hits + counts.right.errors;
  if (leftTotal === 0 && rightTotal === 0) return sessions[0]?.context.hand ?? "both";
  if (leftTotal === 0) return "right";
  if (rightTotal === 0) return "left";
  const leftRate = counts.left.errors / leftTotal;
  const rightRate = counts.right.errors / rightTotal;
  if (Math.abs(leftRate - rightRate) < 0.1) return "both";
  return leftRate > rightRate ? "left" : "right";
}

function hardestWindow(
  sessions: PracticeSession[],
  duration: number,
): { start: number; end: number; errors: number } | undefined {
  if (!(duration > 0)) return undefined;
  const width = Math.min(12, Math.max(4, duration));
  if (duration <= width + 0.25) return undefined;
  const step = Math.min(4, width / 2);
  let best: { start: number; end: number; errors: number; attempts: number; score: number } | undefined;
  for (let start = 0; start < duration - 0.25; start += step) {
    const end = Math.min(duration, start + width);
    let errors = 0;
    let attempts = 0;
    let errorTimeSum = 0;
    let errorEvents = 0;
    for (const session of sessions) {
      for (const event of session.events) {
        if (event.scoreTime < start || event.scoreTime >= end) continue;
        attempts += 1;
        if (event.kind === "missed") {
          errors += 2;
          errorTimeSum += event.scoreTime;
          errorEvents += 1;
        } else if (event.kind === "wrong") {
          errors += 1;
          errorTimeSum += event.scoreTime;
          errorEvents += 1;
        }
      }
    }
    if (attempts === 0) continue;
    const errorCenter = errorEvents > 0 ? errorTimeSum / errorEvents : start + width / 2;
    const centering = 1 - Math.min(1, Math.abs((start + end) / 2 - errorCenter) / width);
    const score = errors * 3 + (errors / attempts) * 5 + Math.min(attempts, 12) / 12 + centering;
    if (!best || score > best.score) best = { start, end, errors, attempts, score };
  }
  if (!best || best.errors === 0) return undefined;
  return { start: best.start, end: best.end, errors: best.errors };
}

export function recommendPractice(
  history: PracticeSession[],
  scoreName: string,
  scoreDuration: number,
  scoreFingerprint?: string,
): PracticeRecommendation | undefined {
  const sessions = history
    .filter((session) => scoreFingerprint
      ? session.context.scoreFingerprint === scoreFingerprint
      : session.context.scoreFingerprint === undefined && session.context.scoreName === scoreName)
    .slice(0, MAX_SOURCE_SESSIONS);
  if (sessions.length === 0) return undefined;
  const events = sessions.flatMap((session) => session.events);
  if (events.length === 0) return undefined;
  const hits = events.filter((event) => event.kind === "hit").length;
  const errors = events.length - hits;
  const accuracy = Math.round((hits / events.length) * 1000) / 10;
  const latest = sessions[0];
  const timingValues = sessions
    .map((session) => session.summary.meanAbsTimingMs)
    .filter((value): value is number => value !== undefined);
  const timing = timingValues.length > 0
    ? timingValues.reduce((sum, value) => sum + value, 0) / timingValues.length
    : undefined;
  const tempo = recommendedTempo(latest.context.tempo, accuracy, timing);
  const hand = chooseHand(sessions);
  const loop = hardestWindow(sessions, scoreDuration);
  const mode: PracticeMode = accuracy < 70 ? "wait" : "realtime";
  const reasonParts: string[] = [];
  if (loop) reasonParts.push(`${loop.start.toFixed(1)}–${loop.end.toFixed(1)} 秒聚集了 ${loop.errors} 个加权错漏`);
  if (hand !== "both") reasonParts.push(`${hand === "left" ? "左手" : "右手"}错误率更高`);
  if (tempo < latest.context.tempo) reasonParts.push(`先降到 ${Math.round(tempo * 100)}% 稳定准确度`);
  else if (tempo > latest.context.tempo) reasonParts.push(`表现稳定，可提升到 ${Math.round(tempo * 100)}%`);
  if (mode === "wait") reasonParts.push("先用等我弹消除音高错误");
  else if (timing !== undefined && timing > 120) reasonParts.push("用实时模式收紧拍点");
  if (reasonParts.length === 0) reasonParts.push("保持当前设置，继续巩固一致性");

  return {
    scoreName,
    mode,
    hand,
    tempo,
    loop: loop ? { start: loop.start, end: loop.end } : undefined,
    confidence: sessions.length >= 5 && events.length >= 80 ? "high" : sessions.length >= 2 && events.length >= 20 ? "medium" : "low",
    reason: reasonParts.join("；"),
    evidence: { sessions: sessions.length, events: events.length, accuracy, errorsInLoop: loop?.errors ?? errors },
  };
}
