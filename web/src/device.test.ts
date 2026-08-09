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
  let sessionValues: Map<string, string>;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    setTimeoutMock.mockClear();
    clearTimeoutMock.mockClear();
    setIntervalMock.mockClear();
    sessionValues = new Map();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("window", {
      location: { hostname: "192.168.4.1" },
      setTimeout: setTimeoutMock,
      clearTimeout: clearTimeoutMock,
      setInterval: setIntervalMock,
      sessionStorage: {
        getItem: (key: string) => sessionValues.get(key) ?? null,
        setItem: (key: string, value: string) => sessionValues.set(key, value),
        removeItem: (key: string) => sessionValues.delete(key),
      },
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
    expect(sentMessages(socket).slice(0, 2)).toEqual([
      { t: "hello", v: 6 },
      expect.objectContaining({ t: "ping" }),
    ]);

    socket.onmessage?.({ data: JSON.stringify({
      t: "status", protocol: 6, piano: true, clients: 1,
      brightness: 2, offset: 0, reversed: false,
      controlSessionReady: true, controlAuthorized: true, accessPointClient: true,
    }) });
    expect(sentMessages(socket)).toContainEqual({ t: "target", notes: [{ n: 48, h: 0 }] });
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

  it("supports an independent Studio device endpoint", () => {
    const link = new DeviceLink("ws://notefall.local:81/");
    link.connect();
    expect(FakeWebSocket.instances[0].url).toBe("ws://notefall.local:81/");
  });

  it("encodes controls and splits MIDI output into bounded batches", () => {
    const link = new DeviceLink();
    link.connect();
    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({
      t: "status", protocol: 6, piano: false, clients: 1,
      brightness: 2, offset: 0, reversed: false,
      controlSessionReady: true, controlAuthorized: true, accessPointClient: true,
    }) });
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

  it("keeps station clients read-only until a session credential succeeds", () => {
    const link = new DeviceLink();
    link.connect();
    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({
      t: "status", protocol: 6, piano: false, clients: 1,
      brightness: 2, offset: 0, reversed: false,
      controlSessionReady: true, controlAuthorized: false, accessPointClient: false,
    }) });
    socket.sent = [];
    link.testNote(60);
    link.scheduleMidi([{ delayMs: 0, status: 0x90, data1: 60, data2: 80 }]);
    expect(socket.sent).toEqual([]);

    expect(() => link.authenticateControl("short")).toThrow(/8–63/);
    link.authenticateControl("correct-horse");
    expect(sentMessages(socket).at(-1)).toEqual({ t: "hello", v: 6, auth: "correct-horse" });
    expect(sessionValues.size).toBe(0);
    socket.onmessage?.({ data: JSON.stringify({
      t: "status", protocol: 6, piano: false, clients: 1,
      brightness: 2, offset: 0, reversed: false,
      controlSessionReady: true, controlAuthorized: true, accessPointClient: false,
      controlToken: "boot-token-0123456789",
    }) });
    expect(sessionValues.get("notefall-control-token")).toBe("boot-token-0123456789");
    expect([...sessionValues.values()]).not.toContain("correct-horse");
    socket.sent = [];
    link.testNote(60);
    expect(sentMessages(socket)).toEqual([{ t: "test", n: 60 }]);

    const reloaded = new DeviceLink();
    reloaded.connect();
    const reloadedSocket = FakeWebSocket.instances[1];
    reloadedSocket.onopen?.();
    expect(sentMessages(reloadedSocket)[0]).toEqual({
      t: "hello", v: 6, token: "boot-token-0123456789",
    });
  });

  it("forgets rejected credentials and never treats SoftAP trust as password proof", () => {
    const link = new DeviceLink();
    link.connect();
    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();

    link.authenticateControl("wrong-password");
    socket.onmessage?.({ data: JSON.stringify({
      t: "status", protocol: 6, piano: false, clients: 1,
      brightness: 2, offset: 0, reversed: false,
      controlSessionReady: true, controlAuthorized: false, accessPointClient: false,
    }) });
    expect(sessionValues.size).toBe(0);

    link.authenticateControl("unverified-on-ap");
    socket.onmessage?.({ data: JSON.stringify({
      t: "status", protocol: 6, piano: false, clients: 1,
      brightness: 2, offset: 0, reversed: false,
      controlSessionReady: true, controlAuthorized: true, accessPointClient: true,
    }) });
    expect(sessionValues.size).toBe(0);
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
