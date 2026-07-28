import { SocialLogin } from "@capgo/capacitor-social-login";
import { isNative, isIOS, GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from "./platform";

let initPromise = null;

// SocialLogin.initialize must run once before any login() call. Kept lazy so the
// web build never touches it.
function ensureInitialized() {
  if (!initPromise) {
    initPromise = SocialLogin.initialize({
      google: {
        webClientId: GOOGLE_WEB_CLIENT_ID,
        iOSClientId: GOOGLE_IOS_CLIENT_ID || undefined,
      },
      ...(isIOS ? { apple: {} } : {}),
    });
  }
  return initPromise;
}

export function isUserCancellation(err) {
  return err?.code === "USER_CANCELLED";
}

// Returns the Google ID token, which /api/auth/google verifies server-side.
//
// No `scopes` are requested on purpose. The plugin always asks for openid,
// userinfo.email and userinfo.profile, which is exactly the sub/email/name the
// backend reads — and passing *any* scopes array makes its Android side demand a
// MainActivity that implements ModifiedMainActivityForSocialLoginPlugin, failing
// with "You CANNOT use scopes without modifying the main activity" instead of
// signing in.
export async function nativeGoogleIdToken() {
  if (!isNative) throw new Error("nativeGoogleIdToken called outside the native shell");
  await ensureInitialized();
  const { result } = await SocialLogin.login({
    provider: "google",
    options: {},
  });
  if (!result?.idToken) throw new Error("Google did not return an ID token");
  return result.idToken;
}

// Apple only ever returns the user's name on the very first authorization, so it
// is passed along to the backend rather than being looked up later.
export async function nativeAppleCredential() {
  if (!isIOS) throw new Error("nativeAppleCredential called outside iOS");
  await ensureInitialized();
  const { result } = await SocialLogin.login({
    provider: "apple",
    options: { scopes: ["email", "name"] },
  });
  if (!result?.idToken) throw new Error("Apple did not return an identity token");
  const given = result.profile?.givenName || "";
  const family = result.profile?.familyName || "";
  return {
    idToken: result.idToken,
    displayName: `${given} ${family}`.trim() || undefined,
  };
}
