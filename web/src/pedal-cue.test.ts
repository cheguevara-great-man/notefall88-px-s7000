import { describe, expect, it } from "vitest";

import { buildPedalCues } from "./pedal-cue";

describe("pedal cues", () => {
  it("turns pedal targets into performer-facing labels", () => {
    expect(buildPedalCues([
      { time: 0, value: 127, action: "down" },
      { time: 1, value: 64, action: "level" },
      { time: 2, value: 0, action: "up" },
    ])).toEqual([
      { time: 0, value: 127, kind: "down", label: "PED ↓" },
      { time: 1, value: 64, kind: "level", label: "PED 50%" },
      { time: 2, value: 0, kind: "up", label: "PED ↑" },
    ]);
  });

  it("collapses a MusicXML change pair without losing its assessment edges", () => {
    expect(buildPedalCues([
      { time: 4, value: 0, action: "change-up" },
      { time: 4, value: 127, action: "change-down" },
      { time: 4, value: 127, action: "change-down" },
    ])).toEqual([{ time: 4, value: 127, kind: "change", label: "PED ↻" }]);
  });

  it("ignores malformed targets and orders valid cues", () => {
    expect(buildPedalCues([
      { time: 3, value: 0, action: "up" },
      { time: Number.NaN, value: 127, action: "down" },
      { time: -1, value: 127, action: "down" },
      { time: 1, value: 127, action: "down" },
    ]).map((cue) => cue.time)).toEqual([1, 3]);
  });
});
