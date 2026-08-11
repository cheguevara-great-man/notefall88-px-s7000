import { describe, expect, it } from "vitest";

import type { PracticeEvent, PracticeSession } from "./analytics";
import {
  assessPracticeMission,
  buildPracticeCircuit,
  loadPracticeCircuit,
  savePracticeCircuit,
} from "./practice-circuit";
import type { ParsedScore } from "./types";

const fingerprint = "a".repeat(64);
const score: ParsedScore = {
  name: "Circuit Etude",
  duration: 16,
  measureStarts: [0, 4, 8, 12],
  measureMap: [0, 1, 0, 1],
  notes: Array.from({ length: 32 }, (_, index) => ({
    note: 48 + index % 24,
    start: index * 0.5,
    end: index * 0.5 + 0.35,
    velocity: 90,
    hand: index % 2 ? "right" as const : "left" as const,
  })),
};

function makeSession(events: PracticeEvent[], overrides: Partial<PracticeSession["context"]> = {}, endedAt = 10_000): PracticeSession {
  const hits = events.filter((event) => event.kind === "hit").length;
  const wrong = events.filter((event) => event.kind === "wrong").length;
  const missed = events.filter((event) => event.kind === "missed").length;
  return {
    id: `session-${endedAt}`,
    startedAt: endedAt - 5_000,
    endedAt,
    elapsedMs: 5_000,
    context: {
      scoreName: score.name,
      scoreFingerprint: fingerprint,
      mode: "realtime",
      hand: "both",
      tempo: 1,
      transpose: 0,
      ...overrides,
    },
    summary: { hits, wrong, missed, accuracy: events.length ? hits / events.length * 100 : 100, bestStreak: hits, problemNotes: [] },
    events,
    droppedEvents: 0,
  };
}

function hit(note: number, scoreTime: number, hand: "left" | "right" = "right", timingMs = 30): PracticeEvent {
  return { kind: "hit", note, hand, velocity: 90, scoreTime, timingMs };
}

