import { useState, useEffect, useCallback } from "react";
import {
  fetchPoolAdmins, addPoolAdmin, kickPoolMember, fetchPoolPassword, changePoolPassword,
  renamePool, updateChatStatus, fetchMessages, fetchParticipants,
  fetchPlayerAwardsLock, updatePlayerAwardsLock, updatePlayerAwardsVoid,
  fetchSeasonLock, updateSeasonLock,
  fetchScoreAdjustments, addScoreAdjustment, deleteScoreAdjustment,
} from "../api";

// League-only pool settings rendered as a full page (WC keeps its own modal untouched).
function PoolSettings({ pool, user, onRenamed }) {
  const [admins, setAdmins] = useState([]);
  const [members, setMembers] = useState([]);
  const [password, setPassword] = useState("");
  const [chatClosed, setChatClosed] = useState(false);
  const [awardsLocked, setAwardsLocked] = useState(false);
  const [awardsVoided, setAwardsVoided] = useState(false);
  const [seasonLocked, setSeasonLocked] = useState(false);
  const [adjustments, setAdjustments] = useState([]);

  const [revealPassword, setRevealPassword] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(pool.name);
  const [renameErr, setRenameErr] = useState("");
  const [kickId, setKickId] = useState(null);

  const [adjParticipant, setAdjParticipant] = useState("");
  const [adjPoints, setAdjPoints] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjErr, setAdjErr] = useState("");
  const [savingAdj, setSavingAdj] = useState(false);

  const isAdmin = admins.some((a) => a.user_id === user.id);

  const loadAdjustments = useCallback(() => {
    fetchScoreAdjustments(pool.id).then((d) => setAdjustments(Array.isArray(d) ? d : [])).catch(() => {});
  }, [pool.id]);

  useEffect(() => {
    fetchPoolAdmins(pool.id).then((d) => { if (Array.isArray(d)) setAdmins(d); }).catch(() => {});
    fetchParticipants(pool.id).then((d) => { if (Array.isArray(d)) setMembers(d); }).catch(() => {});
    fetchPoolPassword(pool.id).then((d) => { if (d && d.password != null) setPassword(d.password); }).catch(() => {});
    fetchMessages(pool.id).then((d) => { if (d && typeof d.chat_closed !== "undefined") setChatClosed(!!d.chat_closed); }).catch(() => {});
    fetchPlayerAwardsLock(pool.id).then((d) => { if (d) { setAwardsLocked(!!d.player_awards_locked); setAwardsVoided(!!d.player_awards_voided); } }).catch(() => {});
    fetchSeasonLock(pool.id).then((d) => { if (d && typeof d.locked !== "undefined") setSeasonLocked(!!d.locked); }).catch(() => {});
    loadAdjustments();
  }, [pool.id, loadAdjustments]);

  const handleAddAdjustment = async () => {
    setAdjErr("");
    const pts = parseInt(adjPoints, 10);
    if (!adjParticipant) { setAdjErr("Pick a player"); return; }
    if (!Number.isInteger(pts) || pts === 0) { setAdjErr("Enter a non-zero whole number"); return; }
    setSavingAdj(true);
    const res = await addScoreAdjustment(pool.id, Number(adjParticipant), pts, adjReason.trim());
    setSavingAdj(false);
    if (res.error) { setAdjErr(res.error); return; }
    setAdjPoints(""); setAdjReason(""); setAdjParticipant("");
    loadAdjustments();
  };

  return (
    <div className="page pool-settings-page">
      <h2>Admin Settings</h2>

      <div className="pool-settings-row">
        <span className="pool-settings-label">Pool name</span>
        {editingName ? (
          <span className="pool-settings-value" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #1e3a1e", background: "#0b1a0b", color: "#d4e8d4", fontSize: 13, width: 160 }} />
            <button className="btn-small" onClick={async () => {
              if (!newName.trim()) return;
              setRenameErr("");
              const res = await renamePool(pool.id, newName.trim());
              if (res.error) { setRenameErr(res.error); return; }
              if (onRenamed) onRenamed(res.name);
              setEditingName(false);
            }}>Save</button>
            <button className="btn-small" onClick={() => { setEditingName(false); setRenameErr(""); setNewName(pool.name); }}>Cancel</button>
            {renameErr && <span className="error" style={{ fontSize: 11 }}>{renameErr}</span>}
          </span>
        ) : (
          <span className="pool-settings-value">
            {pool.name}
            {isAdmin && <button className="btn-small" style={{ marginLeft: 8 }} onClick={() => { setNewName(pool.name); setEditingName(true); }}>Edit</button>}
          </span>
        )}
      </div>

      <div className="pool-settings-row">
        <span className="pool-settings-label">Type</span>
        <span className="pool-settings-value">{pool.is_public ? "Public" : "Private"}</span>
      </div>

      {!pool.is_public && (
        <div className="pool-settings-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", width: "100%", justifyContent: "space-between" }}>
            <span className="pool-settings-label">Password</span>
            <span className="pool-settings-value">
              {revealPassword ? <span className="pool-password-display">{password}</span> : <span className="pool-password-hidden">••••••••</span>}
              <button className="btn-small" style={{ marginLeft: 8 }} onClick={() => setRevealPassword((v) => !v)}>{revealPassword ? "Hide" : "Reveal"}</button>
              {isAdmin && <button className="btn-small" style={{ marginLeft: 8 }} onClick={() => { setShowChangePassword((v) => !v); setNewPassword(""); setPwMsg(""); }}>{showChangePassword ? "Cancel" : "Change"}</button>}
            </span>
          </div>
          {showChangePassword && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
              <input className="auth-input" type="text" placeholder="New password" value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setPwMsg(""); }} />
              {pwMsg && <span style={{ fontSize: 13 }}>{pwMsg}</span>}
              <button className="btn-submit" style={{ alignSelf: "flex-start" }} onClick={async () => {
                if (!newPassword.trim()) { setPwMsg("Password cannot be empty"); return; }
                const res = await changePoolPassword(pool.id, newPassword.trim());
                if (res.error) { setPwMsg(res.error); return; }
                setPassword(newPassword.trim()); setNewPassword(""); setPwMsg("Password updated.");
              }}>Save</button>
            </div>
          )}
        </div>
      )}

      {!pool.is_public && isAdmin && (
        <div className="pool-settings-row">
          <span className="pool-settings-label">Chat</span>
          <span className="pool-settings-value">
            <button className={`btn-small ${chatClosed ? "btn-danger" : ""}`} onClick={async () => {
              const newVal = !chatClosed;
              const res = await updateChatStatus(pool.id, newVal);
              if (!res.error) setChatClosed(newVal);
            }}>{chatClosed ? "Chat Closed — Reopen" : "Open — Close Chat"}</button>
          </span>
        </div>
      )}

      {isAdmin && (
        <div className="pool-settings-row">
          <span className="pool-settings-label">Champion Pick</span>
          <span className="pool-settings-value">
            <button className={`btn-small ${seasonLocked ? "btn-danger" : ""}`} onClick={async () => {
              const newVal = !seasonLocked;
              const res = await updateSeasonLock(pool.id, newVal);
              if (!res.error) setSeasonLocked(newVal);
            }}>{seasonLocked ? "Locked — Unlock" : "Open — Lock"}</button>
            <span style={{ fontSize: "0.72rem", color: "#8aa88a", marginTop: 4, display: "block", textAlign: "right" }}>
              Locks all season predictions, including the title winner
            </span>
          </span>
        </div>
      )}

      {isAdmin && (
        <div className="pool-settings-row">
          <span className="pool-settings-label">Player Award Picks</span>
          <span className="pool-settings-value" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={`btn-small ${awardsLocked ? "btn-danger" : ""}`} disabled={awardsVoided} onClick={async () => {
              const newVal = !awardsLocked;
              const res = await updatePlayerAwardsLock(pool.id, newVal);
              if (!res.error) setAwardsLocked(newVal);
            }}>{awardsLocked ? "Locked — Unlock" : "Open — Lock"}</button>
            <button className={`btn-small ${awardsVoided ? "btn-danger" : ""}`} onClick={async () => {
              const newVal = !awardsVoided;
              if (newVal && !window.confirm("Void player awards? Picks are kept, but this section will score 0 points for everyone in the pool.")) return;
              const res = await updatePlayerAwardsVoid(pool.id, newVal);
              if (!res.error) setAwardsVoided(newVal);
            }}>{awardsVoided ? "Voided (0 pts) — Restore" : "Void (0 pts)"}</button>
          </span>
        </div>
      )}

      {/* Manual score adjustments — itemized, visible to everyone; only admins add/remove. */}
      <h4 style={{ marginTop: 20, marginBottom: 8 }}>Score Adjustments</h4>
      {isAdmin && (
        <div className="adjustment-form" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <select value={adjParticipant} onChange={(e) => setAdjParticipant(e.target.value)}
            style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid #1e3a1e", background: "#0b1a0b", color: "#d4e8d4", fontSize: 13 }}>
            <option value="">Player…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input type="number" placeholder="±pts" value={adjPoints} onChange={(e) => setAdjPoints(e.target.value)}
            style={{ width: 70, padding: "6px 8px", borderRadius: 4, border: "1px solid #1e3a1e", background: "#0b1a0b", color: "#d4e8d4", fontSize: 13 }} />
          <input type="text" placeholder="Reason (optional)" value={adjReason} onChange={(e) => setAdjReason(e.target.value)}
            style={{ flex: "1 1 160px", padding: "6px 8px", borderRadius: 4, border: "1px solid #1e3a1e", background: "#0b1a0b", color: "#d4e8d4", fontSize: 13 }} />
          <button className="btn-small" disabled={savingAdj} onClick={handleAddAdjustment}>{savingAdj ? "…" : "Add"}</button>
          {adjErr && <span className="error" style={{ fontSize: 12, flexBasis: "100%" }}>{adjErr}</span>}
        </div>
      )}
      {adjustments.length === 0 ? (
        <p className="notice" style={{ fontSize: 13 }}>No manual adjustments.</p>
      ) : (
        <div className="adjustment-list">
          {adjustments.map((a) => (
            <div key={a.id} className="pool-member-row">
              <span className="pool-member-name">
                <strong style={{ color: a.points > 0 ? "#5a8a5a" : "#c0392b" }}>{a.points > 0 ? `+${a.points}` : a.points}</strong>
                {" "}{a.participant_name}
                {a.reason && <span style={{ color: "#8aa88a", fontSize: 12 }}> — {a.reason}</span>}
              </span>
              {isAdmin && (
                <span className="pool-member-actions">
                  <button className="btn-small btn-danger" onClick={async () => {
                    const res = await deleteScoreAdjustment(pool.id, a.id);
                    if (!res.error) loadAdjustments();
                  }}>Remove</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <h4 style={{ marginTop: 20, marginBottom: 8 }}>Members ({members.length})</h4>
      <div className="pool-members-list">
        {members.map((m) => {
          const mIsAdmin = admins.some((a) => a.user_id === m.user_id);
          const isMe = m.user_id === user.id;
          return (
            <div key={m.id} className="pool-member-row">
              <span className="pool-member-name">
                {m.name}
                {mIsAdmin && <span className="pool-admin-badge">Admin</span>}
              </span>
              {!pool.is_public && isAdmin && !isMe && (
                <span className="pool-member-actions">
                  {!mIsAdmin && (
                    <button className="btn-small" onClick={async () => {
                      const res = await addPoolAdmin(pool.id, m.user_id);
                      if (!res.error) setAdmins((prev) => [...prev, { user_id: m.user_id, display_name: m.name }]);
                    }}>Make Admin</button>
                  )}
                  {!mIsAdmin && (
                    kickId === m.user_id ? (
                      <span className="kick-confirm">
                        <span>Kick {m.name}?</span>
                        <button className="btn-small btn-danger" onClick={async () => {
                          const res = await kickPoolMember(pool.id, m.user_id);
                          if (!res.error) { setMembers((prev) => prev.filter((x) => x.user_id !== m.user_id)); setKickId(null); }
                        }}>Yes</button>
                        <button className="btn-small" onClick={() => setKickId(null)}>No</button>
                      </span>
                    ) : (
                      <button className="btn-small btn-danger" onClick={() => setKickId(m.user_id)}>Kick</button>
                    )
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PoolSettings;
