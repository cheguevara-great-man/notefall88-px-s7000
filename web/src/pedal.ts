import type { ScorePedalAction, ScorePedalEvent } from "./types";

const FULL_PEDAL_THRESHOLD = 64;
const MAX_MATCH_MS = 450;

export interface PedalControlSample {
  scoreTime: number;
  value: number;
  pass: number;
}

export type PedalAssessmentStatus = "hit" | "missed" | "unexpected";

export interface PedalAssessment {
  pass: number;
  scoreTime: number;
  targetValue: number;
  action: ScorePedalAction;
  actualScoreTime?: number;
  actualValue?: number;
  timingMs?: number;
  valueError?: number;
  status: PedalAssessmentStatus;
}

export interface PedalEvaluation {
  targets: number;
  matched: number;
  missed: number;
  unexpected: number;
  accuracy: number;
  meanAbsTimingMs?: number;
  timingBiasMs?: number;
  meanAbsValueError?: number;
  timingScore?: number;
  pedalScore?: number;
  assessments: PedalAssessment[];
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function timingQuality(milliseconds: number): number {
  if (milliseconds <= 60) return 100;
  if (milliseconds >= 300) return 0;
  return 100 * (300 - milliseconds) / 240;
}

function edgeState(action: ScorePedalAction): boolean | undefined {
  if (action === "down" || action === "change-down") return true;
  if (action === "up" || action === "change-up") return false;
  return undefined;
}

interface PedalEdge extends PedalControlSample {
  down: boolean;
  sampleIndex: number;
}

function fullPedalEdges(samples: PedalControlSample[]): PedalEdge[] {
  const edges: PedalEdge[] = [];
  let down = false;
  samples.forEach((sample, sampleIndex) => {
    const next = sample.value >= FULL_PEDAL_THRESHOLD;
    if (next !== down) edges.push({ ...sample, down: next, sampleIndex });
    down = next;
  });
  return edges;
}

/**
 * Grades one physical pass. Symbolic pedal marks are matched to CC64 threshold
 * edges, while numeric MusicXML damper-pedal levels retain half-pedal precision.
 */
export function evaluatePedal(
  targets: ScorePedalEvent[],
  controls: PedalControlSample[],
  tempo = 1,
  pass = 0,
): PedalEvaluation | undefined {
  if (targets.length === 0) return undefined;
  const safeTempo = Number.isFinite(tempo) && tempo > 0 ? tempo : 1;
  const sortedControls = controls
    .filter((sample) => sample.pass === pass && Number.isFinite(sample.scoreTime) && Number.isFinite(sample.value))
    .map((sample) => ({ ...sample, value: Math.max(0, Math.min(127, Math.round(sample.value))) }))
    .sort((a, b) => a.scoreTime - b.scoreTime);
  const edges = fullPedalEdges(sortedControls);
  const usedEdges = new Set<number>();
  const usedSamples = new Set<number>();
  const assessments: PedalAssessment[] = [];
  const matchScoreWindow = MAX_MATCH_MS / 1000 * safeTempo;

  for (const target of [...targets].sort((a, b) => a.time - b.time)) {
    const desiredState = edgeState(target.action);
    if (desiredState !== undefined) {
      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      edges.forEach((edge, index) => {
        if (usedEdges.has(index) || edge.down !== desiredState) return;
        const distance = Math.abs(edge.scoreTime - target.time);
        if (distance <= matchScoreWindow + 1e-9 && distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      });
      if (best < 0) {
        assessments.push({
          pass, scoreTime: target.time, targetValue: target.value, action: target.action, status: "missed",
        });
        continue;
      }
      usedEdges.add(best);
      usedSamples.add(edges[best].sampleIndex);
      const actual = edges[best];
      assessments.push({
        pass,
        scoreTime: target.time,
        targetValue: target.value,
        action: target.action,
        actualScoreTime: actual.scoreTime,
        actualValue: actual.value,
        timingMs: round((actual.scoreTime - target.time) / safeTempo * 1000),
        valueError: Math.abs(actual.value - target.value),
        status: "hit",
      });
      continue;
    }

    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    sortedControls.forEach((sample, index) => {
      if (usedSamples.has(index)) return;
      const distance = Math.abs(sample.scoreTime - target.time);
      if (distance <= matchScoreWindow + 1e-9 && distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    if (best < 0) {
      assessments.push({
        pass, scoreTime: target.time, targetValue: target.value, action: target.action, status: "missed",
      });
      continue;
    }
    usedSamples.add(best);
    const actual = sortedControls[best];
    const matchingEdge = edges.findIndex((edge) => edge.sampleIndex === best);
    if (matchingEdge >= 0) usedEdges.add(matchingEdge);
    assessments.push({
      pass,
      scoreTime: target.time,
      targetValue: target.value,
      action: target.action,
      actualScoreTime: actual.scoreTime,
      actualValue: actual.value,
      timingMs: round((actual.scoreTime - target.time) / safeTempo * 1000),
      valueError: Math.abs(actual.value - target.value),
      status: "hit",
    });
  }

  const firstTarget = Math.min(...targets.map((target) => target.time)) - matchScoreWindow;
  const lastTarget = Math.max(...targets.map((target) => target.time)) + matchScoreWindow;
  edges.forEach((edge, index) => {
    if (usedEdges.has(index) || edge.scoreTime < firstTarget || edge.scoreTime > lastTarget) return;
    assessments.push({
      pass,
      scoreTime: edge.scoreTime,
      targetValue: edge.down ? 127 : 0,
      action: edge.down ? "down" : "up",
      actualScoreTime: edge.scoreTime,
      actualValue: edge.value,
      status: "unexpected",
    });
  });
  return summarizePedalAssessments(assessments);
}

export function summarizePedalAssessments(assessments: PedalAssessment[]): PedalEvaluation {
  const targets = assessments.filter((assessment) => assessment.status !== "unexpected");
  const hits = targets.filter((assessment) => assessment.status === "hit");
  const unexpected = assessments.filter((assessment) => assessment.status === "unexpected");
  const timings = hits.map((assessment) => assessment.timingMs).filter((value): value is number => Number.isFinite(value));
  const values = hits
    .filter((assessment) => assessment.action === "level")
    .map((assessment) => assessment.valueError)
    .filter((value): value is number => Number.isFinite(value));
  const absoluteTiming = timings.map(Math.abs);
  const accuracy = targets.length + unexpected.length === 0
    ? 100 : hits.length / (targets.length + unexpected.length) * 100;
  const meanAbsTimingMs = absoluteTiming.length > 0
    ? absoluteTiming.reduce((sum, value) => sum + value, 0) / absoluteTiming.length : undefined;
  const timingScore = meanAbsTimingMs === undefined ? undefined : timingQuality(meanAbsTimingMs);
  const meanAbsValueError = values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
  const containsLevelTarget = targets.some((assessment) => assessment.action === "level");
  const valueScore = meanAbsValueError === undefined ? undefined : Math.max(0, 100 - meanAbsValueError / 63 * 100);
  let pedalScore: number | undefined;
  if (targets.length >= 2) {
    pedalScore = containsLevelTarget && valueScore !== undefined
      ? accuracy * 0.55 + (timingScore ?? 0) * 0.3 + valueScore * 0.15
      : accuracy * 0.7 + (timingScore ?? 0) * 0.3;
  }
  return {
    targets: targets.length,
    matched: hits.length,
    missed: targets.length - hits.length,
    unexpected: unexpected.length,
    accuracy: round(accuracy),
    meanAbsTimingMs: meanAbsTimingMs === undefined ? undefined : round(meanAbsTimingMs),
    timingBiasMs: timings.length === 0 ? undefined : round(timings.reduce((sum, value) => sum + value, 0) / timings.length),
    meanAbsValueError: meanAbsValueError === undefined ? undefined : round(meanAbsValueError),
    timingScore: timingScore === undefined ? undefined : round(timingScore),
    pedalScore: pedalScore === undefined ? undefined : round(pedalScore),
    assessments: assessments.map((assessment) => ({ ...assessment })),
  };
}
