import type { DeviceStatus, MidiInputEvent, TargetNote } from "./types";
import { TargetSync } from "./target-sync";

type Listener<T> = (value: T) => void;

export class DeviceLink {
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private statusListeners: Listener<DeviceStatus>[] = [];
  private midiListeners: Listener<MidiInputEvent>[] = [];
  private connectionListeners: Listener<boolean>[] = [];
  private lastPing = 0;
  private pingTimer?: number;
  private reconnectAttempt = 0;
  private heartbeatTimer?: number;
  private readonly targetSync = new TargetSync((targets) => this.sendTargets(targets));
  latencyMs?: number;

  connect(): void {
    window.clearTimeout(this.reconnectTimer);
    const host = window.location.hostname || "192.168.4.1";
    this.socket = new WebSocket(`ws://${host}:81/`);
    this.socket.onopen = () => {
      this.reconnectAttempt = 0;
      window.clearTimeout(this.pingTimer);
      this.connectionListeners.forEach((listener) => listener(true));
      this.send({ t: "hello", v: 2 });
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
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.t === "status") {
      this.statusListeners.forEach((listener) => listener(message as unknown as DeviceStatus));
    } else if (message.t === "midi") {
      const midi: MidiInputEvent = {
        state: message.s === "on" ? "on" : "off",
        note: Number(message.n),
        velocity: Number(message.v ?? 0),
        timestamp: Number(message.ts ?? 0),
      };
      this.midiListeners.forEach((listener) => listener(midi));
    } else if (message.t === "pong") {
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

  testNote(note: number): void {
    this.send({ t: "test", n: note });
  }

  blackout(): void {
    this.send({ t: "blackout" });
  }

  saveWifi(ssid: string, password: string): void {
    this.send({ t: "wifi", ssid, password });
  }

  onStatus(listener: Listener<DeviceStatus>): void {
    this.statusListeners.push(listener);
  }

  onMidi(listener: Listener<MidiInputEvent>): void {
    this.midiListeners.push(listener);
  }

  onConnection(listener: Listener<boolean>): void {
    this.connectionListeners.push(listener);
  }
}
