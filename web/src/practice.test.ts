import { describe, expect, it } from "vitest";
import {
  chordsInRange,
  filterNotesByHand,
  groupChords,
  nextRealtimeChord,
  normalizeLoop,
  PracticeScore,
  RealtimeMatcher,
  ScoreClock,
  targetNotes,
  WaitMatcher,
} from "./practice";
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
    expect(matcher.noteOn(60)).toEqual({ complete: false, correct: true, newlyMatched: true });
    expect(matcher.noteOn(60)).toEqual({ complete: false, correct: true, newlyMatched: false });
    expect(matcher.noteOn(61)).toEqual({ complete: false, correct: false, newlyMatched: false });
    expect(matcher.noteOn(64)).toEqual({ complete: true, correct: true, newlyMatched: true });
  });

  it("preserves score time while changing speed", () => {
    const clock = new ScoreClock();
    clock.play(1000);
    expect(clock.time(2000)).toBeCloseTo(1);
    clock.setSpeed(0.5, 2000);
    expect(clock.time(3000)).toBeCloseTo(1.5);
  });

  it("filters hands and constrains chords to a normalized loop", () => {
    const left = filterNotesByHand(notes, "left");
    expect(left.map((note) => note.note)).toEqual([48]);
    const range = normalizeLoop(1.8, 8, 2.5);
    expect(range).toEqual({ start: 1.8, end: 2.5 });
    expect(chordsInRange(groupChords(notes), range).map((chord) => chord.start)).toEqual([2]);
  });

  it("previews the first loop chord while approaching the loop end", () => {
    const chords = groupChords(notes);
    const result = nextRealtimeChord(chords, 2.42, 700, { start: 1, end: 2.5 });
    expect(result?.start).toBe(1);
  });

  it("scores realtime notes once and records wrong and missed notes", () => {
    const score = new PracticeScore();
    const matcher = new RealtimeMatcher(score);
    matcher.setChords(groupChords(notes));
    expect(matcher.noteOn(60, 1.05)).toEqual({ correct: true, newlyMatched: true });
    expect(matcher.noteOn(60, 1.06)).toEqual({ correct: true, newlyMatched: false });
    expect(matcher.noteOn(61, 1.07)).toEqual({ correct: false, newlyMatched: false });
    matcher.advance(1.5);
    const result = score.snapshot();
    expect(result).toMatchObject({ hits: 1, wrong: 1, missed: 1 });
    expect(result.accuracy).toBeCloseTo(100 / 3);
  });
});
