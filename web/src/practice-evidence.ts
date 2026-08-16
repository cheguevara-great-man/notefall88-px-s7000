import type { PracticeEvent, PracticeSession, SessionSummary } from "./analytics";

export type LearningTrend = "improving" | "steady" | "declining" | "insufficient";

export interface AccuracyEvidence {
  hits: number;
  attempts: number;
  percent: number;
  lower95: number;
  upper95: number;
}

export interface PracticeEvidence {
  sessions: PracticeSession[];
  events: PracticeEvent[];
  accuracy: AccuracyEvidence;
  confidence: "low" | "medium" | "high";
  trend: LearningTrend;
  trendDelta?: number;
  sessionConsistency?: number;
  droppedEvents: number;
  completeTelemetry: boolean;
}

type SummaryMetric = keyof Pick<SessionSummary,
  | "meanAbsTimingMs"
  | "dynamicsScore"
  | "durationCoverageScore"
  | "releasePrecisionScore"
  | "coordinationScore"
  | "handAlignmentScore"
  | "pedalScore"
>;

const METRIC_WEIGHTS: Record<SummaryMetric, keyof SessionSummary | "timingEvents"> = {
  meanAbsTimingMs: "timingEvents",
  dynamicsScore: "dynamicsSamples",
  durationCoverageScore: "articulationSamples",
  releasePrecisionScore: "unpedaledArticulationSamples",
  coordinationScore: "coordinationSamples",
  handAlignmentScore: "crossHandCoordinationSamples",
  pedalScore: "pedalTargets",
};

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function attemptsIn(events: PracticeEvent[]): number {
  return events.reduce((count, event) => count + (
    event.kind === "hit" || event.kind === "wrong" || event.kind === "missed" ? 1 : 0
  ), 0);
}

function hitsIn(events: PracticeEvent[]): number {
  return events.reduce((count, event) => count + (event.kind === "hit" ? 1 : 0), 0);
}

/** Wilson score interval: stable at 0/100% and honest for small samples. */
export function accuracyEvidence(hitsValue: number, attemptsValue: number): AccuracyEvidence {
  const attempts = Math.max(0, Math.floor(finiteNonNegative(attemptsValue) ?? 0));
  const hits = Math.max(0, Math.min(attempts, Math.floor(finiteNonNegative(hitsValue) ?? 0)));
  if (attempts === 0) return { hits, attempts, percent: 0, lower95: 0, upper95: 100 };
  const z = 1.959963984540054;
  const proportion = hits / attempts;
  const denominator = 1 + (z * z) / attempts;
  const center = (proportion + (z * z) / (2 * attempts)) / denominator;
  const margin = z * Math.sqrt(
    (proportion * (1 - proportion) + (z * z) / (4 * attempts)) / attempts,
  ) / denominator;
  return {
    hits,
    attempts,
    percent: Math.round(proportion * 1_000) / 10,
    lower95: Math.round(Math.max(0, center - margin) * 1_000) / 10,
    upper95: Math.round(Math.min(1, center + margin) * 1_000) / 10,
  };
}

function validSession(session: PracticeSession): boolean {
  return Boolean(session && typeof session.id === "string" && Array.isArray(session.events)
    && Number.isFinite(session.endedAt));
}

/**
 * Selects deterministic, newest-first evidence and removes duplicate imported
 * records. A duplicated history backup must never double the coach's certainty.
 */
export function selectPracticeSessions(
  history: PracticeSession[],
  scoreName: string,
  scoreFingerprint?: string,
  maximum = 20,
): PracticeSession[] {
  const seen = new Set<string>();
  return history
    .filter(validSession)
    .filter((session) => scoreFingerprint
      ? session.context.scoreFingerprint === scoreFingerprint
      : session.context.scoreFingerprint === undefined && session.context.scoreName === scoreName)
    .sort((left, right) => right.endedAt - left.endedAt || right.startedAt - left.startedAt)
    .filter((session) => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    })
    .slice(0, Math.max(1, Math.floor(maximum)));
}

function aggregateAccuracy(sessions: PracticeSession[]): AccuracyEvidence {
  const events = sessions.flatMap((session) => session.events);
  return accuracyEvidence(hitsIn(events), attemptsIn(events));
}

