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
    expect(reviewBucketTone({ start: 0, end: 1, hits: 0, wrong: 0, missed: 0 })).toBe("empty");
    expect(reviewBucketTone({ start: 0, end: 1, hits: 1, wrong: 0, missed: 0 })).toBe("clean");
    expect(reviewBucketTone({ start: 0, end: 1, hits: 0, wrong: 1, missed: 0 })).toBe("warning");
    expect(reviewBucketTone({ start: 0, end: 1, hits: 0, wrong: 0, missed: 1 })).toBe("error");
  });
});
