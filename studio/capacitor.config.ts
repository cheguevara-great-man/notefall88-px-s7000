import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.notefall.studio",
  appName: "NoteFall Studio",
  webDir: "../dist/studio",
  server: {
    // The ESP32 Core intentionally exposes ws:// on its isolated local network.
    // Native platform policies are narrowed to local traffic in their projects.
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
