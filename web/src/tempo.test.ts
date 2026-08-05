import { describe, expect, it } from "vitest";
import { clampTempo, normalizeTempo, tempoPercent } from "./tempo";

describe("practice tempo", () => {
  it("supports fine-grained slow practice and rounds to five percent", () => {
    expect(normalizeTempo(0.25)).toBe(0.25);
    expect(normalizeTempo(0.73)).toBeCloseTo(0.75);
    expect(normalizeTempo(1.97)).toBeCloseTo(1.95);
    expect(normalizeTempo(2)).toBe(2);
  });

  it("rejects corrupt persisted values instead of silently clamping them", () => {
    expect(normalizeTempo(0)).toBe(1);
    expect(normalizeTempo(9)).toBe(1);
    expect(normalizeTempo(Number.NaN)).toBe(1);
  });

  it("clamps direct user input to the supported endpoints", () => {
    expect(clampTempo(0.1)).toBe(0.25);
    expect(clampTempo(2.8)).toBe(2);
  });

  it("formats normalized multipliers as integer percentages", () => {
    expect(tempoPercent(1.25)).toBe(125);
    expect(tempoPercent(0.33)).toBe(35);
  });
});
