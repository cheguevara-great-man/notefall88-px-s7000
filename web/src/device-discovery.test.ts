import { describe, expect, it, vi } from "vitest";

import { discoverNativeDeviceWebSocket } from "./device-discovery";

describe("native NoteFall discovery", () => {
  it("returns a validated websocket URL from the native resolver", async () => {
    const resolve = vi.fn().mockResolvedValue({ host: "192.168.1.7" });
    const host = { Capacitor: { Plugins: { NoteFallDiscovery: { resolve } } } } as unknown as Window;
    await expect(discoverNativeDeviceWebSocket(host)).resolves.toBe("ws://192.168.1.7:81/");
  });

  it("registers the native proxy on a fresh Capacitor launch", async () => {
    const resolve = vi.fn().mockResolvedValue({ host: "192.168.1.7" });
    const registerPlugin = vi.fn().mockReturnValue({ resolve });
    const host = { Capacitor: { Plugins: {}, registerPlugin } } as unknown as Window;
    await expect(discoverNativeDeviceWebSocket(host)).resolves.toBe("ws://192.168.1.7:81/");
    expect(registerPlugin).toHaveBeenCalledWith("NoteFallDiscovery");
  });

  it("is absent in a browser and rejects malformed native results", async () => {
    await expect(discoverNativeDeviceWebSocket({} as Window)).resolves.toBeUndefined();
    const host = {
      Capacitor: { Plugins: { NoteFallDiscovery: { resolve: async () => ({ host: "192.168.1.999" }) } } },
    } as unknown as Window;
    await expect(discoverNativeDeviceWebSocket(host)).resolves.toBeUndefined();
  });
});
