import { describe, expect, it } from "vitest";

import { currentMeasureOccurrence, measureLoopRange, measureNavigation, measurePerformance } from "./measure-navigation";

const score = {
  name: "Navigation", duration: 12, notes: [],
  measureStarts: [0, 2, 4, 6, 8, 10], measureMap: [0, 1, 0, 2, 3, 4],
};

describe("score measure navigation", () => {
  it("keeps repeat occurrences separate while showing written measure labels", () => {
    expect(measureNavigation(score, 4.1, { start: 3.9, end: 8.1 }, 1)).toEqual([
      { occurrence: 1, writtenMeasure: 1, start: 2, current: false, inLoop: false },
      { occurrence: 2, writtenMeasure: 0, start: 4, current: true, inLoop: true },
      { occurrence: 3, writtenMeasure: 2, start: 6, current: false, inLoop: true },
    ]);
  });

  it("clamps at score boundaries and ignores missing score navigation", () => {
    expect(currentMeasureOccurrence(score, -1)).toBe(0);
    expect(currentMeasureOccurrence(score, 99)).toBe(5);
    expect(measureNavigation(undefined, 0)).toEqual([]);
  });

  it("creates inclusive whole-measure loops from two rail selections", () => {
    expect(measureLoopRange(score, 3, 1)).toEqual({ start: 2, end: 8 });
    expect(measureLoopRange(score, 5, 5)).toEqual({ start: 10, end: 12 });
    expect(measureLoopRange(undefined, 0, 1)).toBeUndefined();
  });

  it("builds a repeat-aware measure heat ribbon from practice judgments", () => {
    expect(measurePerformance(score, [
      { kind: "hit", note: 60, velocity: 90, scoreTime: 0.2, timingMs: 12 },
      { kind: "hit", note: 62, velocity: 90, scoreTime: 4.2, timingMs: 160 },
      { kind: "missed", note: 64, scoreTime: 4.4 },
      { kind: "wrong", note: 65, velocity: 80, scoreTime: 6.2 },
    ])).toEqual([
      expect.objectContaining({ occurrence: 0, tone: "clean", hits: 1, severity: expect.any(Number) }),
      expect.objectContaining({ occurrence: 1, tone: "untouched" }),
      expect.objectContaining({ occurrence: 2, tone: "weak", hits: 1, missed: 1 }),
      expect.objectContaining({ occurrence: 3, tone: "weak", wrong: 1 }),
      expect.objectContaining({ occurrence: 4, tone: "untouched" }),
      expect.objectContaining({ occurrence: 5, tone: "untouched" }),
    ]);
  });

  it("ignores non-finite event positions and absent scores", () => {
    expect(measurePerformance(undefined, [])).toEqual([]);
    expect(measurePerformance(score, [
      { kind: "wrong", note: 60, velocity: 80, scoreTime: Number.NaN },
    ]).every((item) => item.tone === "untouched")).toBe(true);
  });
});
