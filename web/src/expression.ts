export interface DynamicsSample {
  actual: number;
  target: number;
}

export interface DynamicsMetrics {
  samples: number;
  actualMean: number;
  targetMean: number;
  /** Mean actual-minus-target offset. Kept separate from contour quality. */
  bias: number;
  meanAbsError: number;
  /** Absolute error after removing the player's/instrument's session-wide touch offset. */
  residualMeanAbsError: number;
  /** 0–100 relative-dynamics score; absent when the score contains no meaningful contrast. */
  score?: number;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], average: number): number {
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Scores relative dynamics without treating a piano/player-wide touch offset as
 * bad phrasing. Absolute bias remains visible as a separate calibration hint.
 */
export function evaluateDynamics(source: DynamicsSample[]): DynamicsMetrics | undefined {
  const samples = source.filter(({ actual, target }) => (
    Number.isFinite(actual) && actual >= 0 && actual <= 127
    && Number.isFinite(target) && target >= 0 && target <= 127
  ));
  if (samples.length === 0) return undefined;

  const actual = samples.map((sample) => sample.actual);
  const target = samples.map((sample) => sample.target);
  const actualMean = mean(actual);
  const targetMean = mean(target);
  const deltas = samples.map((sample) => sample.actual - sample.target);
  const bias = mean(deltas);
  const meanAbsError = mean(deltas.map(Math.abs));
  const residualMeanAbsError = mean(deltas.map((delta) => Math.abs(delta - bias)));
  const targetDeviation = standardDeviation(target, targetMean);

  let score: number | undefined;
  if (samples.length >= 4 && targetDeviation >= 4) {
    const actualDeviation = standardDeviation(actual, actualMean);
    const correlation = actualDeviation < 1
      ? 0
      : mean(samples.map((sample) => (
        (sample.actual - actualMean) * (sample.target - targetMean)
      ))) / (actualDeviation * targetDeviation);
    const contourScore = Math.max(0, correlation) * 100;
    const amplitudeScore = clamp(100 - (residualMeanAbsError / 24) * 100, 0, 100);
    score = Math.round(clamp(contourScore * 0.6 + amplitudeScore * 0.4, 0, 100) * 1_000) / 1_000;
  }

  return {
    samples: samples.length,
    actualMean,
    targetMean,
    bias,
    meanAbsError,
    residualMeanAbsError,
    score,
  };
}
