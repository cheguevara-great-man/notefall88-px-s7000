import { afterEach, describe, expect, it, vi } from "vitest";

import { requestImmersiveMode } from "./immersive";

describe("immersive performance mode", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the Android native bridge when available", async () => {
    const setEnabled = vi.fn(async () => undefined);
    const host = { Capacitor: { Plugins: { ImmersiveMode: { setEnabled } } } } as unknown as Window;
    const target = { documentElement: {} } as Document;

    await expect(requestImmersiveMode(true, target, host)).resolves.toBe("native");
    expect(setEnabled).toHaveBeenCalledWith({ enabled: true });
  });

  it("enters and leaves browser fullscreen without losing the CSS fallback", async () => {
    const requestFullscreen = vi.fn(async () => undefined);
    const exitFullscreen = vi.fn(async () => undefined);
    const element = { requestFullscreen } as unknown as HTMLElement;
    const entering = { documentElement: element, fullscreenElement: null, exitFullscreen } as unknown as Document;
    expect(await requestImmersiveMode(true, entering, {} as Window)).toBe("browser");
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });

    const leaving = { documentElement: element, fullscreenElement: element, exitFullscreen } as unknown as Document;
    expect(await requestImmersiveMode(false, leaving, {} as Window)).toBe("browser");
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("keeps app-local focus mode when the platform refuses fullscreen", async () => {
    const requestFullscreen = vi.fn(async () => { throw new Error("not allowed"); });
    const target = { documentElement: { requestFullscreen }, fullscreenElement: null } as unknown as Document;
    await expect(requestImmersiveMode(true, target, {} as Window)).resolves.toBe("css");
  });
});
