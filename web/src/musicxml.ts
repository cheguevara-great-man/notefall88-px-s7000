import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";

import type { Hand, ParsedScore, ScoreNote } from "./types";

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const ZIP_CENTRAL_SIGNATURE = 0x02014B50;
const ZIP_EOCD_SIGNATURE = 0x06054B50;
const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

interface QuarterNote {
  note: number;
  start: number;
  end: number;
  velocity: number;
  hand: Hand;
  part: string;
  staff: number;
  voice: string;
  tieStart: boolean;
  tieStop: boolean;
}

interface TempoEvent {
  quarter: number;
  bpm: number;
}

interface PartMeasure {
  duration: number;
  notes: (Omit<QuarterNote, "start" | "end"> & { start: number; end: number })[];
  tempos: { offset: number; bpm: number }[];
}

export interface MusicXmlScore {
  score: ParsedScore;
  xml: string;
}

function assertSafeZipSize(bytes: Uint8Array): void {
  if (bytes.byteLength < 22) throw new Error("MXL 压缩包结构无效");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstEocd = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= firstEocd; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("MXL 压缩包缺少中央目录");
  const entryCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xFFFF || directorySize === 0xFFFF_FFFF || directoryOffset === 0xFFFF_FFFF) {
    throw new Error("暂不支持 ZIP64 MXL 乐谱");
  }
  if (directoryOffset + directorySize > eocd || directoryOffset + 46 > bytes.byteLength) {
    throw new Error("MXL 压缩包中央目录损坏");
  }
  let offset = directoryOffset;
  let total = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error("MXL 压缩包条目损坏");
    }
    const uncompressed = view.getUint32(offset + 24, true);
    if (uncompressed === 0xFFFF_FFFF) throw new Error("暂不支持 ZIP64 MXL 乐谱");
    total += uncompressed;
    if (total > MAX_SOURCE_BYTES) throw new Error("MXL 声明的解压体积超过 32 MB 安全上限");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset > directoryOffset + directorySize) throw new Error("MXL 压缩包中央目录越界");
}

function children(element: XmlElement, name?: string): XmlElement[] {
  const result: XmlElement[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType !== 1) continue;
    const childElement = child as XmlElement;
    if (!name || childElement.tagName === name) result.push(childElement);
  }
  return result;
}

function child(element: XmlElement, name: string): XmlElement | undefined {
  return children(element, name)[0];
}

function descendants(element: XmlElement, name: string): XmlElement[] {
  return Array.from(element.getElementsByTagName(name)) as XmlElement[];
}

function text(element: XmlElement | undefined): string {
  return element?.textContent?.trim() ?? "";
}

function numberText(element: XmlElement | undefined, fallback = 0): number {
  const value = Number(text(element));
  return Number.isFinite(value) ? value : fallback;
}

function directNumber(element: XmlElement, name: string, fallback = 0): number {
  return numberText(child(element, name), fallback);
}

function nameHint(name: string): Hand | undefined {
  const normalized = name.toLowerCase();
  if (/\b(left|lh|bass)\b|左手/.test(normalized)) return "left";
  if (/\b(right|rh|treble|melody)\b|右手/.test(normalized)) return "right";
  return undefined;
}

function midiPitch(note: XmlElement, transpose: number): number | undefined {
  const pitch = child(note, "pitch");
  if (!pitch) return undefined;
  const step = STEP_TO_SEMITONE[text(child(pitch, "step")).toUpperCase()];
  const octave = directNumber(pitch, "octave", Number.NaN);
  const alter = directNumber(pitch, "alter", 0);
  if (step === undefined || !Number.isFinite(octave)) return undefined;
  return Math.round((octave + 1) * 12 + step + alter + transpose);
}

function parseTempo(direction: XmlElement): number | undefined {
  const sound = descendants(direction, "sound")[0];
  const soundTempo = Number(sound?.getAttribute("tempo"));
  if (Number.isFinite(soundTempo) && soundTempo > 0) return soundTempo;
  const perMinute = numberText(descendants(direction, "per-minute")[0], Number.NaN);
  return Number.isFinite(perMinute) && perMinute > 0 ? perMinute : undefined;
}

