import type { HandSelection, PracticeMode, TimingProfile } from "./types";
import { normalizeTempo } from "./tempo";

const STORAGE_KEY = "notefall88.preferences.v1";

export interface AppPreferences {
  version: 1;
  mode: PracticeMode;
  hand: HandSelection;
  timingProfile: TimingProfile;
  tempo: number;
  leadMs: number;
  previewSeconds: number;
  autoFullscreen: boolean;
  metronome: boolean;
  countIn: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  version: 1,
  mode: "wait",
  hand: "both",
  timingProfile: "adaptive",
  tempo: 1,
  leadMs: 900,
  previewSeconds: 4.2,
  autoFullscreen: false,
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
  const tempo = normalizeTempo(Number(candidate.tempo), DEFAULT_PREFERENCES.tempo);
  const timingProfile = ["adaptive", "relaxed", "strict"].includes(String(candidate.timingProfile))
    ? candidate.timingProfile as TimingProfile
    : DEFAULT_PREFERENCES.timingProfile;
  const leadMs = Math.round(Math.max(300, Math.min(2_000, Number(candidate.leadMs) || DEFAULT_PREFERENCES.leadMs)) / 100) * 100;
  const previewSeconds = normalizePreviewSeconds(candidate.previewSeconds);
  return {
    version: 1,
    mode,
    hand: mode === "follow" && hand === "both" ? "right" : hand,
    timingProfile,
    tempo,
    leadMs,
    previewSeconds,
    autoFullscreen: candidate.autoFullscreen === true,
    metronome: candidate.metronome === true,
    countIn: candidate.countIn !== false,
  };
}

export const PREVIEW_SECONDS_OPTIONS = [2.8, 4.2, 6.5] as const;

export function normalizePreviewSeconds(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_PREFERENCES.previewSeconds;
  return PREVIEW_SECONDS_OPTIONS.reduce((closest, option) => (
    Math.abs(option - numeric) < Math.abs(closest - numeric) ? option : closest
  ));
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
