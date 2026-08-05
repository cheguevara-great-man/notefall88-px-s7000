import { describe, expect, it } from "vitest";

import {
  formatStorageStatus,
  inspectBrowserStorage,
  requestPersistentStorage,
  storageFailureMessage,
} from "./storage";

describe("browser storage reliability", () => {
  it("reports persistence and bounded capacity without requiring a real browser", async () => {
    const manager = {
      persisted: async () => true,
      persist: async () => true,
      estimate: async () => ({ usage: 10 * 1024 * 1024, quota: 100 * 1024 * 1024 }),
    } as StorageManager;
    const status = await inspectBrowserStorage(manager);
    expect(status).toEqual({
      available: true,
      persistent: true,
      usage: 10 * 1024 * 1024,
      quota: 100 * 1024 * 1024,
    });
    expect(formatStorageStatus(status)).toContain("10.0%");
    await expect(requestPersistentStorage(manager)).resolves.toBe(true);
  });

  it("degrades safely when HTTP or private mode denies advisory APIs", async () => {
    const denied = async () => { throw new DOMException("denied", "SecurityError"); };
    const manager = { persisted: denied, persist: denied, estimate: denied } as unknown as StorageManager;
    await expect(inspectBrowserStorage(manager)).resolves.toEqual({ available: true });
    await expect(requestPersistentStorage(manager)).resolves.toBe(false);
    expect(formatStorageStatus({ available: false })).toContain("定期导出备份");
  });

  it("turns quota and private-mode failures into actionable messages", () => {
    expect(storageFailureMessage(new DOMException("full", "QuotaExceededError"), "保存乐谱"))
      .toContain("导出备份");
    expect(storageFailureMessage(new DOMException("denied", "InvalidStateError"), "打开曲库"))
      .toContain("退出私密模式");
    expect(storageFailureMessage(new Error("specific"), "保存")).toBe("specific");
  });
});
