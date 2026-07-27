// Push notifications via Firebase Cloud Messaging (HTTP v1).
//
// FCM fans out to both platforms: Android devices directly, iOS devices through
// APNs once the APNs auth key is uploaded to the Firebase project. That keeps a
// single sender here rather than two.
//
// Configure with a Firebase service account JSON, either inline or as a path:
//   FCM_SERVICE_ACCOUNT       the JSON itself (what Railway wants)
//   FCM_SERVICE_ACCOUNT_FILE  path to the JSON on disk (easier locally)
// Push silently disables itself when neither is set, so dev and CI are unaffected.

const fs = require("fs");
const { JWT } = require("google-auth-library");
const db = require("./db");

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let jwtClient = null;
let projectId = null;
let configError = null;

function loadServiceAccount() {
  const inline = process.env.FCM_SERVICE_ACCOUNT;
  const file = process.env.FCM_SERVICE_ACCOUNT_FILE;
  if (!inline && !file) return null;
  try {
    const raw = inline || fs.readFileSync(file, "utf8");
    const sa = JSON.parse(raw);
    if (!sa.client_email || !sa.private_key || !sa.project_id) {
      throw new Error("missing client_email, private_key or project_id");
    }
    return sa;
  } catch (err) {
    configError = err.message;
    return null;
  }
}

function init() {
  if (jwtClient || configError) return;
  const sa = loadServiceAccount();
  if (!sa) {
    configError = configError || "not configured";
    return;
  }
  projectId = sa.project_id;
  jwtClient = new JWT({
    email: sa.client_email,
    // Railway env vars turn real newlines into the two-character \n sequence.
    key: sa.private_key.replace(/\\n/g, "\n"),
    scopes: [FCM_SCOPE],
  });
}

function isEnabled() {
  init();
  return !!jwtClient;
}

// --- token bookkeeping -------------------------------------------------------

function registerToken(userId, token, platform) {
  db.prepare(
    `INSERT INTO device_tokens (token, user_id, platform, last_seen_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(token) DO UPDATE SET
       user_id = excluded.user_id,
       platform = excluded.platform,
       last_seen_at = datetime('now')`
  ).run(token, userId, platform);
}

function unregisterToken(token) {
  db.prepare("DELETE FROM device_tokens WHERE token = ?").run(token);
}

function tokensFor(userId) {
  return db.prepare("SELECT token FROM device_tokens WHERE user_id = ?").all(userId).map((r) => r.token);
}

// --- sending -----------------------------------------------------------------

// FCM reports a permanently dead token with one of these; anything else (a 5xx,
// a rate limit) is transient and must not delete the token.
function isDeadTokenError(status, body) {
  if (status === 404) return true;
  if (status !== 400 && status !== 403) return false;
  const text = JSON.stringify(body || "");
  return text.includes("UNREGISTERED") || text.includes("INVALID_ARGUMENT");
}

async function sendToToken(accessToken, token, { title, body, data }) {
  const message = {
    token,
    notification: { title, body },
    // Data values must be strings; FCM rejects the request otherwise.
    data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
    android: {
      priority: "high",
      notification: { channel_id: "matches", icon: "ic_stat_notify", color: "#0b1a0b" },
    },
    apns: {
      payload: { aps: { sound: "default", badge: 1 } },
    },
  };

  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (resp.ok) return { ok: true };

  let errBody = null;
  try { errBody = await resp.json(); } catch { /* non-JSON error body */ }
  if (isDeadTokenError(resp.status, errBody)) {
    unregisterToken(token);
    return { ok: false, dead: true };
  }
  return { ok: false, error: `${resp.status} ${JSON.stringify(errBody)}` };
}

// Sends one notification to every device a user owns. Returns how many landed.
async function sendToUser(userId, payload) {
  if (!isEnabled()) return 0;
  const tokens = tokensFor(userId);
  if (tokens.length === 0) return 0;

  const { token: accessToken } = await jwtClient.getAccessToken();
  let delivered = 0;
  for (const token of tokens) {
    try {
      const res = await sendToToken(accessToken, token, payload);
      if (res.ok) delivered++;
      else if (res.error) console.error("Push send failed:", res.error);
    } catch (err) {
      console.error("Push send threw:", err.message || err);
    }
  }
  return delivered;
}

// Claims the (user, kind, ref) slot. Returns false if this user was already told,
// which is what stops duplicates across pools and across scan runs.
function claim(userId, kind, ref) {
  const res = db
    .prepare("INSERT OR IGNORE INTO push_log (user_id, kind, ref) VALUES (?, ?, ?)")
    .run(userId, kind, ref);
  return res.changes > 0;
}

function wantsKind(userId, kind) {
  const row = db.prepare("SELECT reminders, results FROM push_prefs WHERE user_id = ?").get(userId);
  if (!row) return true;
  return kind === "reminder" ? !!row.reminders : !!row.results;
}

async function notifyOnce(userId, kind, ref, payload) {
  if (!wantsKind(userId, kind)) return false;
  if (!claim(userId, kind, ref)) return false;
  const delivered = await sendToUser(userId, payload);
  if (delivered === 0) {
    // No live device: release the slot so the user still hears about it if they
    // install the app before the match starts.
    db.prepare("DELETE FROM push_log WHERE user_id = ? AND kind = ? AND ref = ?").run(userId, kind, ref);
    return false;
  }
  return true;
}

module.exports = {
  isEnabled,
  registerToken,
  unregisterToken,
  tokensFor,
  sendToUser,
  notifyOnce,
  _internals: { isDeadTokenError, claim, wantsKind },
};
