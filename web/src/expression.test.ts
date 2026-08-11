import { describe, expect, it } from "vitest";

import { evaluateDynamics } from "./expression";

const targets = [40, 60, 80, 100];

describe("relative dynamics evaluation", () => {
  it("scores an exact contour and ignores a consistent touch offset", () => {
    expect(evaluateDynamics(targets.map((target) => ({ actual: target, target })))).toMatchObject({
      samples: 4, bias: 0, meanAbsError: 0, residualMeanAbsError: 0, score: 100,
    });
    expect(evaluateDynamics(targets.map((target) => ({ actual: target + 10, target })))).toMatchObject({
      samples: 4, bias: 10, meanAbsError: 10, residualMeanAbsError: 0, score: 100,
    });
  });

  it("penalizes compressed and reversed dynamic contours", () => {
    expect(evaluateDynamics(targets.map((target) => ({ actual: 70, target })))?.score)
      .toBeCloseTo(6.67, 1);
    expect(evaluateDynamics(targets.map((target, index) => ({ actual: targets.at(-index - 1)!, target })))?.score)
      .toBe(0);
  });

  it("does not invent a contour score for flat targets or too little evidence", () => {
    expect(evaluateDynamics([40, 40, 40, 40].map((target, index) => ({ actual: 50 + index, target })))?.score)
      .toBeUndefined();
    expect(evaluateDynamics([{ actual: 70, target: 60 }])?.score).toBeUndefined();
  });

  it("rejects invalid samples without poisoning valid evidence", () => {
    expect(evaluateDynamics([
      { actual: Number.NaN, target: 60 },
      { actual: 80, target: 200 },
      { actual: 72, target: 64 },
    ])).toMatchObject({ samples: 1, actualMean: 72, targetMean: 64, bias: 8 });
    expect(evaluateDynamics([])).toBeUndefined();
  });
});
