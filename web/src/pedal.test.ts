import { describe, expect, it } from "vitest";
import { evaluatePedal, summarizePedalAssessments } from "./pedal";
import type { PedalAssessment, PedalControlSample } from "./pedal";
import type { ScorePedalEvent } from "./types";

const targets: ScorePedalEvent[] = [
  { time: 1, value: 127, action: "down" },
  { time: 3, value: 0, action: "up" },
];

function controls(...items: Array<[number, number]>): PedalControlSample[] {
  return items.map(([scoreTime, value]) => ({ scoreTime, value, pass: 0 }));
}

describe("pedal evaluation", () => {
  it("scores symbolic down/up edges with tempo-correct timing", () => {
    const result = evaluatePedal(targets, controls([1.05, 127], [3.05, 0]), 0.5)!;
    expect(result).toMatchObject({ targets: 2, matched: 2, missed: 0, unexpected: 0, accuracy: 100 });
    expect(result.meanAbsTimingMs).toBe(100);
    expect(result.timingBiasMs).toBe(100);
    expect(result.pedalScore).toBeCloseTo(95, 0);
  });

  it("reports missed targets and extra state edges without punishing continuous samples", () => {
    const result = evaluatePedal(targets, controls([0.8, 90], [1.1, 110], [1.3, 40], [1.5, 100]), 1)!;
    expect(result).toMatchObject({ targets: 2, matched: 1, missed: 1, unexpected: 2, accuracy: 25 });
    expect(result.assessments.filter((item) => item.status === "unexpected")).toHaveLength(2);
  });

  it("keeps numeric half-pedal precision", () => {
    const result = evaluatePedal([
      { time: 1, value: 64, action: "level" },
      { time: 2, value: 32, action: "level" },
    ], controls([1.02, 70], [2.02, 28]), 1)!;
    expect(result.meanAbsValueError).toBe(5);
    expect(result.matched).toBe(2);
    expect(result.pedalScore).toBeGreaterThan(95);
  });

  it("isolates physical loop passes", () => {
    const passOne = controls([1, 127], [3, 0]).map((sample) => ({ ...sample, pass: 1 }));
    expect(evaluatePedal(targets, passOne, 1, 0)!.matched).toBe(0);
    expect(evaluatePedal(targets, passOne, 1, 1)!.pedalScore).toBe(100);
  });

  it("does not publish a composite score from one target", () => {
    expect(evaluatePedal(targets.slice(0, 1), controls([1, 127]), 1)!.pedalScore).toBeUndefined();
  });

  it("aggregates pass assessments without cross-pass matching", () => {
    const assessments: PedalAssessment[] = [
      ...evaluatePedal(targets, controls([1, 127], [3, 0]), 1, 0)!.assessments,
      ...evaluatePedal(targets, controls([1.1, 127], [3.1, 0]).map((item) => ({ ...item, pass: 1 })), 1, 1)!.assessments,
    ];
    const result = summarizePedalAssessments(assessments);
    expect(result).toMatchObject({ targets: 4, matched: 4, unexpected: 0, accuracy: 100 });
    expect(result.meanAbsTimingMs).toBe(50);
  });
});
