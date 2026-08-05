import type { Hand, HandSelection, MidiOutEvent, PracticeStats, ScoreNote, TargetNote } from "./types";

export interface Chord {
  start: number;
  notes: ScoreNote[];
}

export interface LoopRange {
  start: number;
  end: number;
}

export function filterNotesByHand(notes: ScoreNote[], hand: HandSelection): ScoreNote[] {
  return hand === "both" ? [...notes] : notes.filter((note) => note.hand === hand);
}

export function normalizeLoop(start: number, end: number, duration: number): LoopRange {
  const safeDuration = Math.max(0, duration);
  if (safeDuration === 0) return { start: 0, end: 0 };
  const minimum = Math.min(0.5, safeDuration);
  const safeStart = Math.min(Math.max(0, start), safeDuration - minimum);
  const safeEnd = Math.min(Math.max(safeStart + minimum, end), safeDuration);
  return { start: safeStart, end: safeEnd };
}

export function chordsInRange(chords: Chord[], range: LoopRange | undefined): Chord[] {
  if (!range) return [...chords];
  return chords.filter((chord) => chord.start >= range.start && chord.start < range.end);
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
  loop?: LoopRange,
): Chord | undefined {
  const earliest = scoreTime - 0.08;
  const latest = scoreTime + leadMs / 1000;
  const direct = chords.find((chord) => chord.start >= earliest && chord.start <= latest);
  if (direct || !loop || latest < loop.end) return direct;
  const wrappedLatest = loop.start + (latest - loop.end);
  return chords.find((chord) => chord.start >= loop.start && chord.start <= wrappedLatest);
}

export function targetNotes(chord: Chord | undefined): TargetNote[] {
  if (!chord) return [];
  const unique = new Map<number, TargetNote>();
  for (const note of chord.notes) unique.set(note.note, { note: note.note, hand: note.hand });
  return [...unique.values()].sort((a, b) => a.note - b.note);
}

export function followWaitMs(currentStart: number, nextStart: number, speed: number): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.max(0, Math.min(60000, Math.round(((nextStart - currentStart) / safeSpeed) * 1000)));
}

export function followAccompanimentEvents(
  notes: ScoreNote[],
  practicedHand: Hand,
  windowStart: number,
  windowEnd: number,
  speed: number,
): MidiOutEvent[] {
  return new FollowAccompanimentPlanner(notes).events(practicedHand, windowStart, windowEnd, speed);
}

interface IndexedFollowNote {
  note: ScoreNote;
  nextSamePitchStart: number;
}

export class FollowAccompanimentPlanner {
  private readonly byHand: Record<Hand, IndexedFollowNote[]>;

  constructor(notes: ScoreNote[]) {
    this.byHand = {
      left: this.indexHand(notes.filter((note) => note.hand === "left")),
      right: this.indexHand(notes.filter((note) => note.hand === "right")),
    };
  }

  private indexHand(notes: ScoreNote[]): IndexedFollowNote[] {
    const sorted = [...notes].sort((first, second) => first.start - second.start || first.note - second.note);
    const merged: ScoreNote[] = [];
    for (const note of sorted) {
      const previous = merged.at(-1);
      if (previous && previous.note === note.note && Math.abs(previous.start - note.start) <= 0.001) {
        previous.end = Math.max(previous.end, note.end);
        previous.velocity = Math.max(previous.velocity, note.velocity);
      } else {
        merged.push({ ...note });
      }
    }
    const nextByPitch = new Map<number, number>();
    const indexed = new Array<IndexedFollowNote>(merged.length);
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      const note = merged[index];
      indexed[index] = {
        note,
        nextSamePitchStart: nextByPitch.get(note.note) ?? Number.POSITIVE_INFINITY,
      };
      nextByPitch.set(note.note, note.start);
    }
    return indexed;
  }

  events(practicedHand: Hand, windowStart: number, windowEnd: number, speed: number): MidiOutEvent[] {
    const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
    const events: MidiOutEvent[] = [];
    const companion = this.byHand[practicedHand === "left" ? "right" : "left"];
    let low = 0;
    let high = companion.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (companion[middle].note.start < windowStart - 0.001) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < companion.length; index += 1) {
      const { note, nextSamePitchStart } = companion[index];
      if (note.start >= windowEnd - 0.001) break;
      const delayMs = Math.max(0, Math.round(((note.start - windowStart) / safeSpeed) * 1000));
      const effectiveEnd = Math.min(note.end, nextSamePitchStart);
      const durationMs = Math.max(
        35,
        Math.min(60000, Math.round(((effectiveEnd - note.start) / safeSpeed) * 1000)),
      );
      const velocity = Math.max(1, Math.min(127, Math.round(note.velocity || 96)));
      events.push({ delayMs, status: 0x90, data1: note.note, data2: velocity });
      events.push({ delayMs: delayMs + durationMs, status: 0x80, data1: note.note, data2: 0 });
    }
    return events.sort((first, second) => {
      if (first.delayMs !== second.delayMs) return first.delayMs - second.delayMs;
      const firstOff = (first.status & 0xf0) === 0x80;
      const secondOff = (second.status & 0xf0) === 0x80;
      return Number(secondOff) - Number(firstOff);
    });
  }
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

  noteOn(note: number): { complete: boolean; correct: boolean; newlyMatched: boolean } {
    const correct = this.expected.has(note);
    const newlyMatched = correct && !this.matched.has(note);
    if (correct) this.matched.add(note);
    else this.wrong.add(note);
    return {
      complete: this.expected.size > 0 && this.matched.size === this.expected.size,
      correct,
      newlyMatched,
    };
  }

  noteOff(note: number): void {
    this.wrong.delete(note);
  }

  expectedNotes(): Set<number> {
    return new Set(this.expected);
  }
}

