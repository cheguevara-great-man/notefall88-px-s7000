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

export interface RecordedControl {
  channel: number;
  controller: number;
  value: number;
  time: number;
}

interface ActiveNote {
  note: number;
  channel: number;
  velocity: number;
  start: number;
  released: boolean;
  releaseTime?: number;
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
  private controls: RecordedControl[] = [];
  private active = new Map<string, ActiveNote[]>();
  private sustainByChannel = new Map<number, boolean>();

  start(nowMs = performance.now()): void {
    this.recording = true;
    this.originMs = nowMs;
    this.notes = [];
    this.controls = [];
    this.active.clear();
    this.sustainByChannel.clear();
  }

  stop(nowMs = performance.now()): RecordedNote[] {
    if (this.recording) {
      const time = this.relativeSeconds(nowMs);
      for (const [channel, down] of this.sustainByChannel) {
        if (down) this.controls.push({ channel, controller: 64, value: 0, time });
      }
      this.allNotesOff(nowMs);
    }
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
    active.releaseTime = time;
    if (this.sustainByChannel.get(active.channel)) {
      active.sustained = true;
    } else {
      this.finish(active, time);
      this.removeActive(key, active);
    }
  }

  handleControl(event: MidiControlEvent, nowMs = performance.now()): void {
    if (!this.recording) return;
    const channel = Math.max(1, Math.min(16, Math.round(event.channel || 1)));
    const controller = clampMidi(event.controller);
    const value = clampMidi(event.value);
    this.controls.push({ channel, controller, value, time: this.relativeSeconds(nowMs) });
    if (controller === 64) {
      const down = value >= 64;
      const wasDown = this.sustainByChannel.get(channel) ?? false;
      this.sustainByChannel.set(channel, down);
      if (wasDown && !down) this.releaseSustained(channel, this.relativeSeconds(nowMs));
    } else if (controller === 120 || controller === 123) {
      this.allNotesOff(nowMs, channel);
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

  controlSnapshot(): RecordedControl[] {
    return this.controls
      .map((control) => ({ ...control }))
      .sort((a, b) => a.time - b.time || a.channel - b.channel || a.controller - b.controller);
  }

  private relativeSeconds(nowMs: number): number {
    return Math.max(0, (nowMs - this.originMs) / 1000);
  }

  private finish(active: ActiveNote, soundingEnd: number): void {
    const physicalEnd = active.releaseTime ?? soundingEnd;
    this.notes.push({
      note: active.note,
      channel: active.channel,
      velocity: active.velocity,
      start: active.start,
      end: Math.max(active.start + 0.01, physicalEnd),
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

export function recordingToMidi(
  notes: RecordedNote[],
  name = "NoteFall Recording",
  controls: RecordedControl[] = [],
): Uint8Array {
  const midi = new Midi();
  midi.header.name = name;
  midi.header.setTempo(120);
  const tracks = new Map<number, ReturnType<Midi["addTrack"]>>();
  const trackForChannel = (channelValue: number) => {
    const channel = Math.max(1, Math.min(16, Math.round(channelValue || 1)));
    let track = tracks.get(channel);
    if (!track) {
      track = midi.addTrack();
      track.name = `Channel ${channel}`;
      track.channel = channel - 1;
      tracks.set(channel, track);
    }
    return track;
  };
  for (const note of notes) {
    const track = trackForChannel(note.channel);
    track.addNote({
      midi: note.note,
      time: note.start,
      duration: Math.max(0.01, note.end - note.start),
      velocity: note.velocity / 127,
    });
  }
  for (const control of controls) {
    trackForChannel(control.channel).addCC({
      number: clampMidi(control.controller),
      time: Math.max(0, control.time),
      value: clampMidi(control.value) / 127,
    });
  }
  return midi.toArray();
}

export function recordingDuration(notes: RecordedNote[], controls: RecordedControl[] = []): number {
  return Math.max(
    notes.reduce((duration, note) => Math.max(duration, note.end), 0),
    controls.reduce((duration, control) => Math.max(duration, control.time), 0),
  );
}
