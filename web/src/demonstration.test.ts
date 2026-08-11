import { describe, expect, it } from "vitest";
import { DemonstrationPlanner } from "./demonstration";
import type { ScoreNote, ScorePedalEvent } from "./types";

const notes: ScoreNote[] = [
  { note: 48, start: 1, end: 1.8, velocity: 80, hand: "left" },
  { note: 60, start: 1, end: 2.4, velocity: 90, hand: "right" },
  { note: 60, start: 2, end: 2.5, velocity: 100, hand: "right" },
];

describe("piano demonstration planner", () => {
  it("streams selected hands at the requested tempo and safely retriggers repeated pitches", () => {
    const planner = new DemonstrationPlanner(notes);
    expect(planner.events(1, 2.1, 1, 0.5, "right")).toEqual([
      { delayMs: 0, status: 0x90, data1: 60, data2: 90 },
      { delayMs: 2000, status: 0x80, data1: 60, data2: 0 },
      { delayMs: 2000, status: 0x90, data1: 60, data2: 100 },
    ]);
    expect(planner.events(2.1, 2.6, 2.1, 0.5, "right")).toEqual([
      { delayMs: 800, status: 0x80, data1: 60, data2: 0 },
    ]);
  });

  it("merges duplicate unisons instead of producing destructive duplicate note-offs", () => {
    const planner = new DemonstrationPlanner([
      ...notes.slice(0, 1),
      { note: 67, start: 3, end: 3.4, velocity: 60, hand: "right" },
      { note: 67, start: 3, end: 3.8, velocity: 110, hand: "left" },
    ]);
    expect(planner.events(2.9, 4, 2.9, 1)).toEqual([
      { delayMs: 100, status: 0x90, data1: 67, data2: 110 },
      { delayMs: 900, status: 0x80, data1: 67, data2: 0 },
    ]);
    expect(planner.events(2.9, 4, 2.9, 1, "right")).toHaveLength(2);
  });

  it("restores pedal state when starting mid-score and orders release before a same-time note", () => {
    const pedals: ScorePedalEvent[] = [
      { time: 0.5, value: 100, action: "down" },
      { time: 2, value: 0, action: "up" },
    ];
    const planner = new DemonstrationPlanner(notes, pedals);
    expect(planner.events(1, 2.1, 1, 1, "both", true)).toEqual([
      { delayMs: 0, status: 0xb0, data1: 64, data2: 100 },
      { delayMs: 0, status: 0x90, data1: 48, data2: 80 },
      { delayMs: 0, status: 0x90, data1: 60, data2: 90 },
      { delayMs: 800, status: 0x80, data1: 48, data2: 0 },
      { delayMs: 1000, status: 0xb0, data1: 64, data2: 0 },
      { delayMs: 1000, status: 0x80, data1: 60, data2: 0 },
      { delayMs: 1000, status: 0x90, data1: 60, data2: 100 },
    ]);
    expect(planner.events(0.5, 0.6, 0.5, 1, "both", true)).toEqual([
      { delayMs: 0, status: 0xb0, data1: 64, data2: 100 },
    ]);
  });

  it("defers very long note releases instead of clamping them to the protocol limit", () => {
    const planner = new DemonstrationPlanner([
      { note: 60, start: 0, end: 180, velocity: 90, hand: "right" },
    ]);
    expect(planner.events(0, 1.5, 0, 1, "both", true)).toEqual([
      { delayMs: 0, status: 0x90, data1: 60, data2: 90 },
    ]);
    expect(planner.events(179, 181, 179, 1)).toEqual([
      { delayMs: 1000, status: 0x80, data1: 60, data2: 0 },
    ]);
  });

  it("rejects invalid windows without scheduling anything", () => {
    expect(new DemonstrationPlanner(notes).events(2, 1, 2, 1)).toEqual([]);
  });
});
