import type { PracticeEvent } from "./analytics";
import { evaluateDynamics } from "./expression";

export interface ReviewBucket {
  start: number;
  end: number;
  hits: number;
  wrong: number;
  missed: number;
  timingBiasMs?: number;
  meanAbsDynamicsError?: number;
  durationSamples: number;
  earlyReleaseSamples: number;
  meanDurationCoverage?: number;
}

export interface KeyReview {
  note: number;
  hits: number;
  errors: number;
}

export interface PracticeReview {
  buckets: ReviewBucket[];
  keys: KeyReview[];
}

/**
 * Turns raw practice events into stable visual data. Rendering consumes only this
 * model, so a completed-session review and the live review cannot drift apart.
 */
export function buildPracticeReview(events: PracticeEvent[], duration: number, bucketCount = 24): PracticeReview {
  const safeDuration = Math.max(0.001, duration);
  const count = Math.max(1, Math.min(96, Math.floor(bucketCount)));
  const span = safeDuration / count;
  const buckets = Array.from({ length: count }, (_, index): ReviewBucket => ({
    start: index * span,
    end: (index + 1) * span,
    hits: 0,
    wrong: 0,
    missed: 0,
    durationSamples: 0,
    earlyReleaseSamples: 0,
  }));
  const timingTotals = Array.from({ length: count }, () => ({ total: 0, count: 0 }));
  const dynamics = evaluateDynamics(events.flatMap((event) => (
    event.kind === "hit" && event.targetVelocity !== undefined
      ? [{ actual: event.velocity, target: event.targetVelocity }]
      : []
  )));
  const dynamicsTotals = Array.from({ length: count }, () => ({ total: 0, count: 0 }));
  const durationTotals = Array.from({ length: count }, () => ({ total: 0, count: 0 }));
  const byKey = new Map<number, KeyReview>();
  for (const event of events) {
    const index = Math.max(0, Math.min(count - 1, Math.floor(event.scoreTime / span)));
    const bucket = buckets[index];
    const key = byKey.get(event.note) ?? { note: event.note, hits: 0, errors: 0 };
    if (event.kind === "hit") {
      bucket.hits += 1;
      key.hits += 1;
      if (event.timingMs !== undefined && Number.isFinite(event.timingMs)) {
        timingTotals[index].total += event.timingMs;
        timingTotals[index].count += 1;
      }
      if (dynamics && event.targetVelocity !== undefined && Number.isFinite(event.targetVelocity)) {
        dynamicsTotals[index].total += Math.abs((event.velocity - event.targetVelocity) - dynamics.bias);
        dynamicsTotals[index].count += 1;
      }
      if (event.targetDurationMs !== undefined && event.soundingDurationMs !== undefined
          && event.targetDurationMs >= 60 && event.soundingDurationMs >= 0) {
        const coverage = Math.max(0, Math.min(1, event.soundingDurationMs / event.targetDurationMs));
        durationTotals[index].total += coverage;
        durationTotals[index].count += 1;
        bucket.durationSamples += 1;
        if (coverage < 0.8) bucket.earlyReleaseSamples += 1;
      }
    } else if (event.kind === "wrong") {
      bucket.wrong += 1;
      key.errors += 1;
    } else {
      bucket.missed += 1;
      key.errors += 1;
    }
    byKey.set(event.note, key);
  }
  buckets.forEach((bucket, index) => {
    const timing = timingTotals[index];
    if (timing.count > 0) bucket.timingBiasMs = Math.round(timing.total / timing.count);
    const expression = dynamicsTotals[index];
    if (expression.count > 0) bucket.meanAbsDynamicsError = Math.round(expression.total / expression.count);
    const duration = durationTotals[index];
    if (duration.count > 0) bucket.meanDurationCoverage = Math.round(duration.total / duration.count * 100);
  });
  return {
    buckets,
    keys: [...byKey.values()].sort((a, b) => a.note - b.note),
  };
}

export function reviewBucketTone(bucket: ReviewBucket): "clean" | "warning" | "error" | "empty" {
  const errors = bucket.wrong + bucket.missed;
  if (errors > 0) return errors >= 2 || bucket.missed > 0 ? "error" : "warning";
  if (bucket.earlyReleaseSamples > 0) return "warning";
  if ((bucket.meanAbsDynamicsError ?? 0) >= 16) return "warning";
  return bucket.hits > 0 ? "clean" : "empty";
}
