import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeviceLink } from "./device";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;

  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  send(payload: string): void { this.sent.push(payload); }
  close(): void { this.readyState = 3; this.onclose?.(); }
}

function sentMessages(socket: FakeWebSocket): Array<Record<string, unknown>> {
  return socket.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>);
}

describe("device websocket link", () => {
  const setTimeoutMock = vi.fn(() => 41);
  const clearTimeoutMock = vi.fn();
  const setIntervalMock = vi.fn(() => 42);

  beforeEach(() => {
    FakeWebSocket.instances = [];
    setTimeoutMock.mockClear();
    clearTimeoutMock.mockClear();
    setIntervalMock.mockClear();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("window", {
      location: { hostname: "192.168.4.1" },
      setTimeout: setTimeoutMock,
      clearTimeout: clearTimeoutMock,
      setInterval: setIntervalMock,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("handshakes, restores targets and routes validated device events", () => {
    const link = new DeviceLink();
    const connections = vi.fn();
    const statuses = vi.fn();
    const midi = vi.fn();
    const controls = vi.fn();
    const calibration = vi.fn();
    const midiOut = vi.fn();
    link.onConnection(connections);
    link.onStatus(statuses);
    link.onMidi(midi);
    link.onControl(controls);
    link.onCalibration(calibration);
    link.onMidiOutResult(midiOut);
    link.setTargets([{ note: 48, hand: "left" }]);
    link.connect();

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("ws://192.168.4.1:81/");
    socket.onopen?.();
    expect(connections).toHaveBeenCalledWith(true);
    expect(setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 250);
    expect(sentMessages(socket).slice(0, 3)).toEqual([
      { t: "hello", v: 5 },
      { t: "target", notes: [{ n: 48, h: 0 }] },
      expect.objectContaining({ t: "ping" }),
    ]);

    socket.onmessage?.({ data: JSON.stringify({
      t: "status", protocol: 5, piano: true, clients: 1,
      brightness: 2, offset: 0, reversed: false,
    }) });
    socket.onmessage?.({ data: JSON.stringify({ t: "midi", s: "on", ch: 1, n: 60, v: 100, ts: 10 }) });
    socket.onmessage?.({ data: JSON.stringify({ t: "control", ch: 1, c: 64, v: 127, ts: 11 }) });
    socket.onmessage?.({ data: JSON.stringify({ t: "calibration", offsets: Array(88).fill(0) }) });
    socket.onmessage?.({ data: JSON.stringify({ t: "midiOutResult", ok: true, busy: false, accepted: 1, queued: 1 }) });
    expect(statuses).toHaveBeenCalledOnce();
    expect(midi).toHaveBeenCalledOnce();
    expect(controls).toHaveBeenCalledOnce();
    expect(calibration).toHaveBeenCalledOnce();
    expect(midiOut).toHaveBeenCalledOnce();
  });

  it("encodes controls and splits MIDI output into bounded batches", () => {
    const link = new DeviceLink();
    link.connect();
    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    socket.sent = [];

    link.configure(3, -2, true);
    link.setKeyOffset(60, 2);
    link.testNote(60);
    link.blackout();
    link.scheduleMidi(Array.from({ length: 49 }, (_, index) => ({
      delayMs: index === 0 ? -20 : 70_000,
      status: 0x190,
      data1: 188,
      data2: 255,
    })));
    link.panicMidi();

    const messages = sentMessages(socket);
    expect(messages.map((message) => message.t)).toEqual([
      "config", "keyOffset", "test", "blackout", "midiOut", "midiOut", "midiPanic",
    ]);
    const batches = messages.filter((message) => message.t === "midiOut");
    expect((batches[0].events as unknown[])).toHaveLength(48);
    expect((batches[1].events as unknown[])).toHaveLength(1);
    expect((batches[0].events as Array<Record<string, number>>)[0]).toEqual({ delay: 0, s: 144, d1: 60, d2: 127 });
    expect((batches[0].events as Array<Record<string, number>>)[1].delay).toBe(60_000);
  });

  it("rejects malformed input, measures pong latency and reconnects with backoff", () => {
    const link = new DeviceLink();
    const connections = vi.fn();
    link.onConnection(connections);
    link.connect();
    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    socket.onmessage?.({ data: "not-json" });
    expect(link.browserRejectedMessages).toBe(1);
    socket.onmessage?.({ data: JSON.stringify({ t: "pong", ts: 1 }) });
    expect(link.latencyMs).toBeGreaterThanOrEqual(0);
    expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 2000);

    socket.close();
    expect(connections).toHaveBeenLastCalledWith(false);
    expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 1000);
  });
});
