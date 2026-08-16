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

  it("holds back tempo and explains weak dynamics despite correct pitches", () => {
    const events = Array.from({ length: 12 }, (_, index) => ({
      kind: "hit" as const,
      note: 60 + index % 4,
      hand: "right" as const,
      velocity: 70,
      targetVelocity: 40 + (index % 4) * 20,
      scoreTime: index,
      timingMs: 20,
    }));
    const expressive = session("Dynamics", 2_000, events, 1);
    expressive.summary.meanAbsTimingMs = 20;
    expressive.summary.dynamicsScore = 25;
    const recommendation = recommendPractice([expressive], "Dynamics", 15)!;
    expect(recommendation).toMatchObject({
      tempo: 0.95,
      evidence: { dynamicsScore: 25 },
    });
    expect(recommendation.reason).toContain("力度轮廓 25%");
  });

  it("does not increase tempo while notes are being released too early", () => {
    const events = Array.from({ length: 12 }, (_, index) => ({
      kind: "hit" as const,
      note: 60 + index % 4,
      hand: "right" as const,
      velocity: 80,
      scoreTime: index,
      timingMs: 20,
    }));
    const clipped = session("Articulation", 2_000, events, 1);
    clipped.summary.meanAbsTimingMs = 20;
    clipped.summary.durationCoverageScore = 58;
    clipped.summary.releasePrecisionScore = 42;
    const recommendation = recommendPractice([clipped], "Articulation", 15)!;
    expect(recommendation).toMatchObject({
      tempo: 0.95,
      evidence: { durationCoverageScore: 58, releasePrecisionScore: 42 },
    });
    expect(recommendation.reason).toContain("时值覆盖 58%");
    expect(recommendation.reason).toContain("无踏板释放 42%");
  });

  it("holds tempo and explains loose chord and cross-hand synchronization", () => {
    const events = Array.from({ length: 12 }, (_, index) => ({
      kind: "hit" as const,
      note: 48 + index,
      hand: index % 2 ? "right" as const : "left" as const,
      velocity: 80,
      scoreTime: Math.floor(index / 2),
      timingMs: index % 2 ? 90 : 0,
    }));
    const loose = session("Chords", 2_000, events, 1);
    loose.summary.meanAbsTimingMs = 45;
    loose.summary.coordinationScore = 33;
    loose.summary.handAlignmentScore = 33;
    const recommendation = recommendPractice([loose], "Chords", 10)!;
    expect(recommendation).toMatchObject({
      tempo: 0.95,
      evidence: { coordinationScore: 33, handAlignmentScore: 33 },
    });
    expect(recommendation.reason).toContain("和弦整齐度 33%");
    expect(recommendation.reason).toContain("双手同步 33%");
  });

  it("keeps pedal remediation in realtime and blocks a tempo increase", () => {
    const events = Array.from({ length: 12 }, (_, index) => ({
      kind: "hit" as const, note: 60 + index % 4, hand: "right" as const,
      velocity: 80, scoreTime: index, timingMs: 20,
    }));
    const weakPedal = session("Pedal", 2_000, events, 1);
    weakPedal.summary.meanAbsTimingMs = 20;
    weakPedal.summary.pedalScore = 42;
    const recommendation = recommendPractice([weakPedal], "Pedal", 15)!;
    expect(recommendation).toMatchObject({
      mode: "realtime", tempo: 0.95, evidence: { pedalScore: 42 },
    });
    expect(recommendation.reason).toContain("谱面踏板 42%");
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

  it("sorts history itself before taking the current tempo", () => {
    const events = Array.from({ length: 20 }, (_, index) => ({
      kind: "hit" as const, note: 60, hand: "right" as const,
      velocity: 80, scoreTime: index, timingMs: 20,
    }));
    const old = session("Ordered", 1_000, events, 0.7);
    const recent = session("Ordered", 3_000, events, 1);
    old.summary.meanAbsTimingMs = 20;
    recent.summary.meanAbsTimingMs = 20;
    expect(recommendPractice([old, recent], "Ordered", 25)?.tempo).toBe(1.05);
  });

  it("does not raise tempo from a statistically tiny perfect sample", () => {
    const tiny = session("Tiny", 1_000, [
      { kind: "hit", note: 60, hand: "right", velocity: 80, scoreTime: 0, timingMs: 10 },
    ]);
    tiny.summary.meanAbsTimingMs = 10;
    expect(recommendPractice([tiny], "Tiny", 4)).toMatchObject({
      tempo: 1,
      confidence: "low",
      evidence: { accuracy: 100, accuracyLower95: 20.7 },
    });
  });

  it("weights expression evidence by actual samples instead of sessions", () => {
    const short = session("Weighted", 2_000, [
      { kind: "hit", note: 60, hand: "right", velocity: 80, scoreTime: 0, timingMs: 20 },
    ]);
    short.summary.dynamicsScore = 0;
    short.summary.dynamicsSamples = 1;
    short.summary.meanAbsTimingMs = 20;
    const complete = session("Weighted", 1_000, Array.from({ length: 99 }, (_, index) => ({
      kind: "hit" as const, note: 60, hand: "right" as const,
      velocity: 80, scoreTime: index, timingMs: 20,
    })));
    complete.summary.dynamicsScore = 100;
    complete.summary.dynamicsSamples = 99;
    complete.summary.meanAbsTimingMs = 20;
    expect(recommendPractice([short, complete], "Weighted", 100)).toMatchObject({
      tempo: 1.05,
      evidence: { dynamicsScore: 99 },
    });
  });

  it("deduplicates restored sessions and blocks automatic speed-up after dropped events", () => {
    const events = Array.from({ length: 40 }, (_, index) => ({
      kind: "hit" as const, note: 60, hand: "right" as const,
      velocity: 80, scoreTime: index, timingMs: 20,
    }));
    const incomplete = session("Dropped", 1_000, events);
    incomplete.droppedEvents = 2;
    incomplete.summary.meanAbsTimingMs = 20;
    const recommendation = recommendPractice([incomplete, structuredClone(incomplete)], "Dropped", 45)!;
    expect(recommendation).toMatchObject({
      tempo: 1,
      confidence: "low",
      evidence: { sessions: 1, events: 40, droppedEvents: 2 },
    });
    expect(recommendation.reason).toContain("本轮不自动升速");
  });

  it("prefers a persistently failing sparse passage over raw note density", () => {
    const dense = [
      ...Array.from({ length: 100 }, (_, index) => ({
        kind: "hit" as const, note: 60, hand: "right" as const,
        velocity: 80, scoreTime: index / 10, timingMs: 20,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        kind: "wrong" as const, note: 61, velocity: 80, scoreTime: 1 + index / 2,
      })),
      { kind: "hit" as const, note: 64, hand: "right" as const, velocity: 80, scoreTime: 20, timingMs: 20 },
      { kind: "hit" as const, note: 65, hand: "right" as const, velocity: 80, scoreTime: 21, timingMs: 20 },
      { kind: "missed" as const, note: 67, hand: "right" as const, scoreTime: 20.5 },
      { kind: "missed" as const, note: 69, hand: "right" as const, scoreTime: 21.5 },
      { kind: "missed" as const, note: 71, hand: "right" as const, scoreTime: 22.5 },
    ];
    expect(recommendPractice([session("Hotspot", 1_000, dense)], "Hotspot", 40)?.loop)
      .toEqual({ start: 16, end: 28 });
  });
});
