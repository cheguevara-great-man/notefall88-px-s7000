import type { Hand, ScoreNote } from "./types";

export interface PhraseMapBin {
  left: number;
  right: number;
}

export interface PhraseMap {
  bins: PhraseMapBin[];
  duration: number;
}

type PhraseNote = Pick<ScoreNote, "start" | "end" | "hand">;

export function buildPhraseMap(notes: PhraseNote[], duration: number, binCount = 72): PhraseMap {
  const safeBinCount = Math.max(8, Math.min(256, Math.round(binCount) || 72));
  const inferredDuration = notes.reduce((maximum, note) => Math.max(maximum, note.end), 0);
  const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0, inferredDuration);
  const raw = Array.from({ length: safeBinCount }, () => ({ left: 0, right: 0 }));
  if (safeDuration <= 0) return { bins: raw, duration: 0 };

  for (const note of notes) {
    if (!Number.isFinite(note.start) || note.start < 0 || note.start > safeDuration) continue;
    const index = Math.min(safeBinCount - 1, Math.floor(note.start / safeDuration * safeBinCount));
    const hand: Hand = note.hand === "left" ? "left" : "right";
    const weight = 1 + Math.min(2, Math.max(0, note.end - note.start)) * 0.25;
    raw[index][hand] += weight;
  }

  const peak = raw.reduce((maximum, bin) => Math.max(maximum, bin.left + bin.right), 0);
  if (peak <= 0) return { bins: raw, duration: safeDuration };
  return {
    duration: safeDuration,
    bins: raw.map((bin) => ({
      left: Math.sqrt(bin.left / peak),
      right: Math.sqrt(bin.right / peak),
    })),
  };
}

export function phraseMapProgress(time: number, duration: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(1, time / duration));
}
