import { afterEach, describe, expect, it, vi } from "vitest";

import { createWaterfallSurface, nativeScoreBeats, nativeScoreNotes } from "./native-waterfall";

describe("native waterfall bridge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends only stable score fields to the platform renderer", () => {
    expect(nativeScoreNotes({
      name: "Bridge",
      duration: 2,
      format: "musicxml",
      beatMap: [{ time: 0, accent: true, beat: 1, measure: 1 }],
      notes: [{ note: 60, start: 0.25, end: 1.5, velocity: 99, hand: "right" }],
    })).toEqual([{ note: 60, start: 0.25, end: 1.5, hand: "right" }]);
  });

  it("clears the native score explicitly", () => {
    expect(nativeScoreNotes(undefined)).toEqual([]);
    expect(nativeScoreBeats(undefined)).toEqual([]);
  });

  it("keeps real beat and measure markers for the native timeline", () => {
    expect(nativeScoreBeats({
      name: "Markers", duration: 1, notes: [],
      beatMap: [{ time: 0, accent: true, beat: 1, measure: 1 }],
    })).toEqual([{ time: 0, accent: true, beat: 1, measure: 1 }]);
  });

  it("selects the native plugin and sends geometry, state, bounds and a low-rate clock", () => {
    const plugin = {
      setGeometry: vi.fn(async () => undefined),
      setScore: vi.fn(async () => undefined),
      setState: vi.fn(async () => undefined),
      setPlayback: vi.fn(async () => undefined),
      show: vi.fn(async () => undefined),
      hide: vi.fn(async () => undefined),
    };
    vi.stubGlobal("window", { Capacitor: { Plugins: { NativeWaterfall: plugin } } });
    vi.stubGlobal("performance", { now: () => 1_000 });
    const canvas = {
      style: { visibility: "" },
      getBoundingClientRect: () => ({ left: 12.25, top: 44.5, width: 900, height: 420 }),
    } as unknown as HTMLCanvasElement;

    const surface = createWaterfallSurface(canvas, true);
    expect(canvas.style.visibility).toBe("hidden");
    expect(plugin.setGeometry).toHaveBeenCalledWith({ keys: expect.arrayContaining([
      expect.objectContaining({ note: 21 }),
      expect.objectContaining({ note: 108 }),
    ]) });

    surface.setScore({
      name: "Native",
      duration: 1,
      notes: [{ note: 60, start: 0, end: 1, velocity: 80, hand: "right" }],
    });
    surface.setState(new Set([64, 60]), new Set([67]), new Set([64]));
    surface.setPracticeView("right", { start: 0.25, end: 0.75 });
    surface.render(0.4, true);

    expect(plugin.setScore).toHaveBeenCalledWith({
      notes: [{ note: 60, start: 0, end: 1, hand: "right" }], beats: [],
    });
    expect(plugin.setState).toHaveBeenLastCalledWith({
      pressed: [60, 64], expected: [67], wrong: [64], hand: "right", loopStart: 0.25, loopEnd: 0.75,
    });
    expect(plugin.show).toHaveBeenCalledWith({ left: 12.25, top: 44.5, width: 900, height: 420 });
    expect(plugin.setPlayback).toHaveBeenCalledWith({ scoreTime: 0.4, running: true });

    surface.setVisible(false);
    surface.render(0.5, true);
    expect(plugin.hide).toHaveBeenCalledOnce();
    expect(plugin.setPlayback).toHaveBeenCalledOnce();
  });
});
