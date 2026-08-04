import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { parseMidiFile } from "./midi";

describe("MIDI import", () => {
  it("converts tracks to a sorted piano score and ignores non-piano range", () => {
    const midi = new Midi();
    midi.header.name = "Test Song";
    const left = midi.addTrack();
    left.name = "Left Hand";
    left.addNote({ midi: 48, time: 1, duration: 0.5, velocity: 0.8 });
    const right = midi.addTrack();
    right.addNote({ midi: 64, time: 0.5, duration: 0.25, velocity: 0.6 });
    right.addNote({ midi: 10, time: 0, duration: 1, velocity: 1 });
    const score = parseMidiFile(midi.toArray().buffer as ArrayBuffer, "fallback.mid");
    expect(score.name).toBe("Test Song");
    expect(score.notes.map((note) => note.note)).toEqual([64, 48]);
    expect(score.notes[1].hand).toBe("left");
  });
});
