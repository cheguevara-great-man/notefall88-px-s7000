import { describe, expect, it } from "vitest";

import { buildPracticeReview, reviewBucketTone } from "./review";

describe("practice review model", () => {
  it("bins events by score time and preserves timing direction", () => {
    const review = buildPracticeReview([
      { kind: "hit", note: 60, velocity: 80, scoreTime: 0.2, timingMs: -24 },
      { kind: "wrong", note: 61, velocity: 70, scoreTime: 1.8 },
      { kind: "missed", note: 62, scoreTime: 3.9 },
    ], 4, 4);
    expect(review.buckets.map(({ hits, wrong, missed }) => ({ hits, wrong, missed }))).toEqual([
      { hits: 1, wrong: 0, missed: 0 }, { hits: 0, wrong: 1, missed: 0 },
      { hits: 0, wrong: 0, missed: 0 }, { hits: 0, wrong: 0, missed: 1 },
    ]);
    expect(review.buckets[0].timingBiasMs).toBe(-24);
    expect(review.keys).toEqual([
      { note: 60, hits: 1, errors: 0 }, { note: 61, hits: 0, errors: 1 }, { note: 62, hits: 0, errors: 1 },
    ]);
  });

  it("uses calm, warning and error visual tones consistently", () => {
    const base = {
      start: 0, end: 1, durationSamples: 0, earlyReleaseSamples: 0,
      coordinationSamples: 0, looseChordSamples: 0,
      pedalTargets: 0, pedalHits: 0, pedalMissed: 0, pedalUnexpected: 0,
    };
    expect(reviewBucketTone({ ...base, hits: 0, wrong: 0, missed: 0 })).toBe("empty");
    expect(reviewBucketTone({ ...base, hits: 1, wrong: 0, missed: 0 })).toBe("clean");
    expect(reviewBucketTone({ ...base, hits: 0, wrong: 1, missed: 0 })).toBe("warning");
    expect(reviewBucketTone({ ...base, hits: 0, wrong: 0, missed: 1 })).toBe("error");
    expect(reviewBucketTone({ ...base, hits: 2, wrong: 0, missed: 0, meanAbsDynamicsError: 18 })).toBe("warning");
  });

  it("locates session-bias-corrected dynamics errors on the timeline", () => {
    const review = buildPracticeReview([
      { kind: "hit", note: 60, velocity: 40, targetVelocity: 40, scoreTime: 0.2 },
      { kind: "hit", note: 62, velocity: 100, targetVelocity: 60, scoreTime: 1.2 },
      { kind: "hit", note: 64, velocity: 80, targetVelocity: 80, scoreTime: 2.2 },
      { kind: "hit", note: 65, velocity: 100, targetVelocity: 100, scoreTime: 3.2 },
    ], 4, 4);
    expect(review.buckets.map((bucket) => bucket.meanAbsDynamicsError)).toEqual([10, 30, 10, 10]);
    expect(reviewBucketTone(review.buckets[1])).toBe("warning");
  });

  it("marks an early sounding release in its exact review bucket", () => {
    const review = buildPracticeReview([
      {
        kind: "hit", note: 60, velocity: 80, scoreTime: 0.2,
        targetDurationMs: 500, keyDurationMs: 250, soundingDurationMs: 250, sustained: false,
      },
      {
        kind: "hit", note: 62, velocity: 80, scoreTime: 1.2,
        targetDurationMs: 500, keyDurationMs: 500, soundingDurationMs: 500, sustained: false,
      },
    ], 2, 2);
    expect(review.buckets.map((bucket) => ({
      samples: bucket.durationSamples,
      early: bucket.earlyReleaseSamples,
      coverage: bucket.meanDurationCoverage,
    }))).toEqual([
      { samples: 1, early: 1, coverage: 50 },
      { samples: 1, early: 0, coverage: 100 },
    ]);
    expect(reviewBucketTone(review.buckets[0])).toBe("warning");
  });

  it("locates loose chords and signed hand lead on the timeline", () => {
    const review = buildPracticeReview([
      { kind: "hit", note: 48, hand: "left", velocity: 80, scoreTime: 0.2, timingMs: -20 },
      { kind: "hit", note: 72, hand: "right", velocity: 80, scoreTime: 0.2, timingMs: 60 },
      { kind: "hit", note: 50, hand: "left", velocity: 80, scoreTime: 1.2, timingMs: 5 },
      { kind: "hit", note: 74, hand: "right", velocity: 80, scoreTime: 1.2, timingMs: 20 },
    ], 2, 2);
    expect(review.buckets.map((bucket) => ({
      samples: bucket.coordinationSamples,
      loose: bucket.looseChordSamples,
      spread: bucket.meanChordSpreadMs,
      handOffset: bucket.meanHandOffsetMs,
    }))).toEqual([
      { samples: 1, loose: 1, spread: 80, handOffset: 80 },
      { samples: 1, loose: 0, spread: 15, handOffset: 15 },
    ]);
    expect(reviewBucketTone(review.buckets[0])).toBe("warning");
  });

  it("places missed and mistimed score pedal actions on the review timeline", () => {
    const review = buildPracticeReview([], 4, 4, [
      { pass: 0, scoreTime: 1.2, targetValue: 127, action: "down", status: "missed" },
      {
        pass: 0, scoreTime: 2.2, targetValue: 0, action: "up", status: "hit",
        actualScoreTime: 2.42, actualValue: 0, timingMs: 220,
      },
    ]);
    expect(review.buckets[1]).toMatchObject({ pedalTargets: 1, pedalMissed: 1 });
    expect(reviewBucketTone(review.buckets[1])).toBe("error");
    expect(review.buckets[2]).toMatchObject({ pedalHits: 1, meanAbsPedalTimingMs: 220 });
    expect(reviewBucketTone(review.buckets[2])).toBe("warning");
  });
});
