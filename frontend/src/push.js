import { PushNotifications } from "@capacitor/push-notifications";
import { isNative, isIOS, isAndroid, PUSH_ENABLED } from "./platform";
import { registerPushToken, unregisterPushToken } from "./api";

// The FCM/APNs registration token for this device. Kept so sign-out can tell the
// server to stop sending to a device the user has left.
let currentToken = null;
let listenersAttached = false;

// Called when the user taps a notification; App wires this to routing.
let onOpen = null;
export function setPushOpenHandler(fn) {
  onOpen = fn;
}

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  PushNotifications.addListener("registration", async (token) => {
    currentToken = token.value;
    try {
      await registerPushToken(token.value, isIOS ? "ios" : "android");
    } catch {
      // Offline or server down — the token is re-emitted on next app start.
    }
  });

  PushNotifications.addListener("registrationError", (err) => {
    console.warn("Push registration failed:", err?.error || err);
  });

  // Tapping a notification should land the user on the thing it was about.
  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data = action?.notification?.data || {};
    if (onOpen) onOpen(data);
  });
}

// Asks for permission and registers the device. Safe to call on every sign-in:
// FCM returns the same token, and the backend upsert makes repeats a no-op.
export async function enablePush() {
  if (!isNative) return { ok: false, reason: "not-native" };
  if (!PUSH_ENABLED) return { ok: false, reason: "not-configured" };

  try {
    attachListeners();

    // The server sends to channel "matches". On Android 8+ a notification aimed at
    // a channel that does not exist is dropped silently, so create it up front.
    if (isAndroid) {
      await PushNotifications.createChannel({
        id: "matches",
        name: "Match updates",
        description: "Pick reminders before kickoff and results when a match ends.",
        importance: 4,
        visibility: 1,
      }).catch(() => {});
    }

    let status = await PushNotifications.checkPermissions();
    if (status.receive === "prompt" || status.receive === "prompt-with-rationale") {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== "granted") return { ok: false, reason: "denied" };

    await PushNotifications.register();
    return { ok: true };
  } catch (err) {
    console.warn("Push setup failed:", err?.message || err);
    return { ok: false, reason: "error" };
  }
}

// Drops this device from the user's account so the next person to sign in on the
// same handset does not receive the previous user's notifications.
export async function disablePush() {
  if (!isNative || !currentToken) return;
  try {
    await unregisterPushToken(currentToken);
  } catch {
    // Best effort: a failed unregister is corrected the next time the token is
    // registered, because the backend reassigns a token to its newest owner.
  }
  currentToken = null;
}
