import { useState } from "react";
import { createPool, joinPool } from "../api";

function JoinPool({ sport, tournament, onJoin, onBack }) {
  const [mode, setMode] = useState(null); // null, "create", "join"
  const [poolName, setPoolName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    if (!poolName.trim() || !password.trim()) {
      setError("Pool name and password are required");
      return;
    }
    const result = await createPool(poolName.trim(), sport.id, tournament.id, password.trim());
    if (result.error) {
      setError(result.error);
      return;
    }
    onJoin(result);
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    setError("");
    if (!poolName.trim() || !password.trim()) {
      setError("Pool name and password are required");
      return;
    }
    const result = await joinPool(poolName.trim(), password.trim());
    if (result.error) {
      setError(result.error);
      return;
    }
    onJoin(result);
  };

  const resetMode = () => {
    setMode(null);
    setError("");
    setPoolName("");
    setPassword("");
  };

  if (!mode) {
    return (
      <div className="select-page">
        <button className="back-btn" onClick={onBack}>&larr; Back</button>
        <h2>{tournament.emoji} {tournament.name}</h2>
        <p className="select-subtitle">Create a new pool or join an existing one</p>
        <div className="sport-grid">
          <button className="sport-card" onClick={() => setMode("create")}>
            <span className="sport-emoji">+</span>
            <span className="sport-name">Create Pool</span>
          </button>
          <button className="sport-card" onClick={() => setMode("join")}>
            <span className="sport-emoji">{"\uD83D\uDD11"}</span>
            <span className="sport-name">Join Pool</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="select-page">
      <button className="back-btn" onClick={resetMode}>&larr; Back</button>
      <h2>{mode === "create" ? "Create a Pool" : "Join a Pool"}</h2>
      <p className="select-subtitle">
        {mode === "create"
          ? "Set a pool name and password for your group"
          : "Enter the pool name and password to join"}
      </p>
      <form onSubmit={mode === "create" ? handleCreate : handleJoin} className="pool-form-vertical">
        <input
          value={poolName}
          onChange={(e) => setPoolName(e.target.value)}
          placeholder="Pool name"
          autoFocus
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        <button type="submit">
          {mode === "create" ? "Create Pool" : "Join Pool"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

export default JoinPool;
