import type { Hand, ParsedScore } from "./types";

export interface SheetCursorTarget {
  occurrence: number;
  writtenMeasure: number;
  localQuarter: number;
  notes: number[];
  hands: Hand[];
  signature: string;
}

export interface SheetCursorIterator {
  EndReached: boolean;
  CurrentMeasureIndex: number;
  CurrentRelativeInMeasureTimestamp?: { RealValue: number };
  moveToNext(): void;
}

function currentOccurrence(score: ParsedScore, seconds: number): number {
  const starts = score.measureStarts ?? [];
  let occurrence = 0;
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index] <= seconds + 1e-6) occurrence = index;
    else break;
  }
  return occurrence;
}

/** Selects the latest sounding/started score position, not merely its measure. */
export function sheetCursorTarget(score: ParsedScore | undefined, seconds: number): SheetCursorTarget | undefined {
  if (!score?.measureStarts?.length) return undefined;
  const occurrence = currentOccurrence(score, seconds);
  const writtenMeasure = score.measureMap?.[occurrence] ?? occurrence;
  const quarterStarts = score.measureQuarterStarts;
  let localQuarter = 0;
  let notes: number[] = [];
  let hands: Hand[] = [];

  if (quarterStarts && quarterStarts.length > occurrence + 1) {
    const startSeconds = score.measureStarts[occurrence] ?? 0;
    const endSeconds = score.measureStarts[occurrence + 1] ?? score.duration;
    const candidates = score.notes
      .filter((note) => note.scoreQuarterStart !== undefined
        && note.start >= startSeconds - 1e-6
        && note.start < endSeconds - 1e-6)
      .sort((left, right) => left.start - right.start || left.note - right.note);
    const started = candidates.filter((note) => note.start <= seconds + 0.012);
    const target = started.at(-1) ?? candidates[0];
    if (target?.scoreQuarterStart !== undefined) {
      localQuarter = Math.max(0, target.scoreQuarterStart - quarterStarts[occurrence]);
      const chord = candidates.filter((note) => Math.abs(note.scoreQuarterStart! - target.scoreQuarterStart!) < 1e-7);
      notes = [...new Set(chord.map((note) => note.note))].sort((left, right) => left - right);
      hands = [...new Set(chord.map((note) => note.hand))].sort();
    }
  }

  const rounded = Math.round(localQuarter * 1_000_000) / 1_000_000;
  return {
    occurrence,
    writtenMeasure,
    localQuarter: rounded,
    notes,
    hands,
    signature: `${occurrence}:${rounded}`,
  };
}

/**
 * Advances a reset OSMD cursor to a written measure and note position. OSMD's
 * display iterator does not expand repeats; expanded occurrences deliberately
 * map back to the same printed measure while the signature keeps them distinct.
 */
export function advanceSheetIterator(
  iterator: SheetCursorIterator,
  target: SheetCursorTarget,
  maximumSteps = 100_000,
): number {
  // OSMD exposes CurrentMeasureIndex as a one-based source-measure number,
  // while ParsedScore.measureMap is deliberately zero-based.
  const writtenIndex = () => Math.max(0, iterator.CurrentMeasureIndex - 1);
  let steps = 0;

  while (!iterator.EndReached && steps < maximumSteps) {
    const localQuarter = (iterator.CurrentRelativeInMeasureTimestamp?.RealValue ?? 0) * 4;
    const measure = writtenIndex();
    if (measure > target.writtenMeasure
      || (measure === target.writtenMeasure && localQuarter + 1e-7 >= target.localQuarter)) break;
    iterator.moveToNext();
    steps += 1;
  }
  return steps;
}
