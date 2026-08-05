import { readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

import { parseMusicXmlFile } from "../src/musicxml";

interface AuditSuccess {
  file: string;
  notes: number;
  duration: number;
  measures: number;
  playbackMeasures: number;
  beats: number;
}

interface AuditFailure {
  file: string;
  error: string;
}

const EXPECTED_REJECTIONS = new Map<string, RegExp>([
  // This W3C fixture deliberately overlaps and contradicts ending numbers.
  // Refusing to guess a playback order is safer than creating a wrong lesson.
  ["45f-Repeats-InvalidEndings.xml", /反复结尾编号 2.*重叠/],
]);

const EXPECTED_MEASURE_MAPS = new Map<string, number[]>([
  [
    "45d-Repeats-Nested-Alternatives.xml",
    [0, 1, 0, 2, 3, 4, 0, 5, 6, 7, 8, 0, 9, 0, 10, 11],
  ],
]);

const corpusRoot = resolve(process.argv[2] ?? "../tmp/musicxmlTestSuite/xmlFiles");
const supportedExtensions = new Set([".xml", ".musicxml", ".mxl"]);
const files = readdirSync(corpusRoot)
  .filter((file) => supportedExtensions.has(extname(file).toLowerCase()))
  .sort((left, right) => left.localeCompare(right, "en"));

const successes: AuditSuccess[] = [];
const failures: AuditFailure[] = [];
const expectedRejections: AuditFailure[] = [];

for (const file of files) {
  try {
    const bytes = readFileSync(resolve(corpusRoot, file));
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const { score } = parseMusicXmlFile(buffer, file);
    const expectedMeasureMap = EXPECTED_MEASURE_MAPS.get(file);
    if (expectedMeasureMap
      && JSON.stringify(score.measureMap) !== JSON.stringify(expectedMeasureMap)) {
      throw new Error(`unexpected playback measure map: ${JSON.stringify(score.measureMap)}`);
    }
    successes.push({
      file,
      notes: score.notes.length,
      duration: score.duration,
      measures: score.measureStarts?.length ?? 0,
      playbackMeasures: score.measureMap?.length ?? 0,
      beats: score.beatMap?.length ?? 0,
    });
  } catch (error) {
    const failure = {
      file,
      error: error instanceof Error ? error.message : String(error),
    };
    if (EXPECTED_REJECTIONS.get(file)?.test(failure.error)) expectedRejections.push(failure);
    else failures.push(failure);
  }
}

const emptyScores = successes.filter((result) => result.notes === 0);
const invalidNumbers = successes.filter((result) =>
  !Number.isFinite(result.duration) || result.duration < 0);
const missingExpectedRejections = [...EXPECTED_REJECTIONS.keys()].filter((file) =>
  files.includes(file) && !expectedRejections.some((failure) => failure.file === file));

process.stdout.write(`${JSON.stringify({
  corpusRoot,
  total: files.length,
  parsed: successes.length,
  expectedRejected: expectedRejections.length,
  unexpectedFailed: failures.length,
  withNotes: successes.length - emptyScores.length,
  emptyScores: emptyScores.map((result) => result.file),
  invalidNumbers: invalidNumbers.map((result) => result.file),
  expectedRejections,
  unexpectedFailures: failures,
  missingExpectedRejections,
}, null, 2)}\n`);

if (failures.length > 0 || invalidNumbers.length > 0 || missingExpectedRejections.length > 0) {
  process.exitCode = 1;
}