function parsePart(part: XmlElement, partName: string): PartMeasure[] {
  let divisions = 1;
  let beats = 4;
  let beatType = 4;
  let transpose = 0;
  const hinted = nameHint(partName);
  const result: PartMeasure[] = [];

  for (const measure of children(part, "measure")) {
    let cursor = 0;
    let maximum = 0;
    let lastNoteStart = 0;
    const notes: PartMeasure["notes"] = [];
    const tempos: PartMeasure["tempos"] = [];

    for (const event of children(measure)) {
      if (event.tagName === "attributes") {
        const nextDivisions = directNumber(event, "divisions", divisions);
        if (nextDivisions > 0) divisions = nextDivisions;
        const time = child(event, "time");
        if (time) {
          beats = directNumber(time, "beats", beats);
          beatType = directNumber(time, "beat-type", beatType);
        }
        const transposeElement = child(event, "transpose");
        if (transposeElement) transpose = directNumber(transposeElement, "chromatic", transpose);
        continue;
      }

      if (event.tagName === "backup" || event.tagName === "forward") {
        const duration = directNumber(event, "duration", 0) / divisions;
        cursor = event.tagName === "backup" ? Math.max(0, cursor - duration) : cursor + duration;
        maximum = Math.max(maximum, cursor);
        continue;
      }

      if (event.tagName === "direction") {
        const bpm = parseTempo(event);
        if (bpm) {
          const offset = directNumber(event, "offset", 0) / divisions;
          tempos.push({ offset: Math.max(0, cursor + offset), bpm });
        }
        continue;
      }

      if (event.tagName !== "note") continue;
      const isChord = !!child(event, "chord");
      const isGrace = !!child(event, "grace");
      const rawDuration = directNumber(event, "duration", 0) / divisions;
      const duration = rawDuration > 0 ? rawDuration : (isGrace ? 0.125 : 0);
      const start = isChord ? lastNoteStart : cursor;
      if (!isChord) lastNoteStart = start;
      const end = start + Math.max(duration, 0.02);
      const pitch = midiPitch(event, transpose);
      const staff = Math.max(1, Math.round(directNumber(event, "staff", 1)));
      if (pitch !== undefined && pitch >= 21 && pitch <= 108 && !child(event, "rest")) {
        const ties = children(event, "tie").map((tie) => tie.getAttribute("type"));
        const dynamics = descendants(event, "sound")[0]?.getAttribute("dynamics");
        const velocity = Math.max(1, Math.min(127, Math.round(Number(dynamics) || 96)));
        notes.push({
          note: pitch,
          start,
          end,
          velocity,
          hand: staff >= 2 ? "left" : (hinted ?? (pitch < 60 ? "left" : "right")),
          part: part.getAttribute("id") || partName,
          staff,
          voice: text(child(event, "voice")) || "1",
          tieStart: ties.includes("start"),
          tieStop: ties.includes("stop"),
        });
      }
      if (!isChord && !isGrace) cursor += rawDuration;
      maximum = Math.max(maximum, cursor, end);
    }

    const expected = beats > 0 && beatType > 0 ? beats * 4 / beatType : 4;
    result.push({ duration: maximum > 0 ? maximum : expected, notes, tempos });
  }
  return result;
}

function tempoConverter(events: TempoEvent[]): (quarter: number) => number {
  const ordered = [...events]
    .filter((event) => Number.isFinite(event.quarter) && Number.isFinite(event.bpm) && event.bpm > 0)
    .sort((a, b) => a.quarter - b.quarter);
  if (ordered.length === 0 || ordered[0].quarter > 0) ordered.unshift({ quarter: 0, bpm: 120 });
  const deduplicated: TempoEvent[] = [];
  for (const event of ordered) {
    const previous = deduplicated.at(-1);
    if (previous && Math.abs(previous.quarter - event.quarter) < 1e-8) previous.bpm = event.bpm;
    else deduplicated.push({ ...event });
  }

  const accumulated = deduplicated.map(() => 0);
  for (let index = 1; index < deduplicated.length; index += 1) {
    const previous = deduplicated[index - 1];
    accumulated[index] = accumulated[index - 1]
      + (deduplicated[index].quarter - previous.quarter) * 60 / previous.bpm;
  }

  return (quarter: number): number => {
    let index = deduplicated.length - 1;
    while (index > 0 && deduplicated[index].quarter > quarter) index -= 1;
    const event = deduplicated[index];
    return accumulated[index] + Math.max(0, quarter - event.quarter) * 60 / event.bpm;
  };
}

function mergeTies(notes: QuarterNote[]): QuarterNote[] {
  const result: QuarterNote[] = [];
  const open = new Map<string, QuarterNote>();
  for (const note of [...notes].sort((a, b) => a.start - b.start || a.note - b.note)) {
    const key = `${note.part}:${note.staff}:${note.voice}:${note.note}`;
    const existing = open.get(key);
    if (note.tieStop && existing) {
      existing.end = Math.max(existing.end, note.end);
      if (!note.tieStart) open.delete(key);
      continue;
    }
    const copy = { ...note };
    result.push(copy);
    if (copy.tieStart) open.set(key, copy);
  }
  return result;
}

