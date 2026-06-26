import { useState, useEffect, useRef } from "react";
import { adminFetchPools, adminDeletePool, adminFetchUsers, adminDeleteUser, adminFetchUserPools, adminFetchTestPools, adminCreateTestPool, adminDeletePool as deletePool, adminDownloadBackup, adminSaveBackup, adminListBackups, adminDeleteBackup, adminRestoreFromUpload, adminRestoreFromBackup, adminFetchIssues, adminUpdateIssue, adminDeleteIssue, fetchIssueReplies, postIssueReply, adminDeleteReply, adminSyncPLFixtures, adminFetchKoMismatches, adminPatchKnockoutMatch, adminSwapKnockoutSides } from "../api";

const SPORT_LABELS = {
  soccer: { name: "Soccer", emoji: "\u26BD" },
  basketball: { name: "Basketball", emoji: "\uD83C\uDFC0" },
};

const TOURNAMENT_LABELS = {
  wc2022: "World Cup 2022",
  wc2026: "World Cup 2026",
  ucl2627: "Champions League 26/27",
  epl2627: "English Premier League 26/27",
};

function AdminPanel({ user, onSelectPool, onBack, onViewPicks }) {
  const [tab, setTab] = useState("pools");
  const [pools, setPools] = useState([]);
  const [users, setUsers] = useState([]);
  const [testPools, setTestPools] = useState([]);
  const [newTestName, setNewTestName] = useState("");
  const [newTestPwd, setNewTestPwd] = useState("");
  const [creating, setCreating] = useState(false);
  const [backups, setBackups] = useState([]);
  const [backupLoading, setBackupLoading] = useState("");
  const [backupMsg, setBackupMsg] = useState(null);
  const [issues, setIssues] = useState([]);
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [issueReplies, setIssueReplies] = useState([]);
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [poolSort, setPoolSort] = useState("recent");
  const [userSort, setUserSort] = useState("recent");
  const [issueFilter, setIssueFilter] = useState("all");
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [userPools, setUserPools] = useState({});
  const [issueProfileUserId, setIssueProfileUserId] = useState(null);
  const [issueProfilePools, setIssueProfilePools] = useState(null);
  const [koMismatches, setKoMismatches] = useState([]);
  const [koMismatchSaving, setKoMismatchSaving] = useState(null);
  const fileInputRef = useRef(null);

  const refreshKoMismatches = () =>
    adminFetchKoMismatches().then((d) => { if (Array.isArray(d)) setKoMismatches(d); });

  const resolveMismatch = async (m, choice) => {
    const key = `${m.match_id}:${m.field}`;
    const newTeamId = choice === "official" ? m.api_team_id : m.local_team_id;
    setKoMismatchSaving(key);
    try {
      await adminPatchKnockoutMatch(m.match_id, { [m.field]: newTeamId });
      await refreshKoMismatches();
    } finally {
      setKoMismatchSaving(null);
    }
  };

  const swapSides = async (matchId) => {
    const key = `${matchId}:swap`;
    setKoMismatchSaving(key);
    try {
      await adminSwapKnockoutSides(matchId);
      await refreshKoMismatches();
    } finally {
      setKoMismatchSaving(null);
    }
  };

  const loadBackups = () => adminListBackups().then((d) => { if (!d.error) setBackups(d); });
  const loadIssues = () => adminFetchIssues().then((d) => { if (!d.error) setIssues(d); });

  const handleOpenIssueProfile = async (userId) => {
    if (issueProfileUserId === userId) { setIssueProfileUserId(null); setIssueProfilePools(null); return; }
    setIssueProfileUserId(userId);
    setIssueProfilePools(null);
    const data = await adminFetchUserPools(userId);
    setIssueProfilePools(Array.isArray(data) ? data : []);
  };

  const openAdminThread = async (issue) => {
    setSelectedIssue(issue);
    setReplyText("");
    const data = await fetchIssueReplies(issue.id);
    if (!data.error) setIssueReplies(data.replies || []);
  };

  const handleDeleteReply = async (replyId) => {
    if (!selectedIssue) return;
    const res = await adminDeleteReply(selectedIssue.id, replyId);
    if (!res.error) {
      setIssueReplies((prev) => prev.filter((r) => r.id !== replyId));
    }
  };

  const handleAdminReply = async () => {
    if (!replyText.trim() || !selectedIssue) return;
    setReplySending(true);
    const res = await postIssueReply(selectedIssue.id, replyText.trim());
    if (!res.error) {
      setReplyText("");
      const data = await fetchIssueReplies(selectedIssue.id);
      if (!data.error) {
        setIssueReplies(data.replies || []);
        setSelectedIssue(data.issue);
      }
      loadIssues();
    }
    setReplySending(false);
  };

  useEffect(() => {
    adminFetchPools().then((data) => { if (!data.error) setPools(data); });
    adminFetchUsers().then((data) => { if (!data.error) setUsers(data); });
    adminFetchTestPools().then((d) => { if (!d.error) setTestPools(d); });
    adminFetchKoMismatches().then((d) => { if (Array.isArray(d)) setKoMismatches(d); });
    loadBackups();
    loadIssues();
  }, [user.id]);

  const handleCreateTestPool = async () => {
    if (!newTestName.trim() || !newTestPwd.trim()) return;
    setCreating(true);
    try {
      const res = await adminCreateTestPool(newTestName.trim(), newTestPwd.trim());
      if (!res.error) {
        setNewTestName(""); setNewTestPwd("");
        adminFetchTestPools().then((d) => { if (!d.error) setTestPools(d); });
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
    await deletePool(poolId);
    setTestPools((prev) => prev.filter((p) => p.id !== poolId));
  };

  const handleDeletePool = async (e, poolId) => {
    e.stopPropagation();
    if (!confirm("Delete this pool? All participants and predictions will be removed.")) return;
    await adminDeletePool(poolId);
    setPools((prev) => prev.filter((p) => p.id !== poolId));
  };

  const handleDownloadBackup = async () => {
    setBackupLoading("download");
    setBackupMsg(null);
    try {
      await adminDownloadBackup();
      setBackupMsg({ type: "success", text: "Backup downloaded." });
    } catch (err) {
      setBackupMsg({ type: "error", text: err.message });
    } finally {
      setBackupLoading("");
    }
  };

  const handleSaveBackup = async () => {
    setBackupLoading("save");
    setBackupMsg(null);
    try {
      const res = await adminSaveBackup();
      if (res.error) throw new Error(res.error);
      setBackupMsg({ type: "success", text: `Backup saved: ${res.name}` });
      loadBackups();
    } catch (err) {
      setBackupMsg({ type: "error", text: err.message });
    } finally {
      setBackupLoading("");
    }
  };

  const handleUploadRestore = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm("Restore database from this file? A pre-restore backup will be saved automatically.")) {
      e.target.value = "";
      return;
    }
    setBackupLoading("restore");
    setBackupMsg(null);
    try {
      const res = await adminRestoreFromUpload(file);
      if (res.error) throw new Error(res.error);
      setBackupMsg({ type: "success", text: res.message });
      loadBackups();
    } catch (err) {
      setBackupMsg({ type: "error", text: err.message });
    } finally {
      setBackupLoading("");
      e.target.value = "";
    }
  };

  const handleRestoreFromBackup = async (name) => {
    if (!confirm(`Restore database from "${name}"? A pre-restore backup will be saved automatically.`)) return;
    setBackupLoading("restore-" + name);
    setBackupMsg(null);
    try {
      const res = await adminRestoreFromBackup(name);
      if (res.error) throw new Error(res.error);
      setBackupMsg({ type: "success", text: res.message });
      loadBackups();
    } catch (err) {
      setBackupMsg({ type: "error", text: err.message });
    } finally {
      setBackupLoading("");
    }
  };

  const handleDeleteBackup = async (name) => {
    if (!confirm(`Delete backup "${name}"?`)) return;
    await adminDeleteBackup(name);
    loadBackups();
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const handleDeleteUser = async (targetId) => {
    if (!confirm("Delete this user? All their data will be removed.")) return;
    const result = await adminDeleteUser(targetId);
    if (result.error) {
      alert(result.error);
      return;
    }
    setUsers((prev) => prev.filter((u) => u.id !== targetId));
  };

  const sortPools = (list) => {
    const sorted = [...list];
    if (poolSort === "alpha") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (poolSort === "users") sorted.sort((a, b) => (b.user_count || 0) - (a.user_count || 0));
    else sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return sorted;
  };

  const sortUsers = (list) => {
    const sorted = [...list];
    if (userSort === "alpha") sorted.sort((a, b) => a.display_name.localeCompare(b.display_name));
    else sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return sorted;
  };

  // Group pools by sport, then by tournament
  const grouped = {};
  for (const p of pools) {
    if (!grouped[p.sport]) grouped[p.sport] = {};
    if (!grouped[p.sport][p.tournament]) grouped[p.sport][p.tournament] = [];
    grouped[p.sport][p.tournament].push(p);
  }

  const totalPoolUsers = pools.filter((p) => !p.is_test).reduce((sum, p) => sum + (p.user_count || 0), 0);

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
        <button className={`admin-tab ${tab === "backup" ? "active" : ""}`} onClick={() => { setTab("backup"); loadBackups(); }}>
          Backup
        </button>
        <button className={`admin-tab ${tab === "issues" ? "active" : ""}`} onClick={() => { setTab("issues"); loadIssues(); }}>
          Issues {issues.filter((i) => i.status === "open").length > 0 ? `(${issues.filter((i) => i.status === "open").length})` : ""}
        </button>
        <button
          className={`admin-tab ${tab === "sync" ? "active" : ""} ${koMismatches.length > 0 ? "admin-tab-alert" : ""}`}
          onClick={() => { setTab("sync"); refreshKoMismatches(); }}
        >
          Sync {koMismatches.length > 0 ? `(${koMismatches.length})` : ""}
        </button>
      </div>

      {tab === "pools" && (
        <>
          <div className="admin-sort-row">
            <p className="select-subtitle">{pools.length} pool{pools.length !== 1 ? "s" : ""} &middot; {totalPoolUsers} total participant{totalPoolUsers !== 1 ? "s" : ""}</p>
            <select className="admin-sort-select" value={poolSort} onChange={(e) => setPoolSort(e.target.value)}>
              <option value="recent">Recent</option>
              <option value="alpha">A &ndash; Z</option>
              <option value="users">Most Users</option>
            </select>
          </div>

          {Object.keys(grouped).length === 0 && <p className="notice">No pools created yet.</p>}

          {Object.entries(grouped).map(([sport, tournaments]) => {
            const sportLabel = SPORT_LABELS[sport] || { name: sport, emoji: "" };
            const realPools = Object.values(tournaments).flat().filter((p) => !p.is_test);
            const sportUsers = realPools.reduce((sum, p) => sum + (p.user_count || 0), 0);
            const sportPools = realPools.length;

            return (
              <div key={sport} className="admin-sport-section">
                <div className="admin-sport-header">
                  <span>{sportLabel.emoji} {sportLabel.name}</span>
                  <span className="admin-sport-stats">{sportPools} pool{sportPools !== 1 ? "s" : ""} &middot; {sportUsers} user{sportUsers !== 1 ? "s" : ""}</span>
                </div>

                {Object.entries(tournaments).map(([tournament, tournamentPools]) => {
                  const tournamentLabel = TOURNAMENT_LABELS[tournament] || tournament;
                  const tournamentUsers = tournamentPools.filter((p) => !p.is_test).reduce((sum, p) => sum + (p.user_count || 0), 0);

                  return (
                    <div key={tournament} className="admin-tournament-section">
                      <div className="admin-tournament-header">
                        <span>{tournamentLabel}</span>
                        <span className="admin-tournament-stats">{tournamentPools.length} pool{tournamentPools.length !== 1 ? "s" : ""} &middot; {tournamentUsers} user{tournamentUsers !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="pool-list">
                        {sortPools(tournamentPools).map((p) => (
                          <div key={p.id} className="pool-list-item">
                            <button
                              className="pool-list-btn"
                              onClick={() => onSelectPool({ id: p.id, name: p.name, sport: p.sport, tournament: p.tournament, is_test: p.is_test, isAdmin: true })}
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
          <div className="admin-sort-row">
            <p className="select-subtitle">{users.length} registered user{users.length !== 1 ? "s" : ""}</p>
            <select className="admin-sort-select" value={userSort} onChange={(e) => setUserSort(e.target.value)}>
              <option value="recent">Recent</option>
              <option value="alpha">A &ndash; Z</option>
            </select>
          </div>
          <div className="pool-list">
            {sortUsers(users).map((u) => {
              const isExpanded = expandedUserId === u.id;
              const pools = userPools[u.id];
              return (
                <div key={u.id} className="pool-list-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <button
                      className="pool-list-btn user-list-info"
                      style={{ flex: 1 }}
                      onClick={async () => {
                        if (isExpanded) { setExpandedUserId(null); return; }
                        setExpandedUserId(u.id);
                        if (!userPools[u.id]) {
                          const data = await adminFetchUserPools(u.id);
                          setUserPools((prev) => ({ ...prev, [u.id]: Array.isArray(data) ? data : [] }));
                        }
                      }}
                    >
                      <div>
                        <span className="pool-list-name">{u.display_name}</span>
                        <span className="user-username">@{u.username}</span>
                      </div>
                      <span className="pool-list-meta">{u.is_admin ? "Admin" : "User"}</span>
                    </button>
                    {!u.is_admin && (
                      <button className="pool-delete-btn" onClick={() => handleDeleteUser(u.id)}>&times;</button>
                    )}
                  </div>
                  {isExpanded && (
                    <div style={{ padding: "8px 12px 12px", borderTop: "1px solid #2a2a2a" }}>
                      {!pools ? (
                        <p className="notice" style={{ margin: 0 }}>Loading…</p>
                      ) : pools.length === 0 ? (
                        <p className="notice" style={{ margin: 0 }}>Not in any pools.</p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {pools.map((p) => (
                            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                              <span style={{ flex: 1, color: "#ccc" }}>{p.name}</span>
                              {p.is_admin ? <span className="pool-admin-badge">Admin</span> : null}
                              <span style={{ color: "#666", fontSize: 12 }}>{p.is_public ? "Public" : "Private"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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

      {tab === "backup" && (
        <>
          <div className="backup-restore-section" style={{ marginBottom: 16 }}>
            <h3>PL Fixture Sync</h3>
            <p className="backup-help">Fetch Premier League 26/27 match dates and scores from football-data.org API.</p>
            <button
              className="btn-submit"
              onClick={async () => {
                setBackupLoading("pl-sync");
                setBackupMsg(null);
                try {
                  const res = await adminSyncPLFixtures();
                  if (res.error) setBackupMsg({ type: "error", text: res.error });
                  else setBackupMsg({ type: "success", text: `PL fixtures synced — ${res.matches} matches in DB.` });
                } catch (err) {
                  setBackupMsg({ type: "error", text: err.message });
                }
                setBackupLoading("");
              }}
              disabled={!!backupLoading}
            >
              {backupLoading === "pl-sync" ? "Syncing..." : "Sync PL Fixtures"}
            </button>
          </div>

          <p className="select-subtitle">Download, save, or restore database backups.</p>

          {backupMsg && (
            <div className={`backup-msg ${backupMsg.type}`}>
              {backupMsg.text}
            </div>
          )}

          <div className="backup-actions">
            <button
              className="btn-submit"
              onClick={handleDownloadBackup}
              disabled={!!backupLoading}
            >
              {backupLoading === "download" ? "Downloading..." : "Download Backup"}
            </button>
            <button
              className="btn-submit backup-save-btn"
              onClick={handleSaveBackup}
              disabled={!!backupLoading}
            >
              {backupLoading === "save" ? "Saving..." : "Save Backup on Server"}
            </button>
          </div>

          <div className="backup-restore-section">
            <h3>Restore from File</h3>
            <p className="backup-help">Upload a previously downloaded .db backup file to restore.</p>
            <input
              type="file"
              accept=".db"
              ref={fileInputRef}
              onChange={handleUploadRestore}
              style={{ display: "none" }}
            />
            <button
              className="btn-submit backup-restore-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={!!backupLoading}
            >
              {backupLoading === "restore" ? "Restoring..." : "Upload & Restore"}
            </button>
          </div>

          {backups.length > 0 && (
            <div className="backup-list-section">
              <h3>Server Backups</h3>
              <div className="pool-list">
                {backups.map((b) => (
                  <div key={b.name} className="pool-list-item">
                    <div className="pool-list-btn backup-list-info">
                      <div>
                        <span className="pool-list-name">{b.name}</span>
                        <span className="pool-list-meta">
                          {formatBytes(b.size)} &middot; {new Date(b.created).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <button
                      className="btn-submit backup-restore-inline"
                      onClick={() => handleRestoreFromBackup(b.name)}
                      disabled={!!backupLoading}
                    >
                      {backupLoading === "restore-" + b.name ? "..." : "Restore"}
                    </button>
                    <button
                      className="pool-delete-btn"
                      onClick={() => handleDeleteBackup(b.name)}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "issues" && !selectedIssue && (
        <>
          <div className="admin-sort-row">
            <p className="select-subtitle">
              {issues.filter((i) => i.status === "open").length} open issue{issues.filter((i) => i.status === "open").length !== 1 ? "s" : ""}
              {issues.filter((i) => i.status === "resolved").length > 0 && ` · ${issues.filter((i) => i.status === "resolved").length} resolved`}
            </p>
            <select className="admin-sort-select" value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
          {issues.length === 0 ? <p className="notice">No issues reported.</p> : (
            <table className="leaderboard-table issue-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {issues.filter((i) => issueFilter === "all" || i.status === issueFilter).sort((a, b) => (a.status === "open" ? -1 : 1) - (b.status === "open" ? -1 : 1)).map((issue) => (
                  <tr key={issue.id} className="clickable" onClick={() => openAdminThread(issue)}>
                    <td className="name" style={{ position: "relative" }}>
                      <span
                        className="issue-user-link"
                        onClick={(e) => { e.stopPropagation(); handleOpenIssueProfile(issue.user_id); }}
                      >
                        {issue.display_name}
                      </span>
                      {issueProfileUserId === issue.user_id && (
                        <div className="issue-profile-dropdown">
                          {issueProfilePools === null ? (
                            <span className="issue-profile-loading">Loading…</span>
                          ) : issueProfilePools.length === 0 ? (
                            <span className="issue-profile-loading">No pools</span>
                          ) : (
                            issueProfilePools.map((p) => (
                              <button
                                key={p.id}
                                className="issue-profile-pool-btn"
                                onClick={(e) => { e.stopPropagation(); onViewPicks({ id: p.id, name: p.name, sport: p.sport, tournament: p.tournament, is_public: p.is_public }, p.participant_id); }}
                              >
                                {p.name} <span className="issue-profile-arrow">→</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </td>
                    <td className="pts-sub">{new Date(issue.created_at + "Z").toLocaleDateString()} {new Date(issue.created_at + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                    <td><span className={`issue-status-badge ${issue.status}`}>{issue.status}</span></td>
                    <td className="issue-table-actions">
                      {issue.status === "open" ? (
                        <button className="btn-small" onClick={async (e) => { e.stopPropagation(); await adminUpdateIssue(issue.id, "resolved"); loadIssues(); }}>Resolve</button>
                      ) : (
                        <button className="btn-small" onClick={async (e) => { e.stopPropagation(); await adminUpdateIssue(issue.id, "open"); loadIssues(); }}>Reopen</button>
                      )}
                      <button className="pool-delete-btn" onClick={async (e) => { e.stopPropagation(); if (confirm("Delete this issue?")) { await adminDeleteIssue(issue.id); loadIssues(); } }}>&times;</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === "issues" && selectedIssue && (
        <div className="admin-issue-chat">
          <div className="issue-chat-header">
            <button className="btn-back" onClick={() => { setSelectedIssue(null); loadIssues(); }}>&larr;</button>
            <h3>
              Issue #{selectedIssue.id} &mdash;{" "}
              <span className="issue-user-link" onClick={() => handleOpenIssueProfile(selectedIssue.user_id)}>{selectedIssue.display_name}</span>
            </h3>
            {issueProfileUserId === selectedIssue.user_id && (
              <div className="issue-profile-dropdown issue-profile-dropdown-header">
                {issueProfilePools === null ? (
                  <span className="issue-profile-loading">Loading…</span>
                ) : issueProfilePools.length === 0 ? (
                  <span className="issue-profile-loading">Not in any pools</span>
                ) : (
                  issueProfilePools.map((p) => (
                    <button
                      key={p.id}
                      className="issue-profile-pool-btn"
                      onClick={() => onViewPicks({ id: p.id, name: p.name, sport: p.sport, tournament: p.tournament, is_public: p.is_public }, p.participant_id)}
                    >
                      {p.name} <span className="issue-profile-arrow">→</span>
                    </button>
                  ))
                )}
              </div>
            )}
            <span className={`issue-status-badge ${selectedIssue.status}`}>{selectedIssue.status}</span>
            <div className="issue-actions" style={{ marginLeft: "auto" }}>
              {selectedIssue.status === "open" ? (
                <button className="btn-submit backup-restore-inline" onClick={async () => { await adminUpdateIssue(selectedIssue.id, "resolved"); setSelectedIssue({ ...selectedIssue, status: "resolved" }); loadIssues(); }}>Resolve</button>
              ) : (
                <button className="btn-submit backup-restore-inline" onClick={async () => { await adminUpdateIssue(selectedIssue.id, "open"); setSelectedIssue({ ...selectedIssue, status: "open" }); loadIssues(); }}>Reopen</button>
              )}
            </div>
          </div>
          <div className="issue-chat-messages">
            <div className="issue-chat-bubble user-bubble">
              <div className="issue-chat-bubble-meta">
                <strong>{selectedIssue.display_name}</strong>
                <span>{new Date(selectedIssue.created_at + "Z").toLocaleString()}</span>
              </div>
              <p>{selectedIssue.body}</p>
            </div>
            {issueReplies.map((r) => (
              <div key={r.id} className={`issue-chat-bubble ${r.is_admin ? "admin-bubble" : "user-bubble"}`}>
                <div className="issue-chat-bubble-meta">
                  <strong>{r.display_name}{r.is_admin ? " (Admin)" : ""}</strong>
                  <span>{new Date(r.created_at + "Z").toLocaleString()}</span>
                  {r.is_admin && (
                    <button className="btn-delete-reply" onClick={() => handleDeleteReply(r.id)} title="Delete reply">&times;</button>
                  )}
                </div>
                <p>{r.body}</p>
              </div>
            ))}
          </div>
          <div className="issue-chat-input">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type a reply... (Alt+Enter for new line)"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.altKey) {
                  e.preventDefault();
                  const { selectionStart, selectionEnd } = e.target;
                  setReplyText((prev) => prev.slice(0, selectionStart) + "\n" + prev.slice(selectionEnd));
                  setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = selectionStart + 1; }, 0);
                } else if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAdminReply();
                }
              }}
              rows={1}
              autoFocus
            />
            <button className="btn-submit" onClick={handleAdminReply} disabled={replySending || !replyText.trim()}>
              {replySending ? "..." : "Send"}
            </button>
          </div>
        </div>
      )}

      {tab === "sync" && (
        <div className="admin-sync-tab">
          <p className="select-subtitle">
            World Cup knockout bracket — disagreements between our database and the football-data.org feed.
          </p>
          {koMismatches.length === 0 ? (
            <div className="admin-sync-empty">
              <p><strong>All clear.</strong> No knockout matchups currently disagree with the official feed.</p>
              <p className="admin-sync-hint">
                The 30-min sync compares our locally-stored teams against football-data.org. When they disagree, the row stays here until you pick which team to trust — we never overwrite silently because user picks are stored as <em>home / away</em> slots, not team ids.
              </p>
            </div>
          ) : (
            <>
              <div className="admin-sync-intro">
                <p>
                  {koMismatches.length} knockout {koMismatches.length === 1 ? "matchup needs" : "matchups need"} your decision. Our 30-min sync found {koMismatches.length === 1 ? "a team" : "teams"} on the official feed (football-data.org) that {koMismatches.length === 1 ? "doesn't" : "don't"} match what we have stored.
                </p>
                <p className="admin-sync-why">
                  <strong>Why this matters:</strong> user predictions are stored as <em>home / away</em> slots, not team ids. If we auto-swapped the team behind a slot, every pick on that match would silently start predicting a different team. So we&apos;ve frozen the team assignments and are waiting on you. <strong>Score, status (live / finished), and winner sync are also paused</strong> for these matches until you resolve — but users can still pick them; they see and predict our locally-stored team.
                </p>
              </div>
              <ul className="admin-sync-list">
                {(() => {
                  // Group side-swap rows by match_id into one combined card so the admin
                  // sees a single "Swap sides" action rather than two confusingly-linked rows.
                  const items = [];
                  const seenSwapMatch = new Set();
                  for (const m of koMismatches) {
                    if (m.is_side_swap) {
                      if (seenSwapMatch.has(m.match_id)) continue;
                      seenSwapMatch.add(m.match_id);
                      const pair = koMismatches.filter((x) => x.match_id === m.match_id);
                      items.push({ kind: "swap", match_id: m.match_id, round: m.round, rows: pair, detected_at: m.detected_at });
                    } else {
                      items.push({ kind: "single", ...m });
                    }
                  }
                  return items.map((item) => {
                    if (item.kind === "swap") {
                      const homeRow = item.rows.find((r) => r.field === "home_team_id") || item.rows[0];
                      const awayRow = item.rows.find((r) => r.field === "away_team_id") || item.rows[0];
                      const totalPicks = (homeRow.home_pick_count || 0) + (homeRow.away_pick_count || 0);
                      const swapKey = `${item.match_id}:swap`;
                      const saving = koMismatchSaving === swapKey;
                      return (
                        <li key={swapKey} className="admin-sync-card admin-sync-card-swap">
                          <div className="admin-sync-card-header">
                            <span className="admin-sync-round">{item.round || "Knockout"}</span>
                            <span className="admin-sync-match">{item.match_id}</span>
                            <span className="admin-sync-side">Home / away sides swapped</span>
                            <span className="admin-sync-when">detected {item.detected_at}</span>
                          </div>
                          <p className="admin-sync-side-swap">
                            Both teams in this matchup match the official feed &mdash; just the home / away assignment is flipped. Use <strong>Swap sides</strong> to flip our home/away labels and atomically flip every pick&apos;s home/away slot so user intent (which team they picked) is preserved.
                          </p>
                          <div className="admin-sync-card-body">
                            <div className="admin-sync-team">
                              <div className="admin-sync-label">Our home</div>
                              <div className="admin-sync-value"><strong>{homeRow.local_code}</strong> {homeRow.local_name}</div>
                              <div className="admin-sync-label" style={{ marginTop: 8 }}>Our away</div>
                              <div className="admin-sync-value"><strong>{awayRow.local_code}</strong> {awayRow.local_name}</div>
                            </div>
                            <div className="admin-sync-vs">⇄</div>
                            <div className="admin-sync-team">
                              <div className="admin-sync-label">Feed home</div>
                              <div className="admin-sync-value"><strong>{homeRow.api_code}</strong> {homeRow.api_name}</div>
                              <div className="admin-sync-label" style={{ marginTop: 8 }}>Feed away</div>
                              <div className="admin-sync-value"><strong>{awayRow.api_code}</strong> {awayRow.api_name}</div>
                            </div>
                          </div>
                          <p className="admin-sync-impact">
                            <strong>{totalPicks}</strong> user pick{totalPicks === 1 ? "" : "s"} on this match. Swap sides flips each pick&apos;s slot (home ↔ away) and exact-score values so each user still predicts the same team they originally chose.
                          </p>
                          <div className="admin-sync-card-actions">
                            <button
                              className="btn-primary"
                              disabled={saving}
                              onClick={() => swapSides(item.match_id)}
                              title="Swap home/away and flip all predictions on this match in a single transaction."
                            >
                              {saving ? "Saving…" : "Swap sides (preserve picks)"}
                            </button>
                          </div>
                        </li>
                      );
                    }

                    const m = item;
                    const key = `${m.match_id}:${m.field}`;
                    const side = m.field === "home_team_id" ? "Home team" : "Away team";
                    const saving = koMismatchSaving === key;
                    const sidePickCount = m.field === "home_team_id" ? m.home_pick_count : m.away_pick_count;
                    const affected = sidePickCount || 0;
                    return (
                      <li key={key} className="admin-sync-card">
                        <div className="admin-sync-card-header">
                          <span className="admin-sync-round">{m.round || "Knockout"}</span>
                          <span className="admin-sync-match">{m.match_id}</span>
                          <span className="admin-sync-side">{side}</span>
                          <span className="admin-sync-when">detected {m.detected_at}</span>
                        </div>
                        <div className="admin-sync-card-body">
                          <div className="admin-sync-team">
                            <div className="admin-sync-label">Currently stored</div>
                            <div className="admin-sync-value">
                              <strong>{m.local_code || "?"}</strong> {m.local_name || `id ${m.local_team_id ?? "null"}`}
                            </div>
                          </div>
                          <div className="admin-sync-vs">vs.</div>
                          <div className="admin-sync-team">
                            <div className="admin-sync-label">Official feed says</div>
                            <div className="admin-sync-value">
                              <strong>{m.api_code || "?"}</strong> {m.api_name || `id ${m.api_team_id ?? "null"}`}
                            </div>
                          </div>
                        </div>
                        <p className="admin-sync-impact">
                          <strong>{affected}</strong> user pick{affected === 1 ? "" : "s"} currently on the {side.toLowerCase()} slot of this match. Resolving will reinterpret {affected === 1 ? "that pick" : "those picks"} as the team you choose.
                        </p>
                        <div className="admin-sync-card-actions">
                          <button
                            className="btn-secondary"
                            disabled={saving}
                            onClick={() => resolveMismatch(m, "local")}
                            title="Lock the stored team. Future syncs will not change it."
                          >
                            {saving ? "Saving…" : `Keep ${m.local_code || "ours"}`}
                          </button>
                          <button
                            className="btn-primary"
                            disabled={saving}
                            onClick={() => resolveMismatch(m, "official")}
                            title="Replace the stored team with the official feed's team and lock it."
                          >
                            {saving ? "Saving…" : `Use ${m.api_code || "official"}`}
                          </button>
                        </div>
                      </li>
                    );
                  });
                })()}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default AdminPanel;
