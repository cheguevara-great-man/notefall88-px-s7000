import { describe, expect, it } from "vitest";

import { buildChordGuides } from "./chord-guide";
import { parseMusicXml } from "./musicxml";
import type { ScoreNote } from "./types";

function note(value: number, start: number, hand: "left" | "right", velocity = 90): ScoreNote {
  return { note: value, start, end: start + 1, hand, velocity };
}

describe("waterfall chord guides", () => {
  it("groups a human-spread chord while preserving hand and span semantics", () => {
    expect(buildChordGuides([
      note(72, 1.025, "right", 100),
      note(48, 1, "left", 76),
      note(60, 1.012, "right", 88),
      note(67, 2, "right"),
    ])).toEqual([{
      start: 1,
      notes: [
        { note: 48, hand: "left", velocity: 76 },
        { note: 60, hand: "right", velocity: 88 },
        { note: 72, hand: "right", velocity: 100 },
      ],
      hands: ["left", "right"],
      span: 24,
    }]);
  });

  it("deduplicates unisons and does not invent guides for single notes", () => {
    expect(buildChordGuides([
      note(60, 0, "left"), note(60, 0, "right"), note(62, .2, "right"),
    ])).toEqual([]);
  });

  it("clamps the grouping window to avoid swallowing arpeggios", () => {
    expect(buildChordGuides([note(60, 0, "left"), note(64, .08, "right")], 500)).toEqual([{
      start: 0,
      notes: [
        { note: 60, hand: "left", velocity: 90 },
        { note: 64, hand: "right", velocity: 90 },
      ],
      hands: ["left", "right"],
      span: 4,
    }]);
    expect(buildChordGuides([note(60, 0, "left"), note(64, .11, "right")], 500)).toEqual([]);
  });

  it("receives a cross-staff chord from the MusicXML timing expansion", () => {
    const score = parseMusicXml(`<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><sound tempo="60"/></direction><forward><duration>2</duration></forward><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><backup><duration>1</duration></backup><note><pitch><step>C</step><octave>6</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff></note></measure></part></score-partwise>`, "probe.musicxml");
    expect(score.notes.map(({ note, start, hand }) => ({ note, start, hand }))).toEqual([
      { note: 60, start: 2, hand: "right" },
      { note: 84, start: 2, hand: "left" },
    ]);
    expect(buildChordGuides(score.notes)).toMatchObject([{
      start: 2,
      span: 24,
      hands: ["left", "right"],
    }]);
  });
});
