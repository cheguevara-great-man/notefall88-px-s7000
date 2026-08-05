import { Midi } from "@tonejs/midi";
import { beatMapFromTicks } from "./beatmap";
import type { Hand, ParsedScore, ScoreNote } from "./types";

const LEFT_HINTS = ["left", "lh", "bass", "左手"];
const RIGHT_HINTS = ["right", "rh", "treble", "右手", "melody"];

function hintedHand(trackName: string): Hand | undefined {
  const normalized = trackName.toLowerCase();
  if (LEFT_HINTS.some((hint) => normalized.includes(hint))) return "left";
  if (RIGHT_HINTS.some((hint) => normalized.includes(hint))) return "right";
  return undefined;
}

export function parseMidiFile(buffer: ArrayBuffer, fallbackName: string): ParsedScore {
  const midi = new Midi(buffer);
  const notes: ScoreNote[] = [];
  for (const track of midi.tracks) {
    const trackHand = hintedHand(track.name ?? "");
    for (const note of track.notes) {
      if (note.midi < 21 || note.midi > 108) continue;
      notes.push({
        note: note.midi,
        start: note.time,
        end: note.time + Math.max(note.duration, 0.03),
        velocity: Math.max(1, Math.round(note.velocity * 127)),
        hand: trackHand ?? (note.midi < 60 ? "left" : "right"),
      });
    }
  }
  notes.sort((a, b) => a.start - b.start || a.note - b.note);
  const duration = notes.reduce((max, note) => Math.max(max, note.end), midi.duration || 0);
  const embeddedName = midi.header.name?.trim();
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
    name: embeddedName || fallbackName.replace(/\.(mid|midi)$/i, ""),
    duration,
    notes,
    format: "midi",
    beatMap,
  };
}