function scoreTitle(document: XmlDocument, fallbackName: string): string {
  const root = document.documentElement;
  const title = root ? text(descendants(root, "movement-title")[0])
    || text(descendants(root, "work-title")[0])
    || text(descendants(root, "credit-words")[0]) : "";
  return title || fallbackName.replace(/\.(musicxml|xml|mxl)$/i, "");
}

export function parseMusicXml(xml: string, fallbackName: string): ParsedScore {
  if (!xml.trim()) throw new Error("MusicXML 文件为空");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const root = document.documentElement;
  if (!root || root.tagName !== "score-partwise") {
    throw new Error("当前支持 MusicXML score-partwise；该文件不是可识别的总谱");
  }

  const partNames = new Map<string, string>();
  for (const scorePart of descendants(root, "score-part")) {
    const id = scorePart.getAttribute("id") || "";
    partNames.set(id, text(child(scorePart, "part-name")) || id);
  }
  const parts = children(root, "part").map((part) => ({
    id: part.getAttribute("id") || "",
    measures: parsePart(part, partNames.get(part.getAttribute("id") || "") || "Piano"),
  }));
  if (parts.length === 0) throw new Error("MusicXML 中没有声部");

  const measureCount = Math.max(...parts.map((part) => part.measures.length));
  const measureDurations: number[] = [];
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
    measureDurations.push(Math.max(0, ...parts.map((part) => part.measures[measureIndex]?.duration ?? 0)));
  }
  const measureQuarterStarts = [0];
  for (const duration of measureDurations) {
    measureQuarterStarts.push(measureQuarterStarts.at(-1)! + duration);
  }

  const quarterNotes: QuarterNote[] = [];
  const tempos: TempoEvent[] = [];
  for (const part of parts) {
    part.measures.forEach((measure, measureIndex) => {
      const measureStart = measureQuarterStarts[measureIndex];
      measure.notes.forEach((note) => quarterNotes.push({
        ...note,
        start: measureStart + note.start,
        end: measureStart + note.end,
      }));
      measure.tempos.forEach((tempo) => tempos.push({
        quarter: measureStart + tempo.offset,
        bpm: tempo.bpm,
      }));
    });
  }

  const toSeconds = tempoConverter(tempos);
  const notes: ScoreNote[] = mergeTies(quarterNotes).map((note) => ({
    note: note.note,
    start: toSeconds(note.start),
    end: Math.max(toSeconds(note.start) + 0.03, toSeconds(note.end)),
    velocity: note.velocity,
    hand: note.hand,
  })).sort((a, b) => a.start - b.start || a.note - b.note);
  const measureStarts = measureQuarterStarts.slice(0, -1).map(toSeconds);
  const duration = Math.max(
    toSeconds(measureQuarterStarts.at(-1) ?? 0),
    ...notes.map((note) => note.end),
  );
  return {
    name: scoreTitle(document, fallbackName),
    duration,
    notes,
    format: "musicxml",
    measureStarts,
  };
}

export function extractMusicXml(buffer: ArrayBuffer, fileName: string): string {
  if (buffer.byteLength > MAX_SOURCE_BYTES) throw new Error("乐谱文件超过 32 MB 安全上限");
  const bytes = new Uint8Array(buffer);
  const zipped = /\.mxl$/i.test(fileName) || (bytes[0] === 0x50 && bytes[1] === 0x4B);
  if (!zipped) return new TextDecoder().decode(bytes);

  // Check declared sizes before inflation so a small zip bomb cannot force a
  // large allocation before the post-decompression limit is evaluated.
  assertSafeZipSize(bytes);
  const archive = unzipSync(bytes);
  const total = Object.values(archive).reduce((sum, entry) => sum + entry.byteLength, 0);
  if (total > MAX_SOURCE_BYTES) throw new Error("MXL 解压后超过 32 MB 安全上限");
  let scorePath = "";
  const container = archive["META-INF/container.xml"];
  if (container) {
    const containerDocument = new DOMParser().parseFromString(strFromU8(container), "application/xml");
    scorePath = containerDocument.getElementsByTagName("rootfile").item(0)?.getAttribute("full-path") ?? "";
  }
  if (!scorePath || !archive[scorePath]) {
    scorePath = Object.keys(archive).find((path) =>
      !path.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(path)) ?? "";
  }
  if (!scorePath || !archive[scorePath]) throw new Error("MXL 中找不到 MusicXML 主文件");
  return strFromU8(archive[scorePath]);
}

export function parseMusicXmlFile(buffer: ArrayBuffer, fileName: string): MusicXmlScore {
  const xml = extractMusicXml(buffer, fileName);
  return { score: parseMusicXml(xml, fileName), xml };
}
