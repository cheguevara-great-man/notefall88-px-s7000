import { describe, expect, it } from "vitest";
import { groupChords, nextRealtimeChord, ScoreClock, targetNotes, WaitMatcher } from "./practice";
import type { ScoreNote } from "./types";

const notes: ScoreNote[] = [
  { note: 60, start: 1, end: 1.4, velocity: 100, hand: "right" },
  { note: 64, start: 1.03, end: 1.4, velocity: 100, hand: "right" },
  { note: 48, start: 2, end: 2.4, velocity: 90, hand: "left" },
];

describe("practice engine", () => {
  it("groups near-simultaneous notes into one chord", () => {
    const chords = groupChords(notes, 55);
    expect(chords).toHaveLength(2);
    expect(targetNotes(chords[0]).map((target) => target.note)).toEqual([60, 64]);
  });

  it("selects the earliest chord inside the physical lead window", () => {
    const chord = nextRealtimeChord(groupChords(notes), 0.2, 900);
    expect(chord?.start).toBe(1);
  });

  it("wait mode completes only after every expected note", () => {
    const matcher = new WaitMatcher();
    matcher.setChord(groupChords(notes)[0]);
    expect(matcher.noteOn(60)).toEqual({ complete: false, correct: true });
    expect(matcher.noteOn(61)).toEqual({ complete: false, correct: false });
    expect(matcher.noteOn(64)).toEqual({ complete: true, correct: true });
  });

  it("preserves score time while changing speed", () => {
    const clock = new ScoreClock();
    clock.play(1000);
    expect(clock.time(2000)).toBeCloseTo(1);
    clock.setSpeed(0.5, 2000);
    expect(clock.time(3000)).toBeCloseTo(1.5);
  });
});
