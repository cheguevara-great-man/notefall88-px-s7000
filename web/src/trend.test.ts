import { describe, expect, it } from "vitest";

import type { PracticeSession } from "./analytics";
import { practiceTrend } from "./trend";

function session(
  index: number,
  accuracy: number,
  timing?: number,
  dynamicsScore?: number,
  durationCoverageScore?: number,
  coordinationScore?: number,
): PracticeSession {
  return {
    id: `s${index}`, startedAt: index, endedAt: index * 10, elapsedMs: 10,
    context: { scoreName: "Etude", mode: "realtime", hand: "both", tempo: 1, transpose: 0 },
    summary: {
      hits: 10, wrong: 0, missed: 0, accuracy, meanAbsTimingMs: timing,
      dynamicsScore, durationCoverageScore, coordinationScore, bestStreak: 10, problemNotes: [],
    },
    events: [], droppedEvents: 0,
  };
}

describe("practice trend", () => {
  it("sorts attempts and compares stable early and late windows", () => {
    const trend = practiceTrend([
      session(4, 92, 55, 90, 95, 94), session(1, 70, 120, 40, 55, 50),
      session(3, 88, 70, 80, 90, 86), session(2, 78, 95, 60, 65, 62),
    ]);
    expect(trend.points.map((point) => point.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(trend.accuracyDelta).toBe(16);
    expect(trend.timingDeltaMs).toBe(45);
    expect(trend.dynamicsDelta).toBe(35);
    expect(trend.durationCoverageDelta).toBe(32.5);
    expect(trend.coordinationDelta).toBe(34);
    expect(trend.totalEvents).toBe(40);
  });

  it("does not infer progress from a single attempt", () => {
    const trend = practiceTrend([session(1, 88, 62)]);
    expect(trend.accuracyDelta).toBeUndefined();
    expect(trend.timingDeltaMs).toBeUndefined();
    expect(trend.dynamicsDelta).toBeUndefined();
    expect(trend.durationCoverageDelta).toBeUndefined();
    expect(trend.coordinationDelta).toBeUndefined();
  });
});
