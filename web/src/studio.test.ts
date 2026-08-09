import { describe, expect, it } from "vitest";

import { endpointSecurityNotice, normalizeDeviceWebSocketUrl } from "./studio";

describe("Studio device endpoint", () => {
  it("normalizes friendly IP, host and HTTP inputs", () => {
    expect(normalizeDeviceWebSocketUrl("192.168.4.1")).toBe("ws://192.168.4.1:81/");
    expect(normalizeDeviceWebSocketUrl("notefall.local:82")).toBe("ws://notefall.local:82/");
    expect(normalizeDeviceWebSocketUrl("http://10.0.0.8")).toBe("ws://10.0.0.8:81/");
    expect(normalizeDeviceWebSocketUrl("https://device.example")).toBe("wss://device.example:81/");
  });

  it("rejects credentials and application paths", () => {
    expect(() => normalizeDeviceWebSocketUrl("ftp://device")).toThrow(/只支持/);
    expect(() => normalizeDeviceWebSocketUrl("ws://user:pass@device")).toThrow(/用户名/);
    expect(() => normalizeDeviceWebSocketUrl("ws://device/private")).toThrow(/路径/);
  });

  it("explains the HTTPS to local ws mixed-content boundary", () => {
    expect(endpointSecurityNotice("ws://192.168.4.1:81/", "https:")).toMatch(/可能阻止/);
    expect(endpointSecurityNotice("ws://192.168.4.1:81/", "http:")).toBeUndefined();
    expect(endpointSecurityNotice("wss://device.example:81/", "https:")).toBeUndefined();
  });
});
