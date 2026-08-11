import type { PracticeEvent } from "./analytics";

const SCORE_TIME_EPSILON = 1e-4;
const PERFECT_SPREAD_MS = 30;
const ZERO_SCORE_SPREAD_MS = 120;
const MIN_SCORE_SAMPLES = 4;

export interface CoordinationSample {
  scoreTime: number;
  notes: number;
  spreadMs: number;
  leftNotes: number;
  rightNotes: number;
  /** Positive means the right hand landed after the left hand. */
  handOffsetMs?: number;
  score: number;
}

export interface CoordinationEvaluation {
  samples: number;
  crossHandSamples: number;
  meanChordSpreadMs: number;
  p95ChordSpreadMs: number;
  coordinationScore?: number;
  meanHandOffsetMs?: number;
  handAlignmentScore?: number;
  looseChordSamples: number;
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentile(values: number[], proportion: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(proportion * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

export function coordinationSampleScore(spreadMs: number): number {
  if (!Number.isFinite(spreadMs) || spreadMs < 0) return 0;
  if (spreadMs <= PERFECT_SPREAD_MS) return 100;
  return Math.max(0, 100 - (spreadMs - PERFECT_SPREAD_MS)
    / (ZERO_SCORE_SPREAD_MS - PERFECT_SPREAD_MS) * 100);
}

/**
 * Builds samples only from notes mapped to the exact same score onset. This is
 * intentionally stricter than the UI's chord-preview window: near-by arpeggio
 * notes must never be diagnosed as a badly synchronized block chord.
 */
export function coordinationSamples(events: PracticeEvent[]): CoordinationSample[] {
  const groups: Array<{ time: number; hits: Extract<PracticeEvent, { kind: "hit" }>[]; missed: boolean }> = [];
  const relevant = events
    .filter((event) => event.kind === "hit" || event.kind === "missed")
    .filter((event) => Number.isFinite(event.scoreTime))
    .sort((first, second) => first.scoreTime - second.scoreTime);
  for (const event of relevant) {
    let group = groups.at(-1);
    if (!group || Math.abs(group.time - event.scoreTime) > SCORE_TIME_EPSILON) {
      group = { time: event.scoreTime, hits: [], missed: false };
      groups.push(group);
    }
    if (event.kind === "missed") group.missed = true;
    else if (Number.isFinite(event.timingMs)) group.hits.push(event);
  }

  return groups.flatMap((group) => {
    // A partial chord can look artificially tight; pitch accuracy owns it.
    if (group.missed || group.hits.length < 2) return [];
    const unique = new Map<number, Extract<PracticeEvent, { kind: "hit" }>>();
    for (const hit of group.hits) unique.set(hit.note, hit);
    const hits = [...unique.values()];
    if (hits.length < 2) return [];
    const timings = hits.map((hit) => hit.timingMs!);
    const spreadMs = Math.max(...timings) - Math.min(...timings);
    const left = hits.filter((hit) => hit.hand === "left");
    const right = hits.filter((hit) => hit.hand === "right");
    const handOffsetMs = left.length > 0 && right.length > 0
      ? right.reduce((sum, hit) => sum + hit.timingMs!, 0) / right.length
        - left.reduce((sum, hit) => sum + hit.timingMs!, 0) / left.length
      : undefined;
    return [{
      scoreTime: group.time,
      notes: hits.length,
      spreadMs: round(spreadMs),
      leftNotes: left.length,
      rightNotes: right.length,
      handOffsetMs: handOffsetMs === undefined ? undefined : round(handOffsetMs),
      score: round(coordinationSampleScore(spreadMs)),
    }];
  });
}

export function evaluateCoordination(events: PracticeEvent[]): CoordinationEvaluation | undefined {
  const samples = coordinationSamples(events);
  if (samples.length === 0) return undefined;
  const spreads = samples.map((sample) => sample.spreadMs);
  const crossHand = samples.filter((sample) => sample.handOffsetMs !== undefined);
  const offsets = crossHand.map((sample) => sample.handOffsetMs!);
  return {
    samples: samples.length,
    crossHandSamples: crossHand.length,
    meanChordSpreadMs: round(spreads.reduce((sum, value) => sum + value, 0) / spreads.length),
    p95ChordSpreadMs: round(percentile(spreads, 0.95)),
    coordinationScore: samples.length < MIN_SCORE_SAMPLES
      ? undefined
      : round(samples.reduce((sum, sample) => sum + sample.score, 0) / samples.length),
    meanHandOffsetMs: offsets.length === 0
      ? undefined
      : round(offsets.reduce((sum, value) => sum + value, 0) / offsets.length),
    handAlignmentScore: offsets.length < MIN_SCORE_SAMPLES
      ? undefined
      : round(offsets.reduce((sum, value) => sum + coordinationSampleScore(Math.abs(value)), 0) / offsets.length),
    looseChordSamples: samples.filter((sample) => sample.spreadMs > 70).length,
  };
}
