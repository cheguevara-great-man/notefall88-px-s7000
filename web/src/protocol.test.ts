import { describe, expect, it } from "vitest";
import { decodeDeviceMessage } from "./protocol";

const status = {
  t: "status",
  protocol: 6,
  firmware: "0.7.0",
  controlSessionReady: true,
  controlAuthorized: true,
  accessPointClient: true,
  defaultPassword: false,
  controlToken: "boot-token-0123456789",
  piano: true,
  clients: 1,
  brightness: 2,
  offset: 0,
  reversed: false,
  stripEnabled: true,
  usbVid: 0x07cf,
  usbPid: 0x6802,
  usbOutputMirrorCandidates: 3,
  usbMalformed: 4,
  usbLastError: "connected USB device has no MIDI streaming IN endpoint",
  webAuthRejected: 2,
  usbInputQueueDepth: 3,
  usbInputQueueHighWater: 17,
  usbOutputQueueDepth: 4,
  usbOutputQueueHighWater: 19,
  usbLargestInputBatch: 8,
  usbInputResubmitRetries: 1,
  usbClientWatchdog: true,
  usbDaemonWatchdog: true,
  webMidiResyncs: 2,
  webMidiQueueDepth: 5,
  webMidiQueueHighWater: 23,
  midiDispatchLatencyLastUs: 120,
  midiDispatchLatencyAvgUs: 95,
  midiDispatchLatencyMaxUs: 440,
  midiDispatchLatencySamples: 100,
  ledInputLatencyLastUs: 840,
  ledInputLatencyAvgUs: 790,
  ledInputLatencyMaxUs: 1210,
  ledInputLatencySamples: 40,
  ledFrames: 9_000,
  ledFramesSkipped: 24_000,
  ledSpiLastUs: 900,
  ledSpiMaxUs: 1_200,
  ledFrameBytes: 712,
  realtimeReady: true,
  realtimeWatchdog: true,
  realtimeHeartbeatAgeMs: 4,
  realtimeWakeups: 50_000,
  realtimeStackFreeBytes: 3_072,
  mainLoopLastUs: 410,
  mainLoopMaxUs: 2_300,
};

