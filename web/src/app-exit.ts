interface NativeAppWindow extends Window {
  Capacitor?: { Plugins?: { App?: { exitApp?: () => Promise<void> } } };
}

/** Keep a visible exit affordance even while Android's immersive gesture is hidden. */
document.getElementById("app-exit")?.addEventListener("click", () => {
  const nativeApp = (window as NativeAppWindow).Capacitor?.Plugins?.App;
  if (nativeApp?.exitApp) {
    void nativeApp.exitApp();
    return;
  }
  window.history.back();
});