function halfAccuracy(sessions: PracticeSession[]): { recent: AccuracyEvidence; older: AccuracyEvidence } | undefined {
  if (sessions.length < 4) return undefined;
  const middle = Math.ceil(sessions.length / 2);
  const recent = aggregateAccuracy(sessions.slice(0, middle));
  const older = aggregateAccuracy(sessions.slice(middle));
  if (recent.attempts < 10 || older.attempts < 10) return undefined;
  return { recent, older };
}

function learningTrend(sessions: PracticeSession[]): { trend: LearningTrend; delta?: number } {
  const halves = halfAccuracy(sessions);
  if (!halves) return { trend: "insufficient" };
  const delta = Math.round((halves.recent.percent - halves.older.percent) * 10) / 10;
  // Demand both a practically relevant change and interval evidence. This
  // avoids celebrating/randomly punishing a noisy five-note run.
  if (delta >= 4 && halves.recent.lower95 > halves.older.upper95) return { trend: "improving", delta };
  if (delta <= -4 && halves.recent.upper95 < halves.older.lower95) return { trend: "declining", delta };
  return { trend: "steady", delta };
}

function consistency(sessions: PracticeSession[]): number | undefined {
  const rates = sessions.flatMap((session) => {
    const attempts = attemptsIn(session.events);
    if (attempts < 5) return [];
    return [{ accuracy: hitsIn(session.events) / attempts * 100, weight: Math.min(attempts, 100) }];
  });
  if (rates.length < 2) return undefined;
  const totalWeight = rates.reduce((sum, sample) => sum + sample.weight, 0);
  const mean = rates.reduce((sum, sample) => sum + sample.accuracy * sample.weight, 0) / totalWeight;
  const variance = rates.reduce(
    (sum, sample) => sum + sample.weight * (sample.accuracy - mean) ** 2,
    0,
  ) / totalWeight;
  // 100 is perfectly repeatable; a 20-point session-to-session SD reaches 0.
  return Math.round(Math.max(0, 100 - Math.sqrt(variance) * 5) * 10) / 10;
}

export function buildPracticeEvidence(sessions: PracticeSession[]): PracticeEvidence {
  const events = sessions.flatMap((session) => session.events);
  const accuracy = accuracyEvidence(hitsIn(events), attemptsIn(events));
  const droppedEvents = sessions.reduce(
    (sum, session) => sum + Math.floor(finiteNonNegative(session.droppedEvents) ?? 0),
    0,
  );
  const completeTelemetry = droppedEvents === 0;
  const intervalWidth = accuracy.upper95 - accuracy.lower95;
  const confidence = completeTelemetry && sessions.length >= 5 && accuracy.attempts >= 80 && intervalWidth <= 14
    ? "high"
    : completeTelemetry && sessions.length >= 2 && accuracy.attempts >= 20 && intervalWidth <= 28
      ? "medium"
      : "low";
  const trend = learningTrend(sessions);
  return {
    sessions,
    events,
    accuracy,
    confidence,
    trend: trend.trend,
    trendDelta: trend.delta,
    sessionConsistency: consistency(sessions),
    droppedEvents,
    completeTelemetry,
  };
}

/** Weighted by real contributing samples, rather than treating a short run as a full performance. */
export function weightedSummaryMetric(
  sessions: PracticeSession[],
  metric: SummaryMetric,
): number | undefined {
  const weightMetric = METRIC_WEIGHTS[metric];
  let weightedTotal = 0;
  let totalWeight = 0;
  for (const session of sessions) {
    const value = finiteNonNegative(session.summary[metric]);
    if (value === undefined) continue;
    const weightValue = weightMetric === "timingEvents"
      ? session.events.filter((event) => event.kind === "hit" && Number.isFinite(event.timingMs)).length
      : finiteNonNegative(session.summary[weightMetric]);
    // Legacy records may have a valid metric but predate its sample counter.
    // Give them one conservative vote, never the weight of a complete session.
    const weight = Math.max(1, Math.floor(weightValue ?? 0));
    weightedTotal += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedTotal / totalWeight : undefined;
}
