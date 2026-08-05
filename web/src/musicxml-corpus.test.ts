import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseMusicXml } from "./musicxml";
import type { ParsedScore } from "./types";

interface CorpusFixture {
  file: string;
  sha256: string;
  verify: (score: ParsedScore) => void;
}

const CORPUS: CorpusFixture[] = [
  {
    file: "43a-PianoStaff.xml",
    sha256: "6b05819574c29060fd9966d26addb6f84a20d213c87ba3d5daf27eb84bfa8570",
    verify: (score) => {
      expect(score.measureMap).toEqual([0]);
      expect(score.notes.map(({ note, hand }) => ({ note, hand }))).toEqual([
        { note: 47, hand: "left" },
        { note: 65, hand: "right" },
      ]);
    },
  },
  {
    file: "45b-RepeatWithAlternatives.xml",
    sha256: "09352a51113b744b8b184eb51c851a3cdd1a03382abb219c95d82feb5ae112fb",
    verify: (score) => {
      expect(score.notes).toHaveLength(5);
      expect(score.measureMap).toEqual([0, 1, 0, 2, 3]);
      expect(score.duration).toBeCloseTo(10);
    },
  },
  {
    file: "31c-MetronomeMarks.xml",
    sha256: "2c05ee46623e99a3d87412b44ae0e45b8664e664fcdc0079486a7fcaa5437d10",
    verify: (score) => {
      expect(score.notes).toHaveLength(12);
      expect(score.measureMap).toEqual([0, 1, 2]);
      expect(score.beatMap).toHaveLength(12);
      expect(score.duration).toBeCloseTo(6.75146103896104);
    },
  },
];

describe("pinned W3C MusicXML compatibility corpus", () => {
  for (const fixture of CORPUS) {
    it(`parses ${fixture.file} with stable playback semantics`, () => {
      const bytes = readFileSync(new URL(`../test-fixtures/w3c-musicxml/${fixture.file}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
      const score = parseMusicXml(bytes.toString("utf8"), fixture.file);
      expect(score.notes.every((note) => note.start >= 0 && note.end > note.start)).toBe(true);
      fixture.verify(score);
    });
  }
});
