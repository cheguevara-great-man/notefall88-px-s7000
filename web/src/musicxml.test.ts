import { strToU8, zipSync } from "fflate";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { extractMusicXml, parseMusicXml, parseMusicXmlFile } from "./musicxml";

function fixture(name: string): string {
  return readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8");
}

const scoreXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Parser Etude</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction><sound tempo="120"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff><tie type="start"/></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>2</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><voice>2</voice><staff>2</staff></note>
    </measure>
    <measure number="2">
      <direction><sound tempo="60"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff><tie type="stop"/></note>
      <note><pitch><step>G</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

describe("MusicXML parser", () => {
  it("keeps the checked-in compatibility corpus executable", () => {
    expect(parseMusicXml(fixture("parser-etude.musicxml"), "fixture.xml").notes).toHaveLength(4);
    expect(parseMusicXml(fixture("repeat-endings.musicxml"), "fixture.xml").measureMap)
      .toEqual([0, 1, 2, 0, 1, 3]);
    expect(parseMusicXml(fixture("dc-al-fine.musicxml"), "fixture.xml").measureMap)
      .toEqual([0, 1, 2, 3, 0, 1]);
    expect(parseMusicXml(fixture("ds-al-coda.musicxml"), "fixture.xml").measureMap)
      .toEqual([0, 1, 2, 3, 1, 2, 4]);
  });

  it("extracts piano notes, chords, staves, ties and tempo changes", () => {
    const score = parseMusicXml(scoreXml, "fallback.musicxml");
    expect(score.name).toBe("Parser Etude");
    expect(score.format).toBe("musicxml");
    expect(score.notes.map((note) => [note.note, note.hand])).toEqual([
      [48, "left"],
      [60, "right"],
      [64, "right"],
      [68, "right"],
    ]);
    const tiedC = score.notes.find((note) => note.note === 60)!;
    expect(tiedC.start).toBe(0);
    expect(tiedC.end).toBeCloseTo(3);
    expect(score.measureStarts).toEqual([0, 2]);
    expect(score.beatMap?.map((beat) => beat.time)).toEqual([0, 0.5, 1, 1.5, 2, 3]);
    expect(score.beatMap?.filter((beat) => beat.accent).map((beat) => beat.time)).toEqual([0, 2]);
    expect(score.duration).toBeCloseTo(4);
  });

  it("opens an MXL container and locates its declared root file", () => {
    const archive = zipSync({
      "META-INF/container.xml": strToU8(
        `<container><rootfiles><rootfile full-path="scores/main.musicxml"/></rootfiles></container>`,
      ),
      "scores/main.musicxml": strToU8(scoreXml),
    });
    const buffer = archive.slice().buffer as ArrayBuffer;
    expect(extractMusicXml(buffer, "piece.mxl")).toContain("Parser Etude");
    expect(parseMusicXmlFile(buffer, "piece.mxl").score.notes).toHaveLength(4);
  });

  it("rejects unsupported score-timewise input", () => {
    expect(() => parseMusicXml("<score-timewise/>", "bad.xml")).toThrow(/score-partwise/);
  });

  it("rejects an MXL that declares an oversized expansion before inflating it", () => {
    const archive = new Uint8Array(68);
    const view = new DataView(archive.buffer);
    view.setUint32(0, 0x02014B50, true);
    view.setUint32(24, 33 * 1024 * 1024, true);
    view.setUint32(46, 0x06054B50, true);
    view.setUint16(54, 1, true);
    view.setUint16(56, 1, true);
    view.setUint32(58, 46, true);
    view.setUint32(62, 0, true);
    expect(() => extractMusicXml(archive.buffer, "bomb.mxl")).toThrow(/解压体积/);
  });

  it("expands a repeat with first and second endings into playback order", () => {
    const repeatXml = `<score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">
        <measure number="1"><attributes><divisions>1</divisions></attributes>
          <barline location="left"><repeat direction="forward"/></barline>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
        </measure>
        <measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note></measure>
        <measure number="3"><barline location="left"><ending number="1" type="start"/></barline>
          <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>
          <barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>
        </measure>
        <measure number="4"><barline location="left"><ending number="2" type="start"/></barline>
          <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note>
          <barline location="right"><ending number="2" type="discontinue"/></barline>
        </measure>
      </part>
    </score-partwise>`;
    const score = parseMusicXml(repeatXml, "repeat.musicxml");
    expect(score.notes.map((note) => note.note)).toEqual([60, 62, 64, 60, 62, 65]);
    expect(score.measureMap).toEqual([0, 1, 2, 0, 1, 3]);
    expect(score.measureStarts).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(score.duration).toBe(3);
  });

  it("supports implicit repeat starts and repeat counts", () => {
    const repeatXml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">
        <measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure>
        <measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note><barline><repeat direction="backward" times="3"/></barline></measure>
      </part></score-partwise>`;
    const score = parseMusicXml(repeatXml, "repeat-three.musicxml");
    expect(score.notes.map((note) => note.note)).toEqual([60, 62, 60, 62, 60, 62]);
    expect(score.measureMap).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it("follows D.C. al Fine without looping forever", () => {
    const navigationXml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">
        <measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure>
        <measure number="2"><direction><sound fine="yes"/></direction><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note></measure>
        <measure number="3"><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note></measure>
        <measure number="4"><direction><sound dacapo="yes"/></direction><note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note></measure>
      </part></score-partwise>`;
    const score = parseMusicXml(navigationXml, "dc-fine.musicxml");
    expect(score.notes.map((note) => note.note)).toEqual([60, 62, 64, 65, 60, 62]);
    expect(score.measureMap).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it("follows D.S. al Coda using labeled sound markers", () => {
    const navigationXml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">
        <measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure>
        <measure number="2"><direction><sound segno="S1"/></direction><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note></measure>
        <measure number="3"><direction><sound tocoda="C1"/></direction><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note></measure>
        <measure number="4"><direction><sound dalsegno="S1"/></direction><note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note></measure>
        <measure number="5"><direction><sound coda="C1"/></direction><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note></measure>
      </part></score-partwise>`;
    const score = parseMusicXml(navigationXml, "ds-coda.musicxml");
    expect(score.notes.map((note) => note.note)).toEqual([60, 62, 64, 65, 62, 64, 67]);
    expect(score.measureMap).toEqual([0, 1, 2, 3, 1, 2, 4]);
  });

  it("rejects a D.S. jump without a target instead of guessing the score order", () => {
    const invalid = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
      <measure number="1"><attributes><divisions>1</divisions></attributes><direction><sound dalsegno="missing"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure>
    </part></score-partwise>`;
    expect(() => parseMusicXml(invalid, "invalid-ds.musicxml")).toThrow(/D\.S\..*目标/);
  });
});
