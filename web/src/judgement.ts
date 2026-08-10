import type { Chord } from "./practice";
import type { BeatMarker, TimingProfile, TimingWindow } from "./types";

const DEFAULT_BEAT_SECONDS = 0.5;
const MIN_REPEAT_WINDOW_MS = 35;

interface ProfileRule {
  earlyRatio: number;
  lateRatio: number;
  minimumEarlyMs: number;
  minimumLateMs: number;
  maximumEarlyMs: number;
  maximumLateMs: number;
}

const RULES: Record<TimingProfile, ProfileRule> = {
  adaptive: {
    earlyRatio: 0.28,
    lateRatio: 0.38,
    minimumEarlyMs: 90,
    minimumLateMs: 120,
    maximumEarlyMs: 180,
    maximumLateMs: 250,
  },
  relaxed: {
    earlyRatio: 0.38,
    lateRatio: 0.5,
    minimumEarlyMs: 120,
    minimumLateMs: 160,
    maximumEarlyMs: 240,
    maximumLateMs: 320,
  },
  strict: {
    earlyRatio: 0.18,
    lateRatio: 0.24,
    minimumEarlyMs: 60,
    minimumLateMs: 85,
    maximumEarlyMs: 125,
    maximumLateMs: 170,
  },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function orderedBeats(beats: BeatMarker[]): BeatMarker[] {
  return beats
    .filter((beat) => Number.isFinite(beat.time) && beat.time >= 0)
    .sort((left, right) => left.time - right.time);
}

function beatSecondsAt(beats: BeatMarker[], scoreTime: number): number {
  if (beats.length < 2) return DEFAULT_BEAT_SECONDS;
  let low = 0;
  let high = beats.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (beats[middle].time <= scoreTime + 1e-6) low = middle + 1;
    else high = middle;
  }
  const before = Math.max(0, low - 1);
  const candidates = [
    beats[before + 1]?.time - beats[before]?.time,
    beats[before]?.time - beats[before - 1]?.time,
  ].filter((value): value is number => Number.isFinite(value) && value >= 0.08 && value <= 4);
  return candidates[0] ?? DEFAULT_BEAT_SECONDS;
}

function repeatedPitchGaps(chords: Chord[]): Array<{ previous?: number; next?: number }> {
  const result = chords.map(() => ({} as { previous?: number; next?: number }));
  const latest = new Map<number, number>();
  chords.forEach((chord, index) => {
    for (const pitch of new Set(chord.notes.map((note) => note.note))) {
      const previous = latest.get(pitch);
      if (previous !== undefined) {
        const gap = chord.start - chords[previous].start;
        if (gap > 0) {
          result[index].previous = Math.min(result[index].previous ?? Number.POSITIVE_INFINITY, gap);
          result[previous].next = Math.min(result[previous].next ?? Number.POSITIVE_INFINITY, gap);
        }
      }
      latest.set(pitch, index);
    }
  });
  return result;
}

/** Builds a local musical-time window for every chord in expanded playback order. */
export function timingWindowsForChords(
  chords: Chord[],
  beatMap: BeatMarker[],
  profile: TimingProfile,
): TimingWindow[] {
  const rule = RULES[profile] ?? RULES.adaptive;
  const beats = orderedBeats(beatMap);
  const repeated = repeatedPitchGaps(chords);
  return chords.map((chord, index) => {
    const beatMs = beatSecondsAt(beats, chord.start) * 1_000;
    let earlyMs = clamp(beatMs * rule.earlyRatio, rule.minimumEarlyMs, rule.maximumEarlyMs);
    let lateMs = clamp(beatMs * rule.lateRatio, rule.minimumLateMs, rule.maximumLateMs);
    if (repeated[index].previous !== undefined) {
      earlyMs = Math.min(earlyMs, repeated[index].previous! * 480);
    }
    if (repeated[index].next !== undefined) {
      lateMs = Math.min(lateMs, repeated[index].next! * 480);
    }
    return {
      earlyMs: Math.round(Math.max(MIN_REPEAT_WINDOW_MS, earlyMs)),
      lateMs: Math.round(Math.max(MIN_REPEAT_WINDOW_MS, lateMs)),
    };
  });
}

export function timingWindowRange(
  windows: TimingWindow[],
  speed = 1,
): { early: [number, number]; late: [number, number] } | undefined {
  if (windows.length === 0) return undefined;
  const divisor = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const early = windows.map((window) => window.earlyMs / divisor);
  const late = windows.map((window) => window.lateMs / divisor);
  return {
    early: [Math.round(Math.min(...early)), Math.round(Math.max(...early))],
    late: [Math.round(Math.min(...late)), Math.round(Math.max(...late))],
  };
}
