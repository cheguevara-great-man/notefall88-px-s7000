import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";
import { unzipSync } from "fflate";

import type { Hand, ParsedScore, ScoreNote, ScorePedalAction, ScorePedalEvent } from "./types";

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

function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes.byteLength >= 2) {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder("utf-16le").decode(bytes);
    }
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return new TextDecoder("utf-16be").decode(bytes);
    }
  }
  if (bytes.byteLength >= 4) {
    if (bytes[0] === 0x3C && bytes[1] === 0x00 && bytes[2] === 0x3F && bytes[3] === 0x00) {
      return new TextDecoder("utf-16le").decode(bytes);
    }
    if (bytes[0] === 0x00 && bytes[1] === 0x3C && bytes[2] === 0x00 && bytes[3] === 0x3F) {
      return new TextDecoder("utf-16be").decode(bytes);
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

const NOTE_TYPE_QUARTERS: Record<string, number> = {
  maxima: 32,
  long: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 0.0625,
  "128th": 0.03125,
  "256th": 0.015625,
  "512th": 0.0078125,
  "1024th": 0.00390625,
};

const DYNAMIC_VELOCITIES: Record<string, number> = {
  n: 1,
  pppppp: 10,
  ppppp: 14,
  pppp: 20,
  ppp: 30,
  pp: 42,
  p: 54,
  mp: 66,
  mf: 78,
  f: 90,
  ff: 104,
  fff: 116,
  ffff: 124,
  fffff: 126,
  ffffff: 127,
  fp: 72,
  pf: 72,
  sf: 104,
  sfp: 76,
  sfpp: 64,
  sfz: 108,
  sffz: 116,
  fz: 104,
  rf: 102,
  rfz: 108,
  sfzp: 78,
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
  articulationGate?: number;
}

interface TempoEvent {
  quarter: number;
  bpm?: number;
  ratio?: number;
}

interface BeatGroup {
  beats: number;
  beatType: number;
}

interface PartMeasure {
  duration: number;
  beatGroups: BeatGroup[];
  notes: (Omit<QuarterNote, "start" | "end"> & { start: number; end: number })[];
  tempos: { offset: number; bpm?: number; ratio?: number }[];
  pedals: { offset: number; value: number; action: ScorePedalAction }[];
}

interface MeasureControl {
  repeatForward: boolean;
  repeatBackward: boolean;
  repeatTimes: number;
  endings: Set<number>;
  daCapo: boolean;
  dalSegno?: string;
  segno?: string;
  toCoda?: string;
  coda?: string;
  fine: boolean;
}

interface RepeatFrame {
  start: number;
  pass: number;
  times: number;
  alternativeEnd?: number;
  forwardIndex?: number;
}

function articulationGate(note: XmlElement): number | undefined {
  if (descendants(note, "staccatissimo").length > 0) return 0.25;
  if (descendants(note, "staccato").length > 0) return 0.5;
  if (descendants(note, "detached-legato").length > 0) return 0.65;
  if (descendants(note, "tenuto").length > 0) return 0.95;
  return undefined;
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

function firstNumber(value: string): number | undefined {
  const match = value.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timeGroups(time: XmlElement, fallback: BeatGroup[]): BeatGroup[] {
  const result: BeatGroup[] = [];
  let pendingBeats: number[] | undefined;
  for (const element of children(time)) {
    if (element.tagName === "interchangeable") break;
    if (element.tagName === "beats") {
      const parsed = text(element).split("+").map((token) => Number(token.trim()));
      pendingBeats = parsed.length > 0 && parsed.every((value) => Number.isInteger(value) && value > 0)
        ? parsed
        : undefined;
    } else if (element.tagName === "beat-type" && pendingBeats) {
      const beatType = Number(text(element));
      if (Number.isInteger(beatType) && beatType > 0) {
        pendingBeats.forEach((beats) => result.push({ beats, beatType }));
      }
      pendingBeats = undefined;
    }
  }
  return result.length > 0 ? result : fallback.map((group) => ({ ...group }));
}

function measureQuarters(groups: BeatGroup[]): number {
  return groups.reduce((sum, group) => sum + group.beats * 4 / group.beatType, 0);
}

function soundDynamics(sound: XmlElement | undefined): number | undefined {
  const raw = sound?.getAttribute("dynamics");
  if (raw === undefined || raw === null || raw.trim() === "") return undefined;
  const percentage = Number(raw);
  if (!Number.isFinite(percentage) || percentage < 0) return undefined;
  return Math.max(1, Math.min(127, Math.round(90 * percentage / 100)));
}

function directionDynamics(direction: XmlElement): number | undefined {
  const fromSound = soundDynamics(descendants(direction, "sound")[0]);
  if (fromSound !== undefined) return fromSound;
  const dynamics = descendants(direction, "dynamics")[0];
  if (!dynamics) return undefined;
  for (const mark of children(dynamics)) {
    const named = DYNAMIC_VELOCITIES[mark.tagName.toLowerCase()];
    if (named !== undefined) return named;
    if (mark.tagName === "other-dynamics") {
      const other = DYNAMIC_VELOCITIES[text(mark).toLowerCase()];
      if (other !== undefined) return other;
    }
  }
  return undefined;
}

function endingNumbers(value: string | null): Set<number> {
  const result = new Set<number>();
  for (const token of (value ?? "").split(/[;,\s]+/)) {
    if (!token) continue;
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const first = Number(range[1]);
      const last = Number(range[2]);
      for (let number = Math.min(first, last); number <= Math.max(first, last); number += 1) {
        if (number >= 1 && number <= 8) result.add(number);
      }
      continue;
    }
    const number = Number(token);
    if (Number.isInteger(number) && number >= 1 && number <= 8) result.add(number);
  }
  return result;
}

function soundAttribute(sounds: XmlElement[], name: string): string | undefined {
  for (const sound of sounds) {
    const value = sound.getAttribute(name);
    if (value !== null && value !== "" && !/^(no|false|0)$/i.test(value)) return value;
  }
  return undefined;
}

function partMeasureControls(part: XmlElement): MeasureControl[] {
  let activeEndings = new Set<number>();
  return children(part, "measure").map((measure) => {
    const barlines = children(measure, "barline");
    const endings = barlines.flatMap((barline) => children(barline, "ending"));
    for (const ending of endings) {
      if (ending.getAttribute("type") === "start") {
        const parsed = endingNumbers(ending.getAttribute("number"));
        if (parsed.size > 0) activeEndings = parsed;
      }
    }
    const repeats = barlines.flatMap((barline) => children(barline, "repeat"));
    const backward = repeats.find((repeat) => repeat.getAttribute("direction") === "backward");
    const sounds = descendants(measure, "sound");
    const control: MeasureControl = {
      repeatForward: repeats.some((repeat) => repeat.getAttribute("direction") === "forward"),
      repeatBackward: !!backward,
      repeatTimes: Math.max(2, Math.min(8, Math.round(Number(backward?.getAttribute("times")) || 2))),
      endings: new Set(activeEndings),
      daCapo: soundAttribute(sounds, "dacapo") !== undefined,
      dalSegno: soundAttribute(sounds, "dalsegno"),
      segno: soundAttribute(sounds, "segno"),
      toCoda: soundAttribute(sounds, "tocoda"),
      coda: soundAttribute(sounds, "coda"),
      fine: soundAttribute(sounds, "fine") !== undefined,
    };
    if (endings.some((ending) => ["stop", "discontinue"].includes(ending.getAttribute("type") ?? ""))) {
      activeEndings = new Set();
    }
    return control;
  });
}

function mergedMeasureControls(parts: XmlElement[], measureCount: number): MeasureControl[] {
  const result = Array.from({ length: measureCount }, (): MeasureControl => ({
    repeatForward: false,
    repeatBackward: false,
    repeatTimes: 2,
    endings: new Set<number>(),
    daCapo: false,
    fine: false,
  }));
  for (const part of parts) {
    partMeasureControls(part).forEach((control, index) => {
      const merged = result[index];
      if (!merged) return;
      merged.repeatForward ||= control.repeatForward;
      merged.repeatBackward ||= control.repeatBackward;
      merged.repeatTimes = Math.max(merged.repeatTimes, control.repeatTimes);
      control.endings.forEach((number) => merged.endings.add(number));
      merged.daCapo ||= control.daCapo;
      merged.dalSegno ??= control.dalSegno;
      merged.segno ??= control.segno;
      merged.toCoda ??= control.toCoda;
      merged.coda ??= control.coda;
      merged.fine ||= control.fine;
    });
  }
  return result;
}

function expandMeasureOrder(controls: MeasureControl[]): number[] {
  if (controls.length === 0) return [];
  interface EndingGroup {
    passes: Set<number>;
    end: number;
  }
  const endingGroupByMeasure = new Map<number, EndingGroup>();
  let endingGroup: EndingGroup | undefined;
  let previousEndingKey = "";
  let previousEndings = new Set<number>();
  controls.forEach((control, measureIndex) => {
    const endingKey = [...control.endings].sort((left, right) => left - right).join(",");
    if (!endingKey) {
      endingGroup = undefined;
      previousEndingKey = "";
      previousEndings = new Set<number>();
      return;
    }
    const numberingRestarted = endingKey !== previousEndingKey
      && control.endings.has(1) && !previousEndings.has(1);
    if (!endingGroup || numberingRestarted) endingGroup = { passes: new Set<number>(), end: measureIndex };
    if (endingKey !== previousEndingKey) {
      for (const pass of control.endings) {
        if (endingGroup.passes.has(pass)) {
          throw new Error(`MusicXML 反复结尾编号 ${pass} 在同一组中重叠`);
        }
        endingGroup.passes.add(pass);
      }
    }
    endingGroup.end = measureIndex;
    endingGroupByMeasure.set(measureIndex, endingGroup);
    previousEndingKey = endingKey;
    previousEndings = control.endings;
  });
  const segnos = new Map<string, number>();
  const codas = new Map<string, number>();
  controls.forEach((control, measureIndex) => {
    if (control.segno) segnos.set(control.segno, measureIndex);
    if (control.coda) codas.set(control.coda, measureIndex);
  });
  const markerTarget = (markers: Map<string, number>, requested: string, name: string): number => {
    const exact = markers.get(requested);
    if (exact !== undefined) return exact;
    if (markers.size === 1) return [...markers.values()][0];
    throw new Error(`MusicXML ${name} 跳转缺少可识别的目标标记`);
  };
  const order: number[] = [];
  const stack: RepeatFrame[] = [];
  let index = 0;
  let lastCompletedPass = 1;
  let previousHadEnding = false;
  let globalJumpTaken = false;
  let afterGlobalJump = false;
  let codaTaken = false;
  let ignoreRepeats = false;
  let steps = 0;
  const maximumSteps = Math.max(128, controls.length * 32);

  const alternativeGroup = (backwardIndex: number): { passes: number; end?: number } => {
    const group = endingGroupByMeasure.get(backwardIndex);
    return group
      ? { passes: Math.max(0, ...group.passes), end: group.end }
      : { passes: 0 };
  };

  while (index < controls.length && steps < maximumSteps && order.length < 10_000) {
    steps += 1;
    const control = controls[index];
    if (!control.endings.size && previousHadEnding && stack.length === 0) lastCompletedPass = 1;
    const currentEndingGroup = endingGroupByMeasure.get(index);
    if (currentEndingGroup && currentEndingGroup !== endingGroupByMeasure.get(index - 1)
      && stack.length === 0) {
      lastCompletedPass = 1;
    }
    const pass = stack.at(-1)?.pass ?? lastCompletedPass;
    const shouldPlay = control.endings.size === 0 || control.endings.has(pass);
    if (!ignoreRepeats && shouldPlay && control.repeatForward
      && stack.at(-1)?.forwardIndex !== index) {
      stack.push({ start: index, pass: 1, times: 2, forwardIndex: index });
    }
    if (shouldPlay) order.push(index);
    previousHadEnding = control.endings.size > 0;

    if (shouldPlay && afterGlobalJump && control.fine) {
      index = controls.length;
      break;
    }
    if (shouldPlay && afterGlobalJump && !codaTaken && control.toCoda) {
      index = markerTarget(codas, control.toCoda, "To Coda");
      codaTaken = true;
      stack.length = 0;
      previousHadEnding = false;
      continue;
    }
    if (shouldPlay && !globalJumpTaken && (control.daCapo || control.dalSegno)) {
      index = control.daCapo ? 0 : markerTarget(segnos, control.dalSegno!, "D.S.");
      globalJumpTaken = true;
      afterGlobalJump = true;
      ignoreRepeats = true;
      lastCompletedPass = 1;
      stack.length = 0;
      previousHadEnding = false;
      continue;
    }

    if (!ignoreRepeats && shouldPlay && control.repeatBackward) {
      let frame = stack.at(-1);
      if (!frame) {
        frame = { start: 0, pass: 1, times: control.repeatTimes };
        stack.push(frame);
      }
      const alternatives = alternativeGroup(index);
      frame.times = Math.max(frame.times, control.repeatTimes, alternatives.passes);
      if (alternatives.end !== undefined) frame.alternativeEnd = alternatives.end;
      if (frame.pass < frame.times) {
        frame.pass += 1;
        lastCompletedPass = frame.pass;
        index = frame.start;
      } else {
        lastCompletedPass = frame.pass;
        stack.pop();
        index += 1;
      }
    } else {
      const frame = stack.at(-1);
      const alternativesEndHere = frame?.alternativeEnd === index;
      if (shouldPlay && alternativesEndHere && frame.pass >= frame.times) {
        lastCompletedPass = frame.pass;
        stack.pop();
      }
      index += 1;
    }
  }
  if (index < controls.length) throw new Error("MusicXML 反复结构过深或无法终止");
  return order;
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

function metronomeBeatUnits(metronome: XmlElement | undefined): number[] {
  if (!metronome) return [];
  const units: Array<{ quarters: number; dots: number }> = [];
  for (const element of children(metronome)) {
    if (element.tagName === "beat-unit") {
      const quarters = NOTE_TYPE_QUARTERS[text(element).toLowerCase()];
      if (quarters !== undefined) units.push({ quarters, dots: 0 });
    } else if (element.tagName === "beat-unit-dot" && units.length > 0) {
      units.at(-1)!.dots += 1;
    }
  }
  return units.map(({ quarters, dots }) => quarters * (2 - 1 / 2 ** Math.min(dots, 8)));
}

function parseTempo(direction: XmlElement): { bpm?: number; ratio?: number } | undefined {
  const sound = descendants(direction, "sound")[0];
  const soundTempo = Number(sound?.getAttribute("tempo"));
  if (Number.isFinite(soundTempo) && soundTempo > 0) return { bpm: soundTempo };
  const metronome = descendants(direction, "metronome")[0];
  const perMinute = firstNumber(text(metronome ? descendants(metronome, "per-minute")[0] : undefined));
  const units = metronomeBeatUnits(metronome);
  if (perMinute !== undefined && perMinute > 0 && units[0] !== undefined) {
    return { bpm: perMinute * units[0] };
  }
  if (units.length >= 2 && units[0] > 0 && units[1] > 0) {
    return { ratio: units[1] / units[0] };
  }
  return undefined;
}

function pedalValue(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "yes") return 127;
  if (normalized === "no") return 0;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return undefined;
  return Math.round(numeric * 1.27);
}

function pedalEvents(element: XmlElement): Array<{ value: number; action: ScorePedalAction }> {
  const sound = element.tagName === "sound" ? element : descendants(element, "sound")[0];
  const fromSound = pedalValue(sound?.getAttribute("damper-pedal") ?? null);
  // MusicXML recommends playback-oriented sound data when both encodings exist.
  if (fromSound !== undefined) {
    return [{
      value: fromSound,
      action: fromSound === 0 ? "up" : fromSound === 127 ? "down" : "level",
    }];
  }
  if (element.tagName === "sound") return [];
  const result: Array<{ value: number; action: ScorePedalAction }> = [];
  for (const pedal of descendants(element, "pedal")) {
    const type = pedal.getAttribute("type")?.toLowerCase();
    if (type === "start" || type === "resume") result.push({ value: 127, action: "down" });
    else if (type === "stop" || type === "discontinue") result.push({ value: 0, action: "up" });
    else if (type === "change") result.push(
      { value: 0, action: "change-up" },
      { value: 127, action: "change-down" },
    );
    // continue has no state transition; sostenuto belongs to CC66, not CC64.
  }
  return result;
}

function parsePart(part: XmlElement, partName: string): PartMeasure[] {
  let divisions = 1;
  let activeBeatGroups: BeatGroup[] = [{ beats: 4, beatType: 4 }];
  let transpose = 0;
  let partVelocity = 96;
  const staffVelocities = new Map<number, number>();
  const hinted = nameHint(partName);
  const result: PartMeasure[] = [];

  for (const measure of children(part, "measure")) {
    let cursor = 0;
    let maximum = 0;
    let lastNoteStart = 0;
    const notes: PartMeasure["notes"] = [];
    const tempos: PartMeasure["tempos"] = [];
    const pedals: PartMeasure["pedals"] = [];

    for (const event of children(measure)) {
      if (event.tagName === "attributes") {
        const nextDivisions = directNumber(event, "divisions", divisions);
        if (nextDivisions > 0) divisions = nextDivisions;
        const time = child(event, "time");
        if (time) {
          activeBeatGroups = child(time, "senza-misura")
            ? []
            : timeGroups(time, activeBeatGroups.length > 0 ? activeBeatGroups : [{ beats: 4, beatType: 4 }]);
        }
        const transposeElement = child(event, "transpose");
        if (transposeElement) {
          transpose = directNumber(transposeElement, "chromatic", 0)
            + 12 * directNumber(transposeElement, "octave-change", 0);
        }
        continue;
      }

      if (event.tagName === "backup" || event.tagName === "forward") {
        const duration = directNumber(event, "duration", 0) / divisions;
        cursor = event.tagName === "backup" ? Math.max(0, cursor - duration) : cursor + duration;
        maximum = Math.max(maximum, cursor);
        continue;
      }

      if (event.tagName === "direction") {
        const directionOffset = Math.max(0, cursor + directNumber(event, "offset", 0) / divisions);
        for (const pedal of pedalEvents(event)) pedals.push({ offset: directionOffset, ...pedal });
        const tempo = parseTempo(event);
        if (tempo) {
          const sound = descendants(event, "sound")[0];
          const soundOffset = sound ? child(sound, "offset") : undefined;
          const offset = (soundOffset
            ? numberText(soundOffset, 0)
            : directNumber(event, "offset", 0)) / divisions;
          tempos.push({ offset: Math.max(0, cursor + offset), ...tempo });
        }
        const nextVelocity = directionDynamics(event);
        if (nextVelocity !== undefined) {
          const targetStaff = Math.round(directNumber(event, "staff", 0));
          if (targetStaff > 0) staffVelocities.set(targetStaff, nextVelocity);
          else {
            partVelocity = nextVelocity;
            staffVelocities.clear();
          }
        }
        continue;
      }

      if (event.tagName === "sound") {
        const soundOffset = Math.max(0, cursor + directNumber(event, "offset", 0) / divisions);
        for (const pedal of pedalEvents(event)) pedals.push({ offset: soundOffset, ...pedal });
        const bpm = Number(event.getAttribute("tempo"));
        if (Number.isFinite(bpm) && bpm > 0) {
          tempos.push({
            offset: Math.max(0, cursor + directNumber(event, "offset", 0) / divisions),
            bpm,
          });
        }
        const nextVelocity = soundDynamics(event);
        if (nextVelocity !== undefined) {
          partVelocity = nextVelocity;
          staffVelocities.clear();
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
      if (pitch !== undefined && pitch >= 21 && pitch <= 108 &&
          !child(event, "rest") && !child(event, "cue")) {
        const ties = children(event, "tie").map((tie) => tie.getAttribute("type"));
        const noteVelocity = soundDynamics(descendants(event, "sound")[0]);
        const velocity = noteVelocity ?? staffVelocities.get(staff) ?? partVelocity;
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
          articulationGate: articulationGate(event),
        });
      }
      if (!isChord && !isGrace) cursor += rawDuration;
      maximum = Math.max(maximum, cursor, end);
    }

    const expected = measureQuarters(activeBeatGroups);
    result.push({
      duration: maximum > 0 ? maximum : expected,
      beatGroups: activeBeatGroups.map((group) => ({ ...group })),
      notes,
      tempos,
      pedals,
    });
  }
  return result;
}

function tempoConverter(events: TempoEvent[]): (quarter: number) => number {
  const ordered = [...events]
    .filter((event) => Number.isFinite(event.quarter)
      && ((Number.isFinite(event.bpm) && event.bpm! > 0)
        || (Number.isFinite(event.ratio) && event.ratio! > 0)))
    .sort((a, b) => a.quarter - b.quarter);
  const deduplicated: TempoEvent[] = [];
  let currentBpm = 120;
  for (let index = 0; index < ordered.length;) {
    const quarter = ordered[index].quarter;
    const group: TempoEvent[] = [];
    while (index < ordered.length && Math.abs(ordered[index].quarter - quarter) < 1e-8) {
      group.push(ordered[index]);
      index += 1;
    }
    const explicit = group.filter((event) => event.bpm !== undefined).at(-1)?.bpm;
    if (explicit !== undefined) {
      currentBpm = explicit;
    } else {
      const ratios = group
        .map((event) => event.ratio)
        .filter((ratio): ratio is number => ratio !== undefined);
      if (ratios.length > 0) currentBpm *= ratios.at(-1)!;
    }
    deduplicated.push({ quarter, bpm: currentBpm });
  }
  if (deduplicated.length === 0 || deduplicated[0].quarter > 0) {
    deduplicated.unshift({ quarter: 0, bpm: 120 });
  }

  const accumulated = deduplicated.map(() => 0);
  for (let index = 1; index < deduplicated.length; index += 1) {
    const previous = deduplicated[index - 1];
    accumulated[index] = accumulated[index - 1]
      + (deduplicated[index].quarter - previous.quarter) * 60 / previous.bpm!;
  }

  return (quarter: number): number => {
    let index = deduplicated.length - 1;
    while (index > 0 && deduplicated[index].quarter > quarter) index -= 1;
    const event = deduplicated[index];
    return accumulated[index] + Math.max(0, quarter - event.quarter) * 60 / event.bpm!;
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
  const partElements = children(root, "part");
  const parts = partElements.map((part) => ({
    id: part.getAttribute("id") || "",
    measures: parsePart(part, partNames.get(part.getAttribute("id") || "") || "Piano"),
  }));
  if (parts.length === 0) throw new Error("MusicXML 中没有声部");

  const measureCount = Math.max(...parts.map((part) => part.measures.length));
  const writtenMeasureDurations: number[] = [];
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
    writtenMeasureDurations.push(Math.max(0, ...parts.map((part) => part.measures[measureIndex]?.duration ?? 0)));
  }
  const measureOrder = expandMeasureOrder(mergedMeasureControls(partElements, measureCount));
  const measureDurations = measureOrder.map((measureIndex) => writtenMeasureDurations[measureIndex] ?? 0);
  const measureQuarterStarts = [0];
  for (const duration of measureDurations) {
    measureQuarterStarts.push(measureQuarterStarts.at(-1)! + duration);
  }

  const quarterNotes: QuarterNote[] = [];
  const tempos: TempoEvent[] = [];
  const quarterPedals: Array<{ quarter: number; value: number; action: ScorePedalAction }> = [];
  for (const part of parts) {
    measureOrder.forEach((writtenMeasureIndex, playbackMeasureIndex) => {
      const measure = part.measures[writtenMeasureIndex];
      if (!measure) return;
      const measureStart = measureQuarterStarts[playbackMeasureIndex];
      measure.notes.forEach((note) => quarterNotes.push({
        ...note,
        start: measureStart + note.start,
        end: measureStart + note.end,
      }));
      measure.tempos.forEach((tempo) => tempos.push({
        quarter: measureStart + tempo.offset,
        bpm: tempo.bpm,
        ratio: tempo.ratio,
      }));
      measure.pedals.forEach((pedal) => quarterPedals.push({
        quarter: measureStart + pedal.offset,
        value: pedal.value,
        action: pedal.action,
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
    articulationGate: note.tieStart || note.tieStop ? 1 : note.articulationGate,
    scoreQuarterStart: note.start,
    scoreQuarterEnd: note.end,
  })).sort((a, b) => a.start - b.start || a.note - b.note);
  const measureStarts = measureQuarterStarts.slice(0, -1).map(toSeconds);
  const pedalRank: Record<ScorePedalAction, number> = {
    "change-up": 0,
    up: 1,
    level: 2,
    down: 3,
    "change-down": 4,
  };
  const pedalEventsByIdentity = new Map<string, ScorePedalEvent>();
  for (const pedal of quarterPedals) {
    const identity = `${pedal.quarter.toFixed(8)}:${pedal.action}:${pedal.value}`;
    pedalEventsByIdentity.set(identity, {
      time: toSeconds(pedal.quarter),
      value: pedal.value,
      action: pedal.action,
      scoreQuarter: pedal.quarter,
    });
  }
  const scorePedalEvents = [...pedalEventsByIdentity.values()]
    .sort((first, second) => first.time - second.time || pedalRank[first.action] - pedalRank[second.action]);
  const beatMap = measureOrder.flatMap((writtenMeasureIndex, playbackMeasureIndex) => {
    const measure = parts.find((part) => part.measures[writtenMeasureIndex])?.measures[writtenMeasureIndex];
    if (!measure || measure.beatGroups.length === 0) return [];
    const start = measureQuarterStarts[playbackMeasureIndex];
    const end = measureQuarterStarts[playbackMeasureIndex + 1];
    const markers = [];
    let quarter = start;
    let beat = 0;
    let groupIndex = 0;
    let beatInGroup = 0;
    while (quarter < end - 1e-8 && beat < 64) {
      const group = measure.beatGroups[groupIndex] ?? { beats: 1, beatType: 4 };
      markers.push({
        time: toSeconds(quarter),
        accent: beatInGroup === 0,
        beat,
        measure: playbackMeasureIndex,
      });
      quarter += 4 / group.beatType;
      beat += 1;
      beatInGroup += 1;
      if (beatInGroup >= group.beats) {
        beatInGroup = 0;
        groupIndex = (groupIndex + 1) % measure.beatGroups.length;
      }
    }
    return markers;
  });
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
    measureQuarterStarts,
    measureMap: measureOrder,
    beatMap,
    pedalEvents: scorePedalEvents.length > 0 ? scorePedalEvents : undefined,
  };
}

export function extractMusicXml(buffer: ArrayBuffer, fileName: string): string {
  if (buffer.byteLength > MAX_SOURCE_BYTES) throw new Error("乐谱文件超过 32 MB 安全上限");
  const bytes = new Uint8Array(buffer);
  const zipped = /\.mxl$/i.test(fileName) || (bytes[0] === 0x50 && bytes[1] === 0x4B);
  if (!zipped) return decodeXmlBytes(bytes);

  // Check declared sizes before inflation so a small zip bomb cannot force a
  // large allocation before the post-decompression limit is evaluated.
  assertSafeZipSize(bytes);
  const archive = unzipSync(bytes);
  const total = Object.values(archive).reduce((sum, entry) => sum + entry.byteLength, 0);
  if (total > MAX_SOURCE_BYTES) throw new Error("MXL 解压后超过 32 MB 安全上限");
  let scorePath = "";
  const container = archive["META-INF/container.xml"];
  if (container) {
    const containerDocument = new DOMParser().parseFromString(decodeXmlBytes(container), "application/xml");
    scorePath = containerDocument.getElementsByTagName("rootfile").item(0)?.getAttribute("full-path") ?? "";
  }
  if (!scorePath || !archive[scorePath]) {
    scorePath = Object.keys(archive).find((path) =>
      !path.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(path)) ?? "";
  }
  if (!scorePath || !archive[scorePath]) throw new Error("MXL 中找不到 MusicXML 主文件");
  return decodeXmlBytes(archive[scorePath]);
}

export function parseMusicXmlFile(buffer: ArrayBuffer, fileName: string): MusicXmlScore {
  const xml = extractMusicXml(buffer, fileName);
  return { score: parseMusicXml(xml, fileName), xml };
}
