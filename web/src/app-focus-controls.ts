interface NativeAppPlugin {
  addListener?: (
    eventName: "backButton",
    callback: (event: { canGoBack: boolean }) => void,
  ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
}

interface FocusControlWindow extends Window {
  Capacitor?: { Plugins?: { App?: NativeAppPlugin } };
}

const shell = document.querySelector<HTMLElement>(".app-shell");
const timeline = document.getElementById("top-timeline-bar");
const loopButton = document.getElementById("timeline-loop-toggle");
const stripButton = document.getElementById("strip-toggle");
const appExit = document.getElementById("app-exit");

// Preserve the normal toolbar position without cloning the lamp control (and
// therefore without creating a second state or a duplicate event handler).
const stripHome = document.createComment("strip-toggle home");
stripButton?.parentNode?.insertBefore(stripHome, stripButton);

function syncFocusControls(): void {
  const focused = shell?.dataset.focus === "true";
  if (!stripButton) return;
  stripButton.classList.toggle("timeline-strip-toggle", focused);
  if (focused && timeline && loopButton) {
    timeline.insertBefore(stripButton, loopButton.nextSibling);
  } else if (stripHome.parentNode) {
    stripHome.parentNode.insertBefore(stripButton, stripHome.nextSibling);
  } else if (appExit?.parentNode) {
    appExit.parentNode.insertBefore(stripButton, appExit);
  }
}

new MutationObserver(syncFocusControls).observe(shell ?? document.body, {
  attributes: true,
  attributeFilter: ["data-focus"],
});
syncFocusControls();

// On gesture-navigation Android devices, an inward swipe from either side
// becomes the native Back event.  While focused, consume exactly that event
// by activating the existing fullscreen toggle; outside fullscreen Android
// retains its normal back behaviour.
const app = (window as FocusControlWindow).Capacitor?.Plugins?.App;
if (app?.addListener) {
  void app.addListener("backButton", () => {
    if (shell?.dataset.focus === "true") {
      document.getElementById("focus-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });
}
