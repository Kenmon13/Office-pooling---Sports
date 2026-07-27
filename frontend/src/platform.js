import { Capacitor } from "@capacitor/core";

// True when running inside the iOS/Android Capacitor shell rather than a browser.
export const isNative = Capacitor.isNativePlatform();
export const isIOS = Capacitor.getPlatform() === "ios";
export const isAndroid = Capacitor.getPlatform() === "android";

// The public site. Used both as the API origin for native builds and to build
// shareable invite links, which must never point at the in-app webview origin.
const DEFAULT_SITE_ORIGIN = "https://sportspooling.com";

export const SITE_ORIGIN = isNative
  ? (import.meta.env.VITE_API_BASE || DEFAULT_SITE_ORIGIN).replace(/\/$/, "")
  : window.location.origin;

// On the web the app is served by the same Express process that owns /api, so a
// relative path is correct. In the native shell the page is loaded from
// capacitor://localhost (iOS) or https://localhost (Android), so every request
// needs an absolute origin pointing at the deployed server.
export const API_ORIGIN = isNative ? SITE_ORIGIN : "";

// Google OAuth clients. The web client ID doubles as the Android `webClientId`,
// which is what determines the `aud` claim of the ID token Android returns — so
// the backend keeps accepting Android tokens unchanged. iOS returns tokens
// issued to its own client ID, which the backend must also accept.
export const GOOGLE_WEB_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID ||
  "719484309775-ooani0nttr0qeijov4ar50nk845364rt.apps.googleusercontent.com";
export const GOOGLE_IOS_CLIENT_ID = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID || "";

// Push registration calls into Firebase natively. If the Firebase config file is
// missing, that call throws IllegalStateException on the plugin thread and kills
// the app — an exception no JS try/catch can reach. So push stays off unless the
// build explicitly opts in, which you do at the same time as adding
// android/app/google-services.json. See MOBILE.md.
export const PUSH_ENABLED = import.meta.env.VITE_PUSH_ENABLED === "true";
