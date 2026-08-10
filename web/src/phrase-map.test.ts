import { describe, expect, it } from "vitest";

import { buildPhraseMap, phraseMapProgress } from "./phrase-map";

describe("whole-score phrase map", () => {
  it("separates hand density and normalizes the busiest time bin", () => {
    const map = buildPhraseMap([
      { start: 0, end: 1, hand: "left" },
      { start: 0.1, end: 0.6, hand: "right" },
      { start: 5, end: 5.25, hand: "right" },
    ], 10, 10);
    expect(map.duration).toBe(10);
    expect(map.bins[0].left).toBeGreaterThan(0);
    expect(map.bins[0].right).toBeGreaterThan(0);
    expect(map.bins[5].left).toBe(0);
    expect(map.bins[5].right).toBeGreaterThan(0);
    expect(map.bins[0].left + map.bins[0].right).toBeGreaterThan(map.bins[5].right);
  });

  it("infers duration and keeps a note at the exact ending boundary", () => {
    const map = buildPhraseMap([{ start: 2, end: 2, hand: "right" }], Number.NaN, 8);
    expect(map.duration).toBe(2);
    expect(map.bins.at(-1)?.right).toBe(1);
  });

  it("returns a stable empty map for unusable scores", () => {
    const map = buildPhraseMap([], 0, 2);
    expect(map.duration).toBe(0);
    expect(map.bins).toHaveLength(8);
    expect(map.bins.every((bin) => bin.left === 0 && bin.right === 0)).toBe(true);
  });

  it("clamps playhead progress at both ends", () => {
    expect(phraseMapProgress(-2, 10)).toBe(0);
    expect(phraseMapProgress(4, 10)).toBe(0.4);
    expect(phraseMapProgress(20, 10)).toBe(1);
    expect(phraseMapProgress(2, 0)).toBe(0);
  });
});
