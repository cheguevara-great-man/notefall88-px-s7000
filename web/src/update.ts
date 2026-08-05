export type UpdateTarget = "firmware" | "filesystem";

export interface UpdateInfo {
  firmware: string;
  protocol: number;
  running: string;
  firmwareMax: number;
  filesystemMax: number;
  apOnly: boolean;
}

export interface UpdateResult {
  ok: boolean;
  written: number;
  error?: string;
}

export interface FileLike {
  name: string;
  size: number;
}

export function validateUpdateFile(
  file: FileLike,
  target: UpdateTarget,
  info?: Pick<UpdateInfo, "firmwareMax" | "filesystemMax">,
): string | undefined {
  if (!/\.bin$/i.test(file.name)) return "更新文件必须是 .bin";
  if (file.size < 1_024) return "更新文件过小，可能不是有效镜像";
  const maximum = target === "firmware" ? info?.firmwareMax : info?.filesystemMax;
  if (maximum && file.size > maximum) return `文件超过 ${target === "firmware" ? "固件" : "网页"}分区上限`;
  return undefined;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  let parsed: T;
  try {
    parsed = JSON.parse(body) as T;
  } catch {
    throw new Error(`设备返回了无法识别的响应（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    const error = (parsed as { error?: string }).error;
    throw new Error(error || `设备拒绝了请求（HTTP ${response.status}）`);
  }
  return parsed;
}

export async function fetchUpdateInfo(): Promise<UpdateInfo> {
  return responseJson<UpdateInfo>(await fetch("/api/update-info", { cache: "no-store" }));
}

export function uploadUpdate(
  file: File,
  target: UpdateTarget,
  password: string,
  onProgress: (proportion: number) => void,
): Promise<UpdateResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/update?target=${encodeURIComponent(target)}`);
    request.timeout = 10 * 60 * 1_000;
    request.setRequestHeader("X-NoteFall-Admin", password);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
    };
    request.onerror = () => reject(new Error("更新上传中断；设备未确认成功，请不要立刻断电"));
    request.ontimeout = () => reject(new Error("更新超时；设备未确认成功，请不要立刻断电"));
    request.onload = () => {
      try {
        const parsed = JSON.parse(request.responseText) as UpdateResult;
        if (request.status < 200 || request.status >= 300 || !parsed.ok) {
          reject(new Error(parsed.error || `更新失败（HTTP ${request.status}）`));
        } else {
          onProgress(1);
          resolve(parsed);
        }
      } catch (error) {
        reject(error instanceof SyntaxError ? new Error("设备更新响应无法解析") : error);
      }
    };
    const body = new FormData();
    body.append("image", file, file.name);
    request.send(body);
  });
}

export async function changeAccessPointPassword(current: string, next: string): Promise<void> {
  if (next.length < 8 || next.length > 63) throw new Error("新热点密码必须为 8–63 个字符");
  const body = new URLSearchParams({ next });
  await responseJson(await fetch("/api/ap-password", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-NoteFall-Admin": current },
    body,
  }));
}

export async function saveStationWifi(ssid: string, password: string, current: string): Promise<void> {
  const trimmed = ssid.trim();
  if (!trimmed || new TextEncoder().encode(trimmed).length > 32) {
    throw new Error("Wi-Fi 名称必须为 1–32 字节");
  }
  const passwordBytes = new TextEncoder().encode(password).length;
  if (passwordBytes !== 0 && (passwordBytes < 8 || passwordBytes > 63)) {
    throw new Error("Wi-Fi 密码必须为空或 8–63 字节");
  }
  if (!current) throw new Error("请输入当前热点密码");
  const body = new URLSearchParams({ ssid: trimmed, password });
  await responseJson(await fetch("/api/wifi", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-NoteFall-Admin": current },
    body,
  }));
}
