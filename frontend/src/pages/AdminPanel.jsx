import { useState, useEffect } from "react";
import { adminFetchPools, adminDeletePool, adminFetchUsers, adminDeleteUser } from "../api";

const SPORT_LABELS = {
  soccer: { name: "Soccer", emoji: "\u26BD" },
  basketball: { name: "Basketball", emoji: "\uD83C\uDFC0" },
};

const TOURNAMENT_LABELS = {
  wc2026: "World Cup 2026",
  ucl2627: "Champions League 26/27",
  epl2627: "English Premier League 26/27",
};

function AdminPanel({ user, onSelectPool, onBack }) {
  const [tab, setTab] = useState("pools"); // "pools" or "users"
  const [pools, setPools] = useState([]);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    adminFetchPools(user.id).then((data) => {
      if (!data.error) setPools(data);
    });
    adminFetchUsers(user.id).then((data) => {
      if (!data.error) setUsers(data);
    });
  }, [user.id]);

  const handleDeletePool = async (e, poolId) => {
    e.stopPropagation();
    if (!confirm("Delete this pool? All participants and predictions will be removed.")) return;
    await adminDeletePool(poolId, user.id);
    setPools((prev) => prev.filter((p) => p.id !== poolId));
  };

  const handleDeleteUser = async (targetId) => {
    if (!confirm("Delete this user? All their data will be removed.")) return;
    const result = await adminDeleteUser(targetId, user.id);
    if (result.error) {
      alert(result.error);
      return;
    }
    setUsers((prev) => prev.filter((u) => u.id !== targetId));
  };

  // Group pools by sport, then by tournament
  const grouped = {};
  for (const p of pools) {
    if (!grouped[p.sport]) grouped[p.sport] = {};
    if (!grouped[p.sport][p.tournament]) grouped[p.sport][p.tournament] = [];
    grouped[p.sport][p.tournament].push(p);
  }

  const totalPoolUsers = pools.reduce((sum, p) => sum + (p.user_count || 0), 0);

  return (
    <div className="select-page admin-dashboard">
      <button className="back-btn" onClick={onBack}>&larr; Back</button>
      <h2>Admin Dashboard</h2>

      <div className="admin-tabs">
        <button
          className={`admin-tab ${tab === "pools" ? "active" : ""}`}
          onClick={() => setTab("pools")}
        >
          Pools ({pools.length})
        </button>
        <button
          className={`admin-tab ${tab === "users" ? "active" : ""}`}
          onClick={() => setTab("users")}
        >
          Users ({users.length})
        </button>
      </div>

      {tab === "pools" && (
        <>
          <p className="select-subtitle">{pools.length} pool{pools.length !== 1 ? "s" : ""} &middot; {totalPoolUsers} total participant{totalPoolUsers !== 1 ? "s" : ""}</p>

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
                              onClick={(e) => handleDeletePool(e, p.id)}
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
        </>
      )}

      {tab === "users" && (
        <>
          <p className="select-subtitle">{users.length} registered user{users.length !== 1 ? "s" : ""}</p>
          <div className="pool-list">
            {users.map((u) => (
              <div key={u.id} className="pool-list-item">
                <div className="pool-list-btn user-list-info">
                  <div>
                    <span className="pool-list-name">{u.display_name}</span>
                    <span className="user-username">@{u.username}</span>
                  </div>
                  <span className="pool-list-meta">
                    {u.is_admin ? "Admin" : "User"}
                  </span>
                </div>
                {!u.is_admin && (
                  <button
                    className="pool-delete-btn"
                    onClick={() => handleDeleteUser(u.id)}
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default AdminPanel;
