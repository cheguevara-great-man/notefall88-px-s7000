import { Midi } from "@tonejs/midi";
import { beatMapFromTicks } from "./beatmap";
import type { Hand, ParsedScore, ScoreNote, ScorePedalEvent } from "./types";

const LEFT_HINTS = ["left", "lh", "bass", "左手"];
const RIGHT_HINTS = ["right", "rh", "treble", "右手", "melody"];
const ONSET_GROUP_SECONDS = 0.045;

interface MidiNoteCandidate {
  note: number;
  start: number;
  end: number;
  velocity: number;
  trackIndex: number;
  hand?: Hand;
}

function hintedHand(trackName: string): Hand | undefined {
  const normalized = trackName.toLowerCase();
  if (LEFT_HINTS.some((hint) => normalized.includes(hint))) return "left";
  if (RIGHT_HINTS.some((hint) => normalized.includes(hint))) return "right";
  return undefined;
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const center = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[center - 1] + ordered[center]) / 2 : ordered[center];
}

/**
 * MIDI has no standard "this was played by the left hand" field.  When an
 * arranger has kept hands in different tracks but omitted useful track names,
 * use the register of the whole track before falling back to note-by-note
 * inference.  We deliberately require a clear separation so two nearly
 * identical duplicate tracks are never silently called opposite hands.
 */
function inferTrackHands(candidates: MidiNoteCandidate[]): Map<number, Hand> {
  const pitches = new Map<number, number[]>();
  for (const candidate of candidates) {
    if (candidate.hand) continue;
    const values = pitches.get(candidate.trackIndex) ?? [];
    values.push(candidate.note);
    pitches.set(candidate.trackIndex, values);
  }
  const profiles = [...pitches].map(([trackIndex, values]) => ({ trackIndex, middle: median(values) }));
  if (profiles.length < 2) return new Map();
  const low = Math.min(...profiles.map((profile) => profile.middle));
  const high = Math.max(...profiles.map((profile) => profile.middle));
  if (high - low < 9) return new Map();
  const split = (low + high) / 2;
  return new Map(profiles.map((profile) => [profile.trackIndex, profile.middle <= split ? "left" : "right"]));
}

function fallbackHand(note: number, previous: Record<Hand, number>): Hand {
  // Outside the central octave the assignment is effectively unambiguous.
  if (note <= 55) return "left";
  if (note >= 64) return "right";
  // In the overlap around middle C, keep a melodic line with the closest
  // recent register, with a small conventional C4/right-hand preference.
  const leftCost = Math.abs(note - previous.left) + Math.max(0, note - 59) * 2.4;
  const rightCost = Math.abs(note - previous.right) + Math.max(0, 60 - note) * 2.4 - (note >= 60 ? 1 : 0);
  return leftCost <= rightCost ? "left" : "right";
}

function inferSingleStreamHands(candidates: MidiNoteCandidate[]): void {
  const unknown = candidates.filter((candidate) => !candidate.hand)
    .sort((a, b) => a.start - b.start || a.note - b.note);
  const previous: Record<Hand, number> = { left: 52, right: 67 };
  for (let index = 0; index < unknown.length;) {
    const onset = unknown[index].start;
    let end = index + 1;
    while (end < unknown.length && unknown[end].start - onset <= ONSET_GROUP_SECONDS) end += 1;
    const group = unknown.slice(index, end).sort((a, b) => a.note - b.note);

    // A simultaneous wide chord has more information than a lone note. Split
    // it at its largest interval only when that interval is substantial; a
    // normal one-hand triad must not be torn into two imagined hands.
    let gapIndex = -1;
    let largestGap = 0;
    for (let position = 1; position < group.length; position += 1) {
      const gap = group[position].note - group[position - 1].note;
      if (gap > largestGap) { largestGap = gap; gapIndex = position; }
    }
    const hasLowAnchor = group.some((candidate) => candidate.note <= 55);
    const hasHighAnchor = group.some((candidate) => candidate.note >= 64);
    const splitChord = group.length > 1 && largestGap >= 5 && (hasLowAnchor || hasHighAnchor);
    for (let position = 0; position < group.length; position += 1) {
      const candidate = group[position];
      candidate.hand = splitChord
        ? (position < gapIndex ? "left" : "right")
        : fallbackHand(candidate.note, previous);
      previous[candidate.hand] = candidate.note;
    }
    index = end;
  }
}

