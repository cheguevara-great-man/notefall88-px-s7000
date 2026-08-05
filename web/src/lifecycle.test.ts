import { describe, expect, it } from "vitest";
import { planBackgroundSuspension } from "./lifecycle";

describe("mobile page lifecycle", () => {
  it("pauses realtime playback and requires an intentional resume", () => {
    expect(planBackgroundSuspension({
      mode: "realtime",
      clockRunning: true,
      countInPending: false,
      followAdvancePending: false,
      recording: false,
    })).toEqual({
      pauseClock: true,
      cancelCountIn: false,
      cancelFollowAdvance: false,
      advanceCompletedFollowChord: false,
      stopRecording: false,
      requireManualResume: true,
    });
  });

  it("cancels delayed Follow output but preserves the completed chord", () => {
    expect(planBackgroundSuspension({
      mode: "follow",
      clockRunning: false,
      countInPending: false,
      followAdvancePending: true,
      recording: false,
    })).toMatchObject({
      cancelFollowAdvance: true,
      advanceCompletedFollowChord: true,
      requireManualResume: true,
    });
  });

  it("stops a recording even when no practice transport is active", () => {
    expect(planBackgroundSuspension({
      mode: "wait",
      clockRunning: false,
      countInPending: false,
      followAdvancePending: false,
      recording: true,
    })).toMatchObject({ stopRecording: true, requireManualResume: false });
  });
});
