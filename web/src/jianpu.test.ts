import { describe, it, expect } from "vitest";
import { midiToJianpuPitch, buildJianpuMeasures, JianpuRenderer } from "./jianpu";
import type { ParsedScore } from "./types";

describe("jianpu numbered musical notation", () => {
  it("converts MIDI note numbers to Jianpu pitch classes and octave dots", () => {
    expect(midiToJianpuPitch(60)).toEqual({ pitchNum: "1", accidental: "", octaveDots: 0 });
    expect(midiToJianpuPitch(62)).toEqual({ pitchNum: "2", accidental: "", octaveDots: 0 });
    expect(midiToJianpuPitch(61)).toEqual({ pitchNum: "1", accidental: "#", octaveDots: 0 });
    expect(midiToJianpuPitch(72)).toEqual({ pitchNum: "1", accidental: "", octaveDots: 1 });
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

  it("renders DOM and scrolls active line to top row with upcoming preview", () => {
    let activePlaying = false;
    let measureActive = false;
    let scrolledTop = -1;

    const noteEl = {
      dataset: { noteStart: "2.5", noteEnd: "3.5", notePitch: "64" },
      setAttribute: (k: string, _v: string) => { if (k === "data-playing") activePlaying = true; },
      removeAttribute: (k: string) => { if (k === "data-playing") activePlaying = false; },
    };

    const system0 = { offsetTop: 70 };
    const system1 = { offsetTop: 173 };
    const body = {
      scrollTop: 0,
      scrollTo: (opts: { top: number }) => { scrolledTop = opts.top; },
    };
    const measure0 = {
      setAttribute: () => {},
      removeAttribute: () => {},
      querySelectorAll: () => [],
    };

    const measure1 = {
      dataset: { systemIdx: "1" },
      setAttribute: (k: string, _v: string) => { if (k === "data-active") measureActive = true; },
      removeAttribute: (k: string) => { if (k === "data-active") measureActive = false; },
      querySelectorAll: (sel: string) => sel.includes("data-note-start") ? [noteEl] : [],
    };

    const mockContainer = {
      innerHTML: "",
      dataset: {},
      querySelector: (sel: string) => {
        if (sel === ".jianpu-body") return body;
        if (sel === '[data-measure-idx="0"]') return measure0;
        if (sel === '[data-measure-idx="1"]') return measure1;
        if (sel === '[data-system-idx="0"]') return system0;
        if (sel === '[data-system-idx="1"]') return system1;
        return null;
      },
      querySelectorAll: (sel: string) => sel.includes("data-note-start") ? [noteEl] : [],
    } as unknown as HTMLElement;

    const renderer = new JianpuRenderer(mockContainer);
    renderer.load({
      name: "Test Piece",
      duration: 6,
      notes: [
        { note: 60, start: 0, end: 1, velocity: 80, hand: "right" },
        { note: 64, start: 2.5, end: 3.5, velocity: 80, hand: "right" },
      ],
    });

    expect(mockContainer.innerHTML).toContain("Test Piece");
    // Seek to measure 1 / system 1: the second system becomes the top row.
    renderer.seek(2.8);
    expect(measureActive).toBe(true);
    // 173 - 70 = 103px, preserving exactly one preview system below it.
    expect(scrolledTop).toBe(103);
    expect(activePlaying).toBe(true);
  });
});
