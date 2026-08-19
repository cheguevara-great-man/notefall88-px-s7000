import { Midi } from "@tonejs/midi";
import { beatMapFromTicks } from "./beatmap";
import type { Hand, ParsedScore, ScoreNote, ScorePedalEvent } from "./types";

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
  const pedalControls: Array<{ time: number; value: number }> = [];
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
    for (const control of track.controlChanges[64] ?? []) {
      if (!Number.isFinite(control.time) || !Number.isFinite(control.value)) continue;
      pedalControls.push({
        time: Math.max(0, control.time),
        value: Math.max(0, Math.min(127, Math.round(control.value * 127))),
      });
    }
  }
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
  let name = cleanFallback || "未命名乐谱";
  const rawEmbedded = midi.header.name?.trim();
  if (rawEmbedded && !/[\x00-\x1f\x7f-\x9f\ufffd]/.test(rawEmbedded)) {
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
