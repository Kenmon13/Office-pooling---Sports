const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const { OAuth2Client } = require("google-auth-library");
const { Resend } = require("resend");
const JWT_SECRET = process.env.JWT_SECRET || "office-pooling-secret-change-me";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "719484309775-ooani0nttr0qeijov4ar50nk845364rt.apps.googleusercontent.com";
// The iOS app signs in against its own OAuth client, so its ID tokens carry a
// different `aud` than the web/Android ones. Both must be accepted.
const GOOGLE_IOS_CLIENT_ID = process.env.GOOGLE_IOS_CLIENT_ID || "";
const GOOGLE_AUDIENCES = [GOOGLE_CLIENT_ID, GOOGLE_IOS_CLIENT_ID].filter(Boolean);
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
// Sign in with Apple issues identity tokens to the app's bundle ID.
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || "com.sportspooling.app";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.APP_URL || "https://sportspooling.com";

// Seed on first run
require("./seed");
const { startScoreRefresh, syncPLFixtures, syncPLSquads } = require("./scores");
const push = require("./push");
const { startPushJobs } = require("./pushJobs");

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static build
app.use(express.static(path.join(__dirname, "public")));

// --- Auth ---

app.post("/api/auth/signup", (req, res) => {
  const { username, password, display_name, email } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: "Username is required" });
  if (!password || !password.trim()) return res.status(400).json({ error: "Password is required" });
  if (!display_name || !display_name.trim()) return res.status(400).json({ error: "Display name is required" });
  if (!email || !email.trim()) return res.status(400).json({ error: "Email is required" });
  const normEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) return res.status(400).json({ error: "Invalid email format" });
  const normUsername = username.trim().toLowerCase();
  try {
    // Reject if the email is already registered. Without this, a password account with no
    // matching email later blocks Google sign-in from linking, spawning duplicate accounts.
    const emailTaken = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(normEmail);
    if (emailTaken) return res.status(409).json({ error: "An account with this email already exists. Try signing in, or use \"Continue with Google\"." });
    const hashed = bcrypt.hashSync(password.trim(), 10);
    const result = db.prepare("INSERT INTO users (username, password, display_name, email) VALUES (?, ?, ?, ?)").run(normUsername, hashed, display_name.trim(), normEmail);
    const user = { id: result.lastInsertRowid, username: normUsername, display_name: display_name.trim(), email: normEmail, is_admin: 0 };
    const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ ...user, token });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "Username already taken" });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/signin", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password are required" });
  const row = db.prepare("SELECT id, username, password, display_name, email, is_admin FROM users WHERE username = ?").get(username.trim().toLowerCase());
  if (!row || !bcrypt.compareSync(password.trim(), row.password)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const user = { id: row.id, username: row.username, display_name: row.display_name, email: row.email, is_admin: row.is_admin };
  const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ ...user, token });
});

app.post("/api/auth/google", async (req, res) => {
  try {
    const { token: idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: "Token is required" });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_AUDIENCES,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name } = payload;

    // Check if user already exists with this google_id
    let row = db.prepare("SELECT id, username, display_name, email, is_admin FROM users WHERE google_id = ?").get(googleId);

    const normEmail = email ? email.trim().toLowerCase() : null;

    if (!row && normEmail) {
      // Check if a user with this email already exists (link accounts). Matched case-insensitively
      // so a Google login always links to the existing password account instead of duplicating it.
      row = db.prepare("SELECT id, username, display_name, email, is_admin FROM users WHERE lower(email) = ?").get(normEmail);
      if (row) {
        // Link Google to existing account
        db.prepare("UPDATE users SET google_id = ? WHERE id = ?").run(googleId, row.id);
      }
    }

    if (!row) {
      // Create new user
      const username = `g_${googleId.slice(0, 12)}`;
      const displayName = name || normEmail || "Google User";
      const result = db.prepare(
        "INSERT INTO users (username, password, display_name, email, google_id) VALUES (?, ?, ?, ?, ?)"
      ).run(username, "google-oauth-no-password", displayName, normEmail, googleId);
      row = { id: result.lastInsertRowid, username, display_name: displayName, email: normEmail, is_admin: 0 };
    }

    const user = { id: row.id, username: row.username, display_name: row.display_name, email: row.email, is_admin: row.is_admin };
    const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ ...user, token });
  } catch (err) {
    console.error("Google auth error:", err.message || err);
    res.status(401).json({ error: "Google authentication failed: " + (err.message || "unknown error") });
  }
});

// --- Sign in with Apple ---
// Required by App Store guideline 4.8 for any app that offers Google sign-in.

const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
let appleKeyCache = { keys: null, fetchedAt: 0 };

async function getAppleSigningKey(kid) {
  const fresh = Date.now() - appleKeyCache.fetchedAt < 24 * 60 * 60 * 1000;
  if (!appleKeyCache.keys || !fresh || !appleKeyCache.keys.find((k) => k.kid === kid)) {
    const resp = await fetch(APPLE_KEYS_URL);
    if (!resp.ok) throw new Error(`Could not fetch Apple public keys (${resp.status})`);
    const body = await resp.json();
    appleKeyCache = { keys: body.keys || [], fetchedAt: Date.now() };
  }
  const jwk = appleKeyCache.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error("Apple public key not found for this token");
  return crypto.createPublicKey({ key: jwk, format: "jwk" });
}

async function verifyAppleIdentityToken(idToken) {
  let header;
  try {
    header = JSON.parse(Buffer.from(idToken.split(".")[0], "base64url").toString("utf8"));
  } catch {
    throw new Error("Malformed identity token");
  }
  if (!header || !header.kid) throw new Error("Malformed identity token");
  const key = await getAppleSigningKey(header.kid);
  return jwt.verify(idToken, key, {
    algorithms: ["RS256"],
    audience: APPLE_BUNDLE_ID,
    issuer: "https://appleid.apple.com",
  });
}

app.post("/api/auth/apple", async (req, res) => {
  try {
    const { token: idToken, display_name } = req.body;
    if (!idToken) return res.status(400).json({ error: "Token is required" });

    const payload = await verifyAppleIdentityToken(idToken);
    const appleId = payload.sub;

    // Apple only returns the email on the first authorization, and it may be a
    // private relay address. `sub` is the only field present on every sign-in.
    // email_verified arrives as either a boolean or the string "true"/"false".
    const emailVerified = payload.email_verified === true || payload.email_verified === "true";
    const normEmail =
      payload.email && emailVerified ? String(payload.email).trim().toLowerCase() : null;

    let row = db.prepare("SELECT id, username, display_name, email, is_admin FROM users WHERE apple_id = ?").get(appleId);

    if (!row && normEmail) {
      // Link to an existing account with the same email, mirroring Google.
      row = db.prepare("SELECT id, username, display_name, email, is_admin FROM users WHERE lower(email) = ?").get(normEmail);
      if (row) {
        db.prepare("UPDATE users SET apple_id = ? WHERE id = ?").run(appleId, row.id);
      }
    }

    if (!row) {
      const username = `a_${appleId.replace(/\W/g, "").slice(0, 12)}`;
      const displayName = (display_name && display_name.trim()) || normEmail || "Apple User";
      const result = db.prepare(
        "INSERT INTO users (username, password, display_name, email, apple_id) VALUES (?, ?, ?, ?, ?)"
      ).run(username, "apple-oauth-no-password", displayName, normEmail, appleId);
      row = { id: result.lastInsertRowid, username, display_name: displayName, email: normEmail, is_admin: 0 };
    }

    const user = { id: row.id, username: row.username, display_name: row.display_name, email: row.email, is_admin: row.is_admin };
    const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ ...user, token });
  } catch (err) {
    console.error("Apple auth error:", err.message || err);
    res.status(401).json({ error: "Apple authentication failed: " + (err.message || "unknown error") });
  }
});

// --- Profile ---

app.get("/api/user/pools", authenticateToken, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.sport, p.tournament, p.mock_date, p.is_public,
           pt.id as participant_id
    FROM participants pt
    JOIN pools p ON pt.pool_id = p.id
    WHERE pt.user_id = ?
    ORDER BY p.id DESC
  `).all(req.user.id);
  res.json(rows);
});

app.get("/api/auth/profile", authenticateToken, (req, res) => {
  const user = db.prepare("SELECT id, username, display_name, email, is_admin FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

app.get("/api/auth/my-pools", authenticateToken, (req, res) => {
  const pools = db.prepare(`
    SELECT p.id, p.name, p.sport, p.tournament, p.is_public, p.is_test, p.created_at,
           part.id as participant_id, part.created_at as joined_at,
           (SELECT COUNT(*) FROM participants WHERE pool_id = p.id) as member_count
    FROM participants part
    JOIN pools p ON p.id = part.pool_id
    WHERE part.user_id = ?
    ORDER BY part.created_at DESC
  `).all(req.user.id);
  res.json(pools);
});

app.put("/api/auth/profile", authenticateToken, (req, res) => {
  const { email, username, display_name } = req.body;
  if (email !== undefined) {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (email) {
      const existing = db.prepare("SELECT id FROM users WHERE lower(email) = ? AND id != ?").get(email.toLowerCase(), req.user.id);
      if (existing) return res.status(409).json({ error: "Email already linked to another account" });
    }
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email ? email.trim().toLowerCase() : null, req.user.id);
  }
  if (username !== undefined) {
    if (!username || !username.trim()) return res.status(400).json({ error: "Username cannot be empty" });
    // Store and compare usernames lower-cased so casing variants can't create shadow accounts.
    const normUsername = username.trim().toLowerCase();
    const existing = db.prepare("SELECT id FROM users WHERE lower(username) = ? AND id != ?").get(normUsername, req.user.id);
    if (existing) return res.status(409).json({ error: "Username already taken" });
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(normUsername, req.user.id);
  }
  if (display_name !== undefined) {
    if (!display_name || !display_name.trim()) return res.status(400).json({ error: "Display name cannot be empty" });
    db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(display_name.trim(), req.user.id);
    // Update display name in participants table too
    db.prepare("UPDATE participants SET name = ? WHERE user_id = ?").run(display_name.trim(), req.user.id);
  }
  const user = db.prepare("SELECT id, username, display_name, email, is_admin FROM users WHERE id = ?").get(req.user.id);
  res.json(user);
});

app.put("/api/auth/change-password", authenticateToken, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: "Current and new password are required" });
  if (new_password.trim().length < 1) return res.status(400).json({ error: "New password cannot be empty" });
  const user = db.prepare("SELECT password FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const valid = await bcrypt.compare(current_password, user.password);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
  const hashed = await bcrypt.hash(new_password.trim(), 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashed, req.user.id);
  res.json({ success: true });
});

// --- Issues ---

app.post("/api/issues", authenticateToken, (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: "Issue description is required" });
  const user = db.prepare("SELECT display_name FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const result = db.prepare("INSERT INTO issues (user_id, display_name, body) VALUES (?, ?, ?)").run(req.user.id, user.display_name, body.trim());
  res.json({ id: result.lastInsertRowid, success: true });
});

// User: get my issues with reply counts
app.get("/api/issues/mine", authenticateToken, (req, res) => {
  const issues = db.prepare(`
    SELECT i.*, COUNT(r.id) AS reply_count
    FROM issues i
    LEFT JOIN issue_replies r ON r.issue_id = i.id
    WHERE i.user_id = ?
    GROUP BY i.id
    ORDER BY i.created_at DESC
  `).all(req.user.id);
  res.json(issues);
});

// Get replies for an issue (user can only see their own, admin can see all)
app.get("/api/issues/:id/replies", authenticateToken, (req, res) => {
  const issue = db.prepare("SELECT * FROM issues WHERE id = ?").get(req.params.id);
  if (!issue) return res.status(404).json({ error: "Issue not found" });
  const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
  if (issue.user_id !== req.user.id && !user.is_admin) return res.status(403).json({ error: "Forbidden" });
  const replies = db.prepare("SELECT * FROM issue_replies WHERE issue_id = ? ORDER BY created_at ASC").all(req.params.id);
  res.json({ issue, replies });
});

// Post a reply to an issue
app.post("/api/issues/:id/replies", authenticateToken, (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: "Reply cannot be empty" });
  const issue = db.prepare("SELECT * FROM issues WHERE id = ?").get(req.params.id);
  if (!issue) return res.status(404).json({ error: "Issue not found" });
  const user = db.prepare("SELECT display_name, is_admin FROM users WHERE id = ?").get(req.user.id);
  if (issue.user_id !== req.user.id && !user.is_admin) return res.status(403).json({ error: "Forbidden" });
  const result = db.prepare("INSERT INTO issue_replies (issue_id, user_id, display_name, body, is_admin) VALUES (?, ?, ?, ?, ?)").run(
    req.params.id, req.user.id, user.display_name, body.trim(), user.is_admin ? 1 : 0
  );
  // Auto-resolve issue when admin replies, reopen when user replies
  if (user.is_admin && issue.status === "open") {
    db.prepare("UPDATE issues SET status = 'resolved' WHERE id = ?").run(req.params.id);
  } else if (!user.is_admin && issue.status === "resolved") {
    db.prepare("UPDATE issues SET status = 'open' WHERE id = ?").run(req.params.id);
  }
  res.json({ id: result.lastInsertRowid, success: true });
});

// Admin: delete a reply
app.delete("/api/issues/:issueId/replies/:replyId", requireAdminToken, (req, res) => {
  const reply = db.prepare("SELECT * FROM issue_replies WHERE id = ? AND issue_id = ?").get(req.params.replyId, req.params.issueId);
  if (!reply) return res.status(404).json({ error: "Reply not found" });
  if (!reply.is_admin) return res.status(403).json({ error: "Can only delete admin replies" });
  db.prepare("DELETE FROM issue_replies WHERE id = ?").run(req.params.replyId);
  res.json({ success: true });
});

app.get("/api/admin/issues", requireAdminToken, (req, res) => {
  const issues = db.prepare(`
    SELECT i.*, COUNT(r.id) AS reply_count
    FROM issues i
    LEFT JOIN issue_replies r ON r.issue_id = i.id
    GROUP BY i.id
    ORDER BY i.created_at DESC
  `).all();
  res.json(issues);
});

app.put("/api/admin/issues/:id", requireAdminToken, (req, res) => {
  const { status } = req.body;
  if (!["open", "resolved"].includes(status)) return res.status(400).json({ error: "Invalid status" });
  db.prepare("UPDATE issues SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ success: true });
});

app.delete("/api/admin/issues/:id", requireAdminToken, (req, res) => {
  db.prepare("DELETE FROM issues WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// --- Forgot / Reset Password ---

app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  const user = db.prepare("SELECT id, username, display_name, email FROM users WHERE email = ?").get(email.trim().toLowerCase());
  // Always return success to prevent email enumeration
  if (!user) return res.json({ success: true });

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set — cannot send password reset email");
    return res.status(500).json({ error: "Email service not configured" });
  }

  const resetToken = jwt.sign({ id: user.id, purpose: "password-reset" }, JWT_SECRET, { expiresIn: "15m" });
  const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`;

  try {
    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: "Sports Pooling <noreply@sportspooling.com>",
      to: user.email,
      subject: "Reset your password — Sports Pooling",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1b5e20;">Reset Your Password</h2>
          <p>Hi ${user.display_name},</p>
          <p>We received a request to reset your password. Click the button below to set a new one:</p>
          <p style="text-align: center; margin: 24px 0;">
            <a href="${resetUrl}" style="background: #2e7d32; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
              Reset Password
            </a>
          </p>
          <p style="color: #888; font-size: 13px;">This link expires in 15 minutes. If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to send reset email:", err);
    res.status(500).json({ error: "Failed to send email" });
  }
});

app.post("/api/auth/reset-password", (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "Token and new password are required" });
  if (password.trim().length < 3) return res.status(400).json({ error: "Password must be at least 3 characters" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.purpose !== "password-reset") {
      return res.status(400).json({ error: "Invalid reset token" });
    }
    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(payload.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const hashed = bcrypt.hashSync(password.trim(), 10);
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashed, user.id);
    res.json({ success: true });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(400).json({ error: "Reset link has expired. Please request a new one." });
    }
    return res.status(400).json({ error: "Invalid or expired reset token" });
  }
});

// --- JWT Auth Middleware ---

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireAdminToken(req, res, next) {
  authenticateToken(req, res, () => {
    const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    if (!user || !user.is_admin) return res.status(401).json({ error: "Not authorized" });
    next();
  });
}

// --- Push notifications ---

app.post("/api/push/register", authenticateToken, (req, res) => {
  const { token, platform } = req.body;
  if (!token || typeof token !== "string") return res.status(400).json({ error: "Token is required" });
  if (!["ios", "android", "web"].includes(platform)) {
    return res.status(400).json({ error: "platform must be ios, android or web" });
  }
  push.registerToken(req.user.id, token, platform);
  res.json({ ok: true, enabled: push.isEnabled() });
});

app.post("/api/push/unregister", authenticateToken, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Token is required" });
  // Scoped to the caller so one user cannot drop another user's device.
  const row = db.prepare("SELECT user_id FROM device_tokens WHERE token = ?").get(token);
  if (row && row.user_id === req.user.id) push.unregisterToken(token);
  res.json({ ok: true });
});

app.get("/api/push/prefs", authenticateToken, (req, res) => {
  const row = db.prepare("SELECT reminders, results FROM push_prefs WHERE user_id = ?").get(req.user.id);
  res.json({
    reminders: row ? !!row.reminders : true,
    results: row ? !!row.results : true,
    devices: push.tokensFor(req.user.id).length,
  });
});

app.put("/api/push/prefs", authenticateToken, (req, res) => {
  const reminders = req.body.reminders === false ? 0 : 1;
  const results = req.body.results === false ? 0 : 1;
  db.prepare(
    `INSERT INTO push_prefs (user_id, reminders, results) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET reminders = excluded.reminders, results = excluded.results`
  ).run(req.user.id, reminders, results);
  res.json({ reminders: !!reminders, results: !!results });
});

// Send a notification to the caller's own devices, so push can be verified on a
// real handset without waiting for a match.
app.post("/api/push/test", authenticateToken, async (req, res) => {
  if (!push.isEnabled()) return res.status(503).json({ error: "Push is not configured on this server" });
  const delivered = await push.sendToUser(req.user.id, {
    title: "Sports Pooling",
    body: "Push notifications are working.",
    data: { kind: "test" },
  });
  res.json({ delivered });
});

// --- Admin ---

app.get("/api/admin/users", requireAdminToken, (req, res) => {
  const users = db.prepare("SELECT id, username, display_name, email, is_admin, created_at FROM users ORDER BY created_at DESC").all();
  res.json(users);
});

// Admin set/correct/clear a user's email (mirrors the self-serve profile rules).
app.patch("/api/admin/users/:id/email", requireAdminToken, (req, res) => {
  const { email } = req.body;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const normalized = email ? email.trim().toLowerCase() : null;
  if (normalized) {
    const existing = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(normalized, user.id);
    if (existing) return res.status(409).json({ error: "Email already linked to another account" });
  }
  db.prepare("UPDATE users SET email = ? WHERE id = ?").run(normalized, user.id);
  res.json({ success: true, email: normalized });
});

