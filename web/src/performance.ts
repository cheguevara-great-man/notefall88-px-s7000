import { Midi } from "@tonejs/midi";

import type { MidiControlEvent, MidiInputEvent } from "./types";

export interface RecordedNote {
  note: number;
  channel: number;
  velocity: number;
  start: number;
  end: number;
  sustained: boolean;
}

interface ActiveNote {
  note: number;
  channel: number;
  velocity: number;
  start: number;
  released: boolean;
  sustained: boolean;
}

function noteKey(channel: number, note: number): string {
  return `${channel}:${note}`;
}

function clampMidi(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)));
}

export class PerformanceRecorder {
  private recording = false;
  private originMs = 0;
  private notes: RecordedNote[] = [];
  private active = new Map<string, ActiveNote[]>();
  private sustainByChannel = new Map<number, boolean>();

  start(nowMs = performance.now()): void {
    this.recording = true;
    this.originMs = nowMs;
    this.notes = [];
    this.active.clear();
    this.sustainByChannel.clear();
  }

  stop(nowMs = performance.now()): RecordedNote[] {
    if (this.recording) this.allNotesOff(nowMs);
    this.recording = false;
    return this.snapshot();
  }

  isRecording(): boolean {
    return this.recording;
  }

  handleMidi(event: MidiInputEvent, nowMs = performance.now()): void {
    if (!this.recording) return;
    const time = this.relativeSeconds(nowMs);
    const key = noteKey(event.channel, event.note);
    if (event.state === "on" && event.velocity > 0) {
      const queue = this.active.get(key) ?? [];
      queue.push({
        note: clampMidi(event.note),
        channel: Math.max(1, Math.min(16, Math.round(event.channel || 1))),
        velocity: Math.max(1, clampMidi(event.velocity)),
        start: time,
        released: false,
        sustained: false,
      });
      this.active.set(key, queue);
      return;
    }

    const queue = this.active.get(key);
    const active = queue?.find((candidate) => !candidate.released);
    if (!active) return;
    active.released = true;
    if (this.sustainByChannel.get(active.channel)) {
      active.sustained = true;
    } else {
      this.finish(active, time);
      this.removeActive(key, active);
    }
  }

  handleControl(event: MidiControlEvent, nowMs = performance.now()): void {
    if (!this.recording) return;
    if (event.controller === 64) {
      const down = event.value >= 64;
      const wasDown = this.sustainByChannel.get(event.channel) ?? false;
      this.sustainByChannel.set(event.channel, down);
      if (wasDown && !down) this.releaseSustained(event.channel, this.relativeSeconds(nowMs));
    } else if (event.controller === 120 || event.controller === 123) {
      this.allNotesOff(nowMs, event.channel);
    }
  }

  allNotesOff(nowMs = performance.now(), channel?: number): void {
    if (!this.recording) return;
    const time = this.relativeSeconds(nowMs);
    for (const [key, queue] of this.active) {
      const remaining: ActiveNote[] = [];
      for (const active of queue) {
        if (channel !== undefined && active.channel !== channel) {
          remaining.push(active);
          continue;
        }
        this.finish(active, time);
      }
      if (remaining.length === 0) this.active.delete(key);
      else this.active.set(key, remaining);
    }
    if (channel === undefined) this.sustainByChannel.clear();
    else this.sustainByChannel.delete(channel);
  }

  snapshot(): RecordedNote[] {
    return this.notes
      .map((note) => ({ ...note }))
      .sort((a, b) => a.start - b.start || a.note - b.note);
  }

  private relativeSeconds(nowMs: number): number {
    return Math.max(0, (nowMs - this.originMs) / 1000);
  }

  private finish(active: ActiveNote, end: number): void {
    this.notes.push({
      note: active.note,
      channel: active.channel,
      velocity: active.velocity,
      start: active.start,
      end: Math.max(active.start + 0.01, end),
      sustained: active.sustained,
    });
  }

  private removeActive(key: string, active: ActiveNote): void {
    const queue = this.active.get(key);
    if (!queue) return;
    const remaining = queue.filter((candidate) => candidate !== active);
    if (remaining.length === 0) this.active.delete(key);
    else this.active.set(key, remaining);
  }

  private releaseSustained(channel: number, time: number): void {
    for (const [key, queue] of this.active) {
      const remaining: ActiveNote[] = [];
      for (const active of queue) {
        if (active.channel === channel && active.released) this.finish(active, time);
        else remaining.push(active);
      }
      if (remaining.length === 0) this.active.delete(key);
      else this.active.set(key, remaining);
    }
  }
}

export function recordingToMidi(notes: RecordedNote[], name = "NoteFall Recording"): Uint8Array {
  const midi = new Midi();
  midi.header.name = name;
  midi.header.setTempo(120);
  const tracks = new Map<number, ReturnType<Midi["addTrack"]>>();
  for (const note of notes) {
    let track = tracks.get(note.channel);
    if (!track) {
      track = midi.addTrack();
      track.name = `Channel ${note.channel}`;
      track.channel = note.channel - 1;
      tracks.set(note.channel, track);
    }
    track.addNote({
      midi: note.note,
      time: note.start,
      duration: Math.max(0.01, note.end - note.start),
      velocity: note.velocity / 127,
    });
  }
  return midi.toArray();
}

export function recordingDuration(notes: RecordedNote[]): number {
  return notes.reduce((duration, note) => Math.max(duration, note.end), 0);
}
