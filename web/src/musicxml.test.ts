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
    expect(parseMusicXml(fixture("meter-tempo-dynamics.musicxml"), "fixture.xml").notes)
      .toHaveLength(3);
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

  it("preserves written duration while exposing common articulation gates", () => {
    const score = parseMusicXml(`<?xml version="1.0"?>
      <score-partwise version="4.0">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><notations><articulations><staccato/></articulations></notations></note>
          <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><notations><articulations><staccatissimo/></articulations></notations></note>
          <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><notations><articulations><detached-legato/></articulations></notations></note>
          <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><notations><articulations><tenuto/></articulations></notations></note>
        </measure></part>
      </score-partwise>`, "articulations.musicxml");
    expect(score.notes.map((note) => note.articulationGate)).toEqual([0.5, 0.25, 0.65, 0.95]);
    expect(score.notes.map((note) => note.end - note.start)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("honors metronome units, additive/composite meters, dynamics and silent cues", () => {
    const score = parseMusicXml(fixture("meter-tempo-dynamics.musicxml"), "fixture.xml");
    expect(score.notes.map((note) => [note.note, note.velocity, note.hand])).toEqual([
      [60, 45, "right"],
      [62, 45, "right"],
      [64, 104, "left"],
    ]);
    // Eighth=120 means quarter=60, so the silent 1/8 cue advances C4 to 0.5 s.
    expect(score.notes[0].start).toBeCloseTo(0.5);
    expect(score.measureStarts).toEqual([0, 2.5]);
    // The 3+2/8 grouping accents beats 0 and 3.
    expect(score.beatMap?.slice(0, 5).map((beat) => [beat.time, beat.accent])).toEqual([
      [0, true], [0.5, false], [1, false], [1.5, true], [2, false],
    ]);
    // Dotted-quarter=60 means quarter=90 in the second composite 2/4+3/8 measure.
    expect(score.duration).toBeCloseTo(2.5 + 3.5 * 60 / 90);
    expect(score.beatMap?.slice(5).map((beat) => beat.accent)).toEqual([true, false, true, false, false]);
  });

  it("honors measure-level sound and sound-owned direction offsets", () => {
    const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
      <measure><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
        <sound dynamics="100"/>
        <direction><offset>0</offset><sound tempo="60"><offset>1</offset></sound></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
      </measure></part></score-partwise>`;
    const score = parseMusicXml(xml, "sound.musicxml");
    expect(score.notes[0].velocity).toBe(90);
    // Default 120 BPM for the first quarter, then the sound-owned offset changes to 60 BPM.
    expect(score.duration).toBeCloseTo(1.5);
  });

  it("applies exact beat-unit metric modulations without multiplying duplicate parts", () => {
    const part = (id: string) => `<part id="${id}">
      <measure><attributes><divisions>1</divisions></attributes>
        <direction><sound tempo="120"/></direction>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
      </measure>
      <measure>
        <direction><direction-type><metronome>
          <beat-unit>quarter</beat-unit><beat-unit>quarter</beat-unit><beat-unit-dot/>
        </metronome></direction-type></direction>
        <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration></note>
      </measure>
    </part>`;
    const xml = `<score-partwise><part-list>
      <score-part id="P1"><part-name>Piano RH</part-name></score-part>
      <score-part id="P2"><part-name>Piano LH</part-name></score-part>
    </part-list>${part("P1")}${part("P2")}</score-partwise>`;
    const score = parseMusicXml(xml, "metric.musicxml");
    // quarter = dotted-quarter means the new quarter BPM is 120 * 1.5 = 180.
    expect(score.notes.filter((note) => note.note === 62)[0].start).toBeCloseTo(0.5);
    expect(score.duration).toBeCloseTo(0.5 + 2 * 60 / 180);
  });

  it("keeps unmetered music playable without inventing metronome beats", () => {
    const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
      <measure><attributes><divisions>2</divisions><time><senza-misura/></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>3</duration></note>
      </measure></part></score-partwise>`;
    const score = parseMusicXml(xml, "unmetered.musicxml");
    expect(score.notes).toHaveLength(1);
    expect(score.duration).toBeCloseTo(0.75);
    expect(score.beatMap).toEqual([]);
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

  it.each([
    ["UTF-16LE with BOM", true, [0xFF, 0xFE]],
    ["UTF-16LE from its XML byte pattern", true, []],
    ["UTF-16BE with BOM", false, [0xFE, 0xFF]],
    ["UTF-16BE from its XML byte pattern", false, []],
  ] as const)("decodes %s MusicXML exported by notation software", (_name, littleEndian, bom) => {
    const xml = `<?xml version="1.0" encoding="UTF-16"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
    const bytes = new Uint8Array(bom.length + xml.length * 2);
    bytes.set(bom, 0);
    const view = new DataView(bytes.buffer);
    [...xml].forEach((character, index) =>
      view.setUint16(bom.length + index * 2, character.charCodeAt(0), littleEndian));
    expect(parseMusicXmlFile(bytes.buffer, "vendor.xml").score.notes.map((note) => note.note))
      .toEqual([60]);
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

  it("keeps one implicit repeat frame across sequential numbered endings", () => {
    const repeatXml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">
        <measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure>
        <measure number="2"><barline location="left"><ending number="1" type="start"/></barline><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note><barline><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>
        <measure number="3"><barline location="left"><ending number="2" type="start"/></barline><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note><barline><ending number="2" type="stop"/><repeat direction="backward"/></barline></measure>
        <measure number="4"><barline location="left"><ending number="3" type="start"/></barline><note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note><barline><ending number="3" type="discontinue"/></barline></measure>
        <measure number="5"><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note></measure>
      </part></score-partwise>`;
    const score = parseMusicXml(repeatXml, "sequential-endings.musicxml");
    expect(score.measureMap).toEqual([0, 1, 0, 2, 0, 3, 4]);
    expect(score.notes.map((note) => note.note)).toEqual([60, 62, 60, 64, 60, 65, 67]);
  });

  it("rejects overlapping ending numbers instead of guessing a playback order", () => {
    const invalid = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">
        <measure number="1"><attributes><divisions>1</divisions></attributes><barline><ending number="1,2" type="start"/></barline><note><rest/><duration>1</duration></note><barline><ending number="1,2" type="stop"/></barline></measure>
        <measure number="2"><barline><ending number="2" type="start"/></barline><note><rest/><duration>1</duration></note><barline><ending number="2" type="stop"/><repeat direction="backward"/></barline></measure>
      </part></score-partwise>`;
    expect(() => parseMusicXml(invalid, "overlapping-endings.musicxml"))
      .toThrow(/结尾编号 2.*重叠/);
  });

  it("keeps a later implicit repeat alive while crossing an earlier volta group", () => {
    const repeatXml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
      <measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure>
      <measure number="2"><barline><ending number="1" type="start"/></barline><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note><barline><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>
      <measure number="3"><barline><ending number="2" type="start"/></barline><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note><barline><ending number="2" type="discontinue"/></barline></measure>
      <measure number="4"><note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note></measure>
      <measure number="5"><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note></measure>
      <measure number="6"><barline><ending number="1" type="start"/></barline><note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration></note></measure>
      <measure number="7"><note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration></note><barline><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>
      <measure number="8"><barline><ending number="2" type="start"/></barline><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note></measure>
      <measure number="9"><note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration></note><barline><ending number="2" type="discontinue"/></barline></measure>
      <measure number="10"><note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration></note></measure>
    </part></score-partwise>`;
    expect(parseMusicXml(repeatXml, "two-voltas.musicxml").measureMap)
      .toEqual([0, 1, 0, 2, 3, 4, 5, 6, 0, 2, 3, 4, 7, 8, 9]);
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
