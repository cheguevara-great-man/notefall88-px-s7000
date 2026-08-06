import { describe, expect, it } from "vitest";

import {
  commissioningReport,
  completeCommissioning,
  loadCommissioning,
  missingCommissioningEvidence,
  newCommissioningState,
  observeDevice,
  observeMidi,
  saveCommissioning,
} from "./commissioning";

function storage(initial: string | null = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
}

describe("commissioning evidence", () => {
  it("does not allow a click-through completion without hardware evidence", () => {
    const state = newCommissioningState();
    Object.keys(state.manual).forEach((key) => { state.manual[key as keyof typeof state.manual] = true; });
    expect(missingCommissioningEvidence(state)).toContain("PX-S7000 USB 实际枚举");
    expect(() => completeCommissioning(state)).toThrow(/证据/);
  });

  it("records USB status and a real middle-C event, then completes", () => {
    let state = newCommissioningState();
    Object.keys(state.manual).forEach((key) => { state.manual[key as keyof typeof state.manual] = true; });
    state = observeDevice(state, {
      piano: true, clients: 1, brightness: 2, offset: 0, reversed: false,
      firmware: "0.7.0", protocol: 6, usbEndpoint: 0x81, usbOutEndpoint: 0x02,
      usbPackets: 42, usbErrors: 0, usbVid: 0x07cf, usbPid: 0x6803, defaultPassword: false,
    });
    state = observeMidi(state, { state: "on", channel: 1, note: 60, velocity: 90, timestamp: 1 });
    expect(missingCommissioningEvidence(state)).toEqual([]);
    const completed = completeCommissioning(state, 1234);
    expect(commissioningReport(completed)).toMatchObject({ complete: true, missing: [], state: { completedFirmware: "0.7.0" } });
  });

  it("invalidates completion after a firmware change", () => {
    const state = { ...newCommissioningState(), completedAt: 1, completedFirmware: "0.5.0" };
    expect(observeDevice(state, { piano: false, clients: 1, brightness: 2, offset: 0, reversed: false, firmware: "0.6.0" }).completedAt)
      .toBeUndefined();
  });

  it("refuses commissioning while the published default hotspot password remains", () => {
    const state = observeDevice(newCommissioningState(), {
      piano: false, clients: 1, brightness: 2, offset: 0, reversed: false,
      firmware: "0.7.0", protocol: 6, defaultPassword: true,
    });
    expect(missingCommissioningEvidence(state)).toContain("修改公开的默认热点密码");
    expect(state.observed.passwordChanged).toBe(false);
  });

  it("round-trips normalized storage and rejects corrupt versions", () => {
    const target = storage();
    const state = newCommissioningState();
    state.manual.fuseInstalled = true;
    saveCommissioning(state, target);
    expect(loadCommissioning(target).manual.fuseInstalled).toBe(true);
    expect(loadCommissioning(storage('{"version":99}'))).toEqual(newCommissioningState());
  });
});
