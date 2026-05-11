import { useState } from "react";
import { adminLogin, adminDeletePool } from "../api";

const SPORT_LABELS = {
  soccer: { name: "Soccer", emoji: "\u26BD" },
  basketball: { name: "Basketball", emoji: "\uD83C\uDFC0" },
};

const TOURNAMENT_LABELS = {
  wc2026: "World Cup 2026",
  ucl2627: "Champions League 26/27",
  epl2627: "English Premier League 26/27",
};

function AdminPanel({ onSelectPool, onBack }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [creds, setCreds] = useState(null);
  const [pools, setPools] = useState([]);
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password.trim()) {
      setError("Username and password are required");
      return;
    }
    const result = await adminLogin(username.trim(), password.trim());
    if (result.error) {
      setError(result.error);
      return;
    }
    setCreds({ username: username.trim(), password: password.trim() });
    setPools(result.pools);
  };

  const handleDelete = async (e, poolId) => {
    e.stopPropagation();
    if (!confirm("Delete this pool? All participants and predictions will be removed.")) return;
    await adminDeletePool(poolId, creds.username, creds.password);
    setPools((prev) => prev.filter((p) => p.id !== poolId));
  };

  if (!creds) {
    return (
      <div className="select-page">
        <button className="back-btn" onClick={onBack}>&larr; Back</button>
        <h2>Admin Login</h2>
        <p className="select-subtitle">Enter admin credentials</p>
        <form onSubmit={handleLogin} className="pool-form-vertical">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoFocus
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
          <button type="submit">Login</button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    );
  }

  // Group pools by sport, then by tournament
  const grouped = {};
  for (const p of pools) {
    if (!grouped[p.sport]) grouped[p.sport] = {};
    if (!grouped[p.sport][p.tournament]) grouped[p.sport][p.tournament] = [];
    grouped[p.sport][p.tournament].push(p);
  }

  const totalUsers = pools.reduce((sum, p) => sum + (p.user_count || 0), 0);

  return (
    <div className="select-page admin-dashboard">
      <button className="back-btn" onClick={onBack}>&larr; Back</button>
      <h2>Admin Dashboard</h2>
      <p className="select-subtitle">{pools.length} pool{pools.length !== 1 ? "s" : ""} &middot; {totalUsers} total user{totalUsers !== 1 ? "s" : ""}</p>

      {Object.keys(grouped).length === 0 && <p className="notice">No pools created yet.</p>}

      {Object.entries(grouped).map(([sport, tournaments]) => {
        const sportLabel = SPORT_LABELS[sport] || { name: sport, emoji: "" };
        const sportUsers = Object.values(tournaments).flat().reduce((sum, p) => sum + (p.user_count || 0), 0);
        const sportPools = Object.values(tournaments).flat().length;

        return (
          <div key={sport} className="admin-sport-section">
            <div className="admin-sport-header">
              <span>{sportLabel.emoji} {sportLabel.name}</span>
              <span className="admin-sport-stats">{sportPools} pool{sportPools !== 1 ? "s" : ""} &middot; {sportUsers} user{sportUsers !== 1 ? "s" : ""}</span>
            </div>

            {Object.entries(tournaments).map(([tournament, tournamentPools]) => {
              const tournamentLabel = TOURNAMENT_LABELS[tournament] || tournament;
              const tournamentUsers = tournamentPools.reduce((sum, p) => sum + (p.user_count || 0), 0);

              return (
                <div key={tournament} className="admin-tournament-section">
                  <div className="admin-tournament-header">
                    <span>{tournamentLabel}</span>
                    <span className="admin-tournament-stats">{tournamentPools.length} pool{tournamentPools.length !== 1 ? "s" : ""} &middot; {tournamentUsers} user{tournamentUsers !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="pool-list">
                    {tournamentPools.map((p) => (
                      <div key={p.id} className="pool-list-item">
                        <button
                          className="pool-list-btn"
                          onClick={() => onSelectPool({ id: p.id, name: p.name, sport: p.sport, tournament: p.tournament, isAdmin: true })}
                        >
                          <span className="pool-list-name">{p.name}</span>
                          <span className="pool-list-meta">{p.user_count || 0} user{p.user_count !== 1 ? "s" : ""}</span>
                        </button>
                        <button
                          className="pool-delete-btn"
                          onClick={(e) => handleDelete(e, p.id)}
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default AdminPanel;
