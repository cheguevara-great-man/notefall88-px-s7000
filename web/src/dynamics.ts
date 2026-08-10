import type { ScoreNote } from "./types";

export interface DynamicsProfile {
  low: number;
  high: number;
  flat: boolean;
}

function clampVelocity(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(127, numeric)) : 96;
}

/**
 * Keeps dynamics comparable between pieces while reserving part of the visual
 * range for contrasts inside the current score. Percentiles prevent one stray
 * MIDI velocity from flattening the rest of the piece.
 */
export function buildDynamicsProfile(notes: ReadonlyArray<Pick<ScoreNote, "velocity">>): DynamicsProfile {
  const values = notes.map((note) => clampVelocity(note.velocity)).sort((left, right) => left - right);
  if (values.length === 0) return { low: 32, high: 112, flat: false };
  const lowIndex = values.length >= 10 ? Math.floor((values.length - 1) * 0.1) : 0;
  const highIndex = values.length >= 10 ? Math.ceil((values.length - 1) * 0.9) : values.length - 1;
  const low = values[lowIndex];
  const high = values[highIndex];
  return { low, high, flat: high - low < 12 };
}

/** 0.08–0.95 energy used by renderers; geometry remains tied to the key. */
export function normalizedDynamics(velocity: unknown, profile: DynamicsProfile): number {
  const value = clampVelocity(velocity);
  const absolute = value / 127;
  const local = profile.flat
    ? absolute
    : Math.max(0, Math.min(1, (value - profile.low) / Math.max(1, profile.high - profile.low)));
  return Math.max(0.08, Math.min(0.95, absolute * 0.72 + local * 0.28));
}
