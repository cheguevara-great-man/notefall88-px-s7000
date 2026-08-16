/**
 * Decides whether the visual surface needs display-refresh cadence or can
 * sleep between low-rate diagnostic heartbeats. Kept pure for deterministic
 * regression tests; the DOM scheduler in main.ts only performs the timers.
 */
export interface RenderActivity {
  clockRunning: boolean;
  demonstrationActive: boolean;
  recordingPlaybackActive: boolean;
  feedbackAnimationUntil: number;
}

export function requiresContinuousRendering(activity: RenderActivity, now: number): boolean {
  return activity.clockRunning
    || activity.demonstrationActive
    || activity.recordingPlaybackActive
    || now < activity.feedbackAnimationUntil;
}

export function shouldPaintVisual(
  activity: RenderActivity,
  now: number,
  dirty: boolean,
): boolean {
  return dirty || requiresContinuousRendering(activity, now);
}

/** Prevents 90/120/144 Hz panels from doubling Canvas work and battery use. */
export function animatedFrameDue(now: number, previousFrameAt: number, maximumFps = 60): boolean {
  if (!Number.isFinite(previousFrameAt)) return true;
  const safeFps = Math.max(15, Math.min(120, Number.isFinite(maximumFps) ? maximumFps : 60));
  // A small tolerance absorbs requestAnimationFrame timestamp quantization.
  return now - previousFrameAt >= 1_000 / safeFps - 1;
}
