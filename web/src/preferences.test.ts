import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from "./preferences";

function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    value: () => value,
  };
}

describe("app preferences", () => {
  it("falls back safely for corrupt or future data", () => {
    expect(loadPreferences(storage("not-json"))).toEqual(DEFAULT_PREFERENCES);
    expect(loadPreferences(storage(JSON.stringify({ version: 2, mode: "realtime" })))).toEqual(DEFAULT_PREFERENCES);
  });

  it("normalizes ranges and an invalid Follow Me hand", () => {
    const source = storage(JSON.stringify({
      version: 1, mode: "follow", hand: "both", tempo: 9, leadMs: 9_999, previewSeconds: 7, metronome: true, countIn: false,
    }));
    expect(loadPreferences(source)).toEqual({
      version: 1, mode: "follow", hand: "right", tempo: 1, leadMs: 2_000, previewSeconds: 6.5, metronome: true, countIn: false,
    });
  });

  it("round-trips supported values", () => {
    const target = storage();
    savePreferences({ version: 1, mode: "realtime", hand: "left", tempo: 0.75, leadMs: 1_200, previewSeconds: 2.8, metronome: true, countIn: true }, target);
    expect(loadPreferences(target)).toMatchObject({ mode: "realtime", hand: "left", tempo: 0.75, leadMs: 1_200, previewSeconds: 2.8, metronome: true });
  });

  it("migrates existing v1 preferences to the standard visual horizon", () => {
    const source = storage(JSON.stringify({
      version: 1, mode: "wait", hand: "both", tempo: 1, leadMs: 900, metronome: false, countIn: true,
    }));
    expect(loadPreferences(source).previewSeconds).toBe(4.2);
  });

  it("persists five-percent tempo steps across the full practice range", () => {
    const target = storage();
    savePreferences({ version: 1, mode: "wait", hand: "both", tempo: 0.35, leadMs: 900, previewSeconds: 4.2, metronome: false, countIn: true }, target);
    expect(loadPreferences(target).tempo).toBeCloseTo(0.35);
    savePreferences({ version: 1, mode: "wait", hand: "both", tempo: 2, leadMs: 900, previewSeconds: 4.2, metronome: false, countIn: true }, target);
    expect(loadPreferences(target).tempo).toBe(2);
  });
});
