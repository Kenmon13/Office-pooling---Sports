import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { isNative, isAndroid } from "./platform";

// Wires up the bits of native behaviour a plain webview does not give you:
// status-bar styling, Android's hardware back button, and dismissing the splash
// once React has painted. No-ops on the web build.
export function initNativeShell() {
  if (!isNative) return;

  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  if (isAndroid) {
    StatusBar.setBackgroundColor({ color: "#0b1a0b" }).catch(() => {});
  }

  // Android's back button closes the app by default, which loses the user's
  // place. Walk browser history instead, and only exit from the root.
  if (isAndroid) {
    CapApp.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack && window.history.length > 1) {
        window.history.back();
      } else {
        CapApp.exitApp();
      }
    });
  }

  // requestAnimationFrame so the first frame is on screen before the splash goes.
  requestAnimationFrame(() => {
    setTimeout(() => SplashScreen.hide().catch(() => {}), 200);
  });
}
