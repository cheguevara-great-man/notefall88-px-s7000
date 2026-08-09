export const STUDIO_DEVICE_ENDPOINT_KEY = "notefall-studio-device-endpoint";

export function normalizeDeviceWebSocketUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "ws://192.168.4.1:81/";
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  const converted = withScheme
    .replace(/^http:\/\//i, "ws://")
    .replace(/^https:\/\//i, "wss://");
  let url: URL;
  try {
    url = new URL(converted);
  } catch {
    throw new Error("设备地址应为 IP、主机名或 ws:// 地址");
  }
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error("设备地址只支持 ws:// 或 wss://");
  if (url.username || url.password) throw new Error("设备地址不能包含用户名或密码");
  if (url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new Error("设备地址不能包含路径、查询参数或锚点");
  }
  if (!url.port) url.port = "81";
  url.pathname = "/";
  return url.toString();
}

export function endpointSecurityNotice(webSocketUrl: string, pageProtocol: string): string | undefined {
  if (pageProtocol === "https:" && webSocketUrl.startsWith("ws://")) {
    return "当前 HTTPS 页面可能阻止局域网明文 WebSocket；请使用 NoteFall Studio 本地安装包获得确定性连接。";
  }
  return undefined;
}
