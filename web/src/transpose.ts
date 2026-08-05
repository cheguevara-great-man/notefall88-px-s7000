import type { ParsedScore } from "./types";

export function clampTranspose(semitones: number): number {
  return Math.max(-12, Math.min(12, Math.round(semitones)));
}

export function transposeScore(source: ParsedScore, semitones: number): ParsedScore {
  const shift = clampTranspose(semitones);
  return {
    ...source,
    notes: source.notes
      .map((note) => ({ ...note, note: note.note + shift }))
      .filter((note) => note.note >= 21 && note.note <= 108),
    measureStarts: source.measureStarts ? [...source.measureStarts] : undefined,
  };
}

export function transposeLabel(semitones: number): string {
  const shift = clampTranspose(semitones);
  return shift === 0 ? "原调" : `${shift > 0 ? "+" : ""}${shift} 半音`;
}