describe("device protocol decoder", () => {
  it("decodes compatible status and preserves latency diagnostics", () => {
    const result = decodeDeviceMessage(JSON.stringify(status));
    expect(result.ok).toBe(true);
    if (!result.ok || result.message.kind !== "status") return;
    expect(result.message.value.usbVid).toBe(0x07cf);
    expect(result.message.value.usbOutputMirrorCandidates).toBe(3);
    expect(result.message.value.usbMalformed).toBe(4);
    expect(result.message.value.usbLastError).toMatch(/no MIDI streaming IN/);
    expect(result.message.value.controlAuthorized).toBe(true);
    expect(result.message.value.controlToken).toBe("boot-token-0123456789");
    expect(result.message.value.webAuthRejected).toBe(2);
    expect(result.message.value).toMatchObject({
      usbInputQueueDepth: 3,
      usbInputQueueHighWater: 17,
      usbOutputQueueDepth: 4,
      usbOutputQueueHighWater: 19,
      usbLargestInputBatch: 8,
      usbInputResubmitRetries: 1,
      usbClientWatchdog: true,
      usbDaemonWatchdog: true,
      webMidiResyncs: 2,
      webMidiQueueDepth: 5,
      webMidiQueueHighWater: 23,
      midiDispatchLatencyLastUs: 120,
      midiDispatchLatencyAvgUs: 95,
      midiDispatchLatencyMaxUs: 440,
      midiDispatchLatencySamples: 100,
      ledFrames: 9_000,
      ledFramesSkipped: 24_000,
      ledSpiLastUs: 900,
      ledSpiMaxUs: 1_200,
      ledFrameBytes: 712,
      realtimeReady: true,
      realtimeWatchdog: true,
      realtimeHeartbeatAgeMs: 4,
      realtimeWakeups: 50_000,
      realtimeStackFreeBytes: 3_072,
      mainLoopLastUs: 410,
      mainLoopMaxUs: 2_300,
    });
    expect(result.message.value.ledInputLatencyAvgUs).toBe(790);
    expect(result.message.value.stripEnabled).toBe(true);
  });

  it("keeps realtime diagnostics optional for older firmware", () => {
    const legacy = { ...status } as Record<string, unknown>;
    for (const key of [
      "usbInputQueueDepth", "usbInputQueueHighWater", "usbOutputQueueDepth", "usbOutputQueueHighWater",
      "usbLargestInputBatch", "usbInputResubmitRetries", "usbClientWatchdog", "usbDaemonWatchdog",
      "webMidiResyncs", "webMidiQueueDepth", "webMidiQueueHighWater",
      "midiDispatchLatencyLastUs", "midiDispatchLatencyAvgUs", "midiDispatchLatencyMaxUs",
      "midiDispatchLatencySamples", "ledFrames", "ledFramesSkipped", "ledSpiLastUs", "ledSpiMaxUs",
      "ledFrameBytes", "realtimeReady", "realtimeWatchdog", "realtimeHeartbeatAgeMs", "realtimeWakeups",
      "realtimeStackFreeBytes", "mainLoopLastUs", "mainLoopMaxUs", "stripEnabled",
    ]) delete legacy[key];
    const result = decodeDeviceMessage(JSON.stringify(legacy));
    expect(result.ok).toBe(true);
    if (!result.ok || result.message.kind !== "status") return;
    expect(result.message.value.usbInputQueueDepth).toBeUndefined();
    expect(result.message.value.midiDispatchLatencyAvgUs).toBeUndefined();
    expect(result.message.value.ledSpiMaxUs).toBeUndefined();
    expect(result.message.value.realtimeReady).toBeUndefined();
    expect(result.message.value.mainLoopMaxUs).toBeUndefined();
    expect(result.message.value.stripEnabled).toBeUndefined();
  });

  it("decodes bounded MIDI, control, result and pong messages", () => {
    for (const message of [
      { t: "midi", s: "on", ch: 16, n: 108, v: 127, vh: 16_383, ts: 123 },
      { t: "control", ch: 1, c: 64, v: 127, ts: 124 },
      { t: "midiOutResult", ok: true, busy: false, accepted: 48, queued: 256 },
      { t: "pong", ts: 12, deviceTs: 0xffff_ffff },
    ]) {
      expect(decodeDeviceMessage(JSON.stringify(message)).ok).toBe(true);
    }
  });

  it("preserves both sides of a clock-sync pong while accepting legacy pongs", () => {
    const synchronized = decodeDeviceMessage(JSON.stringify({ t: "pong", ts: 12, deviceTs: 345 }));
    expect(synchronized.ok && synchronized.message.kind === "pong" ? synchronized.message : undefined)
      .toEqual({ kind: "pong", browserTimestamp: 12, deviceTimestamp: 345 });
    const legacy = decodeDeviceMessage(JSON.stringify({ t: "pong", ts: 13 }));
    expect(legacy.ok && legacy.message.kind === "pong" ? legacy.message.deviceTimestamp : "invalid")
      .toBeUndefined();
  });

  it("decodes optional 14-bit velocity without breaking 7-bit clients", () => {
    const high = decodeDeviceMessage(JSON.stringify({
      t: "midi", s: "on", ch: 2, n: 64, v: 96, vh: 12_345, ts: 123,
    }));
    expect(high.ok && high.message.kind === "midi"
      ? high.message.value.highResolutionVelocity
      : undefined).toBe(12_345);
    const legacy = decodeDeviceMessage(JSON.stringify({
      t: "midi", s: "on", ch: 2, n: 64, v: 96, ts: 123,
    }));
    expect(legacy.ok && legacy.message.kind === "midi"
      ? legacy.message.value.highResolutionVelocity
      : "invalid").toBeUndefined();
  });

  it("accepts only an exact, bounded 88-key calibration array", () => {
    expect(decodeDeviceMessage(JSON.stringify({ t: "calibration", offsets: Array(88).fill(0) })).ok).toBe(true);
    expect(decodeDeviceMessage(JSON.stringify({ t: "calibration", offsets: Array(87).fill(0) })).ok).toBe(false);
    expect(decodeDeviceMessage(JSON.stringify({ t: "calibration", offsets: [...Array(87).fill(0), 5] })).ok).toBe(false);
  });

  it("rejects malformed, non-finite, fractional and out-of-range fields", () => {
    const bad = [
      "not json",
      "null",
      JSON.stringify({ ...status, piano: "yes" }),
      JSON.stringify({ ...status, clients: 1.5 }),
      JSON.stringify({ ...status, brightness: 5 }),
      JSON.stringify({ ...status, stripEnabled: 1 }),
      JSON.stringify({ ...status, offset: 9 }),
      JSON.stringify({ ...status, usbInputQueueDepth: -1 }),
      JSON.stringify({ ...status, webMidiQueueHighWater: 1.5 }),
      JSON.stringify({ ...status, midiDispatchLatencyMaxUs: -1 }),
      JSON.stringify({ ...status, ledSpiLastUs: Number.MAX_SAFE_INTEGER }),
      JSON.stringify({ ...status, realtimeReady: 1 }),
      JSON.stringify({ ...status, mainLoopMaxUs: -1 }),
      JSON.stringify({ t: "midi", s: "on", ch: 0, n: 60, v: 90, ts: 1 }),
      JSON.stringify({ t: "midi", s: "on", ch: 1, n: 128, v: 90, ts: 1 }),
      JSON.stringify({ t: "midi", s: "on", ch: 1, n: 60, v: 90, vh: 16_384, ts: 1 }),
      JSON.stringify({ t: "control", ch: 1, c: 64, v: -1, ts: 1 }),
      JSON.stringify({ t: "pong", ts: 12.5 }),
      JSON.stringify({ t: "pong", ts: 12, deviceTs: -1 }),
      JSON.stringify({ t: "midiOutResult", ok: 1, busy: false, accepted: 0, queued: 0 }),
      JSON.stringify({ t: "midiOutResult", ok: true, busy: false, accepted: 0, queued: 257 }),
      JSON.stringify({ t: "futureMessage" }),
    ];
    for (const raw of bad) expect(decodeDeviceMessage(raw).ok, raw).toBe(false);
  });

  it("rejects an oversized message before JSON parsing", () => {
    expect(decodeDeviceMessage(`{"t":"pong","ts":1,"padding":"${"x".repeat(70_000)}"}`).ok).toBe(false);
  });
});
