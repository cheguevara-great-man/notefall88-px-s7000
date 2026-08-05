export interface BrowserStorageStatus {
  available: boolean;
  persistent?: boolean;
  usage?: number;
  quota?: number;
}

type StorageManagerLike = Pick<StorageManager, "estimate" | "persist" | "persisted">;

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export async function inspectBrowserStorage(
  manager: StorageManagerLike | undefined = globalThis.navigator?.storage,
): Promise<BrowserStorageStatus> {
  if (!manager) return { available: false };
  const status: BrowserStorageStatus = { available: true };
  try {
    status.persistent = await manager.persisted();
  } catch {
    // Some HTTP/private-mode browsers expose StorageManager but deny this query.
  }
  try {
    const estimate = await manager.estimate();
    status.usage = finiteNonNegative(estimate.usage);
    status.quota = finiteNonNegative(estimate.quota);
  } catch {
    // Capacity is advisory; failure must not block practice or IndexedDB access.
  }
  return status;
}

export async function requestPersistentStorage(
  manager: StorageManagerLike | undefined = globalThis.navigator?.storage,
): Promise<boolean | undefined> {
  if (!manager) return undefined;
  try {
    return await manager.persist();
  } catch {
    return false;
  }
}

export function storageFailureMessage(error: unknown, operation: string): string {
  const name = error && typeof error === "object" && "name" in error
    ? String((error as { name?: unknown }).name ?? "")
    : "";
  if (name === "QuotaExceededError") {
    return `${operation}失败：浏览器本地存储空间不足。请先导出备份，再清理不需要的站点数据或乐谱。`;
  }
  if (name === "SecurityError" || name === "InvalidStateError" || name === "NotAllowedError") {
    return `${operation}失败：浏览器禁止本地存储。请退出私密模式，并确认没有禁用此站点的数据权限。`;
  }
  return error instanceof Error && error.message ? error.message : `${operation}失败`;
}

export function formatStorageStatus(status: BrowserStorageStatus): string {
  if (!status.available) return "浏览器未提供存储诊断；请定期导出备份";
  const persistence = status.persistent === true
    ? "已获持久存储保护"
    : status.persistent === false
      ? "可能被浏览器自动清理"
      : "持久状态未知";
  if (status.usage === undefined || status.quota === undefined || status.quota <= 0) return persistence;
  const usedMiB = status.usage / 1024 / 1024;
  const quotaMiB = status.quota / 1024 / 1024;
  const proportion = Math.min(100, (status.usage / status.quota) * 100);
  return `${persistence} · ${usedMiB.toFixed(1)} / ${quotaMiB.toFixed(1)} MiB（${proportion.toFixed(1)}%）`;
}
