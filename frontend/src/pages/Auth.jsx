import { useState } from "react";
import { signUp, signIn } from "../api";

function Auth({ onAuth }) {
  const [mode, setMode] = useState("signin"); // "signin" or "signup"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (mode === "signup") {
      if (!username.trim() || !password.trim() || !displayName.trim()) {
        setError("All fields are required");
        return;
      }
      const result = await signUp(username.trim(), password.trim(), displayName.trim());
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
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoFocus={mode === "signin"}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        <button type="submit">
          {mode === "signin" ? "Sign In" : "Sign Up"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
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
