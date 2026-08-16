export const FIRST_PIANO_NOTE = 21;
export const LAST_PIANO_NOTE = 108;
export const PIANO_NOTE_COUNT = LAST_PIANO_NOTE - FIRST_PIANO_NOTE + 1;
export const MAX_KEY_PIXEL_OFFSET = 4;

export interface CalibrationProfile {
  schemaVersion: 1;
  product: "NoteFall 88";
  firstMidiNote: 21;
  lastMidiNote: 108;
  offsets: number[];
  exportedAt: string;
  source?: string;
}

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

export function calibrationProfile(
  offsets: readonly number[],
  exportedAt = new Date().toISOString(),
  source?: string,
): CalibrationProfile {
  return {
    schemaVersion: 1,
    product: "NoteFall 88",
    firstMidiNote: FIRST_PIANO_NOTE,
    lastMidiNote: LAST_PIANO_NOTE,
    offsets: normalizeKeyOffsets(offsets),
    exportedAt,
    ...(source ? { source: source.slice(0, 120) } : {}),
  };
}

export function parseCalibrationProfile(value: unknown): CalibrationProfile {
  if (!value || typeof value !== "object") throw new Error("校准文件不是有效对象");
  const candidate = value as Partial<CalibrationProfile>;
  if (candidate.schemaVersion !== 1 || candidate.product !== "NoteFall 88"
      || candidate.firstMidiNote !== FIRST_PIANO_NOTE
      || candidate.lastMidiNote !== LAST_PIANO_NOTE
      || !Array.isArray(candidate.offsets)
      || candidate.offsets.length !== PIANO_NOTE_COUNT) {
    throw new Error("校准文件型号、版本或88键数量不正确");
  }
  if (!candidate.offsets.every((offset) => Number.isFinite(offset)
      && Number.isInteger(offset) && offset >= -MAX_KEY_PIXEL_OFFSET
      && offset <= MAX_KEY_PIXEL_OFFSET)) {
    throw new Error("校准值必须是-4到+4之间的整数");
  }
  return calibrationProfile(
    candidate.offsets,
    typeof candidate.exportedAt === "string" ? candidate.exportedAt : new Date().toISOString(),
    typeof candidate.source === "string" ? candidate.source : undefined,
  );
}