// --- "What should we build next?" poll (one row per user: a vote or a dismissal) ---

app.get("/api/poll/status", authenticateToken, (req, res) => {
  const row = db.prepare("SELECT status FROM poll_responses WHERE user_id = ?").get(req.user.id);
  res.json({ done: !!row, status: row ? row.status : null });
});

app.post("/api/poll/vote", authenticateToken, (req, res) => {
  let { choices, other } = req.body;
  if (!Array.isArray(choices)) choices = [];
  choices = choices.filter((c) => typeof c === "string").slice(0, 30);
  const otherText = (typeof other === "string" && other.trim()) ? other.trim().slice(0, 300) : null;
  if (choices.length === 0 && !otherText) {
    return res.status(400).json({ error: "Pick at least one option or enter your own" });
  }
  db.prepare(`
    INSERT INTO poll_responses (user_id, choices, other_text, status, created_at, updated_at)
    VALUES (?, ?, ?, 'voted', datetime('now'), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      choices = excluded.choices, other_text = excluded.other_text,
      status = 'voted', updated_at = datetime('now')
  `).run(req.user.id, JSON.stringify(choices), otherText);
  res.json({ success: true });
});

app.post("/api/poll/dismiss", authenticateToken, (req, res) => {
  db.prepare(`
    INSERT INTO poll_responses (user_id, choices, other_text, status, created_at, updated_at)
    VALUES (?, NULL, NULL, 'dismissed', datetime('now'), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET status = 'dismissed', updated_at = datetime('now')
  `).run(req.user.id);
  res.json({ success: true });
});

app.get("/api/admin/poll/results", requireAdminToken, (req, res) => {
  const rows = db.prepare("SELECT choices, other_text, status FROM poll_responses").all();
  const counts = {};
  const otherMap = new Map(); // normalized text -> { text, count } so duplicate write-ins group
  let voted = 0, dismissed = 0;
  for (const r of rows) {
    if (r.status === "dismissed") { dismissed++; continue; }
    voted++;
    let ch = [];
    try { ch = JSON.parse(r.choices || "[]"); } catch (_) { ch = []; }
    for (const c of ch) counts[c] = (counts[c] || 0) + 1;
    if (r.other_text) {
      const text = r.other_text.trim();
      if (text) {
        const key = text.toLowerCase();
        const hit = otherMap.get(key);
        if (hit) hit.count++;
        else otherMap.set(key, { text, count: 1 });
      }
    }
  }
  const others = [...otherMap.values()].sort((a, b) => b.count - a.count);
  res.json({ voted, dismissed, counts, others });
});

app.get("/api/admin/users/:id/pools", requireAdminToken, (req, res) => {
  const pools = db.prepare(`
    SELECT p.id, p.name, p.sport, p.tournament, p.is_public,
           part.id as participant_id,
           EXISTS(SELECT 1 FROM pool_admins pa WHERE pa.pool_id = p.id AND pa.user_id = ?) as is_admin
    FROM participants part
    JOIN pools p ON p.id = part.pool_id
    WHERE part.user_id = ?
    ORDER BY p.name
  `).all(req.params.id, req.params.id);
  res.json(pools);
});

// Every table with a participant_id column. Single source of truth for the three admin
// ops that touch participant-scoped data: delete-user + delete-pool (DELETE these first,
// they FK to participants) and merge-participants (reassign them). Hardcoded whitelist
// (not user input), so safe to interpolate. Keep in sync with new participant-scoped tables.
const PARTICIPANT_SCOPED_TABLES = [
  "wc2022_champion_picks",
  "wc2022_group_predictions",
  "wc2022_knockout_predictions",
  "champion_picks",
  "knockout_predictions",
  "group_predictions",
  "predictions",
  "third_place_predictions",
  "player_award_picks",
  "league_award_picks",
  "league_match_predictions",
  "league_season_predictions",
  "pl2627_match_predictions",
  "pl2627_player_award_picks",
  "pl2627_season_predictions",
  "score_adjustments",
];

app.delete("/api/admin/users/:id", requireAdminToken, (req, res) => {
  const targetId = req.params.id;
  // Don't allow deleting yourself
  if (String(targetId) === String(req.user.id)) return res.status(400).json({ error: "Cannot delete yourself" });

  // All-or-nothing: without a transaction a failure partway (e.g. an un-cleared FK)
  // leaves half the user's data deleted and a ghost account behind.
  try {
    const deleteUser = db.transaction(() => {
      // Participant-scoped rows first (they FK to participants).
      for (const t of PARTICIPANT_SCOPED_TABLES) {
        db.prepare(`DELETE FROM ${t} WHERE participant_id IN (SELECT id FROM participants WHERE user_id = ?)`).run(targetId);
      }
      db.prepare("DELETE FROM participants WHERE user_id = ?").run(targetId);

      // User-scoped rows that FK to users. issue_replies also FK to issues, so clear both
      // the user's own replies and any replies left on the user's issues before the issues.
      db.prepare("DELETE FROM issue_replies WHERE user_id = ? OR issue_id IN (SELECT id FROM issues WHERE user_id = ?)").run(targetId, targetId);
      db.prepare("DELETE FROM issues WHERE user_id = ?").run(targetId);
      db.prepare("DELETE FROM messages WHERE user_id = ?").run(targetId);
      db.prepare("DELETE FROM poll_responses WHERE user_id = ?").run(targetId);
      db.prepare("DELETE FROM pool_admins WHERE user_id = ?").run(targetId);

      db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
    });
    deleteUser();
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete user", detail: err.message });
  }
  res.json({ success: true });
});

app.get("/api/admin/pools", requireAdminToken, (req, res) => {

  const pools = db.prepare(`
    SELECT p.id, p.name, p.sport, p.tournament, p.is_test, p.created_at,
      (SELECT COUNT(*) FROM participants pt WHERE pt.pool_id = p.id) as user_count
    FROM pools p
    ORDER BY p.sport, p.tournament, p.created_at DESC
  `).all();
  res.json(pools);
});

app.delete("/api/admin/pools/:id", requireAdminToken, (req, res) => {
  const poolId = req.params.id;
  // All-or-nothing, and clear every table that FKs to this pool's participants (or the pool
  // itself) — an un-cleared table would FK-block the delete and leave the pool half-removed.
  try {
    const deletePool = db.transaction(() => {
      for (const t of PARTICIPANT_SCOPED_TABLES) {
        db.prepare(`DELETE FROM ${t} WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)`).run(poolId);
      }
      db.prepare("DELETE FROM participants WHERE pool_id = ?").run(poolId);
      db.prepare("DELETE FROM messages WHERE pool_id = ?").run(poolId);
      db.prepare("DELETE FROM pool_admins WHERE pool_id = ?").run(poolId);
      db.prepare("DELETE FROM pools WHERE id = ?").run(poolId);
    });
    deletePool();
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete pool", detail: err.message });
  }
  res.json({ success: true });
});

// --- Pools ---

app.post("/api/pools", authenticateToken, (req, res) => {
  const { name, sport, tournament, password, is_public } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Pool name is required" });
  if (!is_public && (!password || !password.trim())) return res.status(400).json({ error: "Password is required" });
  try {
    const pwd = is_public ? "" : password.trim();
    const result = db.prepare("INSERT INTO pools (name, sport, tournament, password, is_public) VALUES (?, ?, ?, ?, ?)").run(name.trim(), sport || "soccer", tournament || "wc2026", pwd, is_public ? 1 : 0);
    const poolId = result.lastInsertRowid;
    // Auto-add creator as pool admin
    db.prepare("INSERT OR IGNORE INTO pool_admins (pool_id, user_id) VALUES (?, ?)").run(poolId, req.user.id);
    res.json({ id: poolId, name: name.trim(), sport: sport || "soccer", tournament: tournament || "wc2026", is_public: is_public ? 1 : 0 });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "A pool with that name already exists in this tournament" });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/pools/join", (req, res) => {
  const { name, password, tournament } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Pool name is required" });
  // Names are unique per tournament, so scope the lookup by tournament when the client
  // provides it (the join screen always knows it). Fall back to name-only for older clients.
  const pool = tournament
    ? db.prepare("SELECT * FROM pools WHERE name = ? AND tournament = ?").get(name.trim(), tournament)
    : db.prepare("SELECT * FROM pools WHERE name = ?").get(name.trim());
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  if (!pool.is_public) {
    if (!password || !password.trim()) return res.status(400).json({ error: "Password is required" });
    if (pool.password !== password.trim()) return res.status(401).json({ error: "Wrong password" });
  }
  res.json({ id: pool.id, name: pool.name, sport: pool.sport, tournament: pool.tournament, is_test: pool.is_test, mock_date: pool.mock_date, is_public: pool.is_public });
});

app.get("/api/pools/:id/password", authenticateToken, (req, res) => {
  const pool = db.prepare("SELECT id, password, is_public FROM pools WHERE id = ?").get(req.params.id);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  const member = db.prepare("SELECT id FROM participants WHERE pool_id = ? AND user_id = ?").get(req.params.id, req.user.id);
  const siteAdmin = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
  if (!member && !siteAdmin?.is_admin) return res.status(403).json({ error: "Not a member of this pool" });
  if (pool.is_public) return res.json({ is_public: true, password: null });
  res.json({ is_public: false, password: pool.password });
});

app.get("/api/pools/public", (req, res) => {
  const { sport, tournament } = req.query;
  let query = "SELECT id, name, sport, tournament, created_at, (SELECT COUNT(*) FROM participants WHERE pool_id = pools.id) as member_count FROM pools WHERE is_public = 1";
  const params = [];
  if (sport) { query += " AND sport = ?"; params.push(sport); }
  if (tournament) { query += " AND tournament = ?"; params.push(tournament); }
  query += " ORDER BY member_count DESC, created_at DESC";
  const pools = db.prepare(query).all(...params);
  res.json(pools);
});

app.get("/api/pools/:id", (req, res) => {
  const pool = db.prepare("SELECT id, name, sport, tournament, is_public, is_test, mock_date FROM pools WHERE id = ?").get(req.params.id);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  res.json(pool);
});

app.post("/api/pools/join-by-id", (req, res) => {
  const { pool_id, password } = req.body;
  if (!pool_id) return res.status(400).json({ error: "pool_id is required" });
  const pool = db.prepare("SELECT * FROM pools WHERE id = ?").get(pool_id);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  if (!pool.is_public) {
    if (!password || !password.trim()) return res.status(400).json({ error: "Password is required" });
    if (pool.password !== password.trim()) return res.status(401).json({ error: "Wrong password" });
  }
  res.json({ id: pool.id, name: pool.name, sport: pool.sport, tournament: pool.tournament, is_test: pool.is_test, mock_date: pool.mock_date, is_public: pool.is_public });
});

app.delete("/api/pools/:poolId/leave", authenticateToken, (req, res) => {
  const poolId = req.params.poolId;
  const userId = req.user.id;
  const participant = db.prepare("SELECT id FROM participants WHERE pool_id = ? AND user_id = ?").get(poolId, userId);
  if (!participant) return res.status(404).json({ error: "You are not in this pool" });

  const deleteParticipantData = db.transaction(() => {
    const pid = participant.id;
    db.prepare("DELETE FROM wc2022_champion_picks WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM champion_picks WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM wc2022_knockout_predictions WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM wc2022_group_predictions WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM knockout_predictions WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM group_predictions WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM third_place_predictions WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM predictions WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM participants WHERE id = ?").run(pid);
    db.prepare("DELETE FROM messages WHERE pool_id = ? AND user_id = ?").run(poolId, userId);
    db.prepare("DELETE FROM pool_admins WHERE pool_id = ? AND user_id = ?").run(poolId, userId);

    const remaining = db.prepare("SELECT COUNT(*) as count FROM participants WHERE pool_id = ?").get(poolId);
    let poolDeleted = false;
    if (remaining.count === 0) {
      db.prepare("DELETE FROM pool_admins WHERE pool_id = ?").run(poolId);
      db.prepare("DELETE FROM pools WHERE id = ?").run(poolId);
      poolDeleted = true;
    }
    return poolDeleted;
  });

  const poolDeleted = deleteParticipantData();
  res.json({ success: true, pool_deleted: poolDeleted });
});

// --- Pool Admins ---

function requirePoolAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    const poolId = req.params.poolId;
    const row = db.prepare("SELECT 1 FROM pool_admins WHERE pool_id = ? AND user_id = ?").get(poolId, req.user.id);
    if (!row) return res.status(403).json({ error: "Pool admin access required" });
    next();
  });
}

app.get("/api/pools/:poolId/admins", authenticateToken, (req, res) => {
  const poolId = req.params.poolId;
  const member = db.prepare("SELECT id FROM participants WHERE pool_id = ? AND user_id = ?").get(poolId, req.user.id);
  if (!member) return res.status(403).json({ error: "Not a member of this pool" });
  const admins = db.prepare(`
    SELECT pa.user_id, u.display_name
    FROM pool_admins pa
    JOIN users u ON u.id = pa.user_id
    WHERE pa.pool_id = ?
  `).all(poolId);
  res.json(admins);
});

app.post("/api/pools/:poolId/admins", authenticateToken, (req, res) => {
  const poolId = req.params.poolId;
  const pool = db.prepare("SELECT is_public FROM pools WHERE id = ?").get(poolId);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  if (pool.is_public) return res.status(400).json({ error: "Admin management is only available for private pools" });
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id is required" });

  const existingAdmins = db.prepare("SELECT COUNT(*) as count FROM pool_admins WHERE pool_id = ?").get(poolId);
  const isSelfClaim = user_id === req.user.id && existingAdmins.count === 0;
  const isAdmin = db.prepare("SELECT 1 FROM pool_admins WHERE pool_id = ? AND user_id = ?").get(poolId, req.user.id);

  if (!isSelfClaim && !isAdmin) return res.status(403).json({ error: "Pool admin access required" });

  const member = db.prepare("SELECT id FROM participants WHERE pool_id = ? AND user_id = ?").get(poolId, user_id);
  if (!member) return res.status(400).json({ error: "User is not a member of this pool" });
  db.prepare("INSERT OR IGNORE INTO pool_admins (pool_id, user_id) VALUES (?, ?)").run(poolId, user_id);
  res.json({ success: true });
});

app.delete("/api/pools/:poolId/kick/:userId", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const pool = db.prepare("SELECT is_public FROM pools WHERE id = ?").get(poolId);
  if (pool && pool.is_public) return res.status(400).json({ error: "Kick is only available for private pools" });
  const targetUserId = Number(req.params.userId);
  if (targetUserId === req.user.id) return res.status(400).json({ error: "Cannot kick yourself" });
  const isTargetAdmin = db.prepare("SELECT 1 FROM pool_admins WHERE pool_id = ? AND user_id = ?").get(poolId, targetUserId);
  if (isTargetAdmin) return res.status(400).json({ error: "Cannot kick a pool admin" });
  const participant = db.prepare("SELECT id FROM participants WHERE pool_id = ? AND user_id = ?").get(poolId, targetUserId);
  if (!participant) return res.status(404).json({ error: "User is not in this pool" });

  const kickMember = db.transaction(() => {
    const pid = participant.id;
    db.prepare("DELETE FROM wc2022_champion_picks WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM champion_picks WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM wc2022_knockout_predictions WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM wc2022_group_predictions WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM knockout_predictions WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM group_predictions WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM third_place_predictions WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM predictions WHERE participant_id = ?").run(pid);
    db.prepare("DELETE FROM participants WHERE id = ?").run(pid);
    db.prepare("DELETE FROM messages WHERE pool_id = ? AND user_id = ?").run(poolId, targetUserId);
    db.prepare("DELETE FROM pool_admins WHERE pool_id = ? AND user_id = ?").run(poolId, targetUserId);
  });
  kickMember();
  res.json({ success: true });
});

app.put("/api/pools/:poolId/chat-status", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const pool = db.prepare("SELECT is_public FROM pools WHERE id = ?").get(poolId);
  if (pool && pool.is_public) return res.status(400).json({ error: "Chat management is only available for private pools" });
  const { closed } = req.body;
  db.prepare("UPDATE pools SET chat_closed = ? WHERE id = ?").run(closed ? 1 : 0, poolId);
  res.json({ success: true, chat_closed: closed ? 1 : 0 });
});

app.put("/api/pools/:poolId/champion-w2-lock", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const { locked } = req.body;
  db.prepare("UPDATE pools SET champion_w2_locked = ? WHERE id = ?").run(locked ? 1 : 0, poolId);
  res.json({ success: true, champion_w2_locked: locked ? 1 : 0 });
});

app.get("/api/pools/:poolId/champion-w2-lock", (req, res) => {
  const poolId = req.params.poolId;
  const pool = db.prepare("SELECT champion_w2_locked FROM pools WHERE id = ?").get(poolId);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  res.json({ champion_w2_locked: pool.champion_w2_locked });
});

// --- Champion Unlock (during group stage) ---

app.put("/api/pools/:poolId/champion-unlock", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const { unlocked } = req.body;
  db.prepare("UPDATE pools SET champion_unlocked = ? WHERE id = ?").run(unlocked ? 1 : 0, poolId);
  res.json({ success: true, champion_unlocked: unlocked ? 1 : 0 });
});

app.get("/api/pools/:poolId/champion-unlock", (req, res) => {
  const poolId = req.params.poolId;
  const pool = db.prepare("SELECT champion_unlocked FROM pools WHERE id = ?").get(poolId);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  res.json({ champion_unlocked: pool.champion_unlocked });
});

// --- Player Awards Lock ---

app.put("/api/pools/:poolId/player-awards-lock", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const { locked } = req.body;
  db.prepare("UPDATE pools SET player_awards_locked = ? WHERE id = ?").run(locked ? 1 : 0, poolId);
  res.json({ success: true, player_awards_locked: locked ? 1 : 0 });
});

// Void freezes the player-award picks AND makes the section score 0 points for the whole pool.
app.put("/api/pools/:poolId/player-awards-void", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const { voided } = req.body;
  db.prepare("UPDATE pools SET player_awards_voided = ? WHERE id = ?").run(voided ? 1 : 0, poolId);
  res.json({ success: true, player_awards_voided: voided ? 1 : 0 });
});

app.put("/api/pools/:poolId/name", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Pool name cannot be empty" });
  db.prepare("UPDATE pools SET name = ? WHERE id = ?").run(name.trim(), poolId);
  res.json({ success: true, name: name.trim() });
});

app.put("/api/pools/:poolId/password", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const { password } = req.body;
  if (!password || !password.trim()) return res.status(400).json({ error: "Password cannot be empty" });
  const pool = db.prepare("SELECT is_public FROM pools WHERE id = ?").get(poolId);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  if (pool.is_public) return res.status(400).json({ error: "Cannot set password on a public pool" });
  db.prepare("UPDATE pools SET password = ? WHERE id = ?").run(password.trim(), poolId);
  res.json({ success: true });
});

