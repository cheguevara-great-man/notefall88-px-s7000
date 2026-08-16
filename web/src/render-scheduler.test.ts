import { describe, expect, it } from "vitest";

import { animatedFrameDue, requiresContinuousRendering, shouldPaintVisual } from "./render-scheduler";

const idle = {
  clockRunning: false,
  demonstrationActive: false,
  recordingPlaybackActive: false,
  feedbackAnimationUntil: 0,
};

describe("render scheduler", () => {
  it("lets a clean, paused practice screen sleep", () => {
    expect(requiresContinuousRendering(idle, 10_000)).toBe(false);
    expect(shouldPaintVisual(idle, 10_000, false)).toBe(false);
  });

  it("paints one dirty frame without entering a continuous loop", () => {
    expect(shouldPaintVisual(idle, 10_000, true)).toBe(true);
    expect(requiresContinuousRendering(idle, 10_000)).toBe(false);
  });

  it.each(["clockRunning", "demonstrationActive", "recordingPlaybackActive"] as const)(
    "keeps display cadence while %s is active",
    (key) => expect(requiresContinuousRendering({ ...idle, [key]: true }, 10_000)).toBe(true),
  );

  it("keeps short feedback animation alive and sleeps at its exact deadline", () => {
    const activity = { ...idle, feedbackAnimationUntil: 10_950 };
    expect(requiresContinuousRendering(activity, 10_949.9)).toBe(true);
    expect(requiresContinuousRendering(activity, 10_950)).toBe(false);
  });

  it("caps expensive painting near 60 fps on a 120 Hz display", () => {
    expect(animatedFrameDue(1_008.3, 1_000)).toBe(false);
    expect(animatedFrameDue(1_016, 1_000)).toBe(true);
    expect(animatedFrameDue(1_000, Number.NEGATIVE_INFINITY)).toBe(true);
  });
});
