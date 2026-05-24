import { useState, useRef } from "react";
import { createPool, joinPool, fetchPublicPools } from "../api";

function JoinPool({ sport, tournament, onJoin, onBack }) {
  const [mode, setMode] = useState(null); // null, "create", "join"
  const [poolName, setPoolName] = useState("");
  const [password, setPassword] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState("");
  const joiningRef = useRef(false);

  const handlePublicJoin = async () => {
    if (joiningRef.current) return;
    joiningRef.current = true;
    setMode("public");
    setError("");
    const pools = await fetchPublicPools(sport.id, tournament.id);
    if (pools.length > 0) {
      const result = await joinPool(pools[0].name, "");
      if (result.error) {
        setError(result.error);
        setMode(null);
        joiningRef.current = false;
      } else {
        onJoin(result);
      }
    } else {
      setError("No public pool available");
      setMode(null);
      joiningRef.current = false;
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    if (!poolName.trim()) {
      setError("Pool name is required");
      return;
    }
    if (!isPublic && !password.trim()) {
      setError("Password is required for private pools");
      return;
    }
    const result = await createPool(poolName.trim(), sport.id, tournament.id, isPublic ? "" : password.trim(), isPublic);
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
    setIsPublic(false);
    joiningRef.current = false;
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
          <button className="sport-card" onClick={handlePublicJoin}>
            <span className="sport-emoji">{"\uD83C\uDF0D"}</span>
            <span className="sport-name">Public Pool</span>
          </button>
        </div>
      </div>
    );
  }

  if (mode === "public") {
    return (
      <div className="select-page">
        <p className="select-subtitle">Joining public pool...</p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (mode === "create") {
    return (
      <div className="select-page">
        <button className="back-btn" onClick={resetMode}>&larr; Back</button>
        <h2>Create a Pool</h2>
        <p className="select-subtitle">
          {isPublic ? "Anyone can join this pool without a password" : "Set a pool name and password for your group"}
        </p>
        <form onSubmit={handleCreate} className="pool-form-vertical">
          <input
            value={poolName}
            onChange={(e) => setPoolName(e.target.value)}
            placeholder="Pool name"
            autoFocus
          />
          {!isPublic && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
          )}
          <label className="public-toggle">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <span>Make this pool public (anyone can join)</span>
          </label>
          <button type="submit">Create Pool</button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="select-page">
      <button className="back-btn" onClick={resetMode}>&larr; Back</button>
      <h2>Join a Pool</h2>
      <p className="select-subtitle">Enter the pool name and password to join</p>
      <form onSubmit={handleJoin} className="pool-form-vertical">
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
        <button type="submit">Join Pool</button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

export default JoinPool;