export function parseMidiFile(buffer: ArrayBuffer, fallbackName: string): ParsedScore {
  const midi = new Midi(buffer);
  const candidates: MidiNoteCandidate[] = [];
  const pedalControls: Array<{ time: number; value: number }> = [];
  for (const [trackIndex, track] of midi.tracks.entries()) {
    const trackHand = hintedHand(track.name ?? "");
    for (const note of track.notes) {
      if (note.midi < 21 || note.midi > 108) continue;
      candidates.push({
        note: note.midi,
        start: note.time,
        end: note.time + Math.max(note.duration, 0.03),
        velocity: Math.max(1, Math.round(note.velocity * 127)),
        trackIndex,
        hand: trackHand,
      });
    }
    for (const control of track.controlChanges[64] ?? []) {
      if (!Number.isFinite(control.time) || !Number.isFinite(control.value)) continue;
      pedalControls.push({
        time: Math.max(0, control.time),
        value: Math.max(0, Math.min(127, Math.round(control.value * 127))),
      });
    }
  }
  const inferredTracks = inferTrackHands(candidates);
  for (const candidate of candidates) candidate.hand ??= inferredTracks.get(candidate.trackIndex);
  inferSingleStreamHands(candidates);
  const notes: ScoreNote[] = candidates.map(({ trackIndex: _trackIndex, ...note }) => ({
    ...note,
    hand: note.hand ?? "right",
  }));
  notes.sort((a, b) => a.start - b.start || a.note - b.note);
  pedalControls.sort((a, b) => a.time - b.time || a.value - b.value);
  const pedalEvents: ScorePedalEvent[] = [];
  let previousPedal = 0;
  for (const control of pedalControls) {
    const previous = pedalEvents.at(-1);
    if (previous && Math.abs(previous.time - control.time) <= 1e-6 && previous.value === control.value) continue;
    const action = previousPedal < 64 && control.value >= 64
      ? "down"
      : previousPedal >= 64 && control.value < 64
        ? "up"
        : "level";
    pedalEvents.push({ time: control.time, value: control.value, action });
    previousPedal = control.value;
  }
  const duration = notes.reduce((max, note) => Math.max(max, note.end), midi.duration || 0);
  const cleanFallback = fallbackName.replace(/\.(mid|midi|xml|musicxml|mxl)$/i, "").trim();
  // The filename is the user-visible title selected during import.  A large
  // number of downloadable MIDI files carry boilerplate header text (for
  // example "eopn") in every file, so metadata must never replace a useful
  // local filename.
  let name = cleanFallback || "未命名乐谱";
  const rawEmbedded = midi.header.name?.trim();
  if (!cleanFallback && rawEmbedded && !/[\x00-\x1f\x7f-\x9f\ufffd]/.test(rawEmbedded)) {
    // Only accept embedded name if it doesn't contain weird garbage characters
    const hasSpecialGarbage = /[^\x20-\x7e\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/.test(rawEmbedded);
    if (!hasSpecialGarbage) {
      name = rawEmbedded;
    }
  }

  const durationTicks = Math.max(0, Math.ceil(midi.header.secondsToTicks(duration)));
  const beatMap = beatMapFromTicks(
    midi.header.timeSignatures.map((event) => ({
      ticks: event.ticks,
      numerator: event.timeSignature[0] ?? 4,
      denominator: event.timeSignature[1] ?? 4,
    })),
    midi.header.ppq,
    durationTicks,
    (ticks) => midi.header.ticksToSeconds(ticks),
  );
  return {
    name,
    duration,
    notes,
    format: "midi",
    beatMap,
    pedalEvents: pedalEvents.length > 0 ? pedalEvents : undefined,
  };
}
