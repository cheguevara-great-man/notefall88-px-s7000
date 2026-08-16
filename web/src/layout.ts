export interface KeyGeometry {
  note: number;
  x: number;
  width: number;
  black: boolean;
}

export interface CanvasRasterSize {
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  scale: number;
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

/**
 * Keeps Canvas text and geometry in CSS pixels while retaining HiDPI detail.
 * The pixel-area limit prevents an unusual browser display scale from turning
 * a fullscreen tablet canvas into a multi-tens-of-megapixel 60 fps surface.
 */
export function canvasRasterSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio = 1,
  maximumPixelArea = 7_500_000,
): CanvasRasterSize {
  const width = Math.max(320, Math.round(Number.isFinite(cssWidth) ? cssWidth : 0));
  const height = Math.max(300, Math.round(Number.isFinite(cssHeight) ? cssHeight : 0));
  const requestedScale = Math.max(1, Math.min(2, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
  const areaScale = Math.sqrt(maximumPixelArea / (width * height));
  const scale = Math.max(0.5, Math.min(requestedScale, areaScale));
  return {
    cssWidth: width,
    cssHeight: height,
    pixelWidth: Math.round(width * scale),
    pixelHeight: Math.round(height * scale),
    scale,
  };
}
