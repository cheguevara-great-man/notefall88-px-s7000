import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { extractMusicXml, parseMusicXml, parseMusicXmlFile } from "./musicxml";

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
});
