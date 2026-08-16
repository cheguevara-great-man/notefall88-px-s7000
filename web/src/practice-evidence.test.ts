import { describe, expect, it } from "vitest";

import type { PracticeSession } from "./analytics";
import {
  accuracyEvidence,
  buildPracticeEvidence,
  selectPracticeSessions,
  weightedSummaryMetric,
} from "./practice-evidence";

function session(
  id: string,
  endedAt: number,
  hits: number,
  errors: number,
  extras: Partial<PracticeSession> = {},
): PracticeSession {
  const events: PracticeSession["events"] = [
    ...Array.from({ length: hits }, (_, index) => ({
      kind: "hit" as const, note: 60, velocity: 80, scoreTime: index, timingMs: 20,
    })),
    ...Array.from({ length: errors }, (_, index) => ({
      kind: "missed" as const, note: 62, scoreTime: hits + index,
    })),
  ];
  return {
    id,
    startedAt: endedAt - 1_000,
    endedAt,
    elapsedMs: 1_000,
    context: { scoreName: "Etude", scoreFingerprint: "abc", mode: "realtime", hand: "both", tempo: 1, transpose: 0 },
    summary: {
      hits, wrong: 0, missed: errors, accuracy: hits / Math.max(1, hits + errors) * 100,
      meanAbsTimingMs: 20, bestStreak: hits, problemNotes: [],
    },
    events,
    droppedEvents: 0,
    ...extras,
  };
}

describe("practice evidence", () => {
  it("uses a finite Wilson interval at the extremes", () => {
    expect(accuracyEvidence(0, 10)).toEqual({ hits: 0, attempts: 10, percent: 0, lower95: 0, upper95: 27.8 });
    expect(accuracyEvidence(10, 10)).toEqual({ hits: 10, attempts: 10, percent: 100, lower95: 72.2, upper95: 100 });
  });

  it("sorts newest first and deduplicates restored history", () => {
    const old = session("old", 1_000, 5, 1);
    const recent = session("recent", 3_000, 6, 0);
    expect(selectPracticeSessions([old, recent, structuredClone(recent)], "Etude", "abc").map(({ id }) => id))
      .toEqual(["recent", "old"]);
  });

  it("weights summary metrics by their contributing sample counts", () => {
    const short = session("short", 2_000, 1, 0);
    short.summary.dynamicsScore = 0;
    short.summary.dynamicsSamples = 1;
    const complete = session("complete", 1_000, 99, 0);
    complete.summary.dynamicsScore = 100;
    complete.summary.dynamicsSamples = 99;
    expect(weightedSummaryMetric([short, complete], "dynamicsScore")).toBe(99);
  });

  it("does not report high confidence when event capture was truncated", () => {
    const sessions = Array.from({ length: 5 }, (_, index) => session(String(index), index, 20, 0));
    sessions[0].droppedEvents = 1;
    expect(buildPracticeEvidence(sessions)).toMatchObject({
      confidence: "low", completeTelemetry: false, droppedEvents: 1,
    });
  });

  it("detects a credible improving trend and session consistency", () => {
    const sessions = [
      session("new-1", 6, 19, 1), session("new-2", 5, 18, 2), session("new-3", 4, 19, 1),
      session("old-1", 3, 12, 8), session("old-2", 2, 13, 7), session("old-3", 1, 12, 8),
    ];
    expect(buildPracticeEvidence(sessions)).toMatchObject({ trend: "improving", trendDelta: 31.6 });
  });
});
