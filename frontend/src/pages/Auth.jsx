import { useState } from "react";
import { signUp, signIn, forgotPassword, resetPassword, googleSignIn } from "../api";
import { GoogleLogin } from "@react-oauth/google";
import PasswordInput from "../components/PasswordInput";

function Auth({ onAuth, initialView }) {
  const [mode, setMode] = useState(initialView || "signin"); // "signin", "signup", "forgot", "reset"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [resetToken] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  });
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleGoogleSuccess = async (credentialResponse) => {
    setError("");
    const result = await googleSignIn(credentialResponse.credential);
    if (result.error) {
      setError(result.error);
      return;
    }
    onAuth(result);
  };

  // Auto-detect reset-password mode from URL
  useState(() => {
    if (window.location.pathname === "/reset-password" && resetToken) {
      setMode("reset");
    }
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (mode === "signup") {
      if (!username.trim() || !password.trim() || !displayName.trim() || !email.trim()) {
        setError("All fields are required");
        return;
      }
      const result = await signUp(username.trim(), password.trim(), displayName.trim(), email.trim());
      if (result.error) {
        setError(result.error);
        return;
      }
      onAuth(result);
    } else {
      if (!username.trim() || !password.trim()) {
        setError("Username and password are required");
        return;
      }
      const result = await signIn(username.trim(), password.trim());
      if (result.error) {
        setError(result.error);
        return;
      }
      onAuth(result);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    setSubmitting(true);
    const res = await forgotPassword(email.trim());
    if (res.error) {
      setError(res.error);
    } else {
      setSuccessMsg("If an account with that email exists, a reset link has been sent. Check your inbox.");
    }
    setSubmitting(false);
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    if (!newPassword.trim()) {
      setError("New password is required");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    const res = await resetPassword(resetToken, newPassword.trim());
    if (res.error) {
      setError(res.error);
    } else {
      setSuccessMsg("Password reset successfully! You can now sign in.");
      window.history.replaceState(null, "", "/");
      setTimeout(() => { setMode("signin"); setSuccessMsg(""); }, 2000);
    }
    setSubmitting(false);
  };

  if (mode === "reset") {
    return (
      <div className="select-page">
        <h2>Reset Password</h2>
        <p className="select-subtitle">Enter your new password.</p>
        <form onSubmit={handleResetPassword} className="pool-form-vertical">
          <PasswordInput
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            autoFocus
          />
          <PasswordInput
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
          />
          <button type="submit" disabled={submitting}>
            {submitting ? "Resetting..." : "Reset Password"}
          </button>
          {error && <p className="error">{error}</p>}
          {successMsg && <p className="success-msg">{successMsg}</p>}
        </form>
      </div>
    );
  }

  if (mode === "forgot") {
    return (
      <div className="select-page">
        <h2>Forgot Password</h2>
        <p className="select-subtitle">Enter your email and we will send you a reset link.</p>
        <form onSubmit={handleForgotPassword} className="pool-form-vertical">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            autoFocus
          />
          <button type="submit" disabled={submitting}>
            {submitting ? "Sending..." : "Send Reset Link"}
          </button>
          {error && <p className="error">{error}</p>}
          {successMsg && <p className="success-msg">{successMsg}</p>}
        </form>
        <button
          className="auth-toggle"
          onClick={() => { setMode("signin"); setError(""); setSuccessMsg(""); }}
        >
          Back to Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="select-page">
      <h2>{mode === "signin" ? "Sign In" : "Sign Up"}</h2>
      <p className="select-subtitle">
        {mode === "signin"
          ? "Welcome back! Sign in to continue."
          : "Create an account to get started."}
      </p>
      <form onSubmit={handleSubmit} className="pool-form-vertical">
        {mode === "signup" && (
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name"
            autoFocus
          />
        )}
        {mode === "signup" && (
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
          />
        )}
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoFocus={mode === "signin"}
        />
        <PasswordInput
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        {mode === "signup" && (
          <p className="auth-legal-notice">
            By signing up you agree to our{" "}
            <a href="/terms" className="auth-legal-link">Terms & Privacy</a>.
          </p>
        )}
        <button type="submit">
          {mode === "signin" ? "Sign In" : "Sign Up"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
      <div className="auth-divider">
        <span>or</span>
      </div>
      <div className="google-login-wrapper">
        <GoogleLogin
          onSuccess={handleGoogleSuccess}
          onError={() => setError("Google sign-in failed")}
          theme="filled_black"
          size="large"
          width="280"
          text={mode === "signin" ? "signin_with" : "signup_with"}
        />
      </div>
      {mode === "signin" && (
        <button
          className="auth-toggle forgot-link"
          onClick={() => { setMode("forgot"); setError(""); }}
        >
          Forgot your password?
        </button>
      )}
      <button
        className="auth-toggle"
        onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}
      >
        {mode === "signin"
          ? "Don't have an account? Sign up"
          : "Already have an account? Sign in"}
      </button>
    </div>
  );
}

export default Auth;
