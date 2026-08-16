interface DiscoveryPlugin {
  resolve(): Promise<{ host?: string }>;
}

interface DiscoveryWindow extends Window {
  Capacitor?: {
    Plugins?: { NoteFallDiscovery?: DiscoveryPlugin };
    registerPlugin?: (name: string) => DiscoveryPlugin;
  };
}

export async function discoverNativeDeviceWebSocket(
  host: Window = window,
): Promise<string | undefined> {
  const capacitor = (host as DiscoveryWindow).Capacitor;
  // Custom native plugins are listed in PluginHeaders by the Android bridge,
  // but Capacitor only creates their JavaScript proxy after registerPlugin().
  // Looking in Plugins alone therefore works in mocks yet silently skips the
  // real plugin on a fresh native install.
  const plugin = capacitor?.Plugins?.NoteFallDiscovery
    ?? capacitor?.registerPlugin?.("NoteFallDiscovery");
  if (!plugin) return undefined;
  const result = await plugin.resolve();
  const candidate = result.host?.trim();
  if (!candidate || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(candidate)) return undefined;
  const octets = candidate.split(".").map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return undefined;
  return `ws://${candidate}:81/`;
}