export class PracticeScore {
  private hits = 0;
  private wrong = 0;
  private missed = 0;

  reset(): void {
    this.hits = 0;
    this.wrong = 0;
    this.missed = 0;
  }

  recordHit(): void {
    this.hits += 1;
  }

  recordWrong(): void {
    this.wrong += 1;
  }

  recordMiss(count = 1): void {
    this.missed += Math.max(0, count);
  }

  snapshot(): PracticeStats {
    const attempts = this.hits + this.wrong + this.missed;
    return {
      hits: this.hits,
      wrong: this.wrong,
      missed: this.missed,
      accuracy: attempts === 0 ? 100 : (this.hits / attempts) * 100,
    };
  }
}

export class RealtimeMatcher {
  private chords: Chord[] = [];
  private matched: Set<number>[] = [];
  private cursor = 0;

  constructor(
    private readonly score: PracticeScore,
    private readonly earlyMs = 180,
    private readonly lateMs = 250,
  ) {}

  setChords(chords: Chord[]): void {
    this.chords = chords;
    this.restartPass();
  }

  restartPass(): void {
    this.matched = this.chords.map(() => new Set<number>());
    this.cursor = 0;
  }

  noteOn(note: number, scoreTime: number): {
    correct: boolean;
    newlyMatched: boolean;
    matched?: ScoreNote;
    timingMs?: number;
    missed: ScoreNote[];
  } {
    const missed = this.advance(scoreTime);
    const earlySeconds = this.earlyMs / 1000;
    const lateSeconds = this.lateMs / 1000;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = this.cursor; index < this.chords.length; index += 1) {
      const chord = this.chords[index];
      if (chord.start > scoreTime + earlySeconds) break;
      if (chord.start < scoreTime - lateSeconds) continue;
      if (!chord.notes.some((candidate) => candidate.note === note)) continue;
      const distance = Math.abs(chord.start - scoreTime);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) {
      this.score.recordWrong();
      return { correct: false, newlyMatched: false, missed };
    }
    const matched = this.chords[bestIndex].notes.find((candidate) => candidate.note === note);
    if (this.matched[bestIndex].has(note)) return { correct: true, newlyMatched: false, matched, missed };
    this.matched[bestIndex].add(note);
    this.score.recordHit();
    return {
      correct: true,
      newlyMatched: true,
      matched,
      timingMs: Math.round((scoreTime - this.chords[bestIndex].start) * 1000),
      missed,
    };
  }

  advance(scoreTime: number): ScoreNote[] {
    const missedNotes: ScoreNote[] = [];
    const lateSeconds = this.lateMs / 1000;
    while (this.cursor < this.chords.length &&
           this.chords[this.cursor].start < scoreTime - lateSeconds) {
      const expected = new Set(this.chords[this.cursor].notes.map((note) => note.note));
      let missed = 0;
      for (const note of expected) {
        if (!this.matched[this.cursor].has(note)) {
          missed += 1;
          const source = this.chords[this.cursor].notes.find((candidate) => candidate.note === note);
          if (source) missedNotes.push(source);
        }
      }
      this.score.recordMiss(missed);
      this.cursor += 1;
    }
    return missedNotes;
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
