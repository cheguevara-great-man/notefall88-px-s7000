import type { HandSelection, MidiOutEvent, ScoreNote, ScorePedalEvent } from "./types";

const SAME_ONSET_SECONDS = 0.001;

interface IndexedNote {
  note: ScoreNote;
  hands: Set<ScoreNote["hand"]>;
  nextSamePitchStart: number;
}

function selected(note: IndexedNote, hand: HandSelection): boolean {
  return hand === "both" || note.hands.has(hand);
}

function eventPriority(event: MidiOutEvent): number {
  const kind = event.status & 0xf0;
  if (kind === 0xb0 && event.data1 === 64 && event.data2 < 64) return 0;
  if (kind === 0x80 || (kind === 0x90 && event.data2 === 0)) return 1;
  if (kind === 0xb0) return 2;
  return 3;
}

/**
 * Builds short, timestamped preview windows for the piano's own sound engine.
 * The browser streams bounded look-ahead windows; the ESP remains the sole
 * MIDI-OUT owner and can panic immediately on pause, backgrounding or loss.
 */
export class DemonstrationPlanner {
  private readonly notes: IndexedNote[];
  private readonly pedals: ScorePedalEvent[];

  constructor(notes: ScoreNote[], pedals: ScorePedalEvent[] = []) {
    const merged: Array<{ note: ScoreNote; hands: Set<ScoreNote["hand"]> }> = [];
    for (const note of [...notes].sort((a, b) => a.start - b.start || a.note - b.note || a.end - b.end)) {
      if (!Number.isInteger(note.note) || note.note < 0 || note.note > 127
          || !Number.isFinite(note.start) || !Number.isFinite(note.end)) continue;
      const previous = merged.at(-1);
      if (previous && previous.note.note === note.note
          && Math.abs(previous.note.start - note.start) <= SAME_ONSET_SECONDS) {
        previous.note.end = Math.max(previous.note.end, note.end);
        previous.note.velocity = Math.max(previous.note.velocity, note.velocity);
        previous.hands.add(note.hand);
      } else {
        merged.push({
          note: { ...note, end: Math.max(note.start + 0.03, note.end) },
          hands: new Set([note.hand]),
        });
      }
    }
    const nextByPitch = new Map<number, number>();
    this.notes = new Array<IndexedNote>(merged.length);
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      const entry = merged[index];
      this.notes[index] = {
        note: entry.note,
        hands: entry.hands,
        nextSamePitchStart: nextByPitch.get(entry.note.note) ?? Number.POSITIVE_INFINITY,
      };
      nextByPitch.set(entry.note.note, entry.note.start);
    }
    const uniquePedals = new Map<string, ScorePedalEvent>();
    for (const pedal of pedals) {
      if (!Number.isFinite(pedal.time) || pedal.time < 0 || !Number.isFinite(pedal.value)) continue;
      const normalized = { ...pedal, value: Math.max(0, Math.min(127, Math.round(pedal.value))) };
      uniquePedals.set(`${normalized.time.toFixed(6)}:${normalized.value}:${normalized.action}`, normalized);
    }
    this.pedals = [...uniquePedals.values()].sort((a, b) => a.time - b.time || a.value - b.value);
  }

  events(
    windowStart: number,
    windowEnd: number,
    origin: number,
    speed: number,
    hand: HandSelection = "both",
    includePedalState = false,
  ): MidiOutEvent[] {
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) return [];
    const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
    const delay = (time: number) => Math.max(0, Math.min(60_000, Math.round((time - origin) / safeSpeed * 1_000)));
    const events: MidiOutEvent[] = [];
    for (const indexed of this.notes) {
      const note = indexed.note;
      if (!selected(indexed, hand)) continue;
      const end = Math.min(note.end, indexed.nextSamePitchStart);
      if (note.start >= windowStart - SAME_ONSET_SECONDS && note.start < windowEnd - SAME_ONSET_SECONDS) {
        events.push({
          delayMs: delay(note.start),
          status: 0x90,
          data1: note.note,
          data2: Math.max(1, Math.min(127, Math.round(note.velocity || 96))),
        });
      }
      const release = Math.max(note.start + 0.03, end);
      const releaseBelongsToWindow = release >= windowStart - SAME_ONSET_SECONDS
        && release < windowEnd - SAME_ONSET_SECONDS;
      if (releaseBelongsToWindow && (!includePedalState || note.start >= windowStart - SAME_ONSET_SECONDS)) {
        events.push({ delayMs: delay(release), status: 0x80, data1: note.note, data2: 0 });
      }
    }

    if (includePedalState) {
      const state = this.pedals.filter((pedal) => pedal.time < windowStart - SAME_ONSET_SECONDS).at(-1);
      if (state) events.push({ delayMs: 0, status: 0xb0, data1: 64, data2: state.value });
    }
    for (const pedal of this.pedals) {
      if (pedal.time < windowStart - SAME_ONSET_SECONDS) continue;
      if (pedal.time >= windowEnd - SAME_ONSET_SECONDS) break;
      events.push({ delayMs: delay(pedal.time), status: 0xb0, data1: 64, data2: pedal.value });
    }

    return events.sort((a, b) => a.delayMs - b.delayMs || eventPriority(a) - eventPriority(b) || a.data1 - b.data1);
  }
}
