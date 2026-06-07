import { useState, useEffect } from "react";
import { createPool, joinPool, fetchPublicPools, fetchUserPools, fetchGlobalStats } from "../api";
import { flag } from "../flags";

function JoinPool({ sport, tournament, onJoin, onBack }) {
  const [mode, setMode] = useState(null); // null, "create", "join", "public"
  const [poolName, setPoolName] = useState("");
  const [password, setPassword] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState("");
  const [publicPools, setPublicPools] = useState([]);
  const [loadingPublic, setLoadingPublic] = useState(false);
  const [joiningPoolId, setJoiningPoolId] = useState(null);
  const [myPools, setMyPools] = useState([]);
  const [globalStats, setGlobalStats] = useState(null);

  useEffect(() => {
    fetchUserPools().then((data) => {
      if (Array.isArray(data)) setMyPools(data.filter((p) => p.tournament === tournament.id));
    }).catch(() => {});
    fetchGlobalStats(tournament.id).then((data) => {
      if (!data.error) setGlobalStats(data);
    }).catch(() => {});
  }, [tournament.id]);

  const handlePublicBrowse = async () => {
    setMode("public");
    setError("");
    setLoadingPublic(true);
    const pools = await fetchPublicPools(sport.id, tournament.id);
    setPublicPools(pools);
    setLoadingPublic(false);
  };

  const handleJoinPublicPool = async (pool) => {
    setJoiningPoolId(pool.id);
    setError("");
    const result = await joinPool(pool.name, "");
    if (result.error) {
      setError(result.error);
      setJoiningPoolId(null);
    } else {
      onJoin(result);
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
          <button className="sport-card" onClick={handlePublicBrowse}>
            <span className="sport-emoji">{"\uD83C\uDF0D"}</span>
            <span className="sport-name">Public Pool</span>
          </button>
          {globalStats && globalStats.champions.length > 0 && (
            <button className="sport-card" onClick={() => setMode("stats")}>
              <span className="sport-emoji">{"\uD83D\uDCCA"}</span>
              <span className="sport-name">Stats</span>
            </button>
          )}
        </div>

        {myPools.length > 0 && (
          <div className="my-pools-section">
            <p className="my-pools-title">Pools you are a member of</p>
            <div className="pool-list">
              {myPools.map((p) => (
                <div key={p.id} className="pool-list-item">
                  <button className="pool-list-btn" onClick={() => onJoin(p)}>
                    <span className="pool-list-name">{p.name}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    );
  }

  if (mode === "stats") {
    return (
      <div className="select-page">
        <button className="back-btn" onClick={resetMode}>&larr; Back</button>
        <h2>Community Predictions</h2>
        <p className="select-subtitle">
          Based on {globalStats?.totalPlayers || 0} player{globalStats?.totalPlayers !== 1 ? "s" : ""} across all pools
        </p>

        {globalStats && globalStats.champions.length > 0 && (
          <div className="global-stats-section">
            <h4>Predicted Winner</h4>
            <div className="stats-list">
              {globalStats.champions.slice(0, 10).map((t, i) => (
                <div key={t.team_id} className="stats-row">
                  <span className="stats-rank">#{i + 1}</span>
                  <span className="stats-team">
                    {flag(t.team_code)}
                    {t.team_name}
                  </span>
                  <div className="stats-bar-wrapper">
                    <div className="stats-bar" style={{ width: `${t.percentage}%` }} />
                  </div>
                  <span className="stats-pct">{t.percentage}%</span>
                  <span className="stats-count">({t.pick_count})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {globalStats && globalStats.groups.length > 0 && (
          <div className="global-stats-section">
            <h4>Group Stage Favourites</h4>
            <div className="stats-groups-grid">
              {globalStats.groups.map((g) => (
                <div key={g.group_id} className="stats-group-card">
                  <h4>{g.group_name}</h4>
                  {g.teams.slice(0, 4).map((t, i) => (
                    <div key={t.team_id} className="stats-row stats-row-compact">
                      <span className="stats-rank-sm">#{i + 1}</span>
                      <span className="stats-team">
                        {flag(t.team_code)}
                        {t.team_name}
                      </span>
                      <div className="stats-bar-wrapper">
                        <div className="stats-bar stats-bar-group" style={{ width: `${t.percentage}%` }} />
                      </div>
                      <span className="stats-pct">{t.percentage}%</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (mode === "public") {
    return (
      <div className="select-page">
        <button className="back-btn" onClick={resetMode}>&larr; Back</button>
        <h2>Public Pools</h2>
        <p className="select-subtitle">Join an open pool — no password needed</p>
        {loadingPublic && <p className="notice">Loading...</p>}
        {!loadingPublic && publicPools.length === 0 && (
          <p className="notice">No public pools available for this tournament yet.</p>
        )}
        {error && <p className="error">{error}</p>}
        {publicPools.length > 0 && (
          <div className="pool-list">
            {publicPools.map((p) => (
              <div key={p.id} className="pool-list-item">
                <button
                  className="pool-list-btn"
                  onClick={() => handleJoinPublicPool(p)}
                  disabled={joiningPoolId === p.id}
                >
                  <span className="pool-list-name">{p.name}</span>
                  <span className="pool-list-meta">
                    {p.member_count} member{p.member_count !== 1 ? "s" : ""}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
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