app.get("/api/pools/:poolId/player-awards-lock", (req, res) => {
  const poolId = req.params.poolId;
  const pool = db.prepare("SELECT player_awards_locked, player_awards_voided FROM pools WHERE id = ?").get(poolId);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  res.json({ player_awards_locked: pool.player_awards_locked, player_awards_voided: pool.player_awards_voided });
});

app.put("/api/pools/:poolId/exact-scores", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const { disabled } = req.body;
  db.prepare("UPDATE pools SET exact_scores_disabled = ? WHERE id = ?").run(disabled ? 1 : 0, poolId);
  // When an admin disables score prediction, wipe the scorelines already entered by this pool's
  // members for league matches. Outcome picks and NFL margin bands are preserved. This is
  // irreversible — turning it back on does not restore the wiped scores.
  if (disabled) {
    db.prepare(`UPDATE league_match_predictions
      SET predicted_home_score = NULL, predicted_away_score = NULL
      WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)`).run(poolId);
  }
  res.json({ success: true, exact_scores_disabled: disabled ? 1 : 0 });
});

app.get("/api/pools/:poolId/exact-scores", (req, res) => {
  const poolId = req.params.poolId;
  const pool = db.prepare("SELECT exact_scores_disabled FROM pools WHERE id = ?").get(poolId);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  res.json({ exact_scores_disabled: pool.exact_scores_disabled });
});

app.put("/api/pools/:poolId/group-stage-unlock", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const { unlocked } = req.body;
  db.prepare("UPDATE pools SET group_stage_unlocked = ? WHERE id = ?").run(unlocked ? 1 : 0, poolId);
  res.json({ success: true, group_stage_unlocked: unlocked ? 1 : 0 });
});

app.get("/api/pools/:poolId/group-stage-unlock", (req, res) => {
  const poolId = req.params.poolId;
  const pool = db.prepare("SELECT group_stage_unlocked FROM pools WHERE id = ?").get(poolId);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  res.json({ group_stage_unlocked: pool.group_stage_unlocked });
});

// --- Participants ---

app.get("/api/participants", (req, res) => {
  const poolId = req.query.pool_id;
  let participants;
  if (poolId) {
    participants = db.prepare("SELECT * FROM participants WHERE pool_id = ? ORDER BY name").all(poolId);
  } else {
    participants = db.prepare("SELECT * FROM participants ORDER BY name").all();
  }
  res.json(participants);
});