describe("adaptive weak-passage circuit", () => {
  it("ranks repeat-expanded weak passages, adds a lead-in measure and avoids overlapping missions", () => {
    const events: PracticeEvent[] = [
      hit(60, 0.5, "right", 20), hit(62, 1.5, "right", 25),
      { kind: "missed", note: 48, hand: "left", scoreTime: 4.5 },
      { kind: "missed", note: 50, hand: "left", scoreTime: 5.5 },
      { kind: "missed", note: 52, hand: "left", scoreTime: 6.5 },
      hit(67, 8.5, "right", 180), hit(69, 9.5, "right", 170),
      { kind: "wrong", note: 72, velocity: 80, scoreTime: 12.5 },
      { kind: "wrong", note: 74, velocity: 80, scoreTime: 13.5 },
    ];
    const circuit = buildPracticeCircuit([makeSession(events)], score, fingerprint, 123)!;
    expect(circuit.id).toBe(`${fingerprint}:123`);
    expect(circuit.missions[0]).toMatchObject({
      fromOccurrence: 0,
      throughOccurrence: 1,
      writtenMeasures: [1, 2],
      hand: "left",
      mode: "wait",
      requiredPasses: 2,
    });
    expect(circuit.missions).toHaveLength(2);
    expect(circuit.missions[1]).toMatchObject({ fromOccurrence: 2, throughOccurrence: 3 });
  });

  it("uses a faster whole-score consolidation challenge when recent evidence is already clean", () => {
    const events = Array.from({ length: 16 }, (_, index) => hit(60 + index % 5, index + 0.2, index % 2 ? "right" : "left", 12));
    const circuit = buildPracticeCircuit([makeSession(events, { tempo: 1 })], score, fingerprint)!;
    expect(circuit.missions).toHaveLength(1);
    expect(circuit.missions[0]).toMatchObject({
      id: "mission-consolidation",
      start: 0,
      end: 16,
      tempo: 1.05,
      targetAccuracy: 96,
      minimumEvents: 32,
      requiredPasses: 1,
    });
  });

  it("turns repeated early releases into a measurable passage mission", () => {
    const clipped = Array.from({ length: 8 }, (_, index): PracticeEvent => ({
      kind: "hit",
      note: 60 + index % 4,
      hand: "right",
      velocity: 80,
      scoreTime: 8.2 + index * 0.4,
      timingMs: 20,
      targetDurationMs: 500,
      keyDurationMs: 200,
      soundingDurationMs: 200,
      sustained: false,
    }));
    const circuit = buildPracticeCircuit([makeSession(clipped)], score, fingerprint)!;
    const mission = circuit.missions[0];
    expect(mission).toMatchObject({
      hand: "right",
      mode: "realtime",
      targetDurationCoverage: 85,
    });
    expect(mission.reason).toContain("提前收音");

    const context = {
      mode: mission.mode,
      hand: mission.hand,
      tempo: mission.tempo,
      loop: { start: mission.start, end: mission.end },
    };
    const attempt = Array.from({ length: mission.minimumEvents }, (_, index): PracticeEvent => ({
      kind: "hit",
      note: 60 + index % 4,
      hand: "right",
      velocity: 80,
      scoreTime: mission.start + 0.1 + index * (mission.end - mission.start - 0.2) / mission.minimumEvents,
      timingMs: 20,
      targetDurationMs: 500,
      keyDurationMs: 200,
      soundingDurationMs: 200,
      sustained: false,
    }));
    const assessment = assessPracticeMission(circuit, makeSession(attempt, context));
    expect(assessment).toMatchObject({
      outcome: "retry",
      accuracy: 100,
      durationCoverageScore: 40,
    });
    expect(assessment.message).toContain("时值覆盖需达到 85%");
  });

  it("can target a locally flattened dynamics contour without confusing touch bias", () => {
    const flattened = [40, 60, 80, 100, 40, 60, 80, 100].map((targetVelocity, index): PracticeEvent => ({
      kind: "hit",
      note: 60 + index % 4,
      hand: "right",
      velocity: 70,
      targetVelocity,
      scoreTime: 4.2 + index * 0.4,
      timingMs: 20,
    }));
    const history = makeSession(flattened);
    history.summary.velocityBias = 0;
    const circuit = buildPracticeCircuit([history], score, fingerprint)!;
    expect(circuit.missions[0]).toMatchObject({
      hand: "right",
      mode: "realtime",
      targetDynamicsScore: 70,
    });
    expect(circuit.missions[0].reason).toContain("强弱轮廓");
  });

  it("requires compatible settings, enough evidence and consecutive passes before advancing", () => {
    const weak = [
      { kind: "missed" as const, note: 48, hand: "left" as const, scoreTime: 4.5 },
      { kind: "missed" as const, note: 50, hand: "left" as const, scoreTime: 5.5 },
      hit(52, 6.5, "left"),
    ];
    let circuit = buildPracticeCircuit([makeSession(weak)], score, fingerprint)!;
    const mission = circuit.missions[0];
    const clean = Array.from({ length: mission.minimumEvents }, (_, index) => hit(48 + index, mission.start + 0.2 + index * 0.2, "left", 20));
    const wrongSettings = makeSession(clean, { mode: mission.mode, hand: mission.hand, tempo: mission.tempo });
    expect(assessPracticeMission(circuit, wrongSettings).outcome).toBe("invalid");

    const context = { mode: mission.mode, hand: mission.hand, tempo: mission.tempo, loop: { start: mission.start, end: mission.end } };
    const first = assessPracticeMission(circuit, makeSession(clean, context));
    expect(first.outcome).toBe("streak");
    expect(first.circuit.missions[0].consecutivePasses).toBe(1);
    circuit = first.circuit;

    const failed = assessPracticeMission(circuit, makeSession([
      ...clean.slice(0, mission.minimumEvents - 1),
      { kind: "missed", note: 70, hand: "left", scoreTime: mission.start + 1 },
      { kind: "missed", note: 71, hand: "left", scoreTime: mission.start + 1.2 },
    ], context));
    expect(failed.outcome).toBe("retry");
    expect(failed.circuit.missions[0].consecutivePasses).toBe(0);

    const passOne = assessPracticeMission(failed.circuit, makeSession(clean, context));
    const passTwo = assessPracticeMission(passOne.circuit, makeSession(clean, context));
    expect(["advanced", "completed"]).toContain(passTwo.outcome);
    expect(passTwo.circuit.activeIndex).toBe(1);
  });

  it("persists only the plan that belongs to the current score identity", () => {
    const events = [
      { kind: "missed" as const, note: 48, hand: "left" as const, scoreTime: 4.5 },
      { kind: "missed" as const, note: 50, hand: "left" as const, scoreTime: 5.5 },
    ];
    const circuit = buildPracticeCircuit([makeSession(events)], score, fingerprint)!;
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
    };
    savePracticeCircuit(circuit, storage);
    expect(loadPracticeCircuit(score.name, fingerprint, storage)).toEqual(circuit);
    expect(loadPracticeCircuit(score.name, "b".repeat(64), storage)).toBeUndefined();
    memory.set("notefall88.practice-circuit.v1", JSON.stringify({ ...circuit, activeIndex: 99 }));
    expect(loadPracticeCircuit(score.name, fingerprint, storage)).toBeUndefined();
  });

  it("does not mix legacy same-title data into fingerprinted plans", () => {
    const legacy = makeSession([
      { kind: "missed", note: 48, hand: "left", scoreTime: 4.5 },
      { kind: "missed", note: 50, hand: "left", scoreTime: 5.5 },
    ]);
    legacy.context.scoreFingerprint = undefined;
    expect(buildPracticeCircuit([legacy], score, fingerprint)).toBeUndefined();
  });
});
