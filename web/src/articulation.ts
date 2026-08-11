export interface ArticulationStart {
  token: number;
  note: number;
  channel: number;
  atMs: number;
  targetDurationMs: number;
}

export interface ArticulationCompletion {
  token: number;
  note: number;
  targetDurationMs: number;
  keyDurationMs: number;
  soundingDurationMs: number;
  sustained: boolean;
}

export interface ArticulationSample {
  targetDurationMs: number;
  keyDurationMs: number;
  soundingDurationMs: number;
  sustained: boolean;
}

export interface ArticulationEvaluation {
  samples: number;
  unpedaledSamples: number;
  pedalExtendedSamples: number;
  earlyReleaseSamples: number;
  durationCoverageScore?: number;
  releasePrecisionScore?: number;
  earlyReleaseRate: number;
  meanKeyDurationRatio: number;
  meanSoundingDurationRatio: number;
  meanPedalExtensionMs?: number;
}

interface ActiveArticulation extends ArticulationStart {
  releasedAtMs?: number;
}

const MIN_TARGET_DURATION_MS = 60;
const MIN_SCORE_SAMPLES = 4;
const EARLY_RELEASE_RATIO = 0.8;
const RELEASE_TOLERANCE_RATIO = 1.15;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function key(channel: number, note: number): string {
  return `${channel}:${note}`;
}

function validClock(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function releaseScore(actualMs: number, targetMs: number): number {
  const ratio = clamp(actualMs / targetMs, 0.01, 100);
  const error = Math.abs(Math.log2(ratio));
  const tolerance = Math.log2(RELEASE_TOLERANCE_RATIO);
  if (error <= tolerance) return 100;
  return clamp(100 * (1 - (error - tolerance) / (1 - tolerance)), 0, 100);
}

/**
 * Separates three facts that conventional piano-app scores tend to conflate:
 * physical key release, sounding release under CC64, and the score's target
 * duration. Pedalled oversustain is reported, but is not silently labelled as
 * bad articulation because the score may not contain reliable pedal markings.
 */
export function evaluateArticulation(samples: ArticulationSample[]): ArticulationEvaluation | undefined {
  const valid = samples.filter((sample) => (
    Number.isFinite(sample.targetDurationMs)
      && sample.targetDurationMs >= MIN_TARGET_DURATION_MS
      && validClock(sample.keyDurationMs)
      && validClock(sample.soundingDurationMs)
      && sample.soundingDurationMs + 0.001 >= sample.keyDurationMs
  ));
  if (valid.length === 0) return undefined;

  const coverage = valid.map((sample) => clamp(sample.soundingDurationMs / sample.targetDurationMs, 0, 1));
  const keyRatios = valid.map((sample) => sample.keyDurationMs / sample.targetDurationMs);
  const soundingRatios = valid.map((sample) => sample.soundingDurationMs / sample.targetDurationMs);
  const unpedaled = valid.filter((sample) => !sample.sustained);
  const pedalled = valid.filter((sample) => sample.sustained);
  const earlyReleaseSamples = soundingRatios.filter((ratio) => ratio < EARLY_RELEASE_RATIO).length;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    samples: valid.length,
    unpedaledSamples: unpedaled.length,
    pedalExtendedSamples: pedalled.length,
    earlyReleaseSamples,
    durationCoverageScore: valid.length >= MIN_SCORE_SAMPLES ? mean(coverage) * 100 : undefined,
    releasePrecisionScore: unpedaled.length >= MIN_SCORE_SAMPLES
      ? mean(unpedaled.map((sample) => releaseScore(sample.keyDurationMs, sample.targetDurationMs)))
      : undefined,
    earlyReleaseRate: earlyReleaseSamples / valid.length * 100,
    meanKeyDurationRatio: mean(keyRatios),
    meanSoundingDurationRatio: mean(soundingRatios),
    meanPedalExtensionMs: pedalled.length > 0
      ? mean(pedalled.map((sample) => sample.soundingDurationMs - sample.keyDurationMs))
      : undefined,
  };
}