// Auto-join: find or create participant for a user in a pool
app.post("/api/participants/auto-join", (req, res) => {
  const { user_id, pool_id } = req.body;
  if (!user_id || !pool_id) return res.status(400).json({ error: "user_id and pool_id are required" });

  // Check if already in pool
  const existing = db.prepare("SELECT * FROM participants WHERE user_id = ? AND pool_id = ?").get(user_id, pool_id);
  if (existing) return res.json(existing);

  // Get user display name
  const user = db.prepare("SELECT display_name FROM users WHERE id = ?").get(user_id);
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    const result = db.prepare("INSERT INTO participants (name, pool_id, user_id) VALUES (?, ?, ?)").run(user.display_name, pool_id, user_id);
    res.json({ id: result.lastInsertRowid, name: user.display_name, pool_id, user_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Merge one participant's data into another (admin only).
// Reassigns every participant-scoped table from `from` -> `into`, then deletes `from`.
// Both participants must exist and belong to the same pool. Pass ?dryRun=1 (or
// { dryRun: true }) to preview the row counts that would move without changing anything.
// The reassignment runs in a single transaction: any UNIQUE collision (both
// participants predicted the same thing) rolls the whole merge back.
app.post("/api/admin/merge-participants", requireAdminToken, (req, res) => {
  const fromId = Number(req.body.from);
  const intoId = Number(req.body.into);
  const dryRun = req.query.dryRun === "1" || req.body.dryRun === true;

  if (!Number.isInteger(fromId) || !Number.isInteger(intoId)) {
    return res.status(400).json({ error: "from and into must be integer participant ids" });
  }
  if (fromId === intoId) {
    return res.status(400).json({ error: "from and into must be different participants" });
  }

  const from = db.prepare("SELECT * FROM participants WHERE id = ?").get(fromId);
  const into = db.prepare("SELECT * FROM participants WHERE id = ?").get(intoId);
  if (!from) return res.status(404).json({ error: `participant ${fromId} not found` });
  if (!into) return res.status(404).json({ error: `participant ${intoId} not found` });
  if (from.pool_id !== into.pool_id) {
    return res.status(400).json({ error: `participants are in different pools (${from.pool_id} vs ${into.pool_id})` });
  }

  // Every table with a participant_id column — shared with delete-user/delete-pool so a new
  // participant-scoped table is handled by all three at once.
  const tables = PARTICIPANT_SCOPED_TABLES;

  const moved = {};
  for (const t of tables) {
    moved[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE participant_id = ?`).get(fromId).n;
  }

  if (dryRun) {
    return res.json({ dryRun: true, from, into, wouldMove: moved });
  }

  try {
    const merge = db.transaction(() => {
      for (const t of tables) {
        db.prepare(`UPDATE ${t} SET participant_id = ? WHERE participant_id = ?`).run(intoId, fromId);
      }
      db.prepare("DELETE FROM participants WHERE id = ?").run(fromId);
    });
    merge();
  } catch (err) {
    return res.status(409).json({
      error: "merge aborted — likely a duplicate prediction held by both participants",
      detail: err.message,
    });
  }

  res.json({ success: true, from: fromId, into: intoId, deleted: from, moved });
});

// --- Groups & Teams ---

app.get("/api/groups", (req, res) => {
  const groups = db.prepare("SELECT * FROM groups ORDER BY name").all();
  const teams = db.prepare(`
    SELECT t.*, g.name as group_name
    FROM teams t JOIN groups g ON t.group_id = g.id
    ORDER BY g.name, t.name
  `).all();

  const result = groups.map((g) => ({
    ...g,
    teams: teams.filter((t) => t.group_id === g.id),
  }));
  res.json(result);
});

// --- Matches ---

app.get("/api/matches", (req, res) => {
  const matches = db
    .prepare(
      `SELECT m.*,
        g.name as group_name,
        ht.name as home_team, ht.code as home_code,
        at.name as away_team, at.code as away_code
      FROM matches m
      JOIN groups g ON m.group_id = g.id
      JOIN teams ht ON m.home_team_id = ht.id
      JOIN teams at ON m.away_team_id = at.id
      ORDER BY m.match_date, g.name, m.id`
    )
    .all();
  res.json(matches);
});

// --- Group Predictions ---

// --- Announcement ---

app.get("/api/announcement", (req, res) => {
  const tournament = req.query.tournament;
  const key = tournament ? `announcement_${tournament}` : "announcement";
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  let announcements = [];
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      announcements = Array.isArray(parsed) ? parsed : [{ text: row.value, createdAt: 0 }];
    } catch {
      // Legacy plain-text — treat each line as a separate item with no timestamp
      announcements = row.value.split("\n").filter(Boolean).map((text) => ({ text, createdAt: 0 }));
    }
  }
  const updatedAt = announcements.length > 0 ? Math.max(...announcements.map((a) => a.createdAt)) : null;
  res.json({ announcements, updatedAt });
});

app.put("/api/announcement", requireAdminToken, (req, res) => {
  const { announcements, tournament } = req.body;
  const key = tournament ? `announcement_${tournament}` : "announcement";
  const items = Array.isArray(announcements) ? announcements.filter((a) => a.text?.trim()) : [];
  if (items.length > 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(items));
  } else {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }
  res.json({ success: true });
});

// --- Group Predictions ---

app.get("/api/group-predictions/:participantId", (req, res) => {
  const predictions = db
    .prepare(`
      SELECT gp.*, t1.name as team1_name, t1.code as team1_code,
        t2.name as team2_name, t2.code as team2_code,
        t3.name as team3_name, t3.code as team3_code
      FROM group_predictions gp
      JOIN teams t1 ON gp.team1_id = t1.id
      JOIN teams t2 ON gp.team2_id = t2.id
      LEFT JOIN teams t3 ON gp.team3_id = t3.id
      WHERE gp.participant_id = ?
    `)
    .all(req.params.participantId);
  res.json(predictions);
});

app.get("/api/prediction-deadline", (req, res) => {
  const firstMatch = db.prepare("SELECT match_date FROM matches ORDER BY match_date ASC LIMIT 1").get();
  if (!firstMatch) return res.json({ deadline: null, groupDeadlines: {} });
  // Per-group deadlines: first match of each group
  const groupFirstMatches = db.prepare("SELECT group_id, MIN(match_date) as first_match FROM matches GROUP BY group_id").all();
  const groupDeadlines = {};
  for (const gm of groupFirstMatches) {
    groupDeadlines[gm.group_id] = gm.first_match;
  }
  res.json({ deadline: firstMatch.match_date, groupDeadlines });
});

app.post("/api/group-predictions", (req, res) => {
  const { participant_id, predictions } = req.body;

  if (!participant_id || !Array.isArray(predictions) || predictions.length === 0) {
    return res.status(400).json({ error: "participant_id and predictions array required" });
  }

  const participant = db.prepare("SELECT pool_id FROM participants WHERE id = ?").get(participant_id);
  const pool = participant ? db.prepare("SELECT group_stage_unlocked FROM pools WHERE id = ?").get(participant.pool_id) : null;
  const groupStageUnlocked = !!(pool && pool.group_stage_unlocked);

  // Check per-group deadlines — filter out locked groups
  const now = new Date();
  const groupFirstMatches = db.prepare("SELECT group_id, MIN(match_date) as first_match FROM matches GROUP BY group_id").all();
  const groupDeadlineMap = {};
  for (const gm of groupFirstMatches) groupDeadlineMap[gm.group_id] = gm.first_match;

  const lockedGroupNames = [];
  const saveable = predictions.filter((pred) => {
    if (groupStageUnlocked) {
      // When unlocked: only lock the group if ALL its matches are finished
      const allFinished = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) as done FROM matches WHERE group_id = ?").get(pred.group_id);
      if (allFinished && allFinished.total > 0 && allFinished.total === allFinished.done) {
        const group = db.prepare("SELECT name FROM groups WHERE id = ?").get(pred.group_id);
        lockedGroupNames.push(group ? `Group ${group.name}` : `Group ${pred.group_id}`);
        return false;
      }
      return true;
    }
    const dl = groupDeadlineMap[pred.group_id];
    if (dl && now >= new Date(dl.replace(" ", "T") + "Z")) {
      const group = db.prepare("SELECT name FROM groups WHERE id = ?").get(pred.group_id);
      lockedGroupNames.push(group ? `Group ${group.name}` : `Group ${pred.group_id}`);
      return false;
    }
    return true;
  });

  if (saveable.length === 0 && lockedGroupNames.length > 0) {
    return res.status(403).json({ error: `Predictions locked for ${lockedGroupNames.join(", ")} — matches have started` });
  }

  // Count how many groups have a 3rd pick — max 8 allowed
  const thirdPickCount = saveable.filter((p) => p.team3_id).length;
  if (thirdPickCount > 8) {
    return res.status(400).json({ error: "You can only pick a 3rd-place team in up to 8 groups" });
  }

  // Validate each prediction
  for (const pred of saveable) {
    const { group_id, team1_id, team2_id, team3_id } = pred;
    if (!group_id || !team1_id || !team2_id) {
      return res.status(400).json({ error: "Each prediction needs group_id, team1_id, and team2_id" });
    }
    const allPicked = [team1_id, team2_id, team3_id].filter(Boolean);
    if (new Set(allPicked).size !== allPicked.length) {
      return res.status(400).json({ error: "Must pick different teams within a group" });
    }
    // Check teams belong to this group
    const teams = db.prepare(
      `SELECT id FROM teams WHERE group_id = ? AND id IN (${allPicked.map(() => "?").join(",")})`
    ).all(group_id, ...allPicked);
    if (teams.length !== allPicked.length) {
      return res.status(400).json({ error: "Teams must belong to their group" });
    }
  }

  try {
    const upsert = db.prepare(`
      INSERT INTO group_predictions (participant_id, group_id, team1_id, team2_id, team3_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(participant_id, group_id) DO UPDATE SET
        team1_id = excluded.team1_id, team2_id = excluded.team2_id, team3_id = excluded.team3_id
    `);
    const txn = db.transaction(() => {
      for (const pred of saveable) {
        upsert.run(participant_id, pred.group_id, pred.team1_id, pred.team2_id, pred.team3_id || null);
      }
    });
    txn();
    const result = { success: true };
    if (lockedGroupNames.length > 0) {
      result.warning = `${lockedGroupNames.join(", ")} skipped — matches already started`;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Third-Place Qualifier Predictions ---

app.get("/api/third-place-predictions/:participantId", (req, res) => {
  const preds = db.prepare(`
    SELECT tp.*, t.name as team_name, t.code as team_code, t.group_id
    FROM third_place_predictions tp
    JOIN teams t ON tp.team_id = t.id
    WHERE tp.participant_id = ?
  `).all(req.params.participantId);
  res.json(preds);
});

app.post("/api/third-place-predictions", (req, res) => {
  const { participant_id, team_ids } = req.body;
  if (!participant_id || !Array.isArray(team_ids)) {
    return res.status(400).json({ error: "participant_id and team_ids array required" });
  }
  if (team_ids.length !== 8) {
    return res.status(400).json({ error: "Must pick exactly 8 third-place qualifiers" });
  }

  // Check deadline - lock predictions before first match
  const firstMatch = db.prepare("SELECT match_date FROM matches ORDER BY match_date ASC LIMIT 1").get();
  if (firstMatch) {
    const deadline = new Date(firstMatch.match_date.replace(" ", "T") + "Z");
    if (new Date() >= deadline) {
      return res.status(403).json({ error: "Predictions are locked - the tournament has started" });
    }
  }

  // Validate all team_ids are real teams
  const validTeams = db.prepare(
    `SELECT id FROM teams WHERE id IN (${team_ids.map(() => "?").join(",")})`
  ).all(...team_ids);
  if (validTeams.length !== 8) {
    return res.status(400).json({ error: "Some team IDs are invalid" });
  }

  // Validate no duplicates
  if (new Set(team_ids).size !== 8) {
    return res.status(400).json({ error: "Duplicate teams not allowed" });
  }

  // Validate none of the picked teams are in this participant's group top-2 predictions
  const groupPreds = db.prepare(
    "SELECT team1_id, team2_id FROM group_predictions WHERE participant_id = ?"
  ).all(participant_id);
  const top2Set = new Set();
  for (const gp of groupPreds) {
    top2Set.add(gp.team1_id);
    top2Set.add(gp.team2_id);
  }
  const conflict = team_ids.find((tid) => top2Set.has(tid));
  if (conflict) {
    const conflictTeam = db.prepare("SELECT name FROM teams WHERE id = ?").get(conflict);
    return res.status(400).json({ error: `${conflictTeam?.name || "Team"} is already in your top-2 group picks` });
  }

  try {
    const txn = db.transaction(() => {
      db.prepare("DELETE FROM third_place_predictions WHERE participant_id = ?").run(participant_id);
      const insert = db.prepare("INSERT INTO third_place_predictions (participant_id, team_id) VALUES (?, ?)");
      for (const tid of team_ids) {
        insert.run(participant_id, tid);
      }
    });
    txn();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Knockout Matches & Predictions ---

app.get("/api/knockout-matches", (req, res) => {
  const matches = db.prepare(`
    SELECT km.*,
      ht.name as home_team_name, ht.code as home_team_code,
      at.name as away_team_name, at.code as away_team_code
    FROM knockout_matches km
    LEFT JOIN teams ht ON km.home_team_id = ht.id
    LEFT JOIN teams at ON km.away_team_id = at.id
    ORDER BY km.id
  `).all();
  res.json(matches);
});

app.get("/api/knockout-predictions/:participantId", (req, res) => {
  const predictions = db
    .prepare("SELECT * FROM knockout_predictions WHERE participant_id = ?")
    .all(req.params.participantId);
  res.json(predictions);
});

// Every pool member's prediction for a single knockout match — powers the
// per-match "everyone's predictions" table in the Knockout Stage view. The same
// picks are already visible per-player from the leaderboard, so this is just a
// read-only, pool-scoped re-slice of that data. Members with no pick are included
// with null fields so the table shows who still hasn't predicted.
app.get("/api/pools/:poolId/knockout-predictions/:matchId", (req, res) => {
  const { poolId, matchId } = req.params;
  const rows = db.prepare(`
    SELECT p.id as participant_id, p.name,
           kp.predicted_winner, kp.predicted_home_score, kp.predicted_away_score
    FROM participants p
    LEFT JOIN knockout_predictions kp
      ON kp.participant_id = p.id AND kp.match_id = ?
    WHERE p.pool_id = ?
    ORDER BY p.name COLLATE NOCASE
  `).all(matchId, poolId);
  res.json(rows);
});

app.post("/api/knockout-predictions", (req, res) => {
  const { participant_id, match_id, predicted_winner, predicted_home_score, predicted_away_score } = req.body;
  if (!participant_id || !match_id || !predicted_winner) {
    return res.status(400).json({ error: "All fields are required" });
  }
  const m = db.prepare("SELECT home_team_id, away_team_id, status, match_date FROM knockout_matches WHERE id = ?").get(match_id);
  if (!m) return res.status(404).json({ error: "Match not found" });
  // Lock the pick once the match has kicked off. The UI already disables the inputs at
  // kickoff, but the lock must be enforced here too — otherwise a stale bracket tab or a
  // direct API call can overwrite a pick mid-match. We check both the status (flipped to
  // 'live'/'finished' by the scores sync) AND the scheduled kickoff time, because the sync
  // only flips status on its next poll, leaving a window after real kickoff where the match
  // is still 'upcoming'. match_date is stored as "YYYY-MM-DD HH:MM" in UTC.
  const kickoff = m.match_date ? new Date(m.match_date.replace(" ", "T") + "Z") : null;
  if (m.status !== "upcoming" || (kickoff && new Date() >= kickoff)) {
    return res.status(403).json({ error: "Predictions are locked — this match has started" });
  }
  // Reject a scoreline that contradicts the picked winner. A regulation draw is allowed
  // (the winner is then decided on penalties); only a score where the picked winner has
  // strictly fewer goals than the loser is inconsistent. predicted_winner is "home"/"away"
  // (or a team id for older rows). Mirrors the frontend "winner can't score fewer goals"
  // guard — enforced here too so the API itself can't store a contradictory pick.
  if (predicted_home_score != null && predicted_away_score != null) {
    const winnerSide = predicted_winner === "home" ? "home"
      : predicted_winner === "away" ? "away"
      : m && String(predicted_winner) === String(m.home_team_id) ? "home"
      : m && String(predicted_winner) === String(m.away_team_id) ? "away"
      : null;
    if ((winnerSide === "home" && predicted_home_score < predicted_away_score) ||
        (winnerSide === "away" && predicted_away_score < predicted_home_score)) {
      return res.status(400).json({ error: "Predicted score contradicts the picked winner" });
    }
  }
  try {
    db.prepare(`
      INSERT INTO knockout_predictions (participant_id, match_id, predicted_winner, predicted_home_score, predicted_away_score)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(participant_id, match_id) DO UPDATE SET
        predicted_winner = excluded.predicted_winner,
        predicted_home_score = excluded.predicted_home_score,
        predicted_away_score = excluded.predicted_away_score
    `).run(participant_id, match_id, predicted_winner, predicted_home_score ?? null, predicted_away_score ?? null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Standings (calculate from match results) ---

app.get("/api/standings", (req, res) => {
  const matches = db.prepare("SELECT * FROM matches WHERE status IN ('finished', 'live')").all();
  const teams = db.prepare("SELECT * FROM teams").all();

  // Build standings per team
  const stats = {};
  for (const t of teams) {
    stats[t.id] = { team_id: t.id, name: t.name, code: t.code, group_id: t.group_id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 };
  }

  for (const m of matches) {
    const h = stats[m.home_team_id];
    const a = stats[m.away_team_id];
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) {
      h.won++; h.points += 3; a.lost++;
    } else if (m.away_score > m.home_score) {
      a.won++; a.points += 3; h.lost++;
    } else {
      h.drawn++; h.points += 1; a.drawn++; a.points += 1;
    }
  }

  // Group by group_id and sort
  const groups = db.prepare("SELECT * FROM groups ORDER BY name").all();
  const result = groups.map((g) => {
    const groupTeams = Object.values(stats)
      .filter((t) => t.group_id === g.id)
      .sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    // 4 teams, 6 matches per group, each team plays 3
    const allFinished = groupTeams.every((t) => t.played >= 3);
    return {
      ...g,
      teams: groupTeams,
      qualified: allFinished ? [groupTeams[0]?.team_id, groupTeams[1]?.team_id] : [],
    };
  });

  // Determine third-place qualifiers (best 8 third-place teams across all groups)
  const allGroupsFinished = result.every((g) => g.qualified.length > 0);
  let thirdQualifiers = [];
  if (allGroupsFinished) {
    const thirdPlaceTeams = result
      .map((g) => g.teams.length >= 3 ? g.teams[2] : null)
      .filter(Boolean)
      .sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    thirdQualifiers = thirdPlaceTeams.slice(0, 8).map((t) => t.team_id);
  }

  res.json({ groups: result, thirdQualifiers });
});

// --- Leaderboard ---

app.get("/api/leaderboard", (req, res) => {
  const poolId = req.query.pool_id;

  // Get all finished matches to calculate standings
  const matches = db.prepare("SELECT * FROM matches WHERE status = 'finished'").all();
  const teams = db.prepare("SELECT * FROM teams").all();
  const groups = db.prepare("SELECT * FROM groups").all();

  // Calculate standings
  const stats = {};
  for (const t of teams) {
    stats[t.id] = { team_id: t.id, group_id: t.group_id, played: 0, gf: 0, ga: 0, points: 0 };
  }
  for (const m of matches) {
    const h = stats[m.home_team_id];
    const a = stats[m.away_team_id];
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) { h.points += 3; }
    else if (m.away_score > m.home_score) { a.points += 3; }
    else { h.points += 1; a.points += 1; }
  }

  // Determine qualified teams per group (top 2)
  const qualified = {};
  for (const g of groups) {
    const groupTeams = Object.values(stats)
      .filter((t) => t.group_id === g.id)
      .sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    const allFinished = groupTeams.every((t) => t.played >= 3);
    qualified[g.id] = allFinished ? [groupTeams[0]?.team_id, groupTeams[1]?.team_id] : null;
  }

  // Get participants (exclude admins)
  let participants;
  if (poolId) {
    participants = db.prepare("SELECT p.* FROM participants p LEFT JOIN users u ON p.user_id = u.id WHERE p.pool_id = ? AND (u.is_admin = 0 OR u.is_admin IS NULL OR p.user_id IS NULL)").all(poolId);
  } else {
    participants = db.prepare("SELECT p.* FROM participants p LEFT JOIN users u ON p.user_id = u.id WHERE (u.is_admin = 0 OR u.is_admin IS NULL OR p.user_id IS NULL)").all();
  }

  // Get all group predictions
  const allPredictions = db.prepare("SELECT * FROM group_predictions").all();

  // Determine third-place qualifiers (best 8 third-place teams across all groups)
  const allGroupsDone = groups.every((g) => {
    const gt = Object.values(stats).filter((t) => t.group_id === g.id);
    return gt.every((t) => t.played >= 3);
  });
  const thirdPlaceQualifiers = new Set();
  if (allGroupsDone) {
    const thirdPlaceTeams = [];
    for (const g of groups) {
      const gt = Object.values(stats)
        .filter((t) => t.group_id === g.id)
        .sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
      if (gt.length >= 3) thirdPlaceTeams.push(gt[2]);
    }
    // Rank third-place teams by points, GD, GF
    thirdPlaceTeams.sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    for (let i = 0; i < Math.min(8, thirdPlaceTeams.length); i++) {
      thirdPlaceQualifiers.add(thirdPlaceTeams[i].team_id);
    }
  }

  // Get knockout data for scoring
  const koMatches = db.prepare("SELECT * FROM knockout_matches WHERE status = 'finished'").all();
  const allKoPredictions = db.prepare("SELECT * FROM knockout_predictions").all();
  const allChampionPicks = db.prepare("SELECT * FROM champion_picks").all();
  const allPlayerAwardPicks = db.prepare("SELECT * FROM player_award_picks").all();
  const awardResults = db.prepare("SELECT * FROM player_award_results").all();
  const awardsVoidedPools = new Set(db.prepare("SELECT id FROM pools WHERE player_awards_voided = 1").all().map((r) => r.id));

  const koPointsMap = { R32: 3, R16: 5, QF: 7, SF: 10, F: 15 };
  const finalMatch = koMatches.find((m) => m.id === "F" && m.winner_team_id);
  const poolRow = poolId ? db.prepare("SELECT exact_scores_disabled FROM pools WHERE id = ?").get(poolId) : null;
  const exactScoresDisabled = !!(poolRow && poolRow.exact_scores_disabled);

  // Build per-group qualifying set (top 2 + 3rd if globally qualified)
  const qualifyingByGroup = {};
  for (const g of groups) {
    if (!qualified[g.id]) continue;
    qualifyingByGroup[g.id] = [...qualified[g.id]];
    if (allGroupsDone) {
      const gt = Object.values(stats)
        .filter((t) => t.group_id === g.id)
        .sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
      if (gt.length >= 3 && thirdPlaceQualifiers.has(gt[2].team_id)) {
        qualifyingByGroup[g.id].push(gt[2].team_id);
      }
    }
  }

  const leaderboard = participants.map((p) => {
    const myPreds = allPredictions.filter((gp) => gp.participant_id === p.id);
    let points = 0;
    let groups_correct = 0;
    let groups_half = 0;
    let groups_predicted = myPreds.length;
    let ko_correct = 0;
    let ko_points = 0;

    for (const pred of myPreds) {
      // Score against the qualifying set for that group. Pre-allGroupsDone, qualSet
      // is just top-2 (qualified-3rd isn't determined yet). Post-allGroupsDone, qualSet
      // also includes the qualified-3rd team if one exists.
      // Picks = [team1, team2, team3-if-set]; order doesn't matter — set membership only.
      // Tier: 3 right → 10pts, 2 right → 5pts, 1 right → 2pts. "Correct" = max for the
      // user's pick count (3/3 for 3-pick users, 2/2 for 2-pick users).
      const qualSet = qualifyingByGroup[pred.group_id];
      if (!qualSet) continue;
      const picked = pred.team3_id
        ? [pred.team1_id, pred.team2_id, pred.team3_id]
        : [pred.team1_id, pred.team2_id];
      const correctCount = picked.filter((t) => qualSet.includes(t)).length;
      if (correctCount === picked.length) {
        points += (picked.length === 3) ? 10 : 5;
        groups_correct++;
      } else if (correctCount === 2) {
        points += 5;
        groups_half++;
      } else if (correctCount === 1) {
        points += 2;
        groups_half++;
      }
    }

    // Knockout prediction scoring — predicted_winner stored as "home"/"away"
    const myKoPreds = allKoPredictions.filter((kp) => kp.participant_id === p.id);
    for (const kp of myKoPreds) {
      const match = koMatches.find((m) => m.id === kp.match_id);
      if (!match || !match.winner_team_id) continue;
      const predictedTeamId = kp.predicted_winner === "home" ? match.home_team_id :
                              kp.predicted_winner === "away" ? match.away_team_id :
                              Number(kp.predicted_winner);
      const basePts = koPointsMap[match.round] || 0;
      const winnerCorrect = String(predictedTeamId) === String(match.winner_team_id);
      const scoreCorrect = !exactScoresDisabled &&
          kp.predicted_home_score !== null && kp.predicted_away_score !== null &&
          match.home_score !== null && match.away_score !== null &&
          kp.predicted_home_score === match.home_score && kp.predicted_away_score === match.away_score;
      // Winner pick and exact-score bonus are scored independently, each worth the round's
      // base points. Correct winner + exact score earns 2× base (as before), but an exact
      // regulation score now also scores base pts when the winner is wrong — e.g. a 1-1 that
      // went to penalties: the scoreline was nailed even though the shootout wasn't.
      if (winnerCorrect) { ko_points += basePts; ko_correct++; }
      if (scoreCorrect) { ko_points += basePts; }
    }
    points += ko_points;

    // Champion pick bonus
    const champPick = allChampionPicks.find((cp) => cp.participant_id === p.id);
    let champion_bonus = 0;
    if (champPick?.team_id && finalMatch && String(champPick.team_id) === String(finalMatch.winner_team_id)) {
      champion_bonus = 20;
    }
    const champion_change_cost = champPick?.change_cost || 0;
    points += champion_bonus - champion_change_cost;

    // Player award picks bonus
    const awardPointsMap = { golden_ball: 5, golden_boot: 5, golden_glove: 5, young_player: 2, fair_play: 2 };
    const myAwardPicks = allPlayerAwardPicks.filter((ap) => ap.participant_id === p.id);
    let player_awards_points = 0;
    // When the pool admin has voided player awards, the section scores 0 for everyone (picks are kept, not wiped).
    if (!awardsVoidedPools.has(p.pool_id)) {
      for (const ap of myAwardPicks) {
        const result = awardResults.find((r) => r.award_category === ap.award_category);
        if (!result) continue;
        if (ap.award_category === "fair_play") {
          if (ap.team_id && String(ap.team_id) === String(result.team_id)) player_awards_points += awardPointsMap.fair_play;
        } else {
          if (ap.player_id && String(ap.player_id) === String(result.player_id)) player_awards_points += awardPointsMap[ap.award_category];
        }
      }
    }
    points += player_awards_points;

    return { id: p.id, name: p.name, points, groups_predicted, groups_correct, groups_half, ko_correct, ko_points, champion_bonus, champion_change_cost, player_awards_points };
  });

  leaderboard.sort((a, b) => b.points - a.points || b.groups_correct - a.groups_correct || a.name.localeCompare(b.name));
  res.json(leaderboard);
});

// --- Knockout Deadline ---

// Which two feeder matches must have winners before a match opens
const KO_PREREQUISITES = {
  "R16-1": ["R32-2", "R32-5"],  "R16-2": ["R32-1",  "R32-3"],
  "R16-3": ["R32-4", "R32-6"],  "R16-4": ["R32-7",  "R32-8"],
  "R16-5": ["R32-11","R32-12"], "R16-6": ["R32-9",  "R32-10"],
  "R16-7": ["R32-14","R32-16"], "R16-8": ["R32-13", "R32-15"],
  "QF-1":  ["R16-1", "R16-2"],  "QF-2":  ["R16-5",  "R16-6"],
  "QF-3":  ["R16-3", "R16-4"],  "QF-4":  ["R16-7",  "R16-8"],
  "SF-1":  ["QF-1",  "QF-2"],   "SF-2":  ["QF-3",   "QF-4"],
  "F":     ["SF-1",  "SF-2"],
};

const TWELVE_HOURS_MS = 0; // lock at kickoff

app.get("/api/knockout-deadline", (req, res) => {
  const totalMatches = db.prepare("SELECT COUNT(*) as c FROM matches").get().c;
  const finishedMatches = db.prepare("SELECT COUNT(*) as c FROM matches WHERE status = 'finished'").get().c;
  const groupStageComplete = totalMatches > 0 && finishedMatches === totalMatches;

  const lastGroupRow = db.prepare("SELECT MAX(match_date) as d FROM matches").get();
  const lastGroupMatchDate = lastGroupRow.d;

  const koMatches = db.prepare("SELECT * FROM knockout_matches").all();
  const koById = Object.fromEntries(koMatches.map((m) => [m.id, m]));
  const now = Date.now();

  const toUtcStr = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 16);

  const getClosesAt = (matchDate) => matchDate || null;

  const getOpensAfter = (matchId) => {
    const prereqs = KO_PREREQUISITES[matchId];
    if (!prereqs) return lastGroupMatchDate; // R32 opens after last group match
    const dates = prereqs.map((pid) => koById[pid]?.match_date).filter(Boolean);
    if (!dates.length) return null;
    const latest = dates.reduce((a, b) => (a > b ? a : b));
    const ms = new Date(latest.replace(" ", "T") + "Z").getTime() + 3 * 3600000;
    return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
  };

  // Open as soon as both teams are confirmed (via group-stage resolver, KO winner cascade,
  // football-data.org sync, or admin override). Don't gate on whether other unrelated groups
  // have finished — e.g. R32 Canada-v-South-Africa shouldn't wait for Groups F/G/H/etc.
  const isMatchOpen = (matchId) => {
    const match = koById[matchId];
    if (!match) return false;
    if (match.status === "live" || match.status === "finished") return false;
    if (match.match_date) {
      const kickoff = new Date(match.match_date.replace(" ", "T") + "Z").getTime();
      if (now >= kickoff - TWELVE_HOURS_MS) return false;
    }
    return match.home_team_id != null && match.away_team_id != null;
  };

  const openMatchIds = koMatches.filter((m) => isMatchOpen(m.id)).map((m) => m.id);

  const matchMeta = {};
  for (const m of koMatches) {
    matchMeta[m.id] = {
      opensAfter: getOpensAfter(m.id),
      closesAt: getClosesAt(m.match_date),
    };
  }

  const koStageComplete = koMatches.length > 0 && koMatches.every((m) => m.status === "finished");
  res.json({ openMatchIds, groupStageComplete, koStageComplete, matchMeta });
});

app.get("/api/champion-pick/:participantId", (req, res) => {
  const { participantId } = req.params;
  const { pool_id } = req.query;
  const totalGroups = db.prepare("SELECT COUNT(*) as c FROM matches").get().c;
  const finishedGroups = db.prepare("SELECT COUNT(*) as c FROM matches WHERE status='finished'").get().c;
  const groupStageComplete = totalGroups > 0 && finishedGroups === totalGroups;
  const groupStarted = finishedGroups > 0;
  const koStarted = db.prepare("SELECT COUNT(*) as c FROM knockout_matches WHERE status != 'upcoming'").get().c > 0;
  const inPreGroupWindow  = !groupStarted;
  const inPostGroupWindow = groupStageComplete && !koStarted;
  // Check pool-level admin overrides
  const pool = pool_id ? db.prepare("SELECT champion_w2_locked, champion_unlocked FROM pools WHERE id = ?").get(pool_id) : null;
  const w2AdminLocked = !!(pool && pool.champion_w2_locked && inPostGroupWindow);
  const championUnlocked = !!(pool && pool.champion_unlocked);
  const lockedDuringGroups = groupStarted && !groupStageComplete;
  const adminUnlockedDuringGroups = lockedDuringGroups && championUnlocked;
  const windowOpen = inPreGroupWindow || (inPostGroupWindow && !w2AdminLocked) || adminUnlockedDuringGroups;
  const pick = db.prepare(`
    SELECT cp.*, t.name as team_name, t.code as team_code
    FROM champion_picks cp
    LEFT JOIN teams t ON cp.team_id = t.id
    WHERE cp.participant_id = ?
  `).get(participantId);
  const canInitialPick = windowOpen && !pick;
  const canChange = windowOpen && !!pick;
  const feePaid = pick && pick.change_cost > 0;
  const changeCost = (inPostGroupWindow && !w2AdminLocked && !feePaid) ? 5 : 0;
  const finalMatch = db.prepare("SELECT winner_team_id FROM knockout_matches WHERE id = 'F'").get();
  const pickCorrect = !!(pick && finalMatch?.winner_team_id && String(pick.team_id) === String(finalMatch.winner_team_id));
  res.json({ canInitialPick, canChange, locked: lockedDuringGroups && !adminUnlockedDuringGroups, adminUnlocked: adminUnlockedDuringGroups, w2AdminLocked, changeCost, pick: pick || null, pickCorrect });
});

app.post("/api/champion-pick", (req, res) => {
  const { participant_id, team_id } = req.body;
  if (!participant_id || !team_id) return res.status(400).json({ error: "participant_id and team_id required" });
  const finishedGroups = db.prepare("SELECT COUNT(*) as c FROM matches WHERE status='finished'").get().c;
  const totalGroups = db.prepare("SELECT COUNT(*) as c FROM matches").get().c;
  const groupStageComplete = totalGroups > 0 && finishedGroups === totalGroups;
  const groupStarted = finishedGroups > 0;
  const koStarted = db.prepare("SELECT COUNT(*) as c FROM knockout_matches WHERE status != 'upcoming'").get().c > 0;
  const inPreGroupWindow  = !groupStarted;
  const inPostGroupWindow = groupStageComplete && !koStarted;
  const lockedDuringGroups = groupStarted && !groupStageComplete;
  // Check pool-level admin overrides
  const participant = db.prepare("SELECT pool_id FROM participants WHERE id = ?").get(participant_id);
  const pool = participant ? db.prepare("SELECT champion_w2_locked, champion_unlocked FROM pools WHERE id = ?").get(participant.pool_id) : null;
  if (inPostGroupWindow && pool && pool.champion_w2_locked) {
    return res.status(403).json({ error: "Champion pick window 2 has been locked by your pool admin" });
  }
  const adminUnlocked = !!(lockedDuringGroups && pool && pool.champion_unlocked);
  if (!inPreGroupWindow && !inPostGroupWindow && !adminUnlocked) return res.status(403).json({ error: "Champion pick window is closed" });
  const existing = db.prepare("SELECT * FROM champion_picks WHERE participant_id = ?").get(participant_id);
  // Charge 5pt fee on the first pick/change made in the post-group window, even if no prior pick
  const isFirstPostGroupChange = inPostGroupWindow && (existing?.change_cost || 0) === 0;
  const newChangeCost = isFirstPostGroupChange ? 5 : (existing?.change_cost || 0);
  const isChanged = existing ? 1 : 0;
  db.prepare(`
    INSERT INTO champion_picks (participant_id, team_id, is_changed, change_cost)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(participant_id) DO UPDATE SET team_id=excluded.team_id, is_changed=excluded.is_changed, change_cost=excluded.change_cost, updated_at=datetime('now')
  `).run(participant_id, team_id, isChanged, newChangeCost);
  res.json({ success: true });
});

// ── Player Award Picks ───────────────────────────────────────────────────────

app.get("/api/wc-players", (req, res) => {
  const players = db.prepare(`
    SELECT wp.id, wp.name, wp.position, wp.team_id, wp.dob, t.name as team_name, t.code as team_code
    FROM wc_players wp
    JOIN teams t ON wp.team_id = t.id
    ORDER BY t.name, wp.position, wp.name
  `).all();
  res.json(players);
});

app.get("/api/player-award-picks/:participantId", (req, res) => {
  const { participantId } = req.params;
  const { pool_id } = req.query;

  const pool = pool_id ? db.prepare("SELECT player_awards_locked, player_awards_voided FROM pools WHERE id = ?").get(pool_id) : null;
  const voided = !!(pool && pool.player_awards_voided);
  const locked = !!(pool && pool.player_awards_locked) || voided;

  const picks = db.prepare(`
    SELECT pap.award_category, pap.player_id, pap.team_id,
           wp.name as player_name, wp.position as player_position,
           t.name as team_name, t.code as team_code
    FROM player_award_picks pap
    LEFT JOIN wc_players wp ON pap.player_id = wp.id
    LEFT JOIN teams t ON pap.team_id = t.id
    WHERE pap.participant_id = ?
  `).all(participantId);

  const results = db.prepare(`
    SELECT par.award_category, par.player_id, par.team_id,
           wp.name as player_name,
           t.name as team_name, t.code as team_code
    FROM player_award_results par
    LEFT JOIN wc_players wp ON par.player_id = wp.id
    LEFT JOIN teams t ON par.team_id = t.id
  `).all();

  res.json({ picks, results, locked, voided });
});

app.post("/api/player-award-picks", (req, res) => {
  const { participant_id, award_category, player_id, team_id } = req.body;
  if (!participant_id || !award_category) return res.status(400).json({ error: "participant_id and award_category required" });

  const validCategories = ["golden_ball", "golden_boot", "golden_glove", "young_player", "fair_play"];
  if (!validCategories.includes(award_category)) return res.status(400).json({ error: "Invalid award category" });

  // Check lock
  const participant = db.prepare("SELECT pool_id FROM participants WHERE id = ?").get(participant_id);
  if (participant) {
    const pool = db.prepare("SELECT player_awards_locked, player_awards_voided FROM pools WHERE id = ?").get(participant.pool_id);
    if (pool && (pool.player_awards_locked || pool.player_awards_voided)) return res.status(403).json({ error: "Player awards have been locked by your pool admin" });
  }

  if (award_category === "fair_play") {
    if (!team_id) return res.status(400).json({ error: "team_id required for Fair Play Trophy" });
    db.prepare(`
      INSERT INTO player_award_picks (participant_id, award_category, team_id, player_id)
      VALUES (?, ?, ?, NULL)
      ON CONFLICT(participant_id, award_category) DO UPDATE SET team_id=excluded.team_id, player_id=NULL, updated_at=datetime('now')
    `).run(participant_id, award_category, team_id);
  } else {
    if (!player_id) return res.status(400).json({ error: "player_id required" });
    const player = db.prepare("SELECT team_id FROM wc_players WHERE id = ?").get(player_id);
    db.prepare(`
      INSERT INTO player_award_picks (participant_id, award_category, player_id, team_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(participant_id, award_category) DO UPDATE SET player_id=excluded.player_id, team_id=excluded.team_id, updated_at=datetime('now')
    `).run(participant_id, award_category, player_id, player?.team_id || null);
  }

  res.json({ success: true });
});

// Admin: set actual award results
app.put("/api/admin/player-award-results", requireAdminToken, (req, res) => {
  const { award_category, player_id, team_id } = req.body;
  const validCategories = ["golden_ball", "golden_boot", "golden_glove", "young_player", "fair_play"];
  if (!award_category || !validCategories.includes(award_category)) return res.status(400).json({ error: "Invalid award category" });

  db.prepare(`
    INSERT INTO player_award_results (award_category, player_id, team_id)
    VALUES (?, ?, ?)
    ON CONFLICT(award_category) DO UPDATE SET player_id=excluded.player_id, team_id=excluded.team_id, set_at=datetime('now')
  `).run(award_category, player_id || null, team_id || null);
  res.json({ success: true });
});

app.get("/api/admin/player-award-results", requireAdminToken, (req, res) => {
  const results = db.prepare(`
    SELECT par.*, wp.name as player_name, t.name as team_name
    FROM player_award_results par
    LEFT JOIN wc_players wp ON par.player_id = wp.id
    LEFT JOIN teams t ON par.team_id = t.id
  `).all();
  res.json(results);
});

// ── Point History ─────────────────────────────────────────────────────────────

app.get("/api/history/:participantId", (req, res) => {
  const { participantId } = req.params;
  const { pool_id } = req.query;
  const events = [];
  const poolRowH = pool_id ? db.prepare("SELECT exact_scores_disabled, player_awards_voided FROM pools WHERE id = ?").get(pool_id) : null;
  const exactScoresDisabledH = !!(poolRowH && poolRowH.exact_scores_disabled);
  const awardsVoidedH = !!(poolRowH && poolRowH.player_awards_voided);

  const groups = db.prepare("SELECT * FROM groups").all();
  const teams = db.prepare("SELECT * FROM teams").all();
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const finishedMatches = db.prepare("SELECT * FROM matches WHERE status='finished'").all();

  const stats = {};
  for (const t of teams) stats[t.id] = { team_id: t.id, group_id: t.group_id, played: 0, gf: 0, ga: 0, points: 0 };
  for (const m of finishedMatches) {
    const h = stats[m.home_team_id], a = stats[m.away_team_id];
    if (!h || !a) continue;
    h.played++; a.played++; h.gf += m.home_score; h.ga += m.away_score; a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) h.points += 3; else if (m.away_score > m.home_score) a.points += 3; else { h.points++; a.points++; }
  }

  const groupLastDate = {};
  for (const m of finishedMatches) {
    const gid = m.group_id;
    if (!groupLastDate[gid] || m.match_date > groupLastDate[gid]) groupLastDate[gid] = m.match_date;
  }

  // Determine third-place qualifiers for combined scoring
  const allGroupsDoneH = groups.every((g) => {
    const gt = Object.values(stats).filter((t) => t.group_id === g.id);
    return gt.every((t) => t.played >= 3);
  });
  const thirdQualifiersH = new Set();
  if (allGroupsDoneH) {
    const thirdPlaceTeamsH = [];
    for (const g of groups) {
      const gt = Object.values(stats).filter((t) => t.group_id === g.id)
        .sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
      if (gt.length >= 3) thirdPlaceTeamsH.push(gt[2]);
    }
    thirdPlaceTeamsH.sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    for (let i = 0; i < Math.min(8, thirdPlaceTeamsH.length); i++) {
      thirdQualifiersH.add(thirdPlaceTeamsH[i].team_id);
    }
  }

  for (const g of groups) {
    const gt = Object.values(stats).filter((t) => t.group_id === g.id).sort((a, b) => b.points - a.points || (b.gf-b.ga)-(a.gf-a.ga) || b.gf-a.gf);
    if (!gt.every((t) => t.played >= 3)) continue;
    const lastDate = groupLastDate[g.id];
    if (!lastDate) continue;
    const pred = db.prepare("SELECT * FROM group_predictions WHERE participant_id = ? AND group_id = ?").get(participantId, g.id);
    if (!pred) continue;

    // Unified scoring: count how many picks are in the qualifying set for this group.
    // qualSet = top-2 always; +qualified-3rd once all groups are done.
    // Mirrors /api/leaderboard (see backend/index.js ~line 1200).
    const qualSet = [gt[0]?.team_id, gt[1]?.team_id];
    if (allGroupsDoneH && gt.length >= 3 && thirdQualifiersH.has(gt[2].team_id)) {
      qualSet.push(gt[2].team_id);
    }
    const picked = pred.team3_id
      ? [pred.team1_id, pred.team2_id, pred.team3_id]
      : [pred.team1_id, pred.team2_id];
    const correct = picked.filter((t) => qualSet.includes(t)).length;
    let pts, label;
    if (correct === picked.length) {
      pts = picked.length === 3 ? 10 : 5;
      label = picked.length === 3 ? "All 3 correct" : "Both correct";
    } else if (correct === 2) { pts = 5; label = "2 correct"; }
    else if (correct === 1) { pts = 2; label = "1 correct"; }
    else { pts = 0; label = "None correct"; }
    const names = picked.map((t) => teamById[t]?.name || "?").join(" & ");
    events.push({ event_date: lastDate, type: "group", description: `Group ${g.name}: ${names} — ${label}`, pts_change: pts });
  }

  const koMatches = db.prepare("SELECT * FROM knockout_matches WHERE status='finished'").all();
  const koPointsMap2 = { R32: 3, R16: 5, QF: 7, SF: 10, F: 15 };
  const koRoundLabels2 = { R32: "Round of 32", R16: "Round of 16", QF: "Quarter-Final", SF: "Semi-Final", F: "Final" };
  for (const m of koMatches) {
    const kp = db.prepare("SELECT * FROM knockout_predictions WHERE participant_id = ? AND match_id = ?").get(participantId, m.id);
    if (!kp) continue;
    const home = teamById[m.home_team_id]?.name || m.home_slot;
    const away = teamById[m.away_team_id]?.name || m.away_slot;
    const roundLabel = koRoundLabels2[m.round] || m.round;
    const basePts = koPointsMap2[m.round] || 0;
    let pts = 0;
    let desc = `${roundLabel}: ${home} vs ${away}`;
    if (m.winner_team_id) {
      const predictedTeamId = kp.predicted_winner === "home" ? m.home_team_id : kp.predicted_winner === "away" ? m.away_team_id : Number(kp.predicted_winner);
      const winnerCorrect = String(predictedTeamId) === String(m.winner_team_id);
      const scoreCorrect = !exactScoresDisabledH &&
                           kp.predicted_home_score !== null && kp.predicted_away_score !== null &&
                           m.home_score !== null && m.away_score !== null &&
                           kp.predicted_home_score === m.home_score && kp.predicted_away_score === m.away_score;
      if (winnerCorrect) pts += basePts;
      if (scoreCorrect) pts += basePts;
      if (winnerCorrect) {
        desc += ` — predicted ${teamById[m.winner_team_id]?.name || "?"} ✓${scoreCorrect ? ` (exact score, +${basePts})` : ""}`;
      } else if (scoreCorrect) {
        desc += ` — wrong winner ✗ but exact score (+${basePts})`;
      } else {
        desc += ` — wrong prediction ✗`;
      }
    }
    events.push({ event_date: m.match_date, type: "ko", description: desc, pts_change: pts });
  }

  const champPick = db.prepare(`
    SELECT cp.*, t.name as team_name
    FROM champion_picks cp LEFT JOIN teams t ON cp.team_id = t.id
    WHERE cp.participant_id = ?
  `).get(participantId);
  if (champPick?.team_id && champPick.updated_at) {
    const pickDate = champPick.updated_at.slice(0, 16);
    if (champPick.change_cost > 0) {
      events.push({ event_date: pickDate, type: "champion_change", description: `Winner pick: ${champPick.team_name} (−${champPick.change_cost} pts fee)`, pts_change: -champPick.change_cost });
    } else {
      events.push({ event_date: pickDate, type: "champion_pick", description: `Winner pick: ${champPick.team_name}`, pts_change: 0 });
    }
    const finalMatch = koMatches.find((m) => m.id === "F");
    if (finalMatch?.winner_team_id && String(champPick.team_id) === String(finalMatch.winner_team_id)) {
      events.push({ event_date: finalMatch.match_date, type: "champion_bonus", description: `Winner pick correct: ${champPick.team_name} won the tournament!`, pts_change: 20 });
    }
  }

  // Player award picks
  const awardPointsMap = { golden_ball: 5, golden_boot: 5, golden_glove: 5, young_player: 2, fair_play: 2 };
  const awardLabels = { golden_ball: "Golden Ball", golden_boot: "Golden Boot", golden_glove: "Golden Glove", young_player: "Young Player", fair_play: "Fair Play" };
  const myAwardPicks = db.prepare(`
    SELECT pap.*, wp.name as player_name, t.name as team_name
    FROM player_award_picks pap
    LEFT JOIN wc_players wp ON pap.player_id = wp.id
    LEFT JOIN teams t ON pap.team_id = t.id
    WHERE pap.participant_id = ?
  `).all(participantId);
  const awardResults = db.prepare(`
    SELECT par.*, wp.name as player_name, t.name as team_name
    FROM player_award_results par
    LEFT JOIN wc_players wp ON par.player_id = wp.id
    LEFT JOIN teams t ON par.team_id = t.id
  `).all();
  for (const ap of myAwardPicks) {
    const result = awardResults.find((r) => r.award_category === ap.award_category);
    const label = awardLabels[ap.award_category] || ap.award_category;
    const pickName = ap.award_category === "fair_play" ? ap.team_name : ap.player_name;
    if (result) {
      const isCorrect = ap.award_category === "fair_play"
        ? ap.team_id && String(ap.team_id) === String(result.team_id)
        : ap.player_id && String(ap.player_id) === String(result.player_id);
      // Voided by the pool admin: keep showing the pick, but it scores 0.
      const pts = (isCorrect && !awardsVoidedH) ? awardPointsMap[ap.award_category] : 0;
      const winnerName = ap.award_category === "fair_play" ? result.team_name : result.player_name;
      const desc = isCorrect
        ? `${label}: ${pickName} ✓${awardsVoidedH ? " (voided — 0 pts)" : ""}`
        : `${label}: picked ${pickName}, winner was ${winnerName} ✗`;
      events.push({ event_date: result.set_at, type: "player_award", description: desc, pts_change: pts });
    }
  }

  events.sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""));
  let running = 0;
  for (const e of events) { running += e.pts_change; e.running_total = running; }
  res.json(events);
});

// ─────────────────────────────────────────────────────────────────────────────

app.put("/api/admin/knockout-matches/:id", requireAdminToken, (req, res) => {
  const { match_date } = req.body;
  db.prepare("UPDATE knockout_matches SET match_date = ? WHERE id = ?").run(match_date || null, req.params.id);
  res.json({ success: true });
});

// Admin override for KO match teams/scores/winner. Pass null to clear a field, number/string to set.
// Touching home_team_id, away_team_id or winner_team_id also flips the matching _admin_set flag
// to 1, which tells the API auto-correct sync and the resolver to leave that field alone.
// To re-enable auto-sync on a field, pass clear_admin_lock: ["home_team_id", ...].
app.patch("/api/admin/knockout-matches/:id", requireAdminToken, (req, res) => {
  const ALLOWED = ["home_team_id", "away_team_id", "winner_team_id", "home_score", "away_score", "status", "match_date"];
  const TEAM_FIELDS = { home_team_id: "home_admin_set", away_team_id: "away_admin_set", winner_team_id: "winner_admin_set" };
  const STATUSES = ["upcoming", "live", "finished"];
  const updates = [];
  const values = [];
  for (const k of ALLOWED) {
    if (!Object.prototype.hasOwnProperty.call(req.body, k)) continue;
    const v = req.body[k];
    if (k === "status" && v !== null && !STATUSES.includes(v)) {
      return res.status(400).json({ error: `status must be one of ${STATUSES.join("/")} or null` });
    }
    updates.push(`${k} = ?`);
    values.push(v);
    // Mark this team-field as admin-locked
    if (TEAM_FIELDS[k]) {
      updates.push(`${TEAM_FIELDS[k]} = 1`);
    }
  }
  // Optional unlock: ["home_team_id"] → home_admin_set = 0
  if (Array.isArray(req.body.clear_admin_lock)) {
    for (const f of req.body.clear_admin_lock) {
      if (TEAM_FIELDS[f]) updates.push(`${TEAM_FIELDS[f]} = 0`);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: "No updatable fields provided" });
  values.push(req.params.id);
  try {
    const r = db.prepare(`UPDATE knockout_matches SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    if (r.changes === 0) return res.status(404).json({ error: "Match not found" });
    // Admin's explicit choice resolves any prior mismatch for fields they touched, so the
    // banner clears immediately rather than waiting for the next 30-min sync.
    for (const f of ["home_team_id", "away_team_id"]) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        db.prepare("DELETE FROM ko_mismatches WHERE match_id = ? AND field = ?").run(req.params.id, f);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Swap home/away sides for a KO match AND atomically flip every existing prediction's
// predicted_winner (and predicted_home_score / predicted_away_score) so user intent
// is preserved. Used when football-data.org and our DB agree on the two teams but
// disagree on which side is home — e.g., neutral-venue conventions differ.
app.post("/api/admin/knockout-matches/:id/swap-sides", requireAdminToken, (req, res) => {
  const id = req.params.id;
  const match = db.prepare(
    "SELECT home_team_id, away_team_id FROM knockout_matches WHERE id = ?"
  ).get(id);
  if (!match) return res.status(404).json({ error: "Match not found" });
  if (match.home_team_id == null || match.away_team_id == null) {
    return res.status(400).json({ error: "Both teams must be set before swapping sides" });
  }

  const txn = db.transaction(() => {
    // Also swaps home_score / away_score on the match row so live or finished
    // matches stay coherent — otherwise the new home team would be credited with
    // the old away team's score and scoring would break. SQLite SET expressions
    // read the pre-update row, so `home_score = away_score` + `away_score = home_score`
    // is a proper swap.
    db.prepare(`
      UPDATE knockout_matches
      SET home_team_id = ?, away_team_id = ?,
          home_score = away_score, away_score = home_score,
          home_admin_set = 1, away_admin_set = 1
      WHERE id = ?
    `).run(match.away_team_id, match.home_team_id, id);
    db.prepare(`
      UPDATE knockout_predictions
      SET predicted_winner = CASE predicted_winner WHEN 'home' THEN 'away' WHEN 'away' THEN 'home' ELSE predicted_winner END,
          predicted_home_score = predicted_away_score,
          predicted_away_score = predicted_home_score
      WHERE match_id = ?
    `).run(id);
    db.prepare("DELETE FROM ko_mismatches WHERE match_id = ?").run(id);
  });

  try {
    txn();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/ko-mismatches", requireAdminToken, (req, res) => {
  const rows = db.prepare(`
    SELECT m.match_id, m.field, m.local_team_id, m.api_team_id, m.detected_at,
      km.round, km.match_date, km.home_team_id, km.away_team_id,
      lt.code AS local_code, lt.name AS local_name,
      at.code AS api_code, at.name AS api_name,
      (SELECT COUNT(*) FROM knockout_predictions kp
        WHERE kp.match_id = m.match_id AND kp.predicted_winner = 'home') AS home_pick_count,
      (SELECT COUNT(*) FROM knockout_predictions kp
        WHERE kp.match_id = m.match_id AND kp.predicted_winner = 'away') AS away_pick_count
    FROM ko_mismatches m
    LEFT JOIN knockout_matches km ON km.id = m.match_id
    LEFT JOIN teams lt ON lt.id = m.local_team_id
    LEFT JOIN teams at ON at.id = m.api_team_id
    ORDER BY m.detected_at DESC
  `).all();
  // For each row, also report whether the API rows for this match are a pure
  // home/away swap (same two teams, sides flipped). The frontend uses this to show
  // a calmer "this is just a label swap" hint instead of the silent-reinterpretation warning.
  for (const r of rows) {
    const other = rows.find((x) => x.match_id === r.match_id && x.field !== r.field);
    r.is_side_swap = !!(
      other &&
      r.local_team_id != null && r.api_team_id != null &&
      other.local_team_id != null && other.api_team_id != null &&
      r.api_team_id === other.local_team_id && r.local_team_id === other.api_team_id
    );
  }
  res.json(rows);
});

// --- Pool Chat ---

app.get("/api/pools/:poolId/messages", (req, res) => {
  const { poolId } = req.params;
  const afterId = req.query.after ? Number(req.query.after) : 0;
  const pool = db.prepare("SELECT chat_closed FROM pools WHERE id = ?").get(poolId);
  const messages = db.prepare(
    "SELECT id, pool_id, user_id, display_name, body, created_at FROM messages WHERE pool_id = ? AND id > ? ORDER BY id ASC LIMIT 200"
  ).all(poolId, afterId);
  res.json({ messages, chat_closed: pool ? pool.chat_closed : 0 });
});

app.post("/api/pools/:poolId/messages", authenticateToken, (req, res) => {
  const { poolId } = req.params;
  const pool = db.prepare("SELECT chat_closed FROM pools WHERE id = ?").get(poolId);
  if (pool && pool.chat_closed) return res.status(403).json({ error: "Chat has been closed by a pool admin" });
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: "Message cannot be empty" });
  if (body.trim().length > 500) return res.status(400).json({ error: "Message too long (max 500 characters)" });
  const user = db.prepare("SELECT display_name FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const result = db.prepare(
    "INSERT INTO messages (pool_id, user_id, display_name, body) VALUES (?, ?, ?, ?)"
  ).run(poolId, req.user.id, user.display_name, body.trim());
  res.json({ id: result.lastInsertRowid, pool_id: Number(poolId), user_id: req.user.id, display_name: user.display_name, body: body.trim(), created_at: new Date().toISOString() });
});

// ── Database Backup & Restore ───────────────────────────────────────────────

const BACKUP_DIR = path.join(path.dirname(db.name), "backups");

app.get("/api/admin/backup", requireAdminToken, async (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupFile = path.join(BACKUP_DIR, `backup-${timestamp}.db`);
    await db.backup(backupFile);
    res.download(backupFile, `sportspooling-backup-${timestamp}.db`, (err) => {
      // Clean up temp backup file after download
      try { fs.unlinkSync(backupFile); } catch (_) {}
      if (err && !res.headersSent) res.status(500).json({ error: "Download failed" });
    });
  } catch (err) {
    res.status(500).json({ error: "Backup failed: " + err.message });
  }
});

app.get("/api/admin/backup/list", requireAdminToken, (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return res.json([]);
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".db"))
      .map((f) => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: stat.size, created: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.created.localeCompare(a.created));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/backup/save", requireAdminToken, async (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupFile = path.join(BACKUP_DIR, `backup-${timestamp}.db`);
    await db.backup(backupFile);
    const stat = fs.statSync(backupFile);
    res.json({ success: true, name: `backup-${timestamp}.db`, size: stat.size, created: stat.mtime.toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Backup failed: " + err.message });
  }
});

app.delete("/api/admin/backup/:name", requireAdminToken, (req, res) => {
  const name = req.params.name;
  if (!name.endsWith(".db") || name.includes("..") || name.includes("/")) {
    return res.status(400).json({ error: "Invalid backup name" });
  }
  const filePath = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Backup not found" });
  try {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/restore", requireAdminToken, express.raw({ type: "application/octet-stream", limit: "50mb" }), async (req, res) => {
  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  try {
    // Save uploaded file to a temp location
    const tempFile = path.join(BACKUP_DIR || path.dirname(db.name), `restore-temp-${Date.now()}.db`);
    if (!fs.existsSync(path.dirname(tempFile))) fs.mkdirSync(path.dirname(tempFile), { recursive: true });
    fs.writeFileSync(tempFile, req.body);

    // Validate it's a real SQLite database by trying to open it
    const Database = require("better-sqlite3");
    let testDb;
    try {
      testDb = new Database(tempFile, { readonly: true });
      // Check it has at least the users table
      testDb.prepare("SELECT COUNT(*) FROM users").get();
      testDb.close();
    } catch (validationErr) {
      if (testDb) testDb.close();
      fs.unlinkSync(tempFile);
      return res.status(400).json({ error: "Invalid backup file — not a valid Sports Pooling database" });
    }

    // Auto-save a backup before restoring
    const preRestoreBackup = path.join(BACKUP_DIR, `pre-restore-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.db`);
    await db.backup(preRestoreBackup);

    // Restore: read the uploaded DB and write it over the current one
    const restoreDb = new Database(tempFile, { readonly: true });
    await restoreDb.backup(db.name);
    restoreDb.close();
    fs.unlinkSync(tempFile);

    res.json({ success: true, message: "Database restored. Restart the server for changes to take full effect." });
  } catch (err) {
    res.status(500).json({ error: "Restore failed: " + err.message });
  }
});

app.post("/api/admin/restore/:name", requireAdminToken, async (req, res) => {
  const name = req.params.name;
  if (!name.endsWith(".db") || name.includes("..") || name.includes("/")) {
    return res.status(400).json({ error: "Invalid backup name" });
  }
  const filePath = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Backup not found" });

  try {
    // Auto-save a backup before restoring
    const preRestoreBackup = path.join(BACKUP_DIR, `pre-restore-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.db`);
    await db.backup(preRestoreBackup);

    const Database = require("better-sqlite3");
    const restoreDb = new Database(filePath, { readonly: true });
    await restoreDb.backup(db.name);
    restoreDb.close();

    res.json({ success: true, message: "Database restored from " + name + ". Restart the server for changes to take full effect." });
  } catch (err) {
    res.status(500).json({ error: "Restore failed: " + err.message });
  }
});

// ── Global stats (across all pools for a tournament) ─────────────────────────

const KO_STATS_ROUND_ORDER = ["R32", "R16", "QF", "SF", "F"];
const KO_STATS_ROUND_LABELS = { R32: "Round of 32", R16: "Round of 16", QF: "Quarter-Finals", SF: "Semi-Finals", F: "Final" };

// Shape raw knockout pick-count rows into rounds → matches with win-share
// percentages. Predicted scores are intentionally excluded. Matches with no
// picks or TBD teams are dropped.
function shapeKnockoutStats(rows) {
  const byRound = {};
  for (const r of rows) {
    const total = r.home_count + r.away_count;
    if (total === 0 || !r.home_team_name || !r.away_team_name) continue;
    if (!byRound[r.round]) {
      byRound[r.round] = { round: r.round, round_name: KO_STATS_ROUND_LABELS[r.round] || r.round, matches: [] };
    }
    byRound[r.round].matches.push({
      match_id: r.match_id,
      home_team_name: r.home_team_name, home_team_code: r.home_team_code,
      away_team_name: r.away_team_name, away_team_code: r.away_team_code,
      home_count: r.home_count, away_count: r.away_count,
      home_pct: Math.round((r.home_count / total) * 100),
      away_pct: Math.round((r.away_count / total) * 100),
    });
  }
  return KO_STATS_ROUND_ORDER.filter((rd) => byRound[rd]).map((rd) => byRound[rd]);
}

app.get("/api/stats/global", (req, res) => {
  const tournament = req.query.tournament || "wc2026";

  // Champion picks across all pools for this tournament
  const championRows = db.prepare(`
    SELECT t.id as team_id, t.name as team_name, t.code as team_code,
           COUNT(*) as pick_count
    FROM champion_picks cp
    JOIN participants p ON p.id = cp.participant_id
    JOIN pools po ON po.id = p.pool_id
    JOIN teams t ON t.id = cp.team_id
    WHERE po.tournament = ?
    GROUP BY t.id
    ORDER BY pick_count DESC
  `).all(tournament);

  const champTotal = championRows.reduce((s, r) => s + r.pick_count, 0);
  const champions = championRows.map(r => ({
    ...r,
    percentage: champTotal > 0 ? Math.round((r.pick_count / champTotal) * 100) : 0,
  }));

  // Group picks across all pools
  const groupRows = db.prepare(`
    SELECT g.id as group_id, g.name as group_name,
           t.id as team_id, t.name as team_name, t.code as team_code,
           COUNT(*) as pick_count
    FROM group_predictions gp
    JOIN participants p ON p.id = gp.participant_id
    JOIN pools po ON po.id = p.pool_id
    JOIN teams t ON t.id IN (gp.team1_id, gp.team2_id)
    JOIN groups g ON g.id = gp.group_id
    WHERE po.tournament = ?
    GROUP BY g.id, t.id
    ORDER BY g.name, pick_count DESC
  `).all(tournament);

  const totalByGroup = {};
  for (const r of groupRows) {
    totalByGroup[r.group_id] = (totalByGroup[r.group_id] || 0) + r.pick_count;
  }
  const groups = {};
  for (const r of groupRows) {
    if (!groups[r.group_id]) {
      groups[r.group_id] = { group_id: r.group_id, group_name: r.group_name, teams: [] };
    }
    groups[r.group_id].teams.push({
      ...r,
      percentage: Math.round((r.pick_count / totalByGroup[r.group_id]) * 100),
    });
  }

  // Award picks across all pools for this tournament
  const awardRows = db.prepare(`
    SELECT
      pap.award_category,
      pap.player_id,
      pap.team_id AS pick_team_id,
      wp.name     AS player_name,
      t.name      AS team_name,
      t.code      AS team_code,
      COUNT(*)    AS pick_count
    FROM player_award_picks pap
    JOIN participants p ON p.id = pap.participant_id
    JOIN pools po ON po.id = p.pool_id
    LEFT JOIN wc_players wp ON wp.id = pap.player_id
    LEFT JOIN teams t ON t.id = COALESCE(wp.team_id, pap.team_id)
    WHERE po.tournament = ?
    GROUP BY pap.award_category, COALESCE(pap.player_id, pap.team_id)
    ORDER BY pap.award_category, pick_count DESC
  `).all(tournament);

  const totalByAward = {};
  for (const r of awardRows) {
    totalByAward[r.award_category] = (totalByAward[r.award_category] || 0) + r.pick_count;
  }
  const awards = {};
  for (const r of awardRows) {
    if (!awards[r.award_category]) awards[r.award_category] = [];
    if (awards[r.award_category].length < 10) {
      const total = totalByAward[r.award_category];
      awards[r.award_category].push({
        player_id: r.player_id,
        player_name: r.player_name,
        team_name: r.team_name,
        team_code: r.team_code,
        pick_count: r.pick_count,
        percentage: total > 0 ? Math.round((r.pick_count / total) * 100) : 0,
      });
    }
  }

  // Knockout winner picks across all pools for this tournament (no scores)
  const knockoutRows = db.prepare(`
    SELECT km.id as match_id, km.round,
           ht.name as home_team_name, ht.code as home_team_code,
           at.name as away_team_name, at.code as away_team_code,
           SUM(CASE WHEN kp.predicted_winner = 'home' THEN 1 ELSE 0 END) as home_count,
           SUM(CASE WHEN kp.predicted_winner = 'away' THEN 1 ELSE 0 END) as away_count
    FROM knockout_predictions kp
    JOIN participants p ON p.id = kp.participant_id
    JOIN pools po ON po.id = p.pool_id
    JOIN knockout_matches km ON km.id = kp.match_id
    LEFT JOIN teams ht ON ht.id = km.home_team_id
    LEFT JOIN teams at ON at.id = km.away_team_id
    WHERE po.tournament = ?
    GROUP BY km.id
    ORDER BY km.id
  `).all(tournament);
  const knockout = shapeKnockoutStats(knockoutRows);

  const totalPlayers = champTotal;

  res.json({ champions, groups: Object.values(groups), awards, knockout, totalPlayers });
});

// ── Stats endpoints ──────────────────────────────────────────────────────────

app.get("/api/stats/group-picks", (req, res) => {
  const poolId = req.query.pool_id;
  if (!poolId) return res.json({ error: "pool_id required" });

  const rows = db.prepare(`
    SELECT g.id as group_id, g.name as group_name,
           t.id as team_id, t.name as team_name, t.code as team_code,
           COUNT(*) as pick_count
    FROM group_predictions gp
    JOIN participants p ON p.id = gp.participant_id
    JOIN teams t ON t.id IN (gp.team1_id, gp.team2_id)
    JOIN groups g ON g.id = gp.group_id
    WHERE p.pool_id = ?
    GROUP BY g.id, t.id
    ORDER BY g.name, pick_count DESC
  `).all(poolId);

  const totalByGroup = {};
  for (const r of rows) {
    totalByGroup[r.group_id] = (totalByGroup[r.group_id] || 0) + r.pick_count;
  }

  const groups = {};
  for (const r of rows) {
    if (!groups[r.group_id]) {
      groups[r.group_id] = { group_id: r.group_id, group_name: r.group_name, teams: [] };
    }
    groups[r.group_id].teams.push({
      team_id: r.team_id,
      team_name: r.team_name,
      team_code: r.team_code,
      pick_count: r.pick_count,
      percentage: Math.round((r.pick_count / totalByGroup[r.group_id]) * 100),
    });
  }

  res.json(Object.values(groups));
});

app.get("/api/stats/knockout-picks", (req, res) => {
  const poolId = req.query.pool_id;
  if (!poolId) return res.json({ error: "pool_id required" });

  const rows = db.prepare(`
    SELECT km.id as match_id, km.round,
           ht.name as home_team_name, ht.code as home_team_code,
           at.name as away_team_name, at.code as away_team_code,
           SUM(CASE WHEN kp.predicted_winner = 'home' THEN 1 ELSE 0 END) as home_count,
           SUM(CASE WHEN kp.predicted_winner = 'away' THEN 1 ELSE 0 END) as away_count
    FROM knockout_predictions kp
    JOIN participants p ON p.id = kp.participant_id
    JOIN knockout_matches km ON km.id = kp.match_id
    LEFT JOIN teams ht ON ht.id = km.home_team_id
    LEFT JOIN teams at ON at.id = km.away_team_id
    WHERE p.pool_id = ?
    GROUP BY km.id
    ORDER BY km.id
  `).all(poolId);

  res.json(shapeKnockoutStats(rows));
});

app.get("/api/stats/champion-picks", (req, res) => {
  const poolId = req.query.pool_id;
  if (!poolId) return res.json({ error: "pool_id required" });

  const rows = db.prepare(`
    SELECT t.id as team_id, t.name as team_name, t.code as team_code,
           COUNT(*) as pick_count
    FROM champion_picks cp
    JOIN participants p ON p.id = cp.participant_id
    JOIN teams t ON t.id = cp.team_id
    WHERE p.pool_id = ?
    GROUP BY t.id
    ORDER BY pick_count DESC
  `).all(poolId);

  const total = rows.reduce((sum, r) => sum + r.pick_count, 0);

  res.json(rows.map(r => ({
    team_id: r.team_id,
    team_name: r.team_name,
    team_code: r.team_code,
    pick_count: r.pick_count,
    percentage: total > 0 ? Math.round((r.pick_count / total) * 100) : 0,
  })));
});

app.get("/api/stats/award-picks", (req, res) => {
  const poolId = req.query.pool_id;
  if (!poolId) return res.json({ error: "pool_id required" });

  const rows = db.prepare(`
    SELECT
      pap.award_category,
      pap.player_id,
      pap.team_id AS pick_team_id,
      wp.name     AS player_name,
      t.name      AS team_name,
      t.code      AS team_code,
      COUNT(*)    AS pick_count
    FROM player_award_picks pap
    JOIN participants p ON p.id = pap.participant_id AND p.pool_id = ?
    LEFT JOIN wc_players wp ON wp.id = pap.player_id
    LEFT JOIN teams t ON t.id = COALESCE(wp.team_id, pap.team_id)
    GROUP BY pap.award_category, COALESCE(pap.player_id, pap.team_id)
    ORDER BY pap.award_category, pick_count DESC
  `).all(poolId);

  const totalByAward = {};
  for (const r of rows) {
    totalByAward[r.award_category] = (totalByAward[r.award_category] || 0) + r.pick_count;
  }

  const awards = {};
  for (const r of rows) {
    if (!awards[r.award_category]) awards[r.award_category] = [];
    if (awards[r.award_category].length < 5) {
      const total = totalByAward[r.award_category];
      awards[r.award_category].push({
        player_id: r.player_id,
        player_name: r.player_name,
        team_name: r.team_name,
        team_code: r.team_code,
        pick_count: r.pick_count,
        percentage: total > 0 ? Math.round((r.pick_count / total) * 100) : 0,
      });
    }
  }

  res.json(awards);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// Domestic league API — config-driven (EPL, La Liga, …). See leagues.js.
// ═══════════════════════════════════════════════════════════════════════════════
const { getLeague, marginBandFor } = require("./leagues");

// Resolve :code -> league config; 404 for unknown leagues. Attaches req.league.
function resolveLeague(req, res, next) {
  const league = getLeague(req.params.code);
  if (!league) return res.status(404).json({ error: `Unknown league: ${req.params.code}` });
  req.league = league;
  next();
}

app.get("/api/league/:code/config", resolveLeague, (req, res) => {
  const L = req.league;
  res.json({
    code: L.code, name: L.name, shortName: L.shortName, emoji: L.emoji,
    sport: L.sport, teamCount: L.teamCount, matchdays: L.matchdays, zones: L.zones,
    awards: L.awards, scoring: L.scoring,
    // NFL-only; undefined for soccer leagues and omitted from the JSON.
    divisions: L.divisions, seasonSlots: L.seasonSlots,
    marginBands: L.marginBands, playoffRounds: L.playoffRounds,
  });
});

app.get("/api/league/:code/teams", resolveLeague, (req, res) => {
  res.json(db.prepare("SELECT * FROM league_teams WHERE league = ? ORDER BY name").all(req.params.code));
});

app.get("/api/league/:code/matches", resolveLeague, (req, res) => {
  const { matchday } = req.query;
  let query = `SELECT m.*, ht.name as home_team, ht.code as home_code, ht.short_name as home_short, ht.crest_url as home_crest,
    at.name as away_team, at.code as away_code, at.short_name as away_short, at.crest_url as away_crest
    FROM league_matches m
    JOIN league_teams ht ON m.home_team_id = ht.id
    JOIN league_teams at ON m.away_team_id = at.id
    WHERE m.league = ?`;
  const params = [req.params.code];
  if (matchday) { query += " AND m.matchday = ?"; params.push(Number(matchday)); }
  query += " ORDER BY m.matchday, m.match_date, m.id";
  res.json(db.prepare(query).all(...params));
});

// NFL regular-season table: W-L-T ordered by win percentage (a tie is half a win, as the NFL
// computes it), then point differential, then points for. Playoff weeks are excluded — they don't
// count toward division standings.
//
// The NFL's real tiebreakers (head-to-head, then division record, then common games, …) are far
// more involved than this. Differential is a close-enough stand-in for a prediction pool, but it
// means a division winner shown here can differ from the official one in a genuine tie.
function nflStandings(L, teams, matches) {
  const stats = {};
  for (const t of teams) {
    stats[t.id] = {
      team_id: t.id, name: t.name, code: t.code, short_name: t.short_name, crest_url: t.crest_url,
      conference: t.conference, division: t.division,
      played: 0, won: 0, lost: 0, tied: 0, pf: 0, pa: 0,
    };
  }
  for (const m of matches) {
    if (m.matchday > L.matchdays) continue; // playoff game
    const h = stats[m.home_team_id], a = stats[m.away_team_id];
    if (!h || !a) continue;
    h.played++; a.played++;
    h.pf += m.home_score; h.pa += m.away_score;
    a.pf += m.away_score; a.pa += m.home_score;
    if (m.home_score > m.away_score) { h.won++; a.lost++; }
    else if (m.away_score > m.home_score) { a.won++; h.lost++; }
    else { h.tied++; a.tied++; }
  }
  const table = Object.values(stats);
  for (const s of table) {
    s.diff = s.pf - s.pa;
    s.pct = s.played > 0 ? (s.won + s.tied / 2) / s.played : 0;
  }
  return table.sort((a, b) =>
    b.pct - a.pct || b.diff - a.diff || b.pf - a.pf || a.name.localeCompare(b.name)
  );
}

app.get("/api/league/:code/standings", resolveLeague, (req, res) => {
  const L = req.league;
  const teams = db.prepare("SELECT * FROM league_teams WHERE league = ?").all(req.params.code);
  const matches = db.prepare("SELECT * FROM league_matches WHERE league = ? AND status IN ('finished', 'live')").all(req.params.code);

  if (L.sport === "nfl") return res.json(nflStandings(L, teams, matches));

  const stats = {};
  for (const t of teams) {
    stats[t.id] = { team_id: t.id, name: t.name, code: t.code, short_name: t.short_name, crest_url: t.crest_url, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 };
  }
  for (const m of matches) {
    const h = stats[m.home_team_id], a = stats[m.away_team_id];
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) { h.won++; h.points += 3; a.lost++; }
    else if (m.away_score > m.home_score) { a.won++; a.points += 3; h.lost++; }
    else { h.drawn++; h.points++; a.drawn++; a.points++; }
  }
  const table = Object.values(stats).sort((a, b) =>
    b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.name.localeCompare(b.name)
  );
  res.json(table);
});

app.get("/api/league/:code/matchday-deadline", resolveLeague, (req, res) => {
  const { matchday } = req.query;
  if (!matchday) return res.json({ deadline: null });
  const row = db.prepare("SELECT MIN(match_date) as deadline FROM league_matches WHERE league = ? AND matchday = ? AND match_date IS NOT NULL").get(req.params.code, Number(matchday));
  res.json({ deadline: row?.deadline || null });
});

// Season/award entry window: open until the start of the first matchday that begins AFTER the
// pool was created (falls back to season start). Scoped to one league's fixtures.
function leaguePoolSeasonDeadline(code, poolId) {
  const pool = poolId ? db.prepare("SELECT created_at FROM pools WHERE id = ?").get(poolId) : null;
  const createdAt = pool?.created_at || "0000-00-00 00:00:00";
  const row = db.prepare(`
    SELECT MIN(md_start) AS d FROM (
      SELECT MIN(match_date) AS md_start
      FROM league_matches
      WHERE league = ? AND match_date IS NOT NULL
      GROUP BY matchday
    ) WHERE md_start > ?
  `).get(code, createdAt);
  return row?.d || null;
}

function leagueSeasonLocked(code, poolId) {
  // Admin override wins over the auto-deadline in both directions (1 = force locked, 0 = force open).
  if (poolId) {
    const ov = db.prepare("SELECT season_locked_override FROM pools WHERE id = ?").get(poolId);
    if (ov && ov.season_locked_override !== null) return !!ov.season_locked_override;
  }
  const deadline = leaguePoolSeasonDeadline(code, poolId);
  if (deadline) return new Date() >= new Date(deadline.replace(" ", "T") + "Z");
  return !!db.prepare("SELECT 1 FROM league_matches WHERE league = ? AND match_date IS NOT NULL LIMIT 1").get(code);
}

app.get("/api/league/:code/season-deadline", resolveLeague, (req, res) => {
  const { code } = req.params;
  const poolId = req.query.pool_id;
  res.json({ deadline: leaguePoolSeasonDeadline(code, poolId), locked: leagueSeasonLocked(code, poolId) });
});

// League pool admin: lock/unlock the whole Season Predictions section (incl. the title
// winner), overriding the auto-deadline. `locked` is the desired effective state.
app.get("/api/pools/:poolId/season-lock", (req, res) => {
  const pool = db.prepare("SELECT tournament, season_locked_override FROM pools WHERE id = ?").get(req.params.poolId);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  res.json({ locked: leagueSeasonLocked(pool.tournament, req.params.poolId), override: pool.season_locked_override });
});

app.put("/api/pools/:poolId/season-lock", requirePoolAdmin, (req, res) => {
  const { locked } = req.body;
  db.prepare("UPDATE pools SET season_locked_override = ? WHERE id = ?").run(locked ? 1 : 0, req.params.poolId);
  res.json({ success: true, locked: !!locked });
});

// Manual score adjustments (itemized). Readable by anyone (shown on the leaderboard);
// only a pool admin can add or remove entries. Adjustments are scoped to the pool's participants.
app.get("/api/pools/:poolId/score-adjustments", (req, res) => {
  const rows = db.prepare(`
    SELECT sa.id, sa.participant_id, sa.points, sa.reason, sa.created_at, p.name AS participant_name
    FROM score_adjustments sa
    JOIN participants p ON p.id = sa.participant_id
    WHERE p.pool_id = ?
    ORDER BY sa.created_at DESC, sa.id DESC
  `).all(req.params.poolId);
  res.json(rows);
});

app.post("/api/pools/:poolId/score-adjustments", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const { participant_id, points, reason } = req.body;
  const pts = Number(points);
  if (!participant_id || !Number.isInteger(pts) || pts === 0) {
    return res.status(400).json({ error: "participant_id and a non-zero whole-number points value are required" });
  }
  // Participant must belong to this pool — don't let an admin adjust someone in another pool.
  const part = db.prepare("SELECT id FROM participants WHERE id = ? AND pool_id = ?").get(participant_id, poolId);
  if (!part) return res.status(404).json({ error: "Participant not found in this pool" });
  const info = db.prepare(
    "INSERT INTO score_adjustments (participant_id, points, reason, created_by) VALUES (?, ?, ?, ?)"
  ).run(participant_id, pts, (reason || "").trim() || null, req.user.id);
  res.json({ success: true, id: info.lastInsertRowid });
});

app.delete("/api/pools/:poolId/score-adjustments/:id", requirePoolAdmin, (req, res) => {
  // Scope the delete to this pool's participants so an admin can only remove their own pool's entries.
  db.prepare(`
    DELETE FROM score_adjustments
    WHERE id = ? AND participant_id IN (SELECT id FROM participants WHERE pool_id = ?)
  `).run(req.params.id, req.params.poolId);
  res.json({ success: true });
});

app.get("/api/league/:code/match-predictions/:participantId", resolveLeague, (req, res) => {
  const { participantId, code } = req.params;
  const { matchday } = req.query;
  let query = "SELECT * FROM league_match_predictions WHERE participant_id = ? AND match_id IN (SELECT id FROM league_matches WHERE league = ?";
  const params = [participantId, code];
  if (matchday) { query += " AND matchday = ?"; params.push(Number(matchday)); }
  query += ")";
  res.json(db.prepare(query).all(...params));
});

app.post("/api/league/:code/match-predictions", resolveLeague, authenticateToken, (req, res) => {
  const { code } = req.params;
  const L = req.league;
  const { participant_id, predictions } = req.body;
  if (!participant_id || !Array.isArray(predictions)) return res.status(400).json({ error: "participant_id and predictions array required" });

  // When the pool has score prediction disabled, drop any incoming scorelines server-side so a
  // crafted request can't bypass the hidden UI. Enforced here as well as in the client.
  const scoresDisabled = !!db.prepare(
    "SELECT pl.exact_scores_disabled FROM participants pa JOIN pools pl ON pa.pool_id = pl.id WHERE pa.id = ?"
  ).get(participant_id)?.exact_scores_disabled;

  const bandKeys = new Set((L.marginBands || []).map((b) => b.key));
  const now = new Date();
  const upsert = db.prepare(`INSERT INTO league_match_predictions (participant_id, match_id, predicted_outcome, predicted_home_score, predicted_away_score, predicted_margin_band)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(participant_id, match_id) DO UPDATE SET predicted_outcome = excluded.predicted_outcome,
    predicted_home_score = excluded.predicted_home_score, predicted_away_score = excluded.predicted_away_score,
    predicted_margin_band = excluded.predicted_margin_band`);

  let saved = 0;
  const errors = [];
  for (const p of predictions) {
    const match = db.prepare("SELECT matchday, match_date FROM league_matches WHERE id = ? AND league = ?").get(p.match_id, code);
    if (!match) { errors.push(`Match ${p.match_id} not found`); continue; }
    if (match.match_date && now >= new Date(match.match_date.replace(" ", "T") + "Z")) {
      errors.push(`Match ${p.match_id} has already kicked off`);
      continue;
    }
    if (scoresDisabled) { p.predicted_home_score = null; p.predicted_away_score = null; }
    // Reject scores that contradict the outcome — enforced server-side, not UI-only.
    const hs = p.predicted_home_score, as_ = p.predicted_away_score;
    if (hs != null && as_ != null) {
      const consistent = p.predicted_outcome === "home" ? hs > as_
                       : p.predicted_outcome === "away" ? as_ > hs
                       : p.predicted_outcome === "draw" ? hs === as_ : false;
      if (!consistent) {
        errors.push(`Match ${p.match_id}: score ${hs}-${as_} contradicts "${p.predicted_outcome}" pick`);
        continue;
      }
    }
    // NFL picks carry a margin band instead of a scoreline. Same rule, same layer: a "tie" band
    // only makes sense with a drawn outcome, and vice versa.
    const band = p.predicted_margin_band ?? null;
    if (band != null) {
      if (!bandKeys.has(band)) { errors.push(`Match ${p.match_id}: unknown margin band "${band}"`); continue; }
      if ((band === "tie") !== (p.predicted_outcome === "draw")) {
        errors.push(`Match ${p.match_id}: margin band "${band}" contradicts "${p.predicted_outcome}" pick`);
        continue;
      }
    }
    upsert.run(participant_id, p.match_id, p.predicted_outcome, p.predicted_home_score ?? null, p.predicted_away_score ?? null, band);
    saved++;
  }
  if (errors.length > 0 && saved === 0) return res.status(400).json({ error: errors.join("; ") });
  res.json({ success: true, saved, errors });
});

app.get("/api/league/:code/season-predictions/:participantId", resolveLeague, (req, res) => {
  const preds = db.prepare(`SELECT sp.*, t.name as team_name, t.code as team_code, t.short_name, t.crest_url
    FROM league_season_predictions sp JOIN league_teams t ON sp.team_id = t.id
    WHERE sp.participant_id = ? AND sp.league = ? ORDER BY sp.position`).all(req.params.participantId, req.params.code);
  res.json(preds);
});

app.post("/api/league/:code/season-predictions", resolveLeague, authenticateToken, (req, res) => {
  const { code } = req.params;
  const L = req.league;
  const { participant_id, predictions } = req.body;

  // Soccer predicts every table position (1..N); NFL predicts a fixed set of slots (division
  // winners, conference champions, Super Bowl) stored in the same `position` column.
  const n = L.sport === "nfl" ? L.seasonSlots.length : L.teamCount;
  if (!participant_id || !Array.isArray(predictions) || predictions.length !== n) {
    return res.status(400).json({ error: L.sport === "nfl" ? `Must fill all ${n} picks` : `Must predict all ${n} positions` });
  }
  const participant = db.prepare("SELECT pool_id FROM participants WHERE id = ?").get(participant_id);
  // Without this the upsert below trips an FK violation and 500s with a stack trace.
  if (!participant) return res.status(400).json({ error: `Unknown participant ${participant_id}` });
  if (leagueSeasonLocked(code, participant.pool_id)) {
    return res.status(400).json({ error: "Season predictions are locked — the entry window for this pool has closed" });
  }

  // A division slot can only take a team from that division, a conference slot only a team from
  // that conference. Enforced here and not just in the picker, so the API can't be posted around.
  if (L.sport === "nfl") {
    const teamById = {};
    for (const t of db.prepare("SELECT id, name, conference, division FROM league_teams WHERE league = ?").all(code)) teamById[t.id] = t;
    const slotByPos = {};
    for (const s of L.seasonSlots) slotByPos[s.pos] = s;

    for (const p of predictions) {
      const slot = slotByPos[p.position];
      if (!slot) return res.status(400).json({ error: `Unknown pick slot ${p.position}` });
      const team = teamById[p.team_id];
      if (!team) return res.status(400).json({ error: `Unknown team ${p.team_id}` });
      if (slot.scope === "division" && team.division !== slot.division) {
        return res.status(400).json({ error: `${team.name} is not in the ${slot.division}` });
      }
      if (slot.scope === "conference" && team.conference !== slot.conference) {
        return res.status(400).json({ error: `${team.name} is not in the ${slot.conference}` });
      }
    }
  }

  const upsert = db.prepare(`INSERT INTO league_season_predictions (participant_id, league, position, team_id)
    VALUES (?, ?, ?, ?) ON CONFLICT(participant_id, league, position) DO UPDATE SET team_id = excluded.team_id`);
  const saveAll = db.transaction(() => {
    for (const p of predictions) upsert.run(participant_id, code, p.position, p.team_id);
  });
  saveAll();
  res.json({ success: true });
});

app.get("/api/league/:code/leaderboard", resolveLeague, (req, res) => {
  const { code } = req.params;
  const L = req.league, S = L.scoring, Z = L.zones, N = L.teamCount;
  const poolId = req.query.pool_id;
  if (!poolId) return res.status(400).json({ error: "pool_id required" });

  const participants = db.prepare("SELECT p.* FROM participants p JOIN users u ON p.user_id = u.id WHERE p.pool_id = ? AND u.is_admin = 0 ORDER BY p.name").all(poolId);
  const poolFlags = db.prepare("SELECT player_awards_voided, exact_scores_disabled FROM pools WHERE id = ?").get(poolId);
  const awardsVoided = !!poolFlags?.player_awards_voided;
  const exactScoresDisabled = !!poolFlags?.exact_scores_disabled;
  const finishedMatches = db.prepare("SELECT * FROM league_matches WHERE league = ? AND status = 'finished'").all(code);
  const allMatchPreds = db.prepare("SELECT mp.* FROM league_match_predictions mp JOIN league_matches m ON mp.match_id = m.id WHERE m.league = ?").all(code);
  const teams = db.prepare("SELECT * FROM league_teams WHERE league = ?").all(code);
  const totalMatches = db.prepare("SELECT COUNT(*) as c FROM league_matches WHERE league = ?").get(code).c;
  const seasonComplete = totalMatches > 0 && finishedMatches.length === totalMatches;

  const actualPositions = {};
  if (L.sport !== "nfl") {
    const standings = {};
    for (const t of teams) standings[t.id] = { team_id: t.id, points: 0, gf: 0, ga: 0 };
    for (const m of finishedMatches) {
      const h = standings[m.home_team_id], a = standings[m.away_team_id];
      if (!h || !a) continue;
      h.gf += m.home_score; h.ga += m.away_score;
      a.gf += m.away_score; a.ga += m.home_score;
      if (m.home_score > m.away_score) h.points += 3;
      else if (m.away_score > m.home_score) a.points += 3;
      else { h.points++; a.points++; }
    }
    const actualTable = Object.values(standings).sort((a, b) =>
      b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf
    );
    actualTable.forEach((t, i) => { actualPositions[t.team_id] = i + 1; });
  }

  // NFL season slots resolve at different moments rather than all at once at season's end:
  // division winners once the 18-week regular season is complete, conference champions after the
  // championship round, the Super Bowl winner after the final. Each scores as soon as it's known.
  const nflSlotWinners = {}; // slot key -> winning team_id
  if (L.sport === "nfl") {
    const allMatches = db.prepare("SELECT * FROM league_matches WHERE league = ?").all(code);
    const teamById = {};
    for (const t of teams) teamById[t.id] = t;
    const winnerOf = (m) => (m.home_score > m.away_score ? m.home_team_id : m.away_score > m.home_score ? m.away_team_id : null);

    const regular = allMatches.filter((m) => m.matchday <= L.matchdays);
    const regularDone = regular.filter((m) => m.status === "finished");
    if (regular.length > 0 && regularDone.length === regular.length) {
      const table = nflStandings(L, teams, regularDone);
      for (const slot of L.seasonSlots) {
        if (slot.scope !== "division") continue;
        const winner = table.find((t) => t.division === slot.division); // table is already sorted
        if (winner) nflSlotWinners[slot.key] = winner.team_id;
      }
    }

    for (const m of allMatches) {
      if (m.status !== "finished") continue;
      const w = winnerOf(m);
      if (!w) continue;
      if (m.matchday === L.conferenceRoundMatchday) {
        const conf = teamById[w]?.conference;
        const slot = L.seasonSlots.find((s) => s.scope === "conference" && s.conference === conf);
        if (slot) nflSlotWinners[slot.key] = w;
      } else if (m.matchday === L.finalMatchday) {
        const slot = L.seasonSlots.find((s) => s.scope === "champion");
        if (slot) nflSlotWinners[slot.key] = w;
      }
    }
  }

  const matchResults = {}, matchScores = {};
  for (const m of finishedMatches) {
    matchResults[m.id] = m.home_score > m.away_score ? "home" : m.away_score > m.home_score ? "away" : "draw";
    matchScores[m.id] = { home: m.home_score, away: m.away_score };
  }
  const predsByParticipant = {};
  for (const p of allMatchPreds) (predsByParticipant[p.participant_id] ||= []).push(p);
  const allSeasonPreds = db.prepare("SELECT * FROM league_season_predictions WHERE league = ?").all(code);
  const seasonByParticipant = {};
  for (const sp of allSeasonPreds) (seasonByParticipant[sp.participant_id] ||= []).push(sp);
  const allAwardPicks = db.prepare("SELECT * FROM league_award_picks WHERE league = ?").all(code);
  const awardResults = db.prepare("SELECT * FROM league_award_results WHERE league = ?").all(code);
  const awardPicksByParticipant = {};
  for (const ap of allAwardPicks) (awardPicksByParticipant[ap.participant_id] ||= []).push(ap);
  const managerKeys = new Set(L.awards.filter((a) => a.type === "manager").map((a) => a.key));

  // Manual admin adjustments (itemized) — summed per participant and added to the total.
  const adjustmentByParticipant = {};
  for (const a of db.prepare(
    "SELECT participant_id, SUM(points) AS s FROM score_adjustments WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?) GROUP BY participant_id"
  ).all(poolId)) adjustmentByParticipant[a.participant_id] = a.s;

  // Soccer-only zone bounds. NFL has no zones, so this must stay inside the guard.
  const [clFrom, clTo] = Z?.cl ?? [], [relFrom, relTo] = Z?.relegation ?? [];

  const result = participants.map((part) => {
    // matchExact counts bonus hits: an exact scoreline in soccer, a correct margin band in NFL.
    let matchPoints = 0, matchCorrect = 0, matchExact = 0;
    for (const p of (predsByParticipant[part.id] || [])) {
      const actual = matchResults[p.match_id];
      if (!actual) continue;
      if (p.predicted_outcome === actual) {
        const sc = matchScores[p.match_id];
        if (L.sport === "nfl") {
          // Called the winner; the bonus rides on also calling how comfortably.
          matchPoints += S.matchOutcome;
          const actualBand = marginBandFor(L, Math.abs(sc.home - sc.away));
          if (p.predicted_margin_band && p.predicted_margin_band === actualBand) { matchPoints += S.matchMargin; matchExact++; }
        } else if (!exactScoresDisabled && p.predicted_home_score != null && p.predicted_away_score != null &&
            p.predicted_home_score === sc.home && p.predicted_away_score === sc.away) {
          matchPoints += S.matchExact; matchExact++;
        } else {
          matchPoints += S.matchOutcome;
        }
        matchCorrect++;
      }
    }

    let seasonPoints = 0;
    const predictedTeams = {};
    for (const s of (seasonByParticipant[part.id] || [])) predictedTeams[s.position] = s.team_id;

    if (L.sport === "nfl") {
      for (const slot of L.seasonSlots) {
        const winner = nflSlotWinners[slot.key];
        if (winner && predictedTeams[slot.pos] === winner) seasonPoints += slot.pts;
      }
    } else if (seasonComplete) {
      if (predictedTeams[Z.champion] && actualPositions[predictedTeams[Z.champion]] === Z.champion) seasonPoints += S.seasonChampion;
      for (let pos = clFrom; pos <= clTo; pos++) {
        const tid = predictedTeams[pos];
        if (tid && actualPositions[tid] && actualPositions[tid] <= clTo) seasonPoints += S.seasonCL;
      }
      if (Z.europa && predictedTeams[Z.europa] && actualPositions[predictedTeams[Z.europa]] === Z.europa) seasonPoints += S.seasonEuropa;
      if (Z.conference && predictedTeams[Z.conference] && actualPositions[predictedTeams[Z.conference]] === Z.conference) seasonPoints += S.seasonConference;
      for (let pos = relFrom; pos <= relTo; pos++) {
        const tid = predictedTeams[pos];
        if (tid && actualPositions[tid] && actualPositions[tid] >= relFrom) seasonPoints += S.seasonRelegation;
      }
      for (let pos = 1; pos <= N; pos++) {
        const tid = predictedTeams[pos];
        if (tid && actualPositions[tid] === pos) seasonPoints += S.seasonExact;
      }
    }

    let awardPoints = 0;
    // Voided by the pool admin: award section scores 0 for everyone (picks are kept, not wiped).
    if (!awardsVoided) {
      for (const ap of (awardPicksByParticipant[part.id] || [])) {
        const r = awardResults.find((x) => x.award_category === ap.award_category);
        if (!r) continue;
        if (managerKeys.has(ap.award_category)) {
          if (ap.team_id && String(ap.team_id) === String(r.team_id)) awardPoints += S.award;
        } else {
          if (ap.player_id && String(ap.player_id) === String(r.player_id)) awardPoints += S.award;
        }
      }
    }

    const adjustmentPoints = adjustmentByParticipant[part.id] || 0;
    const totalPoints = matchPoints + seasonPoints + awardPoints + adjustmentPoints;
    return { id: part.id, name: part.name, points: totalPoints, match_points: matchPoints, match_correct: matchCorrect, match_exact: matchExact, season_points: seasonPoints, award_points: awardPoints, adjustment_points: adjustmentPoints };
  });

  result.sort((a, b) => b.points - a.points || b.match_correct - a.match_correct || a.name.localeCompare(b.name));
  res.json(result);
});

app.get("/api/league/:code/players", resolveLeague, (req, res) => {
  res.json(db.prepare(`SELECT p.*, t.name as team_name, t.code as team_code, t.short_name as team_short, t.crest_url as team_crest
    FROM league_players p JOIN league_teams t ON p.team_id = t.id
    WHERE p.league = ? ORDER BY t.name, p.position, p.name`).all(req.params.code));
});

// Shared engine for league pick distributions. poolId truthy → scoped to one pool (Stats page);
// poolId null → community-wide across every pool of the league (Community Predictions). Config-
// driven off leagues.js, so it works for EPL / La Liga / Serie A / NFL alike.
function computeLeaguePickStats(L, code, poolId) {
  const poolFilter = poolId ? "AND p.pool_id = ?" : "";
  const poolArgs = poolId ? [poolId] : [];

  // Rank teams by how many members put them anywhere in a set of finishing positions (soccer)
  // or NFL slot positions. Percentage is share of picks within that set.
  const zoneStats = (positions) => {
    if (!positions.length) return [];
    const placeholders = positions.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT t.id AS team_id, t.name AS team_name, t.code AS team_code,
             t.short_name AS short_name, t.crest_url AS crest_url, COUNT(*) AS pick_count
      FROM league_season_predictions sp
      JOIN participants p ON p.id = sp.participant_id ${poolFilter}
      JOIN league_teams t ON t.id = sp.team_id
      WHERE sp.league = ? AND sp.position IN (${placeholders})
      GROUP BY t.id
      ORDER BY pick_count DESC
    `).all(...poolArgs, code, ...positions);
    const total = rows.reduce((s, r) => s + r.pick_count, 0);
    return rows.map((r) => ({
      team_id: r.team_id, team_name: r.team_name, team_code: r.team_code,
      short_name: r.short_name, crest_url: r.crest_url, pick_count: r.pick_count,
      percentage: total > 0 ? Math.round((r.pick_count / total) * 100) : 0,
    }));
  };
  // A zone is either a single position (e.g. champion: 1) or an inclusive [from, to] range.
  const rangePositions = (z) => (Array.isArray(z)
    ? Array.from({ length: z[1] - z[0] + 1 }, (_, i) => z[0] + i)
    : (z != null ? [z] : []));

  let winner = { label: "", teams: [] };
  const groups = [];
  if (L.sport === "nfl") {
    const sbSlot = (L.seasonSlots || []).find((s) => s.scope === "champion");
    winner = { label: "Predicted Super Bowl Winner", teams: sbSlot ? zoneStats([sbSlot.pos]) : [] };
    for (const s of (L.seasonSlots || []).filter((x) => x.scope === "conference")) {
      groups.push({ key: s.key, label: `Predicted ${s.label}`, teams: zoneStats([s.pos]) });
    }
  } else {
    const Z = L.zones || {};
    winner = { label: "Predicted Champion", teams: zoneStats(rangePositions(Z.champion ?? 1)) };
    if (Z.cl) groups.push({ key: "cl", label: "Predicted Top 4 (UCL)", teams: zoneStats(rangePositions(Z.cl)) });
    if (Z.relegation) groups.push({ key: "relegation", label: "Predicted Relegation", teams: zoneStats(rangePositions(Z.relegation)) });
  }

  // Award picks — top 5 per category, mirroring /stats/award-picks.
  const awardRows = db.prepare(`
    SELECT pap.award_category,
           COALESCE(pap.player_id, pap.team_id) AS pick_key,
           pap.player_id,
           pl.name AS player_name,
           COALESCE(t2.name, t.name) AS team_name,
           COALESCE(t2.code, t.code) AS team_code,
           COALESCE(t2.crest_url, t.crest_url) AS crest_url,
           COUNT(*) AS pick_count
    FROM league_award_picks pap
    JOIN participants p ON p.id = pap.participant_id ${poolFilter}
    LEFT JOIN league_players pl ON pl.id = pap.player_id
    LEFT JOIN league_teams t ON t.id = pl.team_id
    LEFT JOIN league_teams t2 ON t2.id = pap.team_id
    WHERE pap.league = ?
    GROUP BY pap.award_category, pick_key
    ORDER BY pap.award_category, pick_count DESC
  `).all(...poolArgs, code);

  const totalByAward = {};
  for (const r of awardRows) totalByAward[r.award_category] = (totalByAward[r.award_category] || 0) + r.pick_count;
  const picksByAward = {};
  for (const r of awardRows) {
    picksByAward[r.award_category] ||= [];
    if (picksByAward[r.award_category].length < 5) {
      picksByAward[r.award_category].push({
        player_id: r.player_id, player_name: r.player_name,
        team_name: r.team_name, team_code: r.team_code, crest_url: r.crest_url,
        pick_count: r.pick_count,
        percentage: totalByAward[r.award_category] > 0 ? Math.round((r.pick_count / totalByAward[r.award_category]) * 100) : 0,
      });
    }
  }
  const awards = (L.awards || []).map((a) => ({ key: a.key, label: a.label, type: a.type, picks: picksByAward[a.key] || [] }));

  // Mirror the WC global stat: totalPlayers = number of members who made a winner pick.
  const totalPlayers = winner.teams.reduce((s, t) => s + t.pick_count, 0);

  return { sport: L.sport, totalPlayers, winner, groups, awards };
}

// Pool-wide pick distributions for a league pool — the league analog of the WC /stats/* endpoints.
// Powers the Stats page: who the pool backs to win, zone/slot popularity, and award picks.
app.get("/api/league/:code/pick-stats", resolveLeague, (req, res) => {
  const poolId = req.query.pool_id;
  if (!poolId) return res.status(400).json({ error: "pool_id required" });
  res.json(computeLeaguePickStats(req.league, req.params.code, poolId));
});

// Community-wide (all pools) pick distributions for a league — the league analog of the WC
// /api/stats/global endpoint. Powers "Community Predictions" on the pool-select screen.
app.get("/api/league/:code/community-stats", resolveLeague, (req, res) => {
  res.json(computeLeaguePickStats(req.league, req.params.code, null));
});

app.get("/api/league/:code/player-award-picks/:participantId", resolveLeague, (req, res) => {
  const { code } = req.params;
  const { pool_id } = req.query;
  const pool = pool_id ? db.prepare("SELECT player_awards_locked, player_awards_voided FROM pools WHERE id = ?").get(pool_id) : null;
  const voided = !!(pool && pool.player_awards_voided);
  const lockedByAdmin = !!(pool && pool.player_awards_locked) || voided;
  const deadline = leaguePoolSeasonDeadline(code, pool_id);
  const locked = lockedByAdmin || leagueSeasonLocked(code, pool_id);

  const picks = db.prepare(`SELECT pap.*, p.name as player_name,
    COALESCE(t2.name, t.name) as team_name, COALESCE(t2.code, t.code) as team_code,
    COALESCE(t2.manager, t.manager) as manager
    FROM league_award_picks pap
    LEFT JOIN league_players p ON pap.player_id = p.id
    LEFT JOIN league_teams t ON p.team_id = t.id
    LEFT JOIN league_teams t2 ON pap.team_id = t2.id
    WHERE pap.participant_id = ? AND pap.league = ?`).all(req.params.participantId, code);

  const results = db.prepare(`SELECT par.*, p.name as player_name,
    COALESCE(t2.name, t.name) as team_name, COALESCE(t2.code, t.code) as team_code,
    COALESCE(t2.manager, t.manager) as manager
    FROM league_award_results par
    LEFT JOIN league_players p ON par.player_id = p.id
    LEFT JOIN league_teams t ON p.team_id = t.id
    LEFT JOIN league_teams t2 ON par.team_id = t2.id
    WHERE par.league = ?`).all(code);

  res.json({ picks, results, locked, lockedByAdmin, voided, deadline });
});

app.post("/api/league/:code/player-award-picks", resolveLeague, authenticateToken, (req, res) => {
  const { code } = req.params;
  const { participant_id, award_category, player_id, team_id } = req.body;
  if (!participant_id || !award_category) return res.status(400).json({ error: "participant_id and award_category required" });

  const award = req.league.awards.find((a) => a.key === award_category);
  if (!award) return res.status(400).json({ error: "Invalid award category" });
  const isManager = award.type === "manager";

  const participant = db.prepare("SELECT pool_id FROM participants WHERE id = ?").get(participant_id);
  if (participant) {
    const pool = db.prepare("SELECT player_awards_locked, player_awards_voided FROM pools WHERE id = ?").get(participant.pool_id);
    if (pool && (pool.player_awards_locked || pool.player_awards_voided)) return res.status(403).json({ error: "Player awards have been locked by your pool admin" });
    if (leagueSeasonLocked(code, participant.pool_id)) return res.status(403).json({ error: "Player awards are locked — the entry window for this pool has closed" });
  }

  if (isManager) {
    if (!team_id) return res.status(400).json({ error: "team_id required for this award" });
    db.prepare(`INSERT INTO league_award_picks (participant_id, league, award_category, team_id, player_id)
      VALUES (?, ?, ?, ?, NULL) ON CONFLICT(participant_id, league, award_category) DO UPDATE SET team_id=excluded.team_id, player_id=NULL, updated_at=datetime('now')`)
      .run(participant_id, code, award_category, team_id);
  } else {
    if (!player_id) return res.status(400).json({ error: "player_id required" });
    const player = db.prepare("SELECT team_id FROM league_players WHERE id = ? AND league = ?").get(player_id, code);
    db.prepare(`INSERT INTO league_award_picks (participant_id, league, award_category, player_id, team_id)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(participant_id, league, award_category) DO UPDATE SET player_id=excluded.player_id, team_id=excluded.team_id, updated_at=datetime('now')`)
      .run(participant_id, code, award_category, player_id, player?.team_id || null);
  }
  res.json({ success: true });
});

// Manual PL fixture sync
app.post("/api/admin/sync-pl-fixtures", requireAdminToken, async (req, res) => {
  try {
    const result = await syncPLFixtures();
    const count = db.prepare("SELECT COUNT(*) as c FROM league_matches WHERE league = 'epl2627'").get().c;

    // Surface *why* nothing imported so the admin button isn't a silent "0".
    if (result && result.ok === false) {
      const reasons = {
        no_api_key: "FOOTBALL_API_KEY is not set on the server (add it in Railway → Variables).",
        api_status: `football-data.org returned HTTP ${result.status} for PL season 2026 (free tier may not expose next season yet).`,
        api_empty: "football-data.org returned 0 fixtures for PL season 2026 — the schedule isn't published on that source yet.",
        exception: `Sync error: ${result.message}`,
      };
      return res.json({ error: reasons[result.reason] || "PL sync imported no fixtures.", matches: count });
    }

    // Imported OK but every row was skipped (e.g. team codes don't match our seed).
    if (result && result.ok && result.inserted + result.updated === 0 && result.skipped > 0) {
      const codes = result.unknownCodes?.length ? ` Unknown team codes: ${result.unknownCodes.join(", ")}.` : "";
      return res.json({ error: `API returned ${result.apiCount} fixtures but all ${result.skipped} were skipped.${codes}`, matches: count });
    }

    res.json({ success: true, matches: count, detail: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/sync-pl-squads", requireAdminToken, async (req, res) => {
  try {
    const result = await syncPLSquads();
    const players = db.prepare("SELECT COUNT(*) as c FROM league_players WHERE league = 'epl2627'").get().c;

    if (result && result.ok === false) {
      const reasons = {
        window_closed: "Transfer window is closed — squad/manager auto-refresh is frozen (edit PL_SQUAD_LOCK_DATE to reopen).",
        api_status: `premierleague.com (Pulselive) returned HTTP ${result.status}.`,
        api_empty: "premierleague.com returned 0 teams for the 26/27 season.",
        exception: `Sync error: ${result.message}`,
      };
      return res.json({ error: reasons[result.reason] || "PL squad sync did nothing.", players });
    }

    res.json({ success: true, players, detail: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual score sync + diagnostics
app.post("/api/admin/sync-scores", requireAdminToken, async (req, res) => {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) return res.json({ error: "FOOTBALL_API_KEY not set" });

  try {
    const apiRes = await fetch("https://api.football-data.org/v4/competitions/WC/matches?status=IN_PLAY,PAUSED,FINISHED", {
      headers: { "X-Auth-Token": apiKey },
    });
    if (!apiRes.ok) return res.json({ error: `API responded ${apiRes.status}` });

    const data = await apiRes.json();
    const apiMatches = (data.matches || []).map((m) => ({
      home: m.homeTeam?.tla, away: m.awayTeam?.tla,
      status: m.status, score: `${m.score?.fullTime?.home ?? "?"}-${m.score?.fullTime?.away ?? "?"}`,
    }));

    // Run the sync
    const { fetchLiveScores } = require("./scores");
    await fetchLiveScores();

    const dbStats = db.prepare("SELECT status, COUNT(*) as c FROM matches GROUP BY status").all();
    res.json({ api_matches: apiMatches.length, api_sample: apiMatches.slice(0, 10), db_stats: dbStats });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Diagnostic: what does football-data.org expose for La Liga (PD) on our key's tier? Returns
// each club's football-data tla + coach name so we can (a) decide whether to sync coaches from
// here instead of scraping, and (b) confirm the PD tlas for TLA_ALIASES.laliga2627. Read-only.
app.get("/api/admin/laliga-fd-probe", requireAdminToken, async (req, res) => {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) return res.json({ error: "FOOTBALL_API_KEY not set" });
  try {
    const r = await fetch("https://api.football-data.org/v4/competitions/PD/teams?season=2026", {
      headers: { "X-Auth-Token": apiKey },
    });
    if (!r.ok) return res.json({ error: `football-data returned ${r.status}`, body: (await r.text()).slice(0, 300) });
    const data = await r.json();
    const teams = (data.teams || []).map((t) => ({ tla: t.tla, name: t.shortName || t.name, coach: t.coach?.name || null }));
    res.json({ count: teams.length, coachesPresent: teams.filter((t) => t.coach).length, teams });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Client-side routing fallback
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`World Cup Pool API running on port ${PORT}`);
  startScoreRefresh();
  startPushJobs();
});
