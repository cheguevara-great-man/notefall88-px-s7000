import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { beatsToSchedule, MetronomePlayer } from "./metronome";
import type { BeatMarker } from "./types";

const beats: BeatMarker[] = [0, 0.5, 1, 1.5].map((time, index) => ({
  time,
  accent: index === 0,
  beat: index,
  measure: 0,
}));

describe("metronome scheduler", () => {
  it("schedules each beat exactly once inside the lookahead window", () => {
    expect(beatsToSchedule(beats, 0.4, 1.1, Number.NEGATIVE_INFINITY).map((beat) => beat.time)).toEqual([0.5, 1]);
    expect(beatsToSchedule(beats, 0.9, 1.6, 1).map((beat) => beat.time)).toEqual([1.5]);
  });

  it("does not replay a late or previously scheduled beat", () => {
    expect(beatsToSchedule(beats, 1.02, 1.4, 1)).toEqual([]);
  });
});

class FakeAudioParam {
  calls: Array<[string, number, number]> = [];

  setValueAtTime(value: number, time: number): void {
    this.calls.push(["set", value, time]);
  }

  exponentialRampToValueAtTime(value: number, time: number): void {
    this.calls.push(["ramp", value, time]);
  }
}

class FakeOscillator {
  type = "";
  frequency = new FakeAudioParam();
  onended: (() => void) | null = null;
  starts: number[] = [];
  stops: number[] = [];

  connect(node: unknown): unknown { return node; }
  start(time: number): void { this.starts.push(time); }
  stop(time?: number): void {
    this.stops.push(time ?? Number.NaN);
  }
}

class FakeGain {
  gain = new FakeAudioParam();
  connect(node: unknown): unknown { return node; }
}

class FakeAudioContext {
  static latest?: FakeAudioContext;
  state: AudioContextState = "running";
  currentTime = 10;
  destination = {};
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(async () => { this.state = "running"; });

  constructor() { FakeAudioContext.latest = this; }
  createOscillator(): OscillatorNode {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator as unknown as OscillatorNode;
  }
  createGain(): GainNode {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }
}

describe("metronome audio lifecycle", () => {
  beforeEach(() => vi.stubGlobal("AudioContext", FakeAudioContext));
  afterEach(() => vi.unstubAllGlobals());

  it("does not allocate audio until enabled and schedules accented clicks once", () => {
    const player = new MetronomePlayer();
    expect(player.schedule(beats, 0, 1)).toEqual([]);
    expect(FakeAudioContext.latest).toBeUndefined();

    player.setEnabled(true);
    const scheduled = player.schedule(beats, 0.4, 1);
    expect(scheduled.map((beat) => beat.time)).toEqual([0.5]);
    const context = FakeAudioContext.latest!;
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0].starts[0]).toBeCloseTo(10.1);
    expect(context.oscillators[0].frequency.calls[0][1]).toBe(1_080);

    expect(player.schedule(beats, 0.45, 1)).toEqual([]);
    player.setEnabled(false);
    expect(context.oscillators[0].stops).toHaveLength(2);
  });

  it("resumes suspended audio and creates a speed-adjusted count-in", async () => {
    const player = new MetronomePlayer();
    player.setEnabled(true);
    await player.unlock();
    const context = FakeAudioContext.latest!;
    context.state = "suspended";
    await player.unlock();
    expect(context.resume).toHaveBeenCalledOnce();

    const result = await player.scheduleCountIn(beats, 0.5, 2);
    expect(result).toEqual({ count: 4, delayMs: 1050 });
    expect(context.oscillators).toHaveLength(4);
    expect(context.oscillators[0].frequency.calls[0][1]).toBe(1_560);
    expect(context.oscillators[1].frequency.calls[0][1]).toBe(1_080);
  });

  it("refuses live scheduling while the browser audio context is suspended", () => {
    const player = new MetronomePlayer();
    player.setEnabled(true);
    void player.unlock();
    const context = FakeAudioContext.latest!;
    context.state = "suspended";
    expect(player.schedule(beats, 0.4, 1)).toEqual([]);
    expect(context.oscillators).toHaveLength(0);
  });
});
