import { describe, expect, it } from "vitest";

import type { ScoreNote } from "./types";
import { phraseRailGeometry, phraseRailSeconds, visibleScoreNotes } from "./waterfall";

const note = (start: number, end: number, midi = 60): ScoreNote => ({
  note: midi,
  start,
  end,
  velocity: 80,
  hand: "right",
});

describe("interactive phrase rail", () => {
  it("uses the same geometry for a 3:2 tablet canvas and maps its full height to the score", () => {
    const rail = phraseRailGeometry(1600, 900);
    expect(rail.x + rail.width).toBeLessThan(1600);
    expect(phraseRailSeconds(rail.top + 100, 100, rail, 120)).toBe(0);
    expect(phraseRailSeconds(rail.top + rail.height / 2 + 100, 100, rail, 120)).toBeCloseTo(60);
    expect(phraseRailSeconds(rail.top + rail.height + 100, 100, rail, 120)).toBe(120);
  });
});

describe("waterfall render window", () => {
  it("keeps a long held note visible after its attack reaches the keyboard", () => {
    const notes = [note(0, 6), note(7, 8)];
    expect(visibleScoreNotes(notes, 4, 2.4, 6)).toEqual([notes[0]]);
  });

  it("excludes completed and beyond-horizon notes from a long sorted score", () => {
    const notes = Array.from({ length: 10_000 }, (_, index) => note(index * 0.05, index * 0.05 + 0.2, 21 + index % 88));
    const visible = visibleScoreNotes(notes, 240, 4.2, 0.2);
    expect(visible.length).toBeLessThan(110);
    expect(visible.every((entry) => entry.end >= 239.92 && entry.start <= 244.200_001)).toBe(true);
  });

  it("preserves simultaneous notes in source order", () => {
    const notes = [note(1, 2, 48), note(1, 2, 60), note(1, 2, 72)];
    expect(visibleScoreNotes(notes, 0, 4.2, 1).map((entry) => entry.note)).toEqual([48, 60, 72]);
  });
});
