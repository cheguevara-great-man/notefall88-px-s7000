import { describe, expect, it } from "vitest";

import { timingWindowRange, timingWindowsForChords } from "./judgement";
import type { Chord } from "./practice";
import type { BeatMarker } from "./types";

function chord(start: number, ...notes: number[]): Chord {
  return {
    start,
    notes: notes.map((note) => ({ note, start, end: start + 0.1, velocity: 90, hand: "right" })),
  };
}

function beats(interval: number, count = 10): BeatMarker[] {
  return Array.from({ length: count }, (_, index) => ({
    time: index * interval,
    accent: index % 4 === 0,
    beat: index % 4,
    measure: Math.floor(index / 4),
  }));
}

describe("tempo-aware judgement windows", () => {
  it("tightens fast passages and preserves the musical fraction when practice speed changes", () => {
    const chords = [chord(0, 60), chord(0.5, 62), chord(1, 64)];
    const fast = timingWindowsForChords(chords, beats(0.25), "adaptive");
    const slow = timingWindowsForChords(chords, beats(1), "adaptive");
    expect(fast[1]).toEqual({ earlyMs: 90, lateMs: 120 });
    expect(slow[1]).toEqual({ earlyMs: 180, lateMs: 250 });
    expect(timingWindowRange(fast, 0.5)).toEqual({ early: [180, 180], late: [240, 240] });
    expect(timingWindowRange(fast, 2)).toEqual({ early: [45, 45], late: [60, 60] });
  });

  it("keeps relaxed, adaptive and strict profiles in a stable order", () => {
    const chords = [chord(0, 60), chord(1, 62)];
    const relaxed = timingWindowsForChords(chords, beats(0.5), "relaxed")[0];
    const adaptive = timingWindowsForChords(chords, beats(0.5), "adaptive")[0];
    const strict = timingWindowsForChords(chords, beats(0.5), "strict")[0];
    expect(relaxed.earlyMs).toBeGreaterThan(adaptive.earlyMs);
    expect(adaptive.earlyMs).toBeGreaterThan(strict.earlyMs);
    expect(relaxed.lateMs).toBeGreaterThan(adaptive.lateMs);
    expect(adaptive.lateMs).toBeGreaterThan(strict.lateMs);
  });

  it("separates rapid repeated pitches even when the beat itself is slow", () => {
    const windows = timingWindowsForChords([
      chord(0, 60), chord(0.1, 60), chord(0.2, 60), chord(1, 64),
    ], beats(1), "relaxed");
    expect(windows.slice(0, 3)).toEqual([
      { earlyMs: 240, lateMs: 48 },
      { earlyMs: 48, lateMs: 48 },
      { earlyMs: 48, lateMs: 320 },
    ]);
  });

  it("falls back deterministically for MIDI files without a usable beat map", () => {
    expect(timingWindowsForChords([chord(0, 60)], [], "adaptive"))
      .toEqual([{ earlyMs: 140, lateMs: 190 }]);
    expect(timingWindowRange([], 1)).toBeUndefined();
  });
});
