export const FIRST_PIANO_NOTE = 21;
export const LAST_PIANO_NOTE = 108;
export const PIANO_NOTE_COUNT = LAST_PIANO_NOTE - FIRST_PIANO_NOTE + 1;
export const MAX_KEY_PIXEL_OFFSET = 4;

const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export function clampPianoNote(note: number): number {
  return Math.max(FIRST_PIANO_NOTE, Math.min(LAST_PIANO_NOTE, Math.round(note)));
}

export function clampKeyOffset(offset: number): number {
  return Math.max(-MAX_KEY_PIXEL_OFFSET, Math.min(MAX_KEY_PIXEL_OFFSET, Math.round(offset)));
}

export function pianoNoteName(note: number): string {
  const safe = clampPianoNote(note);
  return `${NOTE_NAMES[safe % 12]}${Math.floor(safe / 12) - 1}`;
}

export function normalizeKeyOffsets(offsets: readonly number[]): number[] {
  return Array.from({ length: PIANO_NOTE_COUNT }, (_, index) =>
    clampKeyOffset(Number(offsets[index]) || 0));
}
