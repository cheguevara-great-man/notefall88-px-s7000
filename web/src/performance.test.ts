import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";

import { PerformanceRecorder, recordingDuration, recordingToMidi } from "./performance";

describe("performance recording", () => {
  it("records note durations and velocity", () => {
    const recorder = new PerformanceRecorder();
    recorder.start(1_000);
    recorder.handleMidi({ state: "on", channel: 1, note: 60, velocity: 96, timestamp: 0 }, 1_100);
    recorder.handleMidi({ state: "off", channel: 1, note: 60, velocity: 0, timestamp: 0 }, 1_600);
    const notes = recorder.stop(2_000);
    expect(notes).toEqual([{
      note: 60,
      channel: 1,
      velocity: 96,
      start: 0.1,
      end: 0.6,
      sustained: false,
    }]);
  });

  it("extends released notes until the sustain pedal rises", () => {
    const recorder = new PerformanceRecorder();
    recorder.start(0);
    recorder.handleControl({ channel: 1, controller: 64, value: 127, timestamp: 0 }, 50);
    recorder.handleMidi({ state: "on", channel: 1, note: 64, velocity: 80, timestamp: 0 }, 100);
    recorder.handleMidi({ state: "off", channel: 1, note: 64, velocity: 0, timestamp: 0 }, 300);
    expect(recorder.snapshot()).toEqual([]);
    recorder.handleControl({ channel: 1, controller: 64, value: 0, timestamp: 0 }, 900);
    const [note] = recorder.stop(1_000);
    expect(note.end).toBeCloseTo(0.9);
    expect(note.sustained).toBe(true);
  });

  it("flushes one channel on all-notes-off", () => {
    const recorder = new PerformanceRecorder();
    recorder.start(0);
    recorder.handleMidi({ state: "on", channel: 1, note: 60, velocity: 80, timestamp: 0 }, 100);
    recorder.handleMidi({ state: "on", channel: 2, note: 67, velocity: 90, timestamp: 0 }, 120);
    recorder.handleControl({ channel: 1, controller: 123, value: 0, timestamp: 0 }, 500);
    expect(recorder.snapshot().map((note) => note.note)).toEqual([60]);
    const notes = recorder.stop(800);
    expect(notes.map((note) => note.note)).toEqual([60, 67]);
  });

  it("exports a standards-readable MIDI file", () => {
    const bytes = recordingToMidi([
      { note: 60, channel: 1, velocity: 100, start: 0, end: 0.5, sustained: false },
      { note: 48, channel: 2, velocity: 80, start: 0.25, end: 1.25, sustained: true },
    ], "Take 1");
    const midi = new Midi(bytes);
    expect(midi.header.name).toBe("Take 1");
    expect(midi.tracks.flatMap((track) => track.notes)).toHaveLength(2);
    expect(recordingDuration([
      { note: 60, channel: 1, velocity: 100, start: 0, end: 0.5, sustained: false },
      { note: 48, channel: 2, velocity: 80, start: 0.25, end: 1.25, sustained: true },
    ])).toBe(1.25);
  });
});
