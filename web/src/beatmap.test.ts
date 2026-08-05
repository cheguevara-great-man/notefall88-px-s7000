import { describe, expect, it } from "vitest";

import { beatMapFromTicks, countInPlan } from "./beatmap";

describe("beat map", () => {
  it("expands time signatures into accented beat markers", () => {
    const beats = beatMapFromTicks([
      { ticks: 0, numerator: 3, denominator: 4 },
      { ticks: 2_880, numerator: 2, denominator: 4 },
    ], 480, 3_840, (ticks) => ticks / 960);
    expect(beats.map((beat) => [beat.time, beat.accent, beat.beat])).toEqual([
      [0, true, 0], [0.5, false, 1], [1, false, 2],
      [1.5, true, 0], [2, false, 1], [2.5, false, 2],
      [3, true, 0], [3.5, false, 1],
    ]);
  });

  it("defaults malformed or absent signatures to 4/4", () => {
    expect(beatMapFromTicks([], 480, 1_920, (ticks) => ticks / 960))
      .toMatchObject([
        { time: 0, accent: true, beat: 0 },
        { time: 0.5, accent: false, beat: 1 },
        { time: 1, accent: false, beat: 2 },
        { time: 1.5, accent: false, beat: 3 },
      ]);
  });

  it("infers one count-in measure and local beat interval", () => {
    const beats = beatMapFromTicks([{ ticks: 0, numerator: 3, denominator: 4 }], 480, 3_000, (ticks) => ticks / 480);
    expect(countInPlan(beats, 1.2)).toEqual({ count: 3, interval: 1 });
  });
});
