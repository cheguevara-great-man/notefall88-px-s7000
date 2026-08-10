import { describe, expect, it } from "vitest";

import { timingCue } from "./timing-feedback";

describe("instant timing feedback", () => {
  it("uses a perceptual on-time deadband", () => {
    expect(timingCue(-25)).toMatchObject({ band: "on-time", label: "准" });
    expect(timingCue(0)).toMatchObject({ symbol: "●", offset: 0 });
    expect(timingCue(25)).toMatchObject({ band: "on-time" });
  });

  it("distinguishes early and late while preserving signed direction", () => {
    expect(timingCue(-80)).toEqual({ band: "early", label: "早 80", symbol: "↑", offset: -0.32 });
    expect(timingCue(125)).toEqual({ band: "late", label: "晚 125", symbol: "↓", offset: 0.5 });
  });

  it("bounds visual displacement and rejects missing timing", () => {
    expect(timingCue(-900)?.offset).toBe(-1);
    expect(timingCue(900)?.offset).toBe(1);
    expect(timingCue(Number.NaN)).toBeUndefined();
    expect(timingCue(undefined)).toBeUndefined();
  });
});
