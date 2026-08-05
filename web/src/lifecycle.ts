import type { PracticeMode } from "./types";

export interface BackgroundState {
  mode: PracticeMode;
  clockRunning: boolean;
  countInPending: boolean;
  followAdvancePending: boolean;
  recording: boolean;
}

export interface BackgroundSuspension {
  pauseClock: boolean;
  cancelCountIn: boolean;
  cancelFollowAdvance: boolean;
  advanceCompletedFollowChord: boolean;
  stopRecording: boolean;
  requireManualResume: boolean;
}

/**
 * Browser background throttling is nondeterministic, especially on iOS.  Turn
 * the current activity into an explicit suspension plan instead of allowing
 * delayed timers and wall-clock score time to decide what happened.
 */
export function planBackgroundSuspension(state: BackgroundState): BackgroundSuspension {
  return {
    pauseClock: state.clockRunning,
    cancelCountIn: state.countInPending,
    cancelFollowAdvance: state.followAdvancePending,
    advanceCompletedFollowChord: state.mode === "follow" && state.followAdvancePending,
    stopRecording: state.recording,
    requireManualResume: state.clockRunning || state.countInPending || state.followAdvancePending,
  };
}
