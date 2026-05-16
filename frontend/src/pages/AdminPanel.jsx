import { useState, useEffect } from "react";
import { adminFetchPools, adminDeletePool, adminFetchUsers, adminDeleteUser, adminFetchTestPools, adminCreateTestPool, adminDeletePool as deletePool } from "../api";

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
  const [tab, setTab] = useState("pools");
  const [pools, setPools] = useState([]);
  const [users, setUsers] = useState([]);
  const [testPools, setTestPools] = useState([]);
  const [newTestName, setNewTestName] = useState("");
  const [newTestPwd, setNewTestPwd] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    adminFetchPools(user.id).then((data) => { if (!data.error) setPools(data); });
    adminFetchUsers(user.id).then((data) => { if (!data.error) setUsers(data); });
    adminFetchTestPools(user.id).then((d) => { if (!d.error) setTestPools(d); });
  }, [user.id]);

  const handleCreateTestPool = async () => {
    if (!newTestName.trim() || !newTestPwd.trim()) return;
    setCreating(true);
    try {
      const res = await adminCreateTestPool(user.id, newTestName.trim(), newTestPwd.trim());
      if (!res.error) {
        setNewTestName(""); setNewTestPwd("");
        adminFetchTestPools(user.id).then((d) => { if (!d.error) setTestPools(d); });
      } else {
        alert(res.error);
      }
    } catch (err) {
      alert("Failed to create pool: " + err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTestPool = async (poolId) => {
    if (!confirm("Delete this test pool and all its data?")) return;
    await deletePool(poolId, user.id);
    setTestPools((prev) => prev.filter((p) => p.id !== poolId));
  };

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
        <button className={`admin-tab ${tab === "pools" ? "active" : ""}`} onClick={() => setTab("pools")}>
          Pools ({pools.length})
        </button>
        <button className={`admin-tab ${tab === "users" ? "active" : ""}`} onClick={() => setTab("users")}>
          Users ({users.length})
        </button>
        <button className={`admin-tab ${tab === "test" ? "active" : ""}`} onClick={() => setTab("test")}>
          Test ({testPools.length})
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
                  <button className="pool-delete-btn" onClick={() => handleDeleteUser(u.id)}>&times;</button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "test" && (
        <>
          <p className="select-subtitle">WC2022 test pools — isolated data, all results known.</p>

          <div className="test-pool-create">
            <input
              className="test-input"
              placeholder="Pool name"
              value={newTestName}
              onChange={(e) => setNewTestName(e.target.value)}
            />
            <input
              className="test-input"
              placeholder="Password"
              value={newTestPwd}
              onChange={(e) => setNewTestPwd(e.target.value)}
            />
            <button className="btn-submit" onClick={handleCreateTestPool} disabled={creating || !newTestName.trim() || !newTestPwd.trim()}>
              {creating ? "Creating…" : "Create WC2022 Test Pool"}
            </button>
          </div>

          {testPools.length === 0 && <p className="notice">No test pools yet.</p>}
          <div className="pool-list" style={{ marginTop: 12 }}>
            {testPools.map((p) => (
              <div key={p.id} className="pool-list-item">
                <button
                  className="pool-list-btn"
                  onClick={() => onSelectPool({ id: p.id, name: p.name, sport: "soccer", tournament: "wc2022", is_test: 1, mock_date: p.mock_date, isAdmin: true })}
                >
                  <span className="pool-list-name">{p.name}</span>
                  <span className="pool-list-meta">
                    {p.participant_count} player{p.participant_count !== 1 ? "s" : ""}
                    {p.mock_date && <> &middot; sim {p.mock_date.slice(0,10)}</>}
                  </span>
                </button>
                <button className="pool-delete-btn" onClick={() => handleDeleteTestPool(p.id)}>&times;</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default AdminPanel;
