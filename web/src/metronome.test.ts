import { describe, expect, it } from "vitest";

import { beatsToSchedule } from "./metronome";
import type { BeatMarker } from "./types";

const beats: BeatMarker[] = [0, 0.5, 1, 1.5].map((time, index) => ({
  time,
  accent: index === 0,
  beat: index,
  measure: 0,
}));

describe("metronome scheduler", () => {
  it("schedules each beat exactly once inside the lookahead window", () => {
    expect(beatsToSchedule(beats, 0.4, 1.1, Number.NEGATIVE_INFINITY).map((beat) => beat.time)).toEqual([0.5, 1]);
    expect(beatsToSchedule(beats, 0.9, 1.6, 1).map((beat) => beat.time)).toEqual([1.5]);
  });

  it("does not replay a late or previously scheduled beat", () => {
    expect(beatsToSchedule(beats, 1.02, 1.4, 1)).toEqual([]);
  });
});
