import { describe, expect, it } from "vitest";
import { decodeDeviceMessage } from "./protocol";

const status = {
  t: "status",
  protocol: 5,
  firmware: "0.6.4",
  piano: true,
  clients: 1,
  brightness: 2,
  offset: 0,
  reversed: false,
  usbVid: 0x07cf,
  usbPid: 0x6802,
  ledInputLatencyLastUs: 840,
  ledInputLatencyAvgUs: 790,
  ledInputLatencyMaxUs: 1210,
  ledInputLatencySamples: 40,
};

describe("device protocol decoder", () => {
  it("decodes compatible status and preserves latency diagnostics", () => {
    const result = decodeDeviceMessage(JSON.stringify(status));
    expect(result.ok).toBe(true);
    if (!result.ok || result.message.kind !== "status") return;
    expect(result.message.value.usbVid).toBe(0x07cf);
    expect(result.message.value.ledInputLatencyAvgUs).toBe(790);
  });

  it("decodes bounded MIDI, control, result and pong messages", () => {
    for (const message of [
      { t: "midi", s: "on", ch: 16, n: 108, v: 127, ts: 123 },
      { t: "control", ch: 1, c: 64, v: 127, ts: 124 },
      { t: "midiOutResult", ok: true, busy: false, accepted: 48, queued: 256 },
      { t: "pong", ts: 12 },
    ]) {
      expect(decodeDeviceMessage(JSON.stringify(message)).ok).toBe(true);
    }
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
      JSON.stringify({ ...status, offset: 9 }),
      JSON.stringify({ t: "midi", s: "on", ch: 0, n: 60, v: 90, ts: 1 }),
      JSON.stringify({ t: "midi", s: "on", ch: 1, n: 128, v: 90, ts: 1 }),
      JSON.stringify({ t: "control", ch: 1, c: 64, v: -1, ts: 1 }),
      JSON.stringify({ t: "pong", ts: 12.5 }),
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
