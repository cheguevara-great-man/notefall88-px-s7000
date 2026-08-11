import type { RecordedControl, RecordedNote } from "./performance";
import type { MidiOutEvent } from "./types";

const SAME_TIME_SECONDS = 0.001;
const REPLAYABLE_CONTROLLERS = new Set([64, 66, 67]);

interface IndexedRecordedNote {
  note: RecordedNote;
  nextSameKeyStart: number;
}

function channelNibble(channel: number): number {
  return Math.max(0, Math.min(15, Math.round(channel || 1) - 1));
}

function eventPriority(event: MidiOutEvent): number {
  const kind = event.status & 0xf0;
  if (kind === 0xb0 && event.data2 < 64) return 0;
  if (kind === 0x80 || (kind === 0x90 && event.data2 === 0)) return 1;
  if (kind === 0xb0) return 2;
  return 3;
}

/**
 * Replays a captured performance through the piano without routing timing
 * through Web MIDI. Only performance pedals are sent back; unrelated CCs
 * remain in the exported MIDI file but cannot unexpectedly change the piano.
 */
export class RecordingPlaybackPlanner {
  private readonly notes: IndexedRecordedNote[];
  private readonly controls: RecordedControl[];

  constructor(notes: RecordedNote[], controls: RecordedControl[] = []) {
    const normalized = notes
      .filter((note) => Number.isFinite(note.start) && Number.isFinite(note.end)
        && Number.isInteger(note.note) && note.note >= 0 && note.note <= 127)
      .map((note) => ({
        ...note,
        channel: Math.max(1, Math.min(16, Math.round(note.channel || 1))),
        velocity: Math.max(1, Math.min(127, Math.round(note.velocity || 1))),
        start: Math.max(0, note.start),
        end: Math.max(Math.max(0, note.start) + 0.01, note.end),
      }))
      .sort((a, b) => a.start - b.start || a.channel - b.channel || a.note - b.note || a.end - b.end);
    const nextByKey = new Map<string, number>();
    this.notes = new Array(normalized.length);
    for (let index = normalized.length - 1; index >= 0; index -= 1) {
      const note = normalized[index];
      const key = `${note.channel}:${note.note}`;
      this.notes[index] = { note, nextSameKeyStart: nextByKey.get(key) ?? Number.POSITIVE_INFINITY };
      nextByKey.set(key, note.start);
    }
    this.controls = controls
      .filter((control) => REPLAYABLE_CONTROLLERS.has(control.controller)
        && Number.isFinite(control.time) && Number.isFinite(control.value))
      .map((control) => ({
        ...control,
        channel: Math.max(1, Math.min(16, Math.round(control.channel || 1))),
        controller: Math.max(0, Math.min(127, Math.round(control.controller))),
        value: Math.max(0, Math.min(127, Math.round(control.value))),
        time: Math.max(0, control.time),
      }))
      .sort((a, b) => a.time - b.time || a.channel - b.channel || a.controller - b.controller);
  }

  events(
    windowStart: number,
    windowEnd: number,
    origin: number,
    speed = 1,
    includeControllerState = false,
  ): MidiOutEvent[] {
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) return [];
    const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
    const delay = (time: number) => Math.max(0, Math.min(60_000, Math.round((time - origin) / safeSpeed * 1_000)));
    const events: MidiOutEvent[] = [];

    for (const indexed of this.notes) {
      const note = indexed.note;
      const statusChannel = channelNibble(note.channel);
      const end = Math.min(note.end, indexed.nextSameKeyStart);
      if (note.start >= windowStart - SAME_TIME_SECONDS && note.start < windowEnd - SAME_TIME_SECONDS) {
        events.push({
          delayMs: delay(note.start),
          status: 0x90 | statusChannel,
          data1: note.note,
          data2: note.velocity,
        });
      }
      const release = Math.max(note.start + 0.01, end);
      const releaseBelongsToWindow = release >= windowStart - SAME_TIME_SECONDS
        && release < windowEnd - SAME_TIME_SECONDS;
      if (releaseBelongsToWindow && (!includeControllerState || note.start >= windowStart - SAME_TIME_SECONDS)) {
        events.push({
          delayMs: delay(release),
          status: 0x80 | statusChannel,
          data1: note.note,
          data2: 0,
        });
      }
    }

    if (includeControllerState) {
      const states = new Map<string, RecordedControl>();
      for (const control of this.controls) {
        if (control.time >= windowStart - SAME_TIME_SECONDS) break;
        states.set(`${control.channel}:${control.controller}`, control);
      }
      for (const control of states.values()) {
        events.push({
          delayMs: 0,
          status: 0xb0 | channelNibble(control.channel),
          data1: control.controller,
          data2: control.value,
        });
      }
    }
    for (const control of this.controls) {
      if (control.time < windowStart - SAME_TIME_SECONDS) continue;
      if (control.time >= windowEnd - SAME_TIME_SECONDS) break;
      events.push({
        delayMs: delay(control.time),
        status: 0xb0 | channelNibble(control.channel),
        data1: control.controller,
        data2: control.value,
      });
    }

    return events.sort((a, b) => a.delayMs - b.delayMs
      || eventPriority(a) - eventPriority(b)
      || a.status - b.status
      || a.data1 - b.data1);
  }
}
