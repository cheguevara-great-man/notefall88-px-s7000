export const MIN_TEMPO = 0.1;
export const MAX_TEMPO = 2;
export const TEMPO_STEP = 0.05;

export function normalizeTempo(value: number, fallback = 1): number {
  if (!Number.isFinite(value) || value < MIN_TEMPO || value > MAX_TEMPO) return fallback;
  return Math.round(Math.round(value / TEMPO_STEP) * TEMPO_STEP * 100) / 100;
}

export function clampTempo(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return normalizeTempo(Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, value)));
}

export function tempoPercent(value: number): number {
  return Math.round(normalizeTempo(value) * 100);
}
