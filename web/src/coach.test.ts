import { describe, expect, it } from "vitest";

import type { PracticeSession } from "./analytics";
import { recommendPractice } from "./coach";

function session(
  name: string,
  endedAt: number,
  events: PracticeSession["events"],
  tempo = 1,
  scoreFingerprint?: string,
): PracticeSession {
  const hits = events.filter((event) => event.kind === "hit").length;
  const wrong = events.filter((event) => event.kind === "wrong").length;
  const missed = events.filter((event) => event.kind === "missed").length;
  return {
    id: `${name}-${endedAt}`,
    startedAt: endedAt - 1_000,
    endedAt,
    elapsedMs: 1_000,
    context: { scoreName: name, scoreFingerprint, mode: "realtime", hand: "both", tempo, transpose: 0 },
    summary: {
      hits,
      wrong,
      missed,
      accuracy: hits / events.length * 100,
      meanAbsTimingMs: 140,
      bestStreak: 2,
      problemNotes: [],
    },
    events,
    droppedEvents: 0,
  };
}

describe("practice coach", () => {
  it("finds the hardest time window and weaker hand", () => {
    const history = [session("Etude", 2_000, [
      { kind: "hit", note: 48, hand: "left", velocity: 90, scoreTime: 2, timingMs: 10 },
      { kind: "missed", note: 50, hand: "left", scoreTime: 17 },
      { kind: "missed", note: 52, hand: "left", scoreTime: 19 },
      { kind: "wrong", note: 51, velocity: 80, scoreTime: 18 },
      { kind: "hit", note: 72, hand: "right", velocity: 90, scoreTime: 30, timingMs: 20 },
    ])];
    expect(recommendPractice(history, "Etude", 40)).toMatchObject({
      mode: "wait",
      hand: "left",
      tempo: 0.85,
      loop: { start: 12, end: 24 },
      confidence: "low",
      evidence: { sessions: 1, events: 5, accuracy: 40, errorsInLoop: 5 },
    });
  });

  it("raises tempo after accurate, tightly timed practice", () => {
    const events = Array.from({ length: 30 }, (_, index) => ({
      kind: "hit" as const,
      note: 60 + index % 5,
      hand: "right" as const,
      velocity: 90,
      scoreTime: index,
      timingMs: 20,
    }));
    const first = session("Scale", 2_000, events, 1);
    first.summary.meanAbsTimingMs = 20;
    const second = structuredClone(first);
    second.id = "second";
    second.endedAt = 3_000;
    expect(recommendPractice([second, first], "Scale", 35)).toMatchObject({
      mode: "realtime",
      hand: "right",
      tempo: 1.05,
      confidence: "medium",
      loop: undefined,
    });
  });

  it("does not infer a recommendation from another score", () => {
    expect(recommendPractice([session("Other", 1, [{ kind: "wrong", note: 60, velocity: 90, scoreTime: 0 }])], "Current", 10))
      .toBeUndefined();
  });

  it("does not mix different score contents that happen to share a title", () => {
    const firstFingerprint = "a".repeat(64);
    const secondFingerprint = "b".repeat(64);
    const history = [
      session("Sonata", 2, [{ kind: "wrong", note: 60, velocity: 90, scoreTime: 1 }], 1, firstFingerprint),
      session("Sonata", 1, [{ kind: "hit", note: 72, hand: "right", velocity: 90, scoreTime: 1, timingMs: 10 }], 1, secondFingerprint),
      // Legacy same-name data is deliberately excluded once an exact content identity exists.
      session("Sonata", 0, [{ kind: "wrong", note: 61, velocity: 90, scoreTime: 1 }]),
    ];
    expect(recommendPractice(history, "Sonata", 10, firstFingerprint)).toMatchObject({
      evidence: { sessions: 1, events: 1, accuracy: 0 },
    });
    expect(recommendPractice(history, "Sonata", 10, secondFingerprint)).toMatchObject({
      evidence: { sessions: 1, events: 1, accuracy: 100 },
    });
  });
});
