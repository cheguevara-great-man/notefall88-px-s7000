import { describe, expect, it } from "vitest";
import { RecordingPlaybackPlanner } from "./recording-playback";

describe("recording playback planner", () => {
  it("preserves MIDI channels, performance pedals and tempo scaling", () => {
    const planner = new RecordingPlaybackPlanner([
      { note: 60, channel: 2, velocity: 91, start: 1, end: 1.5, sustained: false },
      { note: 67, channel: 10, velocity: 70, start: 1.25, end: 2, sustained: true },
    ], [
      { channel: 2, controller: 64, value: 100, time: 0.5 },
      { channel: 2, controller: 64, value: 0, time: 1.5 },
      { channel: 2, controller: 1, value: 127, time: 1.25 },
    ]);
    expect(planner.events(1, 1.6, 1, 0.5, true)).toEqual([
      { delayMs: 0, status: 0xb1, data1: 64, data2: 100 },
      { delayMs: 0, status: 0x91, data1: 60, data2: 91 },
      { delayMs: 500, status: 0x99, data1: 67, data2: 70 },
      { delayMs: 1000, status: 0xb1, data1: 64, data2: 0 },
      { delayMs: 1000, status: 0x81, data1: 60, data2: 0 },
    ]);
    expect(planner.events(1.6, 2.1, 1.6)).toEqual([
      { delayMs: 400, status: 0x89, data1: 67, data2: 0 },
    ]);
    expect(planner.events(0.5, 0.6, 0.5, 1, true)).toEqual([
      { delayMs: 0, status: 0xb1, data1: 64, data2: 100 },
    ]);
  });

  it("ends a repeated key before retriggering and ignores unsafe controllers", () => {
    const planner = new RecordingPlaybackPlanner([
      { note: 64, channel: 1, velocity: 80, start: 0, end: 2, sustained: false },
      { note: 64, channel: 1, velocity: 90, start: 1, end: 1.5, sustained: false },
    ], [{ channel: 1, controller: 7, value: 0, time: 0 }]);
    expect(planner.events(0, 1.1, 0, 1, true)).toEqual([
      { delayMs: 0, status: 0x90, data1: 64, data2: 80 },
      { delayMs: 1000, status: 0x80, data1: 64, data2: 0 },
      { delayMs: 1000, status: 0x90, data1: 64, data2: 90 },
    ]);
  });

  it("rejects an invalid window", () => {
    expect(new RecordingPlaybackPlanner([]).events(2, 2, 2)).toEqual([]);
  });
});
