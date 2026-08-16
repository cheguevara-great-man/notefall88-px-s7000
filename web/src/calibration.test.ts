import { describe, expect, it } from "vitest";

import {
  calibrationProfile,
  clampKeyOffset,
  clampPianoNote,
  normalizeKeyOffsets,
  parseCalibrationProfile,
  pianoNoteName,
} from "./calibration";

describe("per-key calibration", () => {
  it("names and clamps the 88-key range", () => {
    expect(pianoNoteName(21)).toBe("A0");
    expect(pianoNoteName(60)).toBe("C4");
    expect(pianoNoteName(108)).toBe("C8");
    expect(clampPianoNote(200)).toBe(108);
  });

  it("limits per-key corrections to a safe local window", () => {
    expect(clampKeyOffset(-99)).toBe(-4);
    expect(clampKeyOffset(2.6)).toBe(3);
    expect(clampKeyOffset(99)).toBe(4);
  });

  it("normalizes persisted arrays to exactly 88 finite offsets", () => {
    const offsets = normalizeKeyOffsets([2, Number.NaN, -8]);
    expect(offsets).toHaveLength(88);
    expect(offsets.slice(0, 4)).toEqual([2, 0, -4, 0]);
  });

  it("round-trips a bounded portable calibration profile", () => {
    const profile = calibrationProfile([2, -1], "2026-08-16T00:00:00.000Z", "PX-S7000 field fit");
    expect(parseCalibrationProfile(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
    expect(profile.offsets).toHaveLength(88);
  });

  it("rejects truncated or out-of-range calibration profiles", () => {
    expect(() => parseCalibrationProfile({
      ...calibrationProfile([]), offsets: [0],
    })).toThrow(/88/);
    expect(() => parseCalibrationProfile({
      ...calibrationProfile([]), offsets: Array.from({ length: 88 }, (_, index) => index ? 0 : 5),
    })).toThrow(/-4/);
  });
});
