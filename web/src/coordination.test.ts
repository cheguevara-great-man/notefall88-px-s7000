import { describe, expect, it } from "vitest";

import type { PracticeEvent } from "./analytics";
import { coordinationSampleScore, coordinationSamples, evaluateCoordination } from "./coordination";

type HitEvent = Extract<PracticeEvent, { kind: "hit" }>;

function chord(scoreTime: number, timings: number[], hands: Array<"left" | "right">): HitEvent[] {
  return timings.map((timingMs, index) => ({
    kind: "hit" as const,
    note: 48 + index * 12,
    hand: hands[index],
    velocity: 80,
    scoreTime,
    timingMs,
  }));
}

describe("chord and hand coordination", () => {
  it("scores exact-onset chords and preserves signed hand lead", () => {
    const samples = coordinationSamples([
      ...chord(1, [-12, 18, 8], ["left", "right", "right"]),
      ...chord(2, [50, -10], ["left", "right"]),
    ]);
    expect(samples).toMatchObject([
      { scoreTime: 1, notes: 3, spreadMs: 30, handOffsetMs: 25, score: 100 },
      { scoreTime: 2, notes: 2, spreadMs: 60, handOffsetMs: -60, score: 66.7 },
    ]);
  });

  it("does not merge arpeggios, incomplete chords or repeated duplicate events", () => {
    expect(coordinationSamples([
      ...chord(1, [0, 10], ["left", "right"]),
      { kind: "hit", note: 72, hand: "right", velocity: 80, scoreTime: 1.02, timingMs: 20 },
      { kind: "missed", note: 76, hand: "right", scoreTime: 1 },
    ])).toEqual([]);
    const duplicate = chord(2, [0, 12], ["left", "right"]);
    duplicate.push({ ...duplicate[1], timingMs: 40 });
    expect(coordinationSamples(duplicate)).toMatchObject([{ notes: 2, spreadMs: 40 }]);
  });

  it("requires enough samples before publishing stable scores", () => {
    expect(evaluateCoordination(chord(1, [0, 40], ["left", "right"]))).toMatchObject({
      samples: 1,
      crossHandSamples: 1,
      meanChordSpreadMs: 40,
      coordinationScore: undefined,
      handAlignmentScore: undefined,
    });
  });

  it("summarizes spread, tail risk and cross-hand alignment", () => {
    const events = [20, 30, 60, 100].flatMap((spread, index) => (
      chord(index, [0, spread], ["left", "right"])
    ));
    expect(evaluateCoordination(events)).toEqual({
      samples: 4,
      crossHandSamples: 4,
      meanChordSpreadMs: 52.5,
      p95ChordSpreadMs: 100,
      coordinationScore: 72.2,
      meanHandOffsetMs: 52.5,
      handAlignmentScore: 72.2,
      looseChordSamples: 1,
    });
  });

  it("uses a musician-readable tolerance curve", () => {
    expect(coordinationSampleScore(30)).toBe(100);
    expect(coordinationSampleScore(75)).toBe(50);
    expect(coordinationSampleScore(120)).toBe(0);
  });
});
