export type ImmersiveModeResult = "native" | "browser" | "css";

interface ImmersiveModePlugin {
  setEnabled(options: { enabled: boolean }): Promise<void>;
}

interface ImmersiveCapacitorWindow extends Window {
  Capacitor?: { Plugins?: { ImmersiveMode?: ImmersiveModePlugin } };
}

function nativePlugin(host: Window = window): ImmersiveModePlugin | undefined {
  return (host as ImmersiveCapacitorWindow).Capacitor?.Plugins?.ImmersiveMode;
}

/**
 * Requests the strongest fullscreen surface available. The caller always
 * applies the CSS focus layout first, so a rejected browser request remains a
 * useful app-local fullscreen mode instead of turning into a dead button.
 */
export async function requestImmersiveMode(
  enabled: boolean,
  documentTarget: Document = document,
  host: Window = window,
): Promise<ImmersiveModeResult> {
  const plugin = nativePlugin(host);
  if (plugin) {
    try {
      await plugin.setEnabled({ enabled });
      return "native";
    } catch {
      // A broken/missing native bridge should still fall through to the Web
      // Fullscreen API and finally to the always-available CSS focus layout.
    }
  }

  if (enabled) {
    if (!documentTarget.fullscreenElement && documentTarget.documentElement.requestFullscreen) {
      try {
        await documentTarget.documentElement.requestFullscreen({ navigationUI: "hide" });
        return "browser";
      } catch {
        return "css";
      }
    }
  } else if (documentTarget.fullscreenElement && documentTarget.exitFullscreen) {
    try {
      await documentTarget.exitFullscreen();
      return "browser";
    } catch {
      return "css";
    }
  }
  return "css";
}
