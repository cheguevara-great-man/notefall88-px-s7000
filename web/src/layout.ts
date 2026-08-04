export interface KeyGeometry {
  note: number;
  x: number;
  width: number;
  black: boolean;
}

const WHITE_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

export function pianoKeys(): KeyGeometry[] {
  const keys: KeyGeometry[] = [];
  let whitesSeen = 0;
  for (let note = 21; note <= 108; note += 1) {
    const black = !WHITE_CLASSES.has(note % 12);
    if (black) {
      keys.push({ note, x: (whitesSeen - 0.32) / 52, width: 0.64 / 52, black: true });
    } else {
      keys.push({ note, x: whitesSeen / 52, width: 1 / 52, black: false });
      whitesSeen += 1;
    }
  }
  return keys;
}

export function noteCenter(note: number): number {
  const key = pianoKeys().find((candidate) => candidate.note === note);
  if (!key) throw new RangeError(`MIDI note outside piano range: ${note}`);
  return key.x + key.width / 2;
}
