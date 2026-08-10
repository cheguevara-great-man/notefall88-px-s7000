import type { ParsedScore } from "./types";
import type { PracticeEvent } from "./analytics";

export interface MeasureNavigationItem {
  occurrence: number;
  writtenMeasure: number;
  start: number;
  current: boolean;
  inLoop: boolean;
}

export type MeasurePerformanceTone = "untouched" | "clean" | "watch" | "weak";

export interface MeasurePerformance {
  occurrence: number;
  hits: number;
  wrong: number;
  missed: number;
  meanAbsTimingMs?: number;
  /** 0 is clean; 1 is the strongest available practice warning. */
  severity: number;
  tone: MeasurePerformanceTone;
}

function occurrenceAt(score: ParsedScore, seconds: number): number {
  const starts = score.measureStarts ?? [];
  let occurrence = 0;
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index] <= seconds + 1e-6) occurrence = index;
    else break;
  }
  return occurrence;
}

/** Converts practice judgments into a repeat-aware, whole-score heat ribbon. */
export function measurePerformance(
  score: ParsedScore | undefined,
  events: PracticeEvent[],
): MeasurePerformance[] {
  const starts = score?.measureStarts ?? [];
  if (!score || starts.length === 0) return [];
  const buckets = starts.map(() => ({ hits: 0, wrong: 0, missed: 0, timings: [] as number[] }));
  for (const event of events) {
    if (!Number.isFinite(event.scoreTime)) continue;
    const bucket = buckets[occurrenceAt(score, event.scoreTime)];
    if (!bucket) continue;
    if (event.kind === "hit") bucket.hits += 1;
    else bucket[event.kind] += 1;
    if (event.kind === "hit" && Number.isFinite(event.timingMs)) bucket.timings.push(Math.abs(event.timingMs!));
  }
  return buckets.map((bucket, occurrence) => {
    const attempts = bucket.hits + bucket.wrong + bucket.missed;
    if (attempts === 0) {
      return { occurrence, hits: 0, wrong: 0, missed: 0, severity: 0, tone: "untouched" };
    }
    const meanAbsTimingMs = bucket.timings.length > 0
      ? bucket.timings.reduce((sum, value) => sum + value, 0) / bucket.timings.length
      : undefined;
    const errorRate = (bucket.wrong + bucket.missed) / attempts;
    const timingPenalty = Math.min(1, (meanAbsTimingMs ?? 0) / 220);
    const severity = Math.round(Math.min(1, errorRate * 0.82 + timingPenalty * 0.18) * 1_000) / 1_000;
    const tone: MeasurePerformanceTone = severity < 0.12 ? "clean" : severity < 0.4 ? "watch" : "weak";
    return { occurrence, hits: bucket.hits, wrong: bucket.wrong, missed: bucket.missed, meanAbsTimingMs, severity, tone };
  });
}

/** Maps playback occurrences (including repeats) to a small, readable score rail. */
export function measureNavigation(
  score: ParsedScore | undefined,
  seconds: number,
  loop?: { start: number; end: number },
  radius = 3,
): MeasureNavigationItem[] {
  const starts = score?.measureStarts ?? [];
  if (starts.length === 0) return [];
  let current = 0;
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index] <= seconds + 1e-6) current = index;
    else break;
  }
  const safeRadius = Math.max(1, Math.min(12, Math.floor(radius)));
  const first = Math.max(0, current - safeRadius);
  const last = Math.min(starts.length, current + safeRadius + 1);
  return starts.slice(first, last).map((start, localIndex) => {
    const occurrence = first + localIndex;
    return {
      occurrence,
      writtenMeasure: score?.measureMap?.[occurrence] ?? occurrence,
      start,
      current: occurrence === current,
      inLoop: loop !== undefined && start >= loop.start - 1e-6 && start < loop.end - 1e-6,
    };
  });
}

export function currentMeasureOccurrence(score: ParsedScore | undefined, seconds: number): number | undefined {
  const items = measureNavigation(score, seconds, undefined, 1);
  return items.find((item) => item.current)?.occurrence;
}

/** Returns a whole-measure practice loop covering both selected rail pills. */
export function measureLoopRange(
  score: ParsedScore | undefined,
  firstOccurrence: number,
  secondOccurrence: number,
): { start: number; end: number } | undefined {
  const starts = score?.measureStarts ?? [];
  if (starts.length === 0) return undefined;
  const first = Math.max(0, Math.min(starts.length - 1, Math.floor(firstOccurrence)));
  const second = Math.max(0, Math.min(starts.length - 1, Math.floor(secondOccurrence)));
  const from = Math.min(first, second);
  const through = Math.max(first, second);
  const start = starts[from];
  const end = starts[through + 1] ?? score?.duration ?? starts[through];
  return end > start ? { start, end } : undefined;
}
