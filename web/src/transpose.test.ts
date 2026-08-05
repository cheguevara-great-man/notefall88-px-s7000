import { describe, expect, it } from "vitest";

import { clampTranspose, transposeLabel, transposeScore } from "./transpose";
import type { ParsedScore } from "./types";

const source: ParsedScore = {
  name: "Range Test",
  duration: 2,
  notes: [
    { note: 21, start: 0, end: 1, velocity: 90, hand: "left" },
    { note: 60, start: 1, end: 2, velocity: 100, hand: "right" },
    { note: 108, start: 1, end: 2, velocity: 100, hand: "right" },
  ],
  measureStarts: [0, 1],
};

describe("score transposition", () => {
  it("shifts targets without mutating the imported score", () => {
    const shifted = transposeScore(source, 2);
    expect(shifted.notes.map((note) => note.note)).toEqual([23, 62]);
    expect(source.notes.map((note) => note.note)).toEqual([21, 60, 108]);
    expect(shifted.measureStarts).not.toBe(source.measureStarts);
  });

  it("clamps the UI range to one octave in either direction", () => {
    expect(clampTranspose(-99)).toBe(-12);
    expect(clampTranspose(99)).toBe(12);
    expect(transposeLabel(0)).toBe("原调");
    expect(transposeLabel(3)).toBe("+3 半音");
  });
});
