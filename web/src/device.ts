import type {
  CalibrationState,
  DeviceStatus,
  MidiControlEvent,
  MidiInputEvent,
  MidiOutEvent,
  MidiOutResult,
  TargetNote,
} from "./types";
import { TargetSync } from "./target-sync";
import { decodeDeviceMessage } from "./protocol";

type Listener<T> = (value: T) => void;

export class DeviceLink {
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private statusListeners: Listener<DeviceStatus>[] = [];
  private midiListeners: Listener<MidiInputEvent>[] = [];
  private controlListeners: Listener<MidiControlEvent>[] = [];
  private calibrationListeners: Listener<CalibrationState>[] = [];
  private midiOutListeners: Listener<MidiOutResult>[] = [];
  private connectionListeners: Listener<boolean>[] = [];
  private lastPing = 0;
  private pingTimer?: number;
  private reconnectAttempt = 0;
  private heartbeatTimer?: number;
  private readonly targetSync = new TargetSync((targets) => this.sendTargets(targets));
  latencyMs?: number;
  browserRejectedMessages = 0;

  connect(): void {
    window.clearTimeout(this.reconnectTimer);
    const host = window.location.hostname || "192.168.4.1";
    this.socket = new WebSocket(`ws://${host}:81/`);
    this.socket.onopen = () => {
      this.reconnectAttempt = 0;
      window.clearTimeout(this.pingTimer);
      this.connectionListeners.forEach((listener) => listener(true));
      this.send({ t: "hello", v: 5 });
      this.targetSync.reconnect();
      if (this.heartbeatTimer === undefined) {
        this.heartbeatTimer = window.setInterval(() => this.targetSync.heartbeat(), 250);
      }
      this.ping();
    };
    this.socket.onclose = () => {
      window.clearTimeout(this.pingTimer);
      this.connectionListeners.forEach((listener) => listener(false));
      const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 10000);
      this.reconnectAttempt += 1;
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
    this.socket.onerror = () => this.socket?.close();
    this.socket.onmessage = (event) => this.handleMessage(String(event.data));
  }

  private handleMessage(raw: string): void {
    const decoded = decodeDeviceMessage(raw);
    if (!decoded.ok) {
      this.browserRejectedMessages += 1;
      return;
    }
    const message = decoded.message;
    if (message.kind === "status") {
      this.statusListeners.forEach((listener) => listener(message.value));
    } else if (message.kind === "midi") {
      this.midiListeners.forEach((listener) => listener(message.value));
    } else if (message.kind === "control") {
      this.controlListeners.forEach((listener) => listener(message.value));
    } else if (message.kind === "calibration") {
      this.calibrationListeners.forEach((listener) => listener(message.value));
    } else if (message.kind === "midiOutResult") {
      this.midiOutListeners.forEach((listener) => listener(message.value));
    } else if (message.kind === "pong") {
      this.latencyMs = Math.max(0, performance.now() - this.lastPing);
      window.clearTimeout(this.pingTimer);
      this.pingTimer = window.setTimeout(() => this.ping(), 2000);
    }
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  ping(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.lastPing = performance.now();
    this.send({ t: "ping", ts: Math.round(this.lastPing) });
  }

  setTargets(notes: TargetNote[]): void {
    this.targetSync.update(notes);
  }

  private sendTargets(notes: TargetNote[]): void {
    this.send({
      t: "target",
      notes: notes.map((target) => ({ n: target.note, h: target.hand === "left" ? 0 : 1 })),
    });
  }

  configure(brightness: number, offset: number, reversed: boolean): void {
    this.send({ t: "config", brightness, offset, reversed });
  }

  setKeyOffset(note: number, offset: number): void {
    this.send({ t: "keyOffset", n: note, offset });
  }

  testNote(note: number): void {
    this.send({ t: "test", n: note });
  }

  blackout(): void {
    this.send({ t: "blackout" });
  }

  scheduleMidi(events: MidiOutEvent[]): void {
    for (let offset = 0; offset < events.length; offset += 48) {
      this.send({
        t: "midiOut",
        events: events.slice(offset, offset + 48).map((event) => ({
          delay: Math.max(0, Math.min(60000, Math.round(event.delayMs))),
          s: event.status & 0xff,
          d1: event.data1 & 0x7f,
          d2: event.data2 & 0x7f,
        })),
      });
    }
  }

  panicMidi(): void {
    this.send({ t: "midiPanic" });
  }

  onStatus(listener: Listener<DeviceStatus>): void {
    this.statusListeners.push(listener);
  }

  onMidi(listener: Listener<MidiInputEvent>): void {
    this.midiListeners.push(listener);
  }

  onControl(listener: Listener<MidiControlEvent>): void {
    this.controlListeners.push(listener);
  }

  onCalibration(listener: Listener<CalibrationState>): void {
    this.calibrationListeners.push(listener);
  }

  onMidiOutResult(listener: Listener<MidiOutResult>): void {
    this.midiOutListeners.push(listener);
  }

  onConnection(listener: Listener<boolean>): void {
    this.connectionListeners.push(listener);
  }
}