/** Tracks overlapping same-pitch notes and sustain without relying on arrival order. */
export class ArticulationTracker {
  private readonly active = new Map<string, ActiveArticulation[]>();
  private readonly sustain = new Map<number, boolean>();

  noteOn(start: ArticulationStart): ArticulationCompletion[] {
    if (!Number.isInteger(start.token) || !Number.isInteger(start.note) || !Number.isInteger(start.channel)
        || !validClock(start.atMs) || !(start.targetDurationMs >= MIN_TARGET_DURATION_MS)) return [];
    const noteKey = key(start.channel, start.note);
    const queue = this.active.get(noteKey) ?? [];
    const completed: ArticulationCompletion[] = [];
    const remaining: ActiveArticulation[] = [];
    for (const candidate of queue) {
      if (candidate.releasedAtMs !== undefined) completed.push(this.finish(candidate, start.atMs));
      // A second Note On before Note Off means the first release was lost. Do
      // not fabricate a duration for it; discard it deterministically.
    }
    remaining.push({ ...start });
    this.active.set(noteKey, remaining);
    return completed;
  }

  noteOff(note: number, channel: number, atMs: number): ArticulationCompletion[] {
    if (!Number.isInteger(note) || !Number.isInteger(channel) || !validClock(atMs)) return [];
    const noteKey = key(channel, note);
    const queue = this.active.get(noteKey);
    const candidate = queue?.find((entry) => entry.releasedAtMs === undefined);
    if (!candidate) return [];
    candidate.releasedAtMs = Math.max(candidate.atMs, atMs);
    if (this.sustain.get(channel)) return [];
    this.remove(noteKey, candidate);
    return [this.finish(candidate, candidate.releasedAtMs)];
  }

  control(channel: number, controller: number, value: number, atMs: number): ArticulationCompletion[] {
    if (!Number.isInteger(channel) || !Number.isInteger(controller) || !Number.isFinite(value) || !validClock(atMs)) return [];
    if (controller === 64) {
      const down = value >= 64;
      const wasDown = this.sustain.get(channel) ?? false;
      this.sustain.set(channel, down);
      return wasDown && !down ? this.releaseSustained(channel, atMs) : [];
    }
    if (controller === 120 || controller === 123) this.clearActive(channel);
    return [];
  }

  clearActive(channel?: number): void {
    if (channel === undefined) {
      this.active.clear();
      return;
    }
    for (const [noteKey, queue] of this.active) {
      const remaining = queue.filter((candidate) => candidate.channel !== channel);
      if (remaining.length === 0) this.active.delete(noteKey);
      else this.active.set(noteKey, remaining);
    }
  }

  reset(): void {
    this.active.clear();
    this.sustain.clear();
  }

  private releaseSustained(channel: number, atMs: number): ArticulationCompletion[] {
    const completed: ArticulationCompletion[] = [];
    for (const [noteKey, queue] of this.active) {
      for (const candidate of [...queue]) {
        if (candidate.channel !== channel || candidate.releasedAtMs === undefined) continue;
        completed.push(this.finish(candidate, Math.max(candidate.releasedAtMs, atMs)));
        this.remove(noteKey, candidate);
      }
    }
    return completed.sort((first, second) => first.token - second.token);
  }

  private finish(candidate: ActiveArticulation, soundingEndMs: number): ArticulationCompletion {
    const releasedAtMs = candidate.releasedAtMs ?? soundingEndMs;
    return {
      token: candidate.token,
      note: candidate.note,
      targetDurationMs: candidate.targetDurationMs,
      keyDurationMs: Math.max(0, releasedAtMs - candidate.atMs),
      soundingDurationMs: Math.max(0, soundingEndMs - candidate.atMs),
      sustained: soundingEndMs > releasedAtMs + 0.001,
    };
  }

  private remove(noteKey: string, candidate: ActiveArticulation): void {
    const queue = this.active.get(noteKey);
    if (!queue) return;
    const remaining = queue.filter((entry) => entry !== candidate);
    if (remaining.length === 0) this.active.delete(noteKey);
    else this.active.set(noteKey, remaining);
  }
}
