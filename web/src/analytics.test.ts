import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import {
  PracticeAnalytics,
  PracticeSessionStore,
  summarizePractice,
} from "./analytics";
import type { PracticeEvent } from "./analytics";

const databaseNames: string[] = [];

function store(): PracticeSessionStore {
  const name = `notefall-analytics-${Date.now()}-${Math.random()}`;
  databaseNames.push(name);
  return new PracticeSessionStore(name);
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  })));
});

describe("practice analytics", () => {
  const events: PracticeEvent[] = [
    { kind: "hit", note: 60, hand: "right", velocity: 80, scoreTime: 1, timingMs: -40 },
    { kind: "hit", note: 62, hand: "right", velocity: 100, scoreTime: 2, timingMs: 20 },
    { kind: "wrong", note: 61, velocity: 90, scoreTime: 2.1 },
    { kind: "hit", note: 60, hand: "right", velocity: 90, scoreTime: 3, timingMs: 100 },
    { kind: "missed", note: 64, hand: "right", scoreTime: 4 },
  ];

  it("computes timing, dynamics, streaks and problem notes", () => {
    expect(summarizePractice(events)).toEqual({
      hits: 3,
      wrong: 1,
      missed: 1,
      accuracy: 60,
      meanAbsTimingMs: 53.3,
      timingBiasMs: 26.7,
      p95AbsTimingMs: 100,
      velocityMean: 90,
      velocityStdDev: 8.2,
      bestStreak: 2,
      problemNotes: [
        { note: 61, hits: 0, errors: 1, errorRate: 100 },
        { note: 64, hits: 0, errors: 1, errorRate: 100 },
      ],
    });
  });

  it("separates relative dynamic contour from a consistent touch offset", () => {
    const expressive = [40, 60, 80, 100].map((targetVelocity, index): PracticeEvent => ({
      kind: "hit",
      note: 60 + index,
      hand: "right",
      velocity: targetVelocity + 10,
      targetVelocity,
      scoreTime: index,
      timingMs: 0,
    }));
    expect(summarizePractice(expressive)).toMatchObject({
      dynamicsSamples: 4,
      targetVelocityMean: 70,
      velocityBias: 10,
      meanAbsVelocityError: 10,
      dynamicsScore: 100,
    });
  });

  it("enriches a hit after key and pedal release without adding a fake attempt", () => {
    const analytics = new PracticeAnalytics({ scoreName: "Release", mode: "realtime", hand: "both", tempo: 1, transpose: 0 });
    const tokens = [60, 62, 64, 65].map((note, index) => analytics.record({
      kind: "hit",
      note,
      velocity: 80,
      scoreTime: index * 0.5,
      timingMs: 0,
    }));
    tokens.forEach((token) => expect(analytics.completeArticulation({
      token: token!,
      note: 60,
      targetDurationMs: 500,
      keyDurationMs: 500,
      soundingDurationMs: 500,
      sustained: false,
    })).toBe(true));
    expect(analytics.snapshot()).toMatchObject({
      hits: 4,
      articulationSamples: 4,
      durationCoverageScore: 100,
      releasePrecisionScore: 100,
      earlyReleaseRate: 0,
    });
    expect(analytics.eventsSnapshot()).toHaveLength(4);
    expect(analytics.completeArticulation({
      token: 99,
      note: 60,
      targetDurationMs: 500,
      keyDurationMs: 500,
      soundingDurationMs: 500,
      sustained: false,
    })).toBe(false);
  });

  it("finishes only non-empty sessions with immutable context", () => {
    const context = {
      scoreName: "Etude",
      scoreFingerprint: "a".repeat(64),
      mode: "realtime" as const,
      hand: "right" as const,
      tempo: 0.75,
      transpose: 2,
    };
    const analytics = new PracticeAnalytics(context, 1_000);
    expect(analytics.finish()).toBeUndefined();
    events.forEach((event) => analytics.record(event));
    context.scoreName = "mutated";
    const session = analytics.finish(4_000);
    expect(session).toMatchObject({
      elapsedMs: 3_000,
      context: { scoreName: "Etude", scoreFingerprint: "a".repeat(64) },
      summary: { accuracy: 60 },
    });
    expect(session?.events).not.toBe(events);
  });

  it("stores newest sessions first and exports a portable envelope", async () => {
    const history = store();
    for (const [name, endedAt] of [["First", 2_000], ["Second", 4_000]] as const) {
      const analytics = new PracticeAnalytics({ scoreName: name, mode: "wait", hand: "both", tempo: 1, transpose: 0 }, endedAt - 500);
      analytics.record({ kind: "hit", note: 60, velocity: 96, scoreTime: 0 });
      await history.save(analytics.finish(endedAt)!);
    }
    expect((await history.list()).map((session) => session.context.scoreName)).toEqual(["Second", "First"]);
    await expect(history.exportHistory()).resolves.toMatchObject({
      product: "NoteFall 88",
      version: 2,
      sessions: [{ context: { scoreName: "Second" } }, { context: { scoreName: "First" } }],
    });
  });

  it("rejects malformed score identities before persisting history", async () => {
    const history = store();
    const analytics = new PracticeAnalytics({
      scoreName: "Etude",
      scoreFingerprint: "not-a-sha256",
      mode: "wait",
      hand: "both",
      tempo: 1,
      transpose: 0,
    }, 1_000);
    analytics.record({ kind: "hit", note: 60, velocity: 96, scoreTime: 0 });
    await expect(history.save(analytics.finish(2_000)!)).rejects.toThrow(/练习记录无效/);
  });
});
