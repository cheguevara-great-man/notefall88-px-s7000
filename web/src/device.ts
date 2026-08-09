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

const PROTOCOL_VERSION = 6;
const SESSION_TOKEN_KEY = "notefall-control-token";

function loadSessionToken(): string {
  try {
    return window.sessionStorage.getItem(SESSION_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveSessionToken(value: string): void {
  try {
    if (value) window.sessionStorage.setItem(SESSION_TOKEN_KEY, value);
    else window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Private browsing may deny storage; the in-memory session still works.
  }
}

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
  private sessionToken = "";
  private pendingPassword = "";
  private authenticationPending = false;
  private controlAuthorized = false;
  private readonly targetSync = new TargetSync((targets) => this.sendTargets(targets));
  latencyMs?: number;
  browserRejectedMessages = 0;

  constructor(private readonly webSocketUrl?: string) {}

  connect(): void {
    if (!this.sessionToken) this.sessionToken = loadSessionToken();
    this.authenticationPending = Boolean(this.sessionToken);
    window.clearTimeout(this.reconnectTimer);
    const host = window.location.hostname || "192.168.4.1";
    this.socket = new WebSocket(this.webSocketUrl ?? `ws://${host}:81/`);
    this.socket.onopen = () => {
      this.reconnectAttempt = 0;
      window.clearTimeout(this.pingTimer);
      this.connectionListeners.forEach((listener) => listener(true));
      this.sendHello();
      if (this.heartbeatTimer === undefined) {
        this.heartbeatTimer = window.setInterval(() => this.targetSync.heartbeat(), 250);
      }
      this.ping();
    };
    this.socket.onclose = () => {
      this.controlAuthorized = false;
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
      const becameAuthorized = message.value.controlAuthorized === true && !this.controlAuthorized;
      this.controlAuthorized = message.value.controlAuthorized === true;
      if (message.value.controlSessionReady === true &&
          message.value.controlAuthorized === true && this.authenticationPending) {
        if (message.value.accessPointClient === false && message.value.controlToken) {
          this.sessionToken = message.value.controlToken;
          saveSessionToken(this.sessionToken);
        } else {
          // SoftAP authorization proves only the interface, not that an
          // optional supplied password was correct. Never persist it there.
          this.sessionToken = "";
          saveSessionToken("");
        }
        this.pendingPassword = "";
        this.authenticationPending = false;
      } else if (message.value.controlSessionReady === true &&
          message.value.controlAuthorized === false && this.authenticationPending) {
        this.sessionToken = "";
        this.pendingPassword = "";
        this.authenticationPending = false;
        saveSessionToken("");
      }
      if (becameAuthorized) this.targetSync.reconnect();
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

  private sendHello(): void {
    this.send({
      t: "hello",
      v: PROTOCOL_VERSION,
      ...(this.pendingPassword
        ? { auth: this.pendingPassword }
        : (this.sessionToken ? { token: this.sessionToken } : {})),
    });
  }

  authenticateControl(password: string): void {
    const bytes = new TextEncoder().encode(password).length;
    if (bytes < 8 || bytes > 63) throw new Error("当前热点密码必须为 8–63 字节");
    this.pendingPassword = password;
    this.authenticationPending = true;
    this.sendHello();
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
    if (!this.controlAuthorized) return;
    this.send({
      t: "target",
      notes: notes.map((target) => ({ n: target.note, h: target.hand === "left" ? 0 : 1 })),
    });
  }

  configure(brightness: number, offset: number, reversed: boolean): void {
    if (!this.controlAuthorized) return;
    this.send({ t: "config", brightness, offset, reversed });
  }

  setKeyOffset(note: number, offset: number): void {
    if (!this.controlAuthorized) return;
    this.send({ t: "keyOffset", n: note, offset });
  }

  testNote(note: number): void {
    if (!this.controlAuthorized) return;
    this.send({ t: "test", n: note });
  }

  blackout(): void {
    if (!this.controlAuthorized) return;
    this.send({ t: "blackout" });
  }

  scheduleMidi(events: MidiOutEvent[]): void {
    if (!this.controlAuthorized) return;
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
    if (!this.controlAuthorized) return;
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
