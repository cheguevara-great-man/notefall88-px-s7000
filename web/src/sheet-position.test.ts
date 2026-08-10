import { describe, expect, it } from "vitest";

import { advanceSheetIterator, sheetCursorTarget } from "./sheet-position";
import type { ParsedScore } from "./types";

const score: ParsedScore = {
  name: "Repeat study",
  duration: 8,
  measureStarts: [0, 2, 4, 6],
  measureQuarterStarts: [0, 4, 8, 12, 16],
  measureMap: [0, 1, 0, 2],
  notes: [
    { note: 60, start: 0, end: 0.5, velocity: 80, hand: "right", scoreQuarterStart: 0 },
    { note: 62, start: 1, end: 1.5, velocity: 80, hand: "right", scoreQuarterStart: 2 },
    { note: 64, start: 4, end: 4.5, velocity: 80, hand: "right", scoreQuarterStart: 8 },
    { note: 65, start: 5, end: 5.5, velocity: 80, hand: "right", scoreQuarterStart: 10 },
  ],
};

describe("score-follow cursor position", () => {
  it("moves between notes inside one measure", () => {
    expect(sheetCursorTarget(score, 0.2)).toMatchObject({ occurrence: 0, localQuarter: 0 });
    expect(sheetCursorTarget(score, 1.1)).toMatchObject({ occurrence: 0, localQuarter: 2 });
  });

  it("keeps repeated written measures as separate playback occurrences", () => {
    expect(sheetCursorTarget(score, 4.2)).toEqual({
      occurrence: 2, writtenMeasure: 0, localQuarter: 0, notes: [64], hands: ["right"], signature: "2:0",
    });
    expect(sheetCursorTarget(score, 5.2)?.signature).toBe("2:2");
  });

  it("maps a repeated occurrence back to its written measure and note", () => {
    const entries = [
      [1, 0], [1, 0.5], [2, 0], [2, 0.5], [3, 0],
    ];
    let index = 0;
    const iterator = {
      get EndReached() { return index >= entries.length - 1; },
      get CurrentMeasureIndex() { return entries[index][0]; },
      get CurrentRelativeInMeasureTimestamp() { return { RealValue: entries[index][1] }; },
      moveToNext() { index += 1; },
    };
    const target = sheetCursorTarget(score, 5.2)!;
    expect(advanceSheetIterator(iterator, target)).toBe(1);
    expect(index).toBe(1);
  });

  it("falls back to a measure cursor when quarter metadata is absent", () => {
    const minimal = { ...score, measureQuarterStarts: undefined, notes: [] };
    expect(sheetCursorTarget(minimal, 6.5)).toEqual({
      occurrence: 3, writtenMeasure: 2, localQuarter: 0, notes: [], hands: [], signature: "3:0",
    });
  });
});
