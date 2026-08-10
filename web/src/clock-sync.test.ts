import { describe, expect, it } from "vitest";

import { DeviceClockSync, unwrapDeviceTimestamp } from "./clock-sync";

describe("ESP32 monotonic clock synchronization", () => {
  it("uses the lowest-RTT sample and removes WebSocket arrival jitter", () => {
    const sync = new DeviceClockSync();
    expect(sync.observe(1_000, 1_080, 500)).toBe(true);
    expect(sync.observe(3_000, 3_020, 2_500)).toBe(true);
    const estimate = sync.estimate(2_540, 3_075)!;
    expect(estimate.browserTime).toBe(3_050);
    expect(estimate.transportDelayMs).toBe(25);
    expect(estimate.uncertaintyMs).toBe(10);
    expect(sync.uncertaintyMs()).toBe(10);
  });

  it("unwraps MIDI timestamps safely across the uint32 rollover", () => {
    const range = 0x1_0000_0000;
    expect(unwrapDeviceTimestamp(12, range - 20)).toBe(range + 12);
    const sync = new DeviceClockSync();
    sync.observe(10_000, 10_010, range - 25);
    sync.observe(10_040, 10_050, 15);
    const estimate = sync.estimate(20, 10_060)!;
    expect(estimate.browserTime).toBe(10_050);
    expect(estimate.transportDelayMs).toBe(10);
  });

  it("resets after a device reboot instead of applying the old boot offset", () => {
    const sync = new DeviceClockSync();
    sync.observe(1_000_000, 1_000_020, 900_000);
    expect(sync.observe(1_002_000, 1_002_020, 100)).toBe(true);
    const estimate = sync.estimate(110, 1_002_040)!;
    expect(estimate.browserTime).toBe(1_002_020);
    expect(estimate.transportDelayMs).toBe(20);
  });

  it("rejects stale, impossible and unsynchronized estimates", () => {
    const sync = new DeviceClockSync();
    expect(sync.estimate(10, 100)).toBeUndefined();
    expect(sync.observe(100, 99, 10)).toBe(false);
    expect(sync.observe(0, 2_001, 10)).toBe(false);
    sync.observe(1_000, 1_020, 500);
    expect(sync.estimate(510, 7_000)).toBeUndefined();
    expect(sync.estimate(800, 1_100)).toBeUndefined();
  });
});
