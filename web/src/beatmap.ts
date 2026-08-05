import type { BeatMarker } from "./types";

export interface TickTimeSignature {
  ticks: number;
  numerator: number;
  denominator: number;
}

export function beatMapFromTicks(
  signatures: TickTimeSignature[],
  ppq: number,
  durationTicks: number,
  ticksToSeconds: (ticks: number) => number,
): BeatMarker[] {
  if (!(ppq > 0) || !(durationTicks > 0)) return [];
  const ordered = signatures
    .filter((item) => Number.isFinite(item.ticks) && item.ticks >= 0
      && Number.isFinite(item.numerator) && item.numerator > 0
      && Number.isFinite(item.denominator) && item.denominator > 0)
    .sort((a, b) => a.ticks - b.ticks);
  if (ordered.length === 0 || ordered[0].ticks > 0) {
    ordered.unshift({ ticks: 0, numerator: 4, denominator: 4 });
  }
  const deduplicated: TickTimeSignature[] = [];
  for (const signature of ordered) {
    const previous = deduplicated.at(-1);
    if (previous && Math.abs(previous.ticks - signature.ticks) < 0.5) Object.assign(previous, signature);
    else deduplicated.push({ ...signature });
  }

  const result: BeatMarker[] = [];
  let measure = 0;
  for (let segment = 0; segment < deduplicated.length && result.length < 100_000; segment += 1) {
    const signature = deduplicated[segment];
    const end = Math.min(durationTicks, deduplicated[segment + 1]?.ticks ?? durationTicks);
    const ticksPerBeat = ppq * 4 / signature.denominator;
    if (!(ticksPerBeat > 0) || end <= signature.ticks) continue;
    let localBeat = 0;
    for (let ticks = signature.ticks; ticks < end - 0.5 && result.length < 100_000; ticks += ticksPerBeat) {
      const beat = localBeat % Math.max(1, Math.round(signature.numerator));
      result.push({
        time: Math.max(0, ticksToSeconds(ticks)),
        accent: beat === 0,
        beat,
        measure,
      });
      localBeat += 1;
      if (localBeat % Math.max(1, Math.round(signature.numerator)) === 0) measure += 1;
    }
    if (localBeat % Math.max(1, Math.round(signature.numerator)) !== 0) measure += 1;
  }
  return result;
}

export function countInPlan(beats: BeatMarker[], scoreStart: number): { count: number; interval: number } {
  if (beats.length < 2) return { count: 4, interval: 0.5 };
  let index = -1;
  for (let cursor = beats.length - 1; cursor >= 0; cursor -= 1) {
    if (beats[cursor].time <= scoreStart + 0.001) {
      index = cursor;
      break;
    }
  }
  if (index < 0) index = 0;
  let accent = index;
  while (accent > 0 && !beats[accent].accent) accent -= 1;
  let nextAccent = accent + 1;
  while (nextAccent < beats.length && !beats[nextAccent].accent) nextAccent += 1;
  const count = Math.max(1, Math.min(12, nextAccent < beats.length ? nextAccent - accent : 4));
  const intervals: number[] = [];
  for (let cursor = accent; cursor < Math.min(beats.length - 1, accent + count); cursor += 1) {
    const value = beats[cursor + 1].time - beats[cursor].time;
    if (value > 0.03 && value < 10) intervals.push(value);
  }
  const interval = intervals.length > 0
    ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    : 0.5;
  return { count, interval };
}
