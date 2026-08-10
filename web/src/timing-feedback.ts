export type TimingBand = "early" | "on-time" | "late";

export interface TimingCue {
  band: TimingBand;
  label: string;
  symbol: string;
  offset: number;
}

const ON_TIME_MS = 25;
const VISUAL_LIMIT_MS = 250;

/** Converts signed matcher error into a bounded, renderer-independent cue. */
export function timingCue(value: unknown): TimingCue | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const rounded = Math.round(numeric);
  const offset = Math.max(-1, Math.min(1, numeric / VISUAL_LIMIT_MS));
  if (Math.abs(numeric) <= ON_TIME_MS) return { band: "on-time", label: "准", symbol: "●", offset };
  const magnitude = Math.min(999, Math.abs(rounded));
  return numeric < 0
    ? { band: "early", label: `早 ${magnitude}`, symbol: "↑", offset }
    : { band: "late", label: `晚 ${magnitude}`, symbol: "↓", offset };
}
