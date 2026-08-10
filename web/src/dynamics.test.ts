import { describe, expect, it } from "vitest";

import { buildDynamicsProfile, normalizedDynamics } from "./dynamics";

describe("score dynamics visual profile", () => {
  it("retains absolute piano-to-forte meaning for flat scores", () => {
    const piano = buildDynamicsProfile(Array.from({ length: 8 }, () => ({ velocity: 36 })));
    const forte = buildDynamicsProfile(Array.from({ length: 8 }, () => ({ velocity: 116 })));
    expect(piano.flat).toBe(true);
    expect(forte.flat).toBe(true);
    expect(normalizedDynamics(116, forte) - normalizedDynamics(36, piano)).toBeGreaterThan(0.5);
  });

  it("adds local contrast without letting outliers flatten the piece", () => {
    const velocities = [1, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 127];
    const profile = buildDynamicsProfile(velocities.map((velocity) => ({ velocity })));
    expect(profile).toEqual({ low: 30, high: 120, flat: false });
    expect(normalizedDynamics(40, profile)).toBeLessThan(normalizedDynamics(100, profile));
  });

  it("clamps malformed values and provides a useful empty-score default", () => {
    const profile = buildDynamicsProfile([]);
    expect(normalizedDynamics(-50, profile)).toBe(0.08);
    expect(normalizedDynamics(999, profile)).toBe(0.95);
    expect(normalizedDynamics(Number.NaN, profile)).toBeGreaterThan(0.7);
  });
});
