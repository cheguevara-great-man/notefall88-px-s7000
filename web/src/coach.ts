import type { PracticeSession } from "./analytics";
import type { HandSelection, PracticeMode } from "./types";
import { MAX_TEMPO, MIN_TEMPO, normalizeTempo } from "./tempo";

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
    dynamicsScore?: number;
    durationCoverageScore?: number;
    releasePrecisionScore?: number;
    coordinationScore?: number;
    handAlignmentScore?: number;
    pedalScore?: number;
  };
}

function recommendedTempo(
  current: number,
  accuracy: number,
  timingMs?: number,
  dynamicsScore?: number,
  durationCoverageScore?: number,
  releasePrecisionScore?: number,
  coordinationScore?: number,
  pedalScore?: number,
): number {
  const normalized = normalizeTempo(current);
  const delta = accuracy < 70
    ? -0.15
    : (accuracy < 88 || (timingMs !== undefined && timingMs > 120))
      ? -0.1
      : ((dynamicsScore !== undefined && dynamicsScore < 60)
          || (durationCoverageScore !== undefined && durationCoverageScore < 75)
          || (releasePrecisionScore !== undefined && releasePrecisionScore < 60)
          || (coordinationScore !== undefined && coordinationScore < 65)
          || (pedalScore !== undefined && pedalScore < 65))
        ? -0.05
        : (accuracy >= 96 && (timingMs === undefined || timingMs < 65)
          && (dynamicsScore === undefined || dynamicsScore >= 80)
          && (durationCoverageScore === undefined || durationCoverageScore >= 90)
          && (releasePrecisionScore === undefined || releasePrecisionScore >= 75)
          && (coordinationScore === undefined || coordinationScore >= 85)
          && (pedalScore === undefined || pedalScore >= 85)) ? 0.05 : 0;
  return normalizeTempo(Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, normalized + delta)));
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
      for (const assessment of session.pedalAssessments ?? []) {
        if (assessment.scoreTime < start || assessment.scoreTime >= end) continue;
        attempts += 1;
        const weakHit = assessment.status === "hit"
          && (Math.abs(assessment.timingMs ?? 0) > 180 || (assessment.valueError ?? 0) > 20);
        if (assessment.status !== "hit" || weakHit) {
          errors += assessment.status === "missed" ? 2 : 1;
          errorTimeSum += assessment.scoreTime;
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
  const dynamicsValues = sessions
    .map((session) => session.summary.dynamicsScore)
    .filter((value): value is number => value !== undefined);
  const dynamics = dynamicsValues.length > 0
    ? dynamicsValues.reduce((sum, value) => sum + value, 0) / dynamicsValues.length
    : undefined;
  const coverageValues = sessions
    .map((session) => session.summary.durationCoverageScore)
    .filter((value): value is number => value !== undefined);
  const durationCoverage = coverageValues.length > 0
    ? coverageValues.reduce((sum, value) => sum + value, 0) / coverageValues.length
    : undefined;
  const releaseValues = sessions
    .map((session) => session.summary.releasePrecisionScore)
    .filter((value): value is number => value !== undefined);
  const releasePrecision = releaseValues.length > 0
    ? releaseValues.reduce((sum, value) => sum + value, 0) / releaseValues.length
    : undefined;
  const coordinationValues = sessions
    .map((session) => session.summary.coordinationScore)
    .filter((value): value is number => value !== undefined);
  const coordination = coordinationValues.length > 0
    ? coordinationValues.reduce((sum, value) => sum + value, 0) / coordinationValues.length
    : undefined;
  const handAlignmentValues = sessions
    .map((session) => session.summary.handAlignmentScore)
    .filter((value): value is number => value !== undefined);
  const handAlignment = handAlignmentValues.length > 0
    ? handAlignmentValues.reduce((sum, value) => sum + value, 0) / handAlignmentValues.length
    : undefined;
  const pedalValues = sessions
    .map((session) => session.summary.pedalScore)
    .filter((value): value is number => value !== undefined);
  const pedal = pedalValues.length > 0
    ? pedalValues.reduce((sum, value) => sum + value, 0) / pedalValues.length
    : undefined;
  const tempo = recommendedTempo(
    latest.context.tempo,
    accuracy,
    timing,
    dynamics,
    durationCoverage,
    releasePrecision,
    coordination,
    pedal,
  );
  const hand = chooseHand(sessions);
  const loop = hardestWindow(sessions, scoreDuration);
  // Pedal timing needs the score clock; wait-for-me deliberately has no absolute onset.
  const mode: PracticeMode = pedal !== undefined && pedal < 65 ? "realtime" : accuracy < 70 ? "wait" : "realtime";
  const reasonParts: string[] = [];
  if (loop) reasonParts.push(`${loop.start.toFixed(1)}–${loop.end.toFixed(1)} 秒聚集了 ${loop.errors} 个加权错漏`);
  if (hand !== "both") reasonParts.push(`${hand === "left" ? "左手" : "右手"}错误率更高`);
  if (tempo < latest.context.tempo) reasonParts.push(
    dynamics !== undefined && dynamics < 60 && accuracy >= 88 && (timing === undefined || timing <= 120)
      ? `先降到 ${Math.round(tempo * 100)}% 打磨力度层次`
      : ((durationCoverage !== undefined && durationCoverage < 75)
          || (releasePrecision !== undefined && releasePrecision < 60))
        ? `先降到 ${Math.round(tempo * 100)}% 修正提前收音与指尖释放`
        : coordination !== undefined && coordination < 65
          ? `先降到 ${Math.round(tempo * 100)}% 收紧和弦与双手落键`
        : pedal !== undefined && pedal < 65
          ? `先降到 ${Math.round(tempo * 100)}% 对齐谱面换踏与松踏`
      : `先降到 ${Math.round(tempo * 100)}% 稳定准确度`,
  );
  else if (tempo > latest.context.tempo) reasonParts.push(`表现稳定，可提升到 ${Math.round(tempo * 100)}%`);
  if (mode === "wait") reasonParts.push("先用等我弹消除音高错误");
  else if (timing !== undefined && timing > 120) reasonParts.push("用实时模式收紧拍点");
  if (dynamics !== undefined && dynamics < 60) reasonParts.push(`力度轮廓 ${Math.round(dynamics)}%，放慢后夸大谱面强弱层次`);
  if (durationCoverage !== undefined && durationCoverage < 75) {
    reasonParts.push(`时值覆盖 ${Math.round(durationCoverage)}%，先确保声音延续到谱面目标末端`);
  }
  if (releasePrecision !== undefined && releasePrecision < 60) {
    reasonParts.push(`无踏板释放 ${Math.round(releasePrecision)}%，单独练习整齐松键`);
  }
  if (coordination !== undefined && coordination < 65) {
    reasonParts.push(`和弦整齐度 ${Math.round(coordination)}%，慢速对齐各音起点后再恢复速度`);
  }
  if (handAlignment !== undefined && handAlignment < 65) {
    reasonParts.push(`双手同步 ${Math.round(handAlignment)}%，先用落键重音确认两手共同脉冲`);
  }
  if (pedal !== undefined && pedal < 65) {
    reasonParts.push(`谱面踏板 ${Math.round(pedal)}%，用实时模式逐个对齐踩下、松开与换踏`);
  }
  if (reasonParts.length === 0) reasonParts.push("保持当前设置，继续巩固一致性");

  return {
    scoreName,
    mode,
    hand,
    tempo,
    loop: loop ? { start: loop.start, end: loop.end } : undefined,
    confidence: sessions.length >= 5 && events.length >= 80 ? "high" : sessions.length >= 2 && events.length >= 20 ? "medium" : "low",
    reason: reasonParts.join("；"),
    evidence: {
      sessions: sessions.length,
      events: events.length,
      accuracy,
      errorsInLoop: loop?.errors ?? errors,
      dynamicsScore: dynamics,
      durationCoverageScore: durationCoverage,
      releasePrecisionScore: releasePrecision,
      coordinationScore: coordination,
      handAlignmentScore: handAlignment,
      pedalScore: pedal,
    },
  };
}
