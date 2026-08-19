import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportFile } from "./file-export";

describe("file export utility", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to anchor download in standard browser environment", async () => {
    const clickMock = vi.fn();
    const appendChildMock = vi.fn();
    const removeChildMock = vi.fn();

    vi.stubGlobal("document", {
      createElement: () => ({
        style: {},
        set href(_val: string) {},
        set download(_val: string) {},
        click: clickMock,
      }),
      body: {
        appendChild: appendChildMock,
        removeChild: removeChildMock,
      },
    });

    const result = await exportFile("test data", "test.json", "application/json");
    expect(result.method).toBe("download");
    expect(result.success).toBe(true);
    expect(clickMock).toHaveBeenCalled();
  });
});
