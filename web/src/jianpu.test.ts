import { describe, it, expect } from "vitest";
import { midiToJianpuPitch, buildJianpuMeasures, JianpuRenderer } from "./jianpu";
import type { ParsedScore } from "./types";

describe("jianpu numbered musical notation", () => {
  it("converts MIDI note numbers to Jianpu pitch classes and octave dots", () => {
    // Middle C (C4 = 60) -> 1, octaveDots = 0
    expect(midiToJianpuPitch(60)).toEqual({ pitchNum: "1", accidental: "", octaveDots: 0 });
    // D4 = 62 -> 2
    expect(midiToJianpuPitch(62)).toEqual({ pitchNum: "2", accidental: "", octaveDots: 0 });
    // C#4 = 61 -> 1#
    expect(midiToJianpuPitch(61)).toEqual({ pitchNum: "1", accidental: "#", octaveDots: 0 });
    // C5 = 72 -> 1 with 1 dot above
    expect(midiToJianpuPitch(72)).toEqual({ pitchNum: "1", accidental: "", octaveDots: 1 });
    // C3 = 48 -> 1 with 1 dot below
    expect(midiToJianpuPitch(48)).toEqual({ pitchNum: "1", accidental: "", octaveDots: -1 });
  });

  it("builds measures correctly from score notes", () => {
    const mockScore: ParsedScore = {
      name: "Twinkle Star",
      duration: 8,
      notes: [
        { note: 60, start: 0, end: 0.5, velocity: 80, hand: "right" },
        { note: 60, start: 0.5, end: 1.0, velocity: 80, hand: "right" },
        { note: 67, start: 1.0, end: 1.5, velocity: 80, hand: "right" },
        { note: 48, start: 0, end: 2.0, velocity: 80, hand: "left" },
      ],
    };

    const measures = buildJianpuMeasures(mockScore);
    expect(measures.length).toBeGreaterThan(0);
    expect(measures[0].rightTrack.length).toBe(3);
    expect(measures[0].leftTrack.length).toBe(1);
    expect(measures[0].rightTrack[0].pitchNum).toBe("1");
    expect(measures[0].rightTrack[2].pitchNum).toBe("5");
  });

  it("renders DOM and responds to seek", () => {
    let activePlaying = false;
    const noteEl = {
      dataset: { noteStart: "0", noteEnd: "1", notePitch: "60" },
      setAttribute: (k: string, _v: string) => { if (k === "data-playing") activePlaying = true; },
      removeAttribute: (k: string) => { if (k === "data-playing") activePlaying = false; },
    };

    const mockContainer = {
      innerHTML: "",
      dataset: {},
      querySelector: (_sel: string) => null,
      querySelectorAll: (sel: string) => sel.includes("data-note-start") ? [noteEl] : [],
    } as unknown as HTMLElement;

    const renderer = new JianpuRenderer(mockContainer);
    renderer.load({
      name: "Test Piece",
      duration: 4,
      notes: [
        { note: 60, start: 0, end: 1, velocity: 80, hand: "right" },
        { note: 64, start: 1, end: 2, velocity: 80, hand: "right" },
      ],
    });

    expect(mockContainer.innerHTML).toContain("Test Piece");
    renderer.seek(0.5);
    expect(activePlaying).toBe(true);
  });
});
