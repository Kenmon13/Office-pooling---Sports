import { useState, useEffect } from "react";
import { fetchProfile, updateProfile, changePassword, fetchMyPools } from "../api";

const SPORT_LABELS = {
  soccer: "\u26BD",
  basketball: "\uD83C\uDFC0",
};

const TOURNAMENT_LABELS = {
  wc2022: "World Cup 2022",
  wc2026: "World Cup 2026",
  ucl2627: "Champions League 26/27",
  epl2627: "English Premier League 26/27",
};

function Settings({ user, onBack, onUpdateUser, onSelectPool }) {
  const [tab, setTab] = useState("profile");
  const [email, setEmail] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  const [username, setUsername] = useState(user.username);
  const [savedUsername, setSavedUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.display_name);
  const [savedDisplayName, setSavedDisplayName] = useState(user.display_name);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg, setPwdMsg] = useState(null);
  const [myPools, setMyPools] = useState([]);
  const [loadingPools, setLoadingPools] = useState(true);

  useEffect(() => {
    fetchProfile().then((data) => {
      if (!data.error) {
        setEmail(data.email || "");
        setSavedEmail(data.email || "");
        setUsername(data.username);
        setSavedUsername(data.username);
        setDisplayName(data.display_name);
        setSavedDisplayName(data.display_name);
      }
    });
    fetchMyPools().then((data) => {
      if (!data.error) setMyPools(data);
      setLoadingPools(false);
    });
  }, []);

  const handleSaveProfile = async () => {
    setSaving(true);
    setMsg(null);
    const updates = {};
    if (email.trim().toLowerCase() !== (savedEmail || "").toLowerCase()) {
      updates.email = email.trim() || null;
    }
    if (username.trim() !== savedUsername) {
      updates.username = username.trim();
    }
    if (displayName.trim() !== savedDisplayName) {
      updates.display_name = displayName.trim();
    }
    const res = await updateProfile(updates);
    if (res.error) {
      setMsg({ type: "error", text: res.error });
    } else {
      setSavedEmail(res.email || "");
      setEmail(res.email || "");
      setSavedUsername(res.username);
      setUsername(res.username);
      setSavedDisplayName(res.display_name);
      setDisplayName(res.display_name);
      if (onUpdateUser) onUpdateUser(res);
      setMsg({ type: "success", text: "Profile updated" });
    }
    setSaving(false);
  };

  const handleChangePassword = async () => {
    setPwdMsg(null);
    if (!currentPassword) {
      setPwdMsg({ type: "error", text: "Enter your current password" });
      return;
    }
    if (!newPassword) {
      setPwdMsg({ type: "error", text: "Enter a new password" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdMsg({ type: "error", text: "New passwords do not match" });
      return;
    }
    setPwdSaving(true);
    const res = await changePassword(currentPassword, newPassword);
    if (res.error) {
      setPwdMsg({ type: "error", text: res.error });
    } else {
      setPwdMsg({ type: "success", text: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    setPwdSaving(false);
  };

  const profileHasChanged =
    email.trim().toLowerCase() !== (savedEmail || "").toLowerCase() ||
    username.trim() !== savedUsername ||
    displayName.trim() !== savedDisplayName;

  return (
    <div className="select-page settings-page">
      <button className="back-btn" onClick={onBack}>&larr; Back</button>
      <h2>Profile</h2>

      <div className="profile-tabs">
        <button className={`admin-tab ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>
          Profile
        </button>
        <button className={`admin-tab ${tab === "pools" ? "active" : ""}`} onClick={() => setTab("pools")}>
          My Pools ({myPools.filter((p) => !p.is_test).length})
        </button>
        <button className={`admin-tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
          Settings
        </button>
      </div>

      {tab === "profile" && (
        <>
          <div className="settings-section">
            <h3>Account</h3>
            <div className="settings-field">
              <label>Username</label>
              <input type="text" value={user.username} disabled className="settings-input disabled" />
            </div>
            <div className="settings-field">
              <label>Display Name</label>
              <input type="text" value={user.display_name} disabled className="settings-input disabled" />
            </div>
            <div className="settings-field">
              <label>Email</label>
              <input type="text" value={savedEmail || "Not linked"} disabled className="settings-input disabled" />
            </div>
          </div>

          <div className="settings-section">
            <h3>Stats</h3>
            <div className="profile-stats">
              <div className="profile-stat">
                <span className="profile-stat-value">{myPools.filter((p) => !p.is_test).length}</span>
                <span className="profile-stat-label">Pools Joined</span>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "pools" && (
        <>
          <p className="select-subtitle">Pools you are a member of</p>
          {loadingPools && <p className="notice">Loading...</p>}
          {!loadingPools && myPools.filter((p) => !p.is_test).length === 0 && (
            <p className="notice">You haven&apos;t joined any pools yet.</p>
          )}
          <div className="pool-list">
            {myPools.filter((p) => !p.is_test).map((p) => (
              <div key={p.id} className="pool-list-item">
                <button
                  className="pool-list-btn"
                  onClick={() => onSelectPool && onSelectPool({
                    id: p.id, name: p.name, sport: p.sport, tournament: p.tournament,
                    is_test: p.is_test, is_public: p.is_public,
                  })}
                >
                  <span className="pool-list-name">
                    {SPORT_LABELS[p.sport] || ""} {p.name}
                  </span>
                  <span className="pool-list-meta">
                    {TOURNAMENT_LABELS[p.tournament] || p.tournament} &middot; {p.member_count} member{p.member_count !== 1 ? "s" : ""}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "settings" && (
        <>
          <div className="settings-section">
            <h3>Account</h3>
            <div className="settings-field">
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="settings-input"
              />
            </div>
            <div className="settings-field">
              <label>Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="settings-input"
              />
            </div>
            <div className="settings-field">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="settings-input"
              />
            </div>
            <p className="settings-help">
              Email is used for password recovery only.
            </p>
            {msg && (
              <div className={`backup-msg ${msg.type}`}>{msg.text}</div>
            )}
            <button
              className="btn-submit"
              onClick={handleSaveProfile}
              disabled={saving || !profileHasChanged}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>

          <div className="settings-section">
            <h3>Change Password</h3>
            <div className="settings-field">
              <label>Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="settings-input"
              />
            </div>
            <div className="settings-field">
              <label>New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="settings-input"
              />
            </div>
            <div className="settings-field">
              <label>Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="settings-input"
              />
            </div>
            {pwdMsg && (
              <div className={`backup-msg ${pwdMsg.type}`}>{pwdMsg.text}</div>
            )}
            <button
              className="btn-submit"
              onClick={handleChangePassword}
              disabled={pwdSaving || !currentPassword || !newPassword}
            >
              {pwdSaving ? "Changing..." : "Change Password"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Settings;
