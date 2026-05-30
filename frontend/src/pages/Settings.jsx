import { useState, useEffect } from "react";
import { fetchProfile, updateProfile } from "../api";

function Settings({ user, onBack, onUpdateUser }) {
  const [email, setEmail] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    fetchProfile().then((data) => {
      if (!data.error) {
        setEmail(data.email || "");
        setSavedEmail(data.email || "");
      }
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    const res = await updateProfile({ email: email.trim() || null });
    if (res.error) {
      setMsg({ type: "error", text: res.error });
    } else {
      setSavedEmail(res.email || "");
      setEmail(res.email || "");
      if (onUpdateUser) onUpdateUser(res);
      setMsg({ type: "success", text: "Email updated" });
    }
    setSaving(false);
  };

  const hasChanged = email.trim().toLowerCase() !== (savedEmail || "").toLowerCase();

  return (
    <div className="select-page settings-page">
      <button className="back-btn" onClick={onBack}>&larr; Back</button>
      <h2>Settings</h2>

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
      </div>

      <div className="settings-section">
        <h3>Email</h3>
        <p className="settings-help">
          Link your email to enable password recovery. We will only use it to send password reset links.
        </p>
        <div className="settings-field">
          <label>Email Address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="settings-input"
          />
        </div>
        {msg && (
          <div className={`backup-msg ${msg.type}`}>{msg.text}</div>
        )}
        <button
          className="btn-submit"
          onClick={handleSave}
          disabled={saving || !hasChanged}
        >
          {saving ? "Saving..." : "Save Email"}
        </button>
      </div>
    </div>
  );
}

export default Settings;
