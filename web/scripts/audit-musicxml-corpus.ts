import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";

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

const EXPECTED_REJECTIONS: Array<{ path: RegExp; error: RegExp }> = [
  // This W3C fixture deliberately overlaps and contradicts ending numbers.
  // Refusing to guess a playback order is safer than creating a wrong lesson.
  { path: /(?:^|\/)45f-Repeats-InvalidEndings\.xml$/, error: /反复结尾编号 2.*重叠/ },
  // The comparison corpus intentionally contains metadata-only Dorico exports.
  { path: /^Dorico\/MetadataTest\/MetadataTest Dorico(?: 5)?\.(?:musicxml|xml)$/, error: /没有声部/ },
  // Finale emits D.S. target 16 without a matching machine-readable segno 16.
  // The visible words are not a safe basis for a scored playback timeline.
  { path: /^Finale\/RepeatsTest\/RepeatsTest Finale\.musicxml$/, error: /D\.S\..*目标标记/ },
];

const EXPECTED_MEASURE_MAPS = new Map<string, number[]>([
  [
    "45d-Repeats-Nested-Alternatives.xml",
    [0, 1, 0, 2, 3, 4, 0, 5, 6, 7, 8, 0, 9, 0, 10, 11],
  ],
]);

const corpusRoot = resolve(process.argv[2] ?? "../tmp/musicxmlTestSuite/xmlFiles");
const supportedExtensions = new Set([".xml", ".musicxml", ".mxl"]);
function findScoreFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return findScoreFiles(path);
    return entry.isFile() && supportedExtensions.has(extname(entry.name).toLowerCase()) ? [path] : [];
  });
}

const files = findScoreFiles(corpusRoot)
  .sort((left, right) => left.localeCompare(right, "en"));

const successes: AuditSuccess[] = [];
const failures: AuditFailure[] = [];
const expectedRejections: AuditFailure[] = [];
const producerCounts = new Map<string, number>();

function producerFamily(value: string): string {
  if (/musescore/i.test(value)) return "MuseScore";
  if (/sibelius/i.test(value)) return "Sibelius";
  if (/finale/i.test(value)) return "Finale";
  if (/dolet/i.test(value)) return "Dolet";
  if (/dorico/i.test(value)) return "Dorico";
  return value.trim().replace(/\s+/g, " ").slice(0, 80) || "unknown";
}

for (const filePath of files) {
  const file = relative(corpusRoot, filePath).replaceAll("\\", "/");
  const fileName = basename(filePath);
  try {
    const bytes = readFileSync(filePath);
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const { score, xml } = parseMusicXmlFile(buffer, fileName);
    const fileProducers = new Set(
      [...xml.matchAll(/<software(?:\s[^>]*)?>([^<]+)<\/software>/gi)]
        .map((match) => producerFamily(match[1])),
    );
    for (const producer of fileProducers) {
      producerCounts.set(producer, (producerCounts.get(producer) ?? 0) + 1);
    }
    const expectedMeasureMap = EXPECTED_MEASURE_MAPS.get(fileName);
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
    const expected = EXPECTED_REJECTIONS.find((rule) =>
      rule.path.test(file) && rule.error.test(failure.error));
    if (expected) expectedRejections.push(failure);
    else failures.push(failure);
  }
}

const emptyScores = successes.filter((result) => result.notes === 0);
const invalidNumbers = successes.filter((result) =>
  !Number.isFinite(result.duration) || result.duration < 0);
const relativeFiles = files.map((path) => relative(corpusRoot, path).replaceAll("\\", "/"));
const missingExpectedRejections = EXPECTED_REJECTIONS
  .filter((rule) => relativeFiles.some((file) => rule.path.test(file))
    && !expectedRejections.some((failure) => rule.path.test(failure.file)))
  .map((rule) => rule.path.source);

process.stdout.write(`${JSON.stringify({
  corpusRoot,
  total: files.length,
  parsed: successes.length,
  expectedRejected: expectedRejections.length,
  unexpectedFailed: failures.length,
  withNotes: successes.length - emptyScores.length,
  producerFiles: Object.fromEntries([...producerCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"))),
  emptyScores: emptyScores.map((result) => result.file),
  invalidNumbers: invalidNumbers.map((result) => result.file),
  expectedRejections,
  unexpectedFailures: failures,
  missingExpectedRejections,
}, null, 2)}\n`);

if (failures.length > 0 || invalidNumbers.length > 0 || missingExpectedRejections.length > 0) {
  process.exitCode = 1;
}
