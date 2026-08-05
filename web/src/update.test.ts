import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchUpdateInfo, saveStationWifi, validateUpdateFile } from "./update";

afterEach(() => vi.unstubAllGlobals());

describe("device update validation", () => {
  const info = { firmwareMax: 0x280000, filesystemMax: 0x2e0000 };

  it("accepts bounded binary images", () => {
    expect(validateUpdateFile({ name: "firmware.bin", size: 900_000 }, "firmware", info)).toBeUndefined();
    expect(validateUpdateFile({ name: "littlefs.bin", size: 400_000 }, "filesystem", info)).toBeUndefined();
  });

  it("rejects wrong extensions, implausible files and partition overflow", () => {
    expect(validateUpdateFile({ name: "firmware.zip", size: 900_000 }, "firmware", info)).toMatch(/\.bin/);
    expect(validateUpdateFile({ name: "firmware.bin", size: 42 }, "firmware", info)).toMatch(/过小/);
    expect(validateUpdateFile({ name: "firmware.bin", size: 0x280001 }, "firmware", info)).toMatch(/分区上限/);
  });

  it("explains that an HTML fallback is not a connected device", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html>", {
      status: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
    })));
    await expect(fetchUpdateInfo()).rejects.toThrow(/尚未连接/);
  });
});

describe("station Wi-Fi authorization", () => {
  it("requires hotspot credentials and sends them only in the admin header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await saveStationWifi("PianoRoom", "12345678", "notefall88");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ "X-NoteFall-Admin": "notefall88" });
    expect(String(init.body)).not.toContain("notefall88");
  });

  it("rejects invalid names and WPA passwords before sending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveStationWifi("", "12345678", "adminpass")).rejects.toThrow(/名称/);
    await expect(saveStationWifi("PianoRoom", "short", "adminpass")).rejects.toThrow(/密码/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
