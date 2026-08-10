import { describe, expect, it } from "vitest";

import { currentMeasureOccurrence, measureLoopRange, measureNavigation } from "./measure-navigation";

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
});
