import type { HandSelection, PracticeMode } from "./types";

const STORAGE_KEY = "notefall88.preferences.v1";
const TEMPOS = [0.5, 0.75, 1, 1.25, 1.5];

export interface AppPreferences {
  version: 1;
  mode: PracticeMode;
  hand: HandSelection;
  tempo: number;
  leadMs: number;
  metronome: boolean;
  countIn: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  version: 1,
  mode: "wait",
  hand: "both",
  tempo: 1,
  leadMs: 900,
  metronome: false,
  countIn: true,
};

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function normalize(value: unknown): AppPreferences {
  if (!value || typeof value !== "object") return { ...DEFAULT_PREFERENCES };
  const candidate = value as Partial<AppPreferences>;
  if (candidate.version !== 1) return { ...DEFAULT_PREFERENCES };
  const mode = ["wait", "realtime", "follow"].includes(String(candidate.mode))
    ? candidate.mode as PracticeMode
    : DEFAULT_PREFERENCES.mode;
  const hand = ["both", "left", "right"].includes(String(candidate.hand))
    ? candidate.hand as HandSelection
    : DEFAULT_PREFERENCES.hand;
  const tempo = TEMPOS.includes(Number(candidate.tempo)) ? Number(candidate.tempo) : DEFAULT_PREFERENCES.tempo;
  const leadMs = Math.round(Math.max(300, Math.min(2_000, Number(candidate.leadMs) || DEFAULT_PREFERENCES.leadMs)) / 100) * 100;
  return {
    version: 1,
    mode,
    hand: mode === "follow" && hand === "both" ? "right" : hand,
    tempo,
    leadMs,
    metronome: candidate.metronome === true,
    countIn: candidate.countIn !== false,
  };
}

export function loadPreferences(storage?: PreferenceStorage): AppPreferences {
  try {
    const raw = (storage ?? localStorage).getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : { ...DEFAULT_PREFERENCES };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences: AppPreferences, storage?: PreferenceStorage): void {
  try {
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(normalize(preferences)));
  } catch {
    // Private browsing or a full quota must not stop practice.
  }
}
