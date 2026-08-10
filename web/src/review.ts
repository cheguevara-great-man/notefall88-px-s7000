import type { PracticeEvent } from "./analytics";

export interface ReviewBucket {
  start: number;
  end: number;
  hits: number;
  wrong: number;
  missed: number;
  timingBiasMs?: number;
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
    start: index * span, end: (index + 1) * span, hits: 0, wrong: 0, missed: 0,
  }));
  const timingTotals = Array.from({ length: count }, () => ({ total: 0, count: 0 }));
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
  });
  return {
    buckets,
    keys: [...byKey.values()].sort((a, b) => a.note - b.note),
  };
}

export function reviewBucketTone(bucket: ReviewBucket): "clean" | "warning" | "error" | "empty" {
  const errors = bucket.wrong + bucket.missed;
  if (errors > 0) return errors >= 2 || bucket.missed > 0 ? "error" : "warning";
  return bucket.hits > 0 ? "clean" : "empty";
}
