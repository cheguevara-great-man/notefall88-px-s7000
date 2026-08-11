import type { PracticeSession } from "./analytics";

export interface PracticeTrendPoint {
  id: string;
  endedAt: number;
  accuracy: number;
  timingMs?: number;
  dynamicsScore?: number;
  durationCoverageScore?: number;
  releasePrecisionScore?: number;
  coordinationScore?: number;
  handAlignmentScore?: number;
  events: number;
}

export interface PracticeTrend {
  points: PracticeTrendPoint[];
  totalEvents: number;
  accuracyDelta?: number;
  timingDeltaMs?: number;
  dynamicsDelta?: number;
  durationCoverageDelta?: number;
  coordinationDelta?: number;
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Compares early and late windows, so one lucky attempt is never treated as progress. */
export function practiceTrend(sessions: PracticeSession[], maximum = 12): PracticeTrend {
  const ordered = [...sessions]
    .filter((session) => Number.isFinite(session.endedAt) && Number.isFinite(session.summary.accuracy))
    .sort((first, second) => first.endedAt - second.endedAt)
    .slice(-Math.max(1, Math.floor(maximum)));
  const points = ordered.map((session) => ({
    id: session.id,
    endedAt: session.endedAt,
    accuracy: Math.max(0, Math.min(100, session.summary.accuracy)),
    timingMs: session.summary.meanAbsTimingMs,
    dynamicsScore: session.summary.dynamicsScore,
    durationCoverageScore: session.summary.durationCoverageScore,
    releasePrecisionScore: session.summary.releasePrecisionScore,
    coordinationScore: session.summary.coordinationScore,
    handAlignmentScore: session.summary.handAlignmentScore,
    events: session.summary.hits + session.summary.wrong + session.summary.missed,
  }));
  const window = Math.min(3, Math.floor(points.length / 2));
  const early = window > 0 ? points.slice(0, window) : [];
  const late = window > 0 ? points.slice(-window) : [];
  const earlyAccuracy = mean(early.map((point) => point.accuracy));
  const lateAccuracy = mean(late.map((point) => point.accuracy));
  const earlyTiming = mean(early.flatMap((point) => point.timingMs === undefined ? [] : [point.timingMs]));
  const lateTiming = mean(late.flatMap((point) => point.timingMs === undefined ? [] : [point.timingMs]));
  const earlyDynamics = mean(early.flatMap((point) => point.dynamicsScore === undefined ? [] : [point.dynamicsScore]));
  const lateDynamics = mean(late.flatMap((point) => point.dynamicsScore === undefined ? [] : [point.dynamicsScore]));
  const earlyCoverage = mean(early.flatMap((point) => point.durationCoverageScore === undefined ? [] : [point.durationCoverageScore]));
  const lateCoverage = mean(late.flatMap((point) => point.durationCoverageScore === undefined ? [] : [point.durationCoverageScore]));
  const earlyCoordination = mean(early.flatMap((point) => point.coordinationScore === undefined ? [] : [point.coordinationScore]));
  const lateCoordination = mean(late.flatMap((point) => point.coordinationScore === undefined ? [] : [point.coordinationScore]));
  return {
    points,
    totalEvents: points.reduce((sum, point) => sum + point.events, 0),
    accuracyDelta: earlyAccuracy === undefined || lateAccuracy === undefined ? undefined : lateAccuracy - earlyAccuracy,
    // Lower absolute timing error is better, so positive means improvement.
    timingDeltaMs: earlyTiming === undefined || lateTiming === undefined ? undefined : earlyTiming - lateTiming,
    dynamicsDelta: earlyDynamics === undefined || lateDynamics === undefined ? undefined : lateDynamics - earlyDynamics,
    durationCoverageDelta: earlyCoverage === undefined || lateCoverage === undefined ? undefined : lateCoverage - earlyCoverage,
    coordinationDelta: earlyCoordination === undefined || lateCoordination === undefined
      ? undefined : lateCoordination - earlyCoordination,
  };
}
