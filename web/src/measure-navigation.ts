import type { ParsedScore } from "./types";

export interface MeasureNavigationItem {
  occurrence: number;
  writtenMeasure: number;
  start: number;
  current: boolean;
  inLoop: boolean;
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
