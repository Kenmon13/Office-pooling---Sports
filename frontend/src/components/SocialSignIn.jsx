import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { isNative, isIOS } from "../platform";
import { nativeGoogleIdToken, nativeAppleCredential, isUserCancellation } from "../nativeAuth";
import { googleSignIn, appleSignIn } from "../api";

// Google's web SDK refuses to run inside an embedded webview, so the native
// shell has to go through the platform sign-in sheets instead.
function SocialSignIn({ mode, onAuth, onError }) {
  const [busy, setBusy] = useState("");

  const run = async (provider, fn) => {
    onError("");
    setBusy(provider);
    try {
      const result = await fn();
      if (result.error) {
        onError(result.error);
        return;
      }
      onAuth(result);
    } catch (err) {
      if (!isUserCancellation(err)) {
        onError(err?.message || `${provider} sign-in failed`);
      }
    } finally {
      setBusy("");
    }
  };

  if (!isNative) {
    return (
      <div className="google-login-wrapper">
        <GoogleLogin
          onSuccess={(credentialResponse) =>
            run("Google", async () => googleSignIn(credentialResponse.credential))
          }
          onError={() => onError("Google sign-in failed")}
          theme="filled_black"
          size="large"
          width="280"
          text={mode === "signin" ? "signin_with" : "signup_with"}
        />
      </div>
    );
  }

  const verb = mode === "signin" ? "Sign in" : "Sign up";

  return (
    <div className="native-social-buttons">
      <button
        type="button"
        className="native-social-btn native-social-btn-google"
        disabled={!!busy}
        onClick={() => run("Google", async () => googleSignIn(await nativeGoogleIdToken()))}
      >
        {busy === "Google" ? "Signing in…" : `${verb} with Google`}
      </button>
      {isIOS && (
        <button
          type="button"
          className="native-social-btn native-social-btn-apple"
          disabled={!!busy}
          onClick={() =>
            run("Apple", async () => {
              const { idToken, displayName } = await nativeAppleCredential();
              return appleSignIn(idToken, displayName);
            })
          }
        >
          {busy === "Apple" ? "Signing in…" : `${verb} with Apple`}
        </button>
      )}
    </div>
  );
}

export default SocialSignIn;
