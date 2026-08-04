import type { ScoreNote, TargetNote } from "./types";

export interface Chord {
  start: number;
  notes: ScoreNote[];
}

export function groupChords(notes: ScoreNote[], windowMs = 55): Chord[] {
  const windowSeconds = windowMs / 1000;
  const chords: Chord[] = [];
  for (const note of notes) {
    const previous = chords.at(-1);
    if (previous && note.start - previous.start <= windowSeconds) {
      previous.notes.push(note);
    } else {
      chords.push({ start: note.start, notes: [note] });
    }
  }
  return chords;
}

export function nextRealtimeChord(
  chords: Chord[],
  scoreTime: number,
  leadMs: number,
): Chord | undefined {
  const earliest = scoreTime - 0.08;
  const latest = scoreTime + leadMs / 1000;
  return chords.find((chord) => chord.start >= earliest && chord.start <= latest);
}

export function targetNotes(chord: Chord | undefined): TargetNote[] {
  if (!chord) return [];
  const unique = new Map<number, TargetNote>();
  for (const note of chord.notes) unique.set(note.note, { note: note.note, hand: note.hand });
  return [...unique.values()].sort((a, b) => a.note - b.note);
}

export class WaitMatcher {
  private expected = new Set<number>();
  private matched = new Set<number>();
  private wrong = new Set<number>();

  setChord(chord: Chord | undefined): void {
    this.expected = new Set(chord?.notes.map((note) => note.note) ?? []);
    this.matched.clear();
    this.wrong.clear();
  }

  noteOn(note: number): { complete: boolean; correct: boolean } {
    const correct = this.expected.has(note);
    if (correct) this.matched.add(note);
    else this.wrong.add(note);
    return { complete: this.expected.size > 0 && this.matched.size === this.expected.size, correct };
  }

  noteOff(note: number): void {
    this.wrong.delete(note);
  }

  expectedNotes(): Set<number> {
    return new Set(this.expected);
  }
}

export class ScoreClock {
  private anchorMs = 0;
  private anchorScore = 0;
  private running = false;
  speed = 1;

  play(nowMs: number): void {
    if (this.running) return;
    this.anchorMs = nowMs;
    this.running = true;
  }

  pause(nowMs: number): void {
    if (!this.running) return;
    this.anchorScore = this.time(nowMs);
    this.running = false;
  }

  reset(scoreTime = 0): void {
    this.anchorScore = scoreTime;
    this.anchorMs = performance.now();
    this.running = false;
  }

  seek(scoreTime: number, nowMs = performance.now()): void {
    this.anchorScore = Math.max(0, scoreTime);
    this.anchorMs = nowMs;
  }

  setSpeed(speed: number, nowMs: number): void {
    const current = this.time(nowMs);
    this.anchorScore = current;
    this.anchorMs = nowMs;
    this.speed = speed;
  }

  time(nowMs: number): number {
    if (!this.running) return this.anchorScore;
    return this.anchorScore + ((nowMs - this.anchorMs) / 1000) * this.speed;
  }

  isRunning(): boolean {
    return this.running;
  }
}
