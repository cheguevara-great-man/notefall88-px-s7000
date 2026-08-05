import { countInPlan } from "./beatmap";
import type { BeatMarker } from "./types";

const LOOKAHEAD_SECONDS = 0.12;

function firstBeatAfter(beats: BeatMarker[], time: number): number {
  let low = 0;
  let high = beats.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (beats[middle].time <= time + 1e-6) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function beatsToSchedule(
  beats: BeatMarker[],
  scoreTime: number,
  scoreHorizon: number,
  lastScheduled: number,
): BeatMarker[] {
  if (beats.length === 0 || scoreHorizon < scoreTime) return [];
  const start = firstBeatAfter(beats, Math.max(lastScheduled, scoreTime - 0.035));
  const result: BeatMarker[] = [];
  for (let index = start; index < beats.length; index += 1) {
    if (beats[index].time > scoreHorizon + 1e-6) break;
    result.push(beats[index]);
  }
  return result;
}

export class MetronomePlayer {
  private context?: AudioContext;
  private sources = new Set<OscillatorNode>();
  private lastScheduled = Number.NEGATIVE_INFINITY;
  private enabled = false;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  async unlock(): Promise<void> {
    const context = this.audioContext();
    if (context.state === "suspended") await context.resume();
  }

  reset(scoreTime = Number.NEGATIVE_INFINITY): void {
    this.cancel();
    this.lastScheduled = scoreTime - 0.001;
  }

  schedule(beats: BeatMarker[], scoreTime: number, speed: number): BeatMarker[] {
    if (!this.enabled || !(speed > 0)) return [];
    const context = this.audioContext();
    if (context.state !== "running") return [];
    const horizon = scoreTime + LOOKAHEAD_SECONDS * speed;
    const pending = beatsToSchedule(beats, scoreTime, horizon, this.lastScheduled);
    for (const beat of pending) {
      const when = context.currentTime + Math.max(0.004, (beat.time - scoreTime) / speed);
      this.clickAt(when, beat.accent);
      this.lastScheduled = Math.max(this.lastScheduled, beat.time);
    }
    return pending;
  }

  async scheduleCountIn(
    beats: BeatMarker[],
    scoreStart: number,
    speed: number,
  ): Promise<{ count: number; delayMs: number }> {
    await this.unlock();
    this.cancel();
    const plan = countInPlan(beats, scoreStart);
    const safeSpeed = speed > 0 ? speed : 1;
    const interval = plan.interval / safeSpeed;
    const start = this.audioContext().currentTime + 0.05;
    for (let index = 0; index < plan.count; index += 1) this.clickAt(start + index * interval, index === 0);
    return { count: plan.count, delayMs: Math.round((0.05 + plan.count * interval) * 1000) };
  }

  cancel(): void {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.sources.clear();
  }

  private audioContext(): AudioContext {
    this.context ??= new AudioContext({ latencyHint: "interactive" });
    return this.context;
  }

  private clickAt(when: number, accent: boolean): void {
    const context = this.audioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(accent ? 1_560 : 1_080, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.12 : 0.075, when + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(when);
    oscillator.stop(when + 0.05);
    this.sources.add(oscillator);
    oscillator.onended = () => this.sources.delete(oscillator);
  }
}
