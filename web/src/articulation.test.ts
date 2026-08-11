import { describe, expect, it } from "vitest";

import { ArticulationTracker, evaluateArticulation } from "./articulation";

describe("articulation evaluation", () => {
  it("scores sounding coverage separately from unpedalled release precision", () => {
    const result = evaluateArticulation([
      { targetDurationMs: 500, keyDurationMs: 500, soundingDurationMs: 500, sustained: false },
      { targetDurationMs: 500, keyDurationMs: 525, soundingDurationMs: 525, sustained: false },
      { targetDurationMs: 500, keyDurationMs: 475, soundingDurationMs: 475, sustained: false },
      { targetDurationMs: 500, keyDurationMs: 500, soundingDurationMs: 500, sustained: false },
    ]);
    expect(result).toMatchObject({
      samples: 4,
      unpedaledSamples: 4,
      pedalExtendedSamples: 0,
      earlyReleaseSamples: 0,
      durationCoverageScore: 98.75,
      releasePrecisionScore: 100,
      earlyReleaseRate: 0,
    });
  });

  it("reports early cuts and pedal overhang without calling the overhang wrong", () => {
    const result = evaluateArticulation([
      { targetDurationMs: 500, keyDurationMs: 200, soundingDurationMs: 200, sustained: false },
      { targetDurationMs: 500, keyDurationMs: 250, soundingDurationMs: 750, sustained: true },
      { targetDurationMs: 500, keyDurationMs: 500, soundingDurationMs: 500, sustained: false },
      { targetDurationMs: 500, keyDurationMs: 500, soundingDurationMs: 500, sustained: false },
    ]);
    expect(result).toMatchObject({
      samples: 4,
      unpedaledSamples: 3,
      pedalExtendedSamples: 1,
      earlyReleaseSamples: 1,
      durationCoverageScore: 85,
      earlyReleaseRate: 25,
      meanPedalExtensionMs: 500,
    });
    expect(result?.releasePrecisionScore).toBeUndefined();
  });

  it("rejects invalid and too-short targets and waits for four scored samples", () => {
    expect(evaluateArticulation([
      { targetDurationMs: 50, keyDurationMs: 50, soundingDurationMs: 50, sustained: false },
    ])).toBeUndefined();
    expect(evaluateArticulation([
      { targetDurationMs: 500, keyDurationMs: 500, soundingDurationMs: 500, sustained: false },
    ])?.durationCoverageScore).toBeUndefined();
  });
});

describe("articulation tracker", () => {
  it("finishes a normal key release immediately", () => {
    const tracker = new ArticulationTracker();
    expect(tracker.noteOn({ token: 3, note: 60, channel: 1, atMs: 100, targetDurationMs: 500 })).toEqual([]);
    expect(tracker.noteOff(60, 1, 620)).toEqual([{
      token: 3,
      note: 60,
      targetDurationMs: 500,
      keyDurationMs: 520,
      soundingDurationMs: 520,
      sustained: false,
    }]);
  });

  it("keeps physical release distinct while sustain extends sounding time", () => {
    const tracker = new ArticulationTracker();
    tracker.control(1, 64, 127, 0);
    tracker.noteOn({ token: 7, note: 64, channel: 1, atMs: 100, targetDurationMs: 600 });
    expect(tracker.noteOff(64, 1, 450)).toEqual([]);
    expect(tracker.control(1, 64, 0, 900)).toEqual([{
      token: 7,
      note: 64,
      targetDurationMs: 600,
      keyDurationMs: 350,
      soundingDurationMs: 800,
      sustained: true,
    }]);
  });

  it("closes a released sustained note when the same pitch is retriggered", () => {
    const tracker = new ArticulationTracker();
    tracker.control(1, 64, 127, 0);
    tracker.noteOn({ token: 1, note: 60, channel: 1, atMs: 100, targetDurationMs: 400 });
    tracker.noteOff(60, 1, 250);
    expect(tracker.noteOn({ token: 2, note: 60, channel: 1, atMs: 500, targetDurationMs: 400 })).toEqual([{
      token: 1,
      note: 60,
      targetDurationMs: 400,
      keyDurationMs: 150,
      soundingDurationMs: 400,
      sustained: true,
    }]);
  });

  it("drops an unmatched held note on panic instead of fabricating evidence", () => {
    const tracker = new ArticulationTracker();
    tracker.noteOn({ token: 9, note: 60, channel: 2, atMs: 100, targetDurationMs: 500 });
    expect(tracker.control(2, 123, 0, 300)).toEqual([]);
    expect(tracker.noteOff(60, 2, 600)).toEqual([]);
  });
});
