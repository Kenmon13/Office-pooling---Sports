const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const { OAuth2Client } = require("google-auth-library");
const { Resend } = require("resend");
const JWT_SECRET = process.env.JWT_SECRET || "office-pooling-secret-change-me";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "719484309775-ooani0nttr0qeijov4ar50nk845364rt.apps.googleusercontent.com";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.APP_URL || "https://sportspooling.com";

// Seed on first run
require("./seed");
const { startScoreRefresh } = require("./scores");

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static build
app.use(express.static(path.join(__dirname, "public")));

// --- Auth ---

app.post("/api/auth/signup", (req, res) => {
  const { username, password, display_name } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: "Username is required" });
  if (!password || !password.trim()) return res.status(400).json({ error: "Password is required" });
  if (!display_name || !display_name.trim()) return res.status(400).json({ error: "Display name is required" });
  try {
    const hashed = bcrypt.hashSync(password.trim(), 10);
    const result = db.prepare("INSERT INTO users (username, password, display_name) VALUES (?, ?, ?)").run(username.trim().toLowerCase(), hashed, display_name.trim());
    const user = { id: result.lastInsertRowid, username: username.trim().toLowerCase(), display_name: display_name.trim(), is_admin: 0 };
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
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name } = payload;

    // Check if user already exists with this google_id
    let row = db.prepare("SELECT id, username, display_name, email, is_admin FROM users WHERE google_id = ?").get(googleId);

    if (!row && email) {
      // Check if a user with this email already exists (link accounts)
      row = db.prepare("SELECT id, username, display_name, email, is_admin FROM users WHERE email = ?").get(email);
      if (row) {
        // Link Google to existing account
        db.prepare("UPDATE users SET google_id = ? WHERE id = ?").run(googleId, row.id);
      }
    }

    if (!row) {
      // Create new user
      const username = `g_${googleId.slice(0, 12)}`;
      const displayName = name || email || "Google User";
      const result = db.prepare(
        "INSERT INTO users (username, password, display_name, email, google_id) VALUES (?, ?, ?, ?, ?)"
      ).run(username, "google-oauth-no-password", displayName, email || null, googleId);
      row = { id: result.lastInsertRowid, username, display_name: displayName, email: email || null, is_admin: 0 };
    }

    const user = { id: row.id, username: row.username, display_name: row.display_name, email: row.email, is_admin: row.is_admin };
    const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ ...user, token });
  } catch (err) {
    console.error("Google auth error:", err.message || err);
    res.status(401).json({ error: "Google authentication failed: " + (err.message || "unknown error") });
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
      const existing = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email.toLowerCase(), req.user.id);
      if (existing) return res.status(409).json({ error: "Email already linked to another account" });
    }
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email ? email.toLowerCase() : null, req.user.id);
  }
  if (username !== undefined) {
    if (!username || !username.trim()) return res.status(400).json({ error: "Username cannot be empty" });
    const existing = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(username.trim(), req.user.id);
    if (existing) return res.status(409).json({ error: "Username already taken" });
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(username.trim(), req.user.id);
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

// --- Admin ---

app.get("/api/admin/users", requireAdminToken, (req, res) => {
  const users = db.prepare("SELECT id, username, display_name, is_admin, created_at FROM users ORDER BY created_at DESC").all();
  res.json(users);
});

app.get("/api/admin/users/:id/pools", requireAdminToken, (req, res) => {
  const pools = db.prepare(`
    SELECT p.id, p.name, p.sport, p.tournament, p.is_public,
           EXISTS(SELECT 1 FROM pool_admins pa WHERE pa.pool_id = p.id AND pa.user_id = ?) as is_admin
    FROM participants part
    JOIN pools p ON p.id = part.pool_id
    WHERE part.user_id = ?
    ORDER BY p.name
  `).all(req.params.id, req.params.id);
  res.json(pools);
});

app.delete("/api/admin/users/:id", requireAdminToken, (req, res) => {
  const targetId = req.params.id;
  // Don't allow deleting yourself
  if (String(targetId) === String(req.user.id)) return res.status(400).json({ error: "Cannot delete yourself" });

  // Delete all their data
  db.prepare("DELETE FROM wc2022_champion_picks WHERE participant_id IN (SELECT id FROM participants WHERE user_id = ?)").run(targetId);
  db.prepare("DELETE FROM champion_picks WHERE participant_id IN (SELECT id FROM participants WHERE user_id = ?)").run(targetId);
  db.prepare("DELETE FROM knockout_predictions WHERE participant_id IN (SELECT id FROM participants WHERE user_id = ?)").run(targetId);
  db.prepare("DELETE FROM group_predictions WHERE participant_id IN (SELECT id FROM participants WHERE user_id = ?)").run(targetId);
  db.prepare("DELETE FROM predictions WHERE participant_id IN (SELECT id FROM participants WHERE user_id = ?)").run(targetId);
  db.prepare("DELETE FROM participants WHERE user_id = ?").run(targetId);
  db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
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
  db.prepare("DELETE FROM wc2022_champion_picks WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM champion_picks WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM wc2022_knockout_predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM wc2022_group_predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM knockout_predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM group_predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM participants WHERE pool_id = ?").run(poolId);
  db.prepare("DELETE FROM pool_admins WHERE pool_id = ?").run(poolId);
  db.prepare("DELETE FROM pools WHERE id = ?").run(poolId);
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
      return res.status(409).json({ error: "Pool name already taken" });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/pools/join", (req, res) => {
  const { name, password } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Pool name is required" });
  const pool = db.prepare("SELECT * FROM pools WHERE name = ?").get(name.trim());
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

// --- Player Awards Lock ---

app.put("/api/pools/:poolId/player-awards-lock", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const { locked } = req.body;
  db.prepare("UPDATE pools SET player_awards_locked = ? WHERE id = ?").run(locked ? 1 : 0, poolId);
  res.json({ success: true, player_awards_locked: locked ? 1 : 0 });
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
  const pool = db.prepare("SELECT player_awards_locked FROM pools WHERE id = ?").get(poolId);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  res.json({ player_awards_locked: pool.player_awards_locked });
});

app.put("/api/pools/:poolId/exact-scores", requirePoolAdmin, (req, res) => {
  const poolId = req.params.poolId;
  const { disabled } = req.body;
  db.prepare("UPDATE pools SET exact_scores_disabled = ? WHERE id = ?").run(disabled ? 1 : 0, poolId);
  res.json({ success: true, exact_scores_disabled: disabled ? 1 : 0 });
});

app.get("/api/pools/:poolId/exact-scores", (req, res) => {
  const poolId = req.params.poolId;
  const pool = db.prepare("SELECT exact_scores_disabled FROM pools WHERE id = ?").get(poolId);
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  res.json({ exact_scores_disabled: pool.exact_scores_disabled });
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

  // Check per-group deadlines — filter out groups whose first match has started
  const now = new Date();
  const groupFirstMatches = db.prepare("SELECT group_id, MIN(match_date) as first_match FROM matches GROUP BY group_id").all();
  const groupDeadlineMap = {};
  for (const gm of groupFirstMatches) groupDeadlineMap[gm.group_id] = gm.first_match;

  const lockedGroupNames = [];
  const saveable = predictions.filter((pred) => {
    const dl = groupDeadlineMap[pred.group_id];
    if (dl && now >= new Date(dl.replace(" ", "T"))) {
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
    const deadline = new Date(firstMatch.match_date.replace(" ", "T"));
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

app.post("/api/knockout-predictions", (req, res) => {
  const { participant_id, match_id, predicted_winner, predicted_home_score, predicted_away_score } = req.body;
  if (!participant_id || !match_id || !predicted_winner) {
    return res.status(400).json({ error: "All fields are required" });
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
  const matches = db.prepare("SELECT * FROM matches WHERE status = 'finished'").all();
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
      const q = qualified[pred.group_id];
      if (!q) continue;

      // 3-pick group with all groups done: combined 10/5/2/0 scoring
      if (pred.team3_id && allGroupsDone) {
        const qualSet = qualifyingByGroup[pred.group_id] || [];
        const picked = [pred.team1_id, pred.team2_id, pred.team3_id];
        const correctCount = picked.filter((t) => qualSet.includes(t)).length;
        if (correctCount === 3) { points += 10; groups_correct++; }
        else if (correctCount === 2) { points += 5; groups_half++; }
        else if (correctCount === 1) { points += 2; }
      } else {
        // 2-pick scoring (or 3rd-place qualifiers not yet determined)
        const picked = [pred.team1_id, pred.team2_id];
        const correctCount = picked.filter((t) => q.includes(t)).length;
        if (correctCount === 2) { points += 5; groups_correct++; }
        else if (correctCount === 1) { points += 2; groups_half++; }
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
      if (String(predictedTeamId) === String(match.winner_team_id)) {
        let roundPts = koPointsMap[match.round] || 0;
        if (!exactScoresDisabled &&
            kp.predicted_home_score !== null && kp.predicted_away_score !== null &&
            match.home_score !== null && match.away_score !== null &&
            kp.predicted_home_score === match.home_score && kp.predicted_away_score === match.away_score) {
          roundPts *= 2;
        }
        ko_points += roundPts;
        ko_correct++;
      }
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
    for (const ap of myAwardPicks) {
      const result = awardResults.find((r) => r.award_category === ap.award_category);
      if (!result) continue;
      if (ap.award_category === "fair_play") {
        if (ap.team_id && String(ap.team_id) === String(result.team_id)) player_awards_points += awardPointsMap.fair_play;
      } else {
        if (ap.player_id && String(ap.player_id) === String(result.player_id)) player_awards_points += awardPointsMap[ap.award_category];
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

  const isMatchOpen = (matchId) => {
    const match = koById[matchId];
    if (!match) return false;
    if (match.status === "live" || match.status === "finished") return false;
    if (match.match_date) {
      const kickoff = new Date(match.match_date.replace(" ", "T") + "Z").getTime();
      if (now >= kickoff - TWELVE_HOURS_MS) return false;
    }
    const prereqs = KO_PREREQUISITES[matchId];
    if (!prereqs) return groupStageComplete;
    return prereqs.every((pid) => koById[pid]?.winner_team_id);
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

// ── Admin: test pool management ──────────────────────────────────────────────

app.post("/api/admin/test/pool", requireAdminToken, (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: "name and password required" });
  try {
    const result = db.prepare("INSERT INTO pools (name, sport, tournament, password, is_test) VALUES (?, 'soccer', 'wc2022', ?, 1)").run(name.trim(), password.trim());
    res.json({ id: result.lastInsertRowid, name: name.trim(), sport: "soccer", tournament: "wc2022", is_test: 1 });
  } catch (err) {
    if (err.message.includes("UNIQUE")) return res.status(409).json({ error: "Pool name already taken" });
    res.status(500).json({ error: err.message });
  }
});

const TEST_NAMES = [
  "Alice","Bob","Charlie","Diana","Edward","Fatima","George","Hannah",
  "Ivan","Julia","Kevin","Laura","Michael","Nina","Oscar","Paula",
  "Quinn","Rachel","Samuel","Tina","Ulrich","Victoria","William","Xena",
  "Yusuf","Zara","Aaron","Bella","Carlos","Demi",
];

app.post("/api/admin/test/pool/:poolId/participants", requireAdminToken, (req, res) => {
  const { count = 5 } = req.body;
  const poolId = req.params.poolId;
  const pool = db.prepare("SELECT is_test FROM pools WHERE id = ?").get(poolId);
  if (!pool || !pool.is_test) return res.status(400).json({ error: "Not a test pool" });

  const existing = db.prepare("SELECT name FROM participants WHERE pool_id = ?").all(poolId).map((p) => p.name);
  const available = TEST_NAMES.filter((n) => !existing.includes(n));
  const toAdd = available.slice(0, Math.min(count, available.length));

  const insert = db.prepare("INSERT INTO participants (name, pool_id) VALUES (?, ?)");
  const added = [];
  for (const name of toAdd) {
    const result = insert.run(name, poolId);
    added.push({ id: result.lastInsertRowid, name });
  }
  res.json({ added });
});

app.post("/api/admin/test/pool/:poolId/randomize-picks", requireAdminToken, (req, res) => {
  const poolId = req.params.poolId;
  const pool = db.prepare("SELECT is_test FROM pools WHERE id = ?").get(poolId);
  if (!pool || !pool.is_test) return res.status(400).json({ error: "Not a test pool" });

  const participants = db.prepare("SELECT id FROM participants WHERE pool_id = ?").all(poolId);
  const groups = db.prepare("SELECT * FROM wc2022_groups").all();
  const teams = db.prepare("SELECT * FROM wc2022_teams").all();
  const koMatches = db.prepare("SELECT * FROM wc2022_knockout_matches").all();

  const upsertGp = db.prepare(`
    INSERT INTO wc2022_group_predictions (participant_id, group_id, team1_id, team2_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(participant_id, group_id) DO UPDATE SET team1_id=excluded.team1_id, team2_id=excluded.team2_id
  `);
  const upsertKp = db.prepare(`
    INSERT INTO wc2022_knockout_predictions (participant_id, match_id, predicted_winner)
    VALUES (?, ?, ?)
    ON CONFLICT(participant_id, match_id) DO UPDATE SET predicted_winner=excluded.predicted_winner
  `);
  const upsertChamp = db.prepare(`
    INSERT INTO wc2022_champion_picks (participant_id, team_id)
    VALUES (?, ?)
    ON CONFLICT(participant_id) DO UPDATE SET team_id=excluded.team_id
  `);

  const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);

  for (const p of participants) {
    for (const g of groups) {
      const groupTeams = shuffle(teams.filter((t) => t.group_id === g.id));
      upsertGp.run(p.id, g.id, groupTeams[0].id, groupTeams[1].id);
    }
    for (const m of koMatches) {
      const winner = Math.random() < 0.5 ? m.home_team_id : m.away_team_id;
      upsertKp.run(p.id, m.id, winner);
    }
    const randomTeam = teams[Math.floor(Math.random() * teams.length)];
    upsertChamp.run(p.id, randomTeam.id);
  }
  res.json({ success: true, participants: participants.length });
});

app.put("/api/admin/test/pool/:poolId/mock-date", requireAdminToken, (req, res) => {
  const { mock_date } = req.body;
  db.prepare("UPDATE pools SET mock_date = ? WHERE id = ? AND is_test = 1").run(mock_date || null, req.params.poolId);
  res.json({ success: true });
});

app.delete("/api/admin/test/pool/:poolId/mock-date", requireAdminToken, (req, res) => {
  db.prepare("UPDATE pools SET mock_date = NULL WHERE id = ? AND is_test = 1").run(req.params.poolId);
  res.json({ success: true });
});

// ── WC2022 data endpoints ────────────────────────────────────────────────────

app.get("/api/wc2022/groups", (req, res) => {
  const groups = db.prepare("SELECT * FROM wc2022_groups ORDER BY name").all();
  const teams = db.prepare("SELECT * FROM wc2022_teams ORDER BY name").all();
  res.json(groups.map((g) => ({ ...g, teams: teams.filter((t) => t.group_id === g.id) })));
});

app.get("/api/wc2022/matches", (req, res) => {
  const poolId = req.query.pool_id;
  const pool = poolId ? db.prepare("SELECT mock_date FROM pools WHERE id = ?").get(poolId) : null;
  const cutoff = pool?.mock_date || null;

  const matches = db.prepare(`
    SELECT m.*, g.name as group_name,
      ht.name as home_team, ht.code as home_code,
      at.name as away_team, at.code as away_code
    FROM wc2022_matches m
    JOIN wc2022_groups g ON m.group_id = g.id
    JOIN wc2022_teams ht ON m.home_team_id = ht.id
    JOIN wc2022_teams at ON m.away_team_id = at.id
    ORDER BY m.match_date, g.name, m.id
  `).all();

  // When a mock date is set, hide scores for matches that haven't kicked off yet
  const result = matches.map((m) => {
    if (cutoff && m.match_date > cutoff) {
      return { ...m, home_score: null, away_score: null, status: "upcoming" };
    }
    return m;
  });
  res.json(result);
});

app.get("/api/wc2022/standings", (req, res) => {
  const poolId = req.query.pool_id;
  const pool = poolId ? db.prepare("SELECT mock_date FROM pools WHERE id = ?").get(poolId) : null;
  const cutoff = pool?.mock_date || null;

  // Only count matches that have kicked off by effectiveNow
  const allMatches = db.prepare("SELECT * FROM wc2022_matches WHERE status = 'finished'").all();
  const matches = cutoff ? allMatches.filter((m) => m.match_date <= cutoff) : allMatches;
  const teams = db.prepare("SELECT * FROM wc2022_teams").all();
  const groups = db.prepare("SELECT * FROM wc2022_groups ORDER BY name").all();

  const stats = {};
  for (const t of teams) {
    stats[t.id] = { team_id: t.id, name: t.name, code: t.code, group_id: t.group_id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 };
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

  res.json(groups.map((g) => {
    const groupTeams = Object.values(stats)
      .filter((t) => t.group_id === g.id)
      .sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    const allFinished = groupTeams.every((t) => t.played >= 3);
    return { ...g, teams: groupTeams, qualified: allFinished ? [groupTeams[0]?.team_id, groupTeams[1]?.team_id] : [] };
  }));
});

app.get("/api/wc2022/knockout-matches", (req, res) => {
  const { pool_id } = req.query;
  let cutoff = null;
  if (pool_id) {
    const pool = db.prepare("SELECT mock_date FROM pools WHERE id = ?").get(pool_id);
    cutoff = pool?.mock_date || null;
  }
  if (!cutoff) cutoff = new Date().toISOString().slice(0, 16).replace("T", " ");

  const matches = db.prepare(`
    SELECT km.*,
      ht.name as home_team_name, ht.code as home_team_code,
      at.name as away_team_name, at.code as away_team_code,
      wt.name as winner_team_name
    FROM wc2022_knockout_matches km
    LEFT JOIN wc2022_teams ht ON km.home_team_id = ht.id
    LEFT JOIN wc2022_teams at ON km.away_team_id = at.id
    LEFT JOIN wc2022_teams wt ON km.winner_team_id = wt.id
    ORDER BY km.match_date
  `).all();

  const groupDone = cutoff >= LAST_2022_GROUP_DATE;
  const dateById = {};
  for (const m of matches) dateById[m.id] = m.match_date;

  res.json(matches.map((m) => {
    let teamsRevealed;
    if (m.round === "R16") {
      teamsRevealed = groupDone;
    } else {
      const prereqs = WC2022_KO_PREREQUISITES[m.id] || [];
      teamsRevealed = prereqs.every((pid) => dateById[pid] && dateById[pid] <= cutoff);
    }
    const matchPlayed = m.match_date && m.match_date <= cutoff;

    return {
      ...m,
      home_team_id:   teamsRevealed ? m.home_team_id   : null,
      home_team_name: teamsRevealed ? m.home_team_name : null,
      home_team_code: teamsRevealed ? m.home_team_code : null,
      away_team_id:   teamsRevealed ? m.away_team_id   : null,
      away_team_name: teamsRevealed ? m.away_team_name : null,
      away_team_code: teamsRevealed ? m.away_team_code : null,
      winner_team_id: matchPlayed ? m.winner_team_id : null,
      status:         matchPlayed ? m.status : "upcoming",
    };
  }));
});

const WC2022_KO_PREREQUISITES = {
  "22-QF-1": ["22-R16-1","22-R16-2"], "22-QF-2": ["22-R16-3","22-R16-4"],
  "22-QF-3": ["22-R16-5","22-R16-6"], "22-QF-4": ["22-R16-7","22-R16-8"],
  "22-SF-1": ["22-QF-1","22-QF-3"],   "22-SF-2": ["22-QF-2","22-QF-4"],
  "22-F":    ["22-SF-1","22-SF-2"],
};
const LAST_2022_GROUP_DATE = "2022-12-02 23:59";

app.get("/api/wc2022/knockout-deadline", (req, res) => {
  const poolId = req.query.pool_id;
  const pool = poolId ? db.prepare("SELECT mock_date FROM pools WHERE id = ?").get(poolId) : null;
  const effectiveNow = pool?.mock_date
    ? new Date(pool.mock_date.replace(" ", "T") + "Z").getTime()
    : Date.now();

  const koMatches = db.prepare("SELECT * FROM wc2022_knockout_matches").all();
  const koById = Object.fromEntries(koMatches.map((m) => [m.id, m]));

  const matchKickoff = (m) => m.match_date ? new Date(m.match_date.replace(" ", "T") + "Z").getTime() : null;
  const lastGroupMs = new Date(LAST_2022_GROUP_DATE.replace(" ", "T") + "Z").getTime();

  const isMatchOpen = (matchId) => {
    const match = koById[matchId];
    if (!match || !match.match_date) return false;
    const kickoff = matchKickoff(match);
    if (effectiveNow >= kickoff) return false; // past or at kickoff
    const prereqs = WC2022_KO_PREREQUISITES[matchId];
    if (!prereqs) return effectiveNow >= lastGroupMs; // R16: group stage must be done
    return prereqs.every((pid) => {
      const feeder = koById[pid];
      if (!feeder || !feeder.match_date) return false;
      return effectiveNow >= matchKickoff(feeder) + 3 * 3600 * 1000; // 3h after feeder kickoff
    });
  };

  const openMatchIds = koMatches.filter((m) => isMatchOpen(m.id)).map((m) => m.id);
  const matchMeta = {};
  for (const m of koMatches) {
    const prereqs = WC2022_KO_PREREQUISITES[m.id];
    let opensAfter = null;
    if (!prereqs) {
      opensAfter = LAST_2022_GROUP_DATE;
    } else {
      const feederDates = prereqs.map((pid) => koById[pid]?.match_date).filter(Boolean);
      opensAfter = feederDates.length ? feederDates.reduce((a, b) => (a > b ? a : b)) : null;
    }
    matchMeta[m.id] = { opensAfter, closesAt: m.match_date };
  }

  const groupStageComplete = effectiveNow >= lastGroupMs;
  const lastKoDate = koMatches.map((m) => m.match_date).filter(Boolean).reduce((a, b) => (a > b ? a : b), "");
  const koStageComplete = !!lastKoDate && effectiveNow >= new Date(lastKoDate.replace(" ", "T") + "Z").getTime();
  res.json({ openMatchIds, groupStageComplete, koStageComplete, matchMeta });
});

app.get("/api/wc2022/group-predictions/:participantId", (req, res) => {
  const preds = db.prepare(`
    SELECT gp.*, t1.name as team1_name, t1.code as team1_code,
      t2.name as team2_name, t2.code as team2_code
    FROM wc2022_group_predictions gp
    JOIN wc2022_teams t1 ON gp.team1_id = t1.id
    JOIN wc2022_teams t2 ON gp.team2_id = t2.id
    WHERE gp.participant_id = ?
  `).all(req.params.participantId);
  res.json(preds);
});

app.post("/api/wc2022/group-predictions", (req, res) => {
  const { participant_id, group_id, team1_id, team2_id } = req.body;
  if (!participant_id || !group_id || !team1_id || !team2_id) return res.status(400).json({ error: "All fields required" });
  if (team1_id === team2_id) return res.status(400).json({ error: "Must pick two different teams" });

  const participant = db.prepare("SELECT pool_id FROM participants WHERE id = ?").get(participant_id);
  if (!participant) return res.status(404).json({ error: "Participant not found" });
  const pool = db.prepare("SELECT mock_date FROM pools WHERE id = ?").get(participant.pool_id);
  const effectiveNow = pool?.mock_date ? new Date(pool.mock_date.replace(" ", "T") + "Z") : new Date();
  const firstMatch = new Date("2022-11-20T16:00:00Z");
  if (effectiveNow >= firstMatch) return res.status(403).json({ error: "Group predictions are locked" });

  const teams = db.prepare("SELECT id FROM wc2022_teams WHERE group_id = ? AND id IN (?, ?)").all(group_id, team1_id, team2_id);
  if (teams.length !== 2) return res.status(400).json({ error: "Teams must belong to this group" });

  db.prepare(`
    INSERT INTO wc2022_group_predictions (participant_id, group_id, team1_id, team2_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(participant_id, group_id) DO UPDATE SET team1_id=excluded.team1_id, team2_id=excluded.team2_id
  `).run(participant_id, group_id, team1_id, team2_id);
  res.json({ success: true });
});

app.get("/api/wc2022/knockout-predictions/:participantId", (req, res) => {
  const preds = db.prepare("SELECT * FROM wc2022_knockout_predictions WHERE participant_id = ?").all(req.params.participantId);
  res.json(preds);
});

app.post("/api/wc2022/knockout-predictions", (req, res) => {
  const { participant_id, match_id, predicted_winner, predicted_home_score, predicted_away_score } = req.body;
  if (!participant_id || !match_id || !predicted_winner) return res.status(400).json({ error: "All fields required" });
  db.prepare(`
    INSERT INTO wc2022_knockout_predictions (participant_id, match_id, predicted_winner, predicted_home_score, predicted_away_score)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(participant_id, match_id) DO UPDATE SET
      predicted_winner = excluded.predicted_winner,
      predicted_home_score = excluded.predicted_home_score,
      predicted_away_score = excluded.predicted_away_score
  `).run(participant_id, match_id, predicted_winner, predicted_home_score ?? null, predicted_away_score ?? null);
  res.json({ success: true });
});

app.get("/api/wc2022/leaderboard", (req, res) => {
  const poolId = req.query.pool_id;
  const pool = poolId ? db.prepare("SELECT mock_date, exact_scores_disabled FROM pools WHERE id = ?").get(poolId) : null;
  const effectiveNow = pool?.mock_date ? new Date(pool.mock_date.replace(" ", "T") + "Z") : new Date();
  const exactScoresDisabled22 = !!(pool && pool.exact_scores_disabled);

  const participants = poolId
    ? db.prepare("SELECT p.* FROM participants p WHERE p.pool_id = ?").all(poolId)
    : db.prepare("SELECT p.* FROM participants p").all();

  // Compute group qualifiers from WC2022 results filtered by effectiveNow
  const allGroupMatches = db.prepare("SELECT * FROM wc2022_matches WHERE status = 'finished'").all();
  const matches = allGroupMatches.filter((m) => !m.match_date || new Date(m.match_date.replace(" ", "T") + "Z") <= effectiveNow);
  const teams = db.prepare("SELECT * FROM wc2022_teams").all();
  const groups = db.prepare("SELECT * FROM wc2022_groups").all();
  const stats = {};
  for (const t of teams) stats[t.id] = { team_id: t.id, group_id: t.group_id, played: 0, gf: 0, ga: 0, points: 0 };
  for (const m of matches) {
    const h = stats[m.home_team_id], a = stats[m.away_team_id];
    if (!h || !a) continue;
    h.played++; a.played++; h.gf += m.home_score; h.ga += m.away_score; a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) { h.points += 3; } else if (m.away_score > m.home_score) { a.points += 3; } else { h.points++; a.points++; }
  }
  const qualified = {};
  for (const g of groups) {
    const gt = Object.values(stats).filter((t) => t.group_id === g.id).sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    qualified[g.id] = gt.every((t) => t.played >= 3) ? [gt[0]?.team_id, gt[1]?.team_id] : null;
  }

  const allGp = db.prepare("SELECT * FROM wc2022_group_predictions").all();
  const allKoMatches = db.prepare("SELECT * FROM wc2022_knockout_matches WHERE status = 'finished'").all();
  const koMatches = allKoMatches.filter((m) => !m.match_date || new Date(m.match_date.replace(" ", "T") + "Z") <= effectiveNow);
  const allKp = db.prepare("SELECT * FROM wc2022_knockout_predictions").all();
  const allChampionPicks22 = db.prepare("SELECT * FROM wc2022_champion_picks").all();
  const koPointsMap = { R16: 5, QF: 7, SF: 10, F: 15 };
  const finalMatch22 = koMatches.find((m) => m.id === "22-F" && m.winner_team_id);

  const leaderboard = participants.map((p) => {
    let points = 0, groups_correct = 0, groups_half = 0, ko_correct = 0, ko_points = 0;
    for (const pred of allGp.filter((gp) => gp.participant_id === p.id)) {
      const q = qualified[pred.group_id]; if (!q) continue;
      const correct = [pred.team1_id, pred.team2_id].filter((t) => q.includes(t)).length;
      if (correct === 2) { points += 5; groups_correct++; } else if (correct === 1) { points += 2; groups_half++; }
    }
    for (const kp of allKp.filter((kp) => kp.participant_id === p.id)) {
      const match = koMatches.find((m) => m.id === kp.match_id);
      if (!match?.winner_team_id) continue;
      if (String(kp.predicted_winner) === String(match.winner_team_id)) {
        let roundPts = koPointsMap[match.round] || 0;
        if (!exactScoresDisabled22 &&
            kp.predicted_home_score !== null && kp.predicted_away_score !== null &&
            match.home_score !== null && match.away_score !== null &&
            kp.predicted_home_score === match.home_score && kp.predicted_away_score === match.away_score) {
          roundPts *= 2;
        }
        ko_points += roundPts; ko_correct++;
      }
    }
    points += ko_points;

    const champPick = allChampionPicks22.find((cp) => cp.participant_id === p.id);
    let champion_bonus = 0;
    if (champPick?.team_id && finalMatch22 && String(champPick.team_id) === String(finalMatch22.winner_team_id)) {
      champion_bonus = 20;
    }
    const champion_change_cost = champPick?.change_cost || 0;
    points += champion_bonus - champion_change_cost;

    return { id: p.id, name: p.name, points, groups_correct, groups_half, ko_correct, ko_points, champion_bonus, champion_change_cost };
  });

  leaderboard.sort((a, b) => b.points - a.points || b.groups_correct - a.groups_correct || a.name.localeCompare(b.name));
  res.json(leaderboard);
});

app.get("/api/wc2022/prediction-deadline", (req, res) => {
  const poolId = req.query.pool_id;
  const pool = poolId ? db.prepare("SELECT mock_date FROM pools WHERE id = ?").get(poolId) : null;
  const effectiveNow = pool?.mock_date ? new Date(pool.mock_date.replace(" ", "T") + "Z") : new Date();
  const deadline = "2022-11-20 16:00";
  const locked = effectiveNow >= new Date(deadline.replace(" ", "T") + "Z");
  res.json({ deadline, locked });
});

app.get("/api/admin/test/pools", requireAdminToken, (req, res) => {
  const pools = db.prepare(`
    SELECT p.id, p.name, p.mock_date,
      (SELECT COUNT(*) FROM participants pt WHERE pt.pool_id = p.id) as participant_count
    FROM pools p WHERE p.is_test = 1 ORDER BY p.created_at DESC
  `).all();
  res.json(pools);
});

// ─────────────────────────────────────────────────────────────────────────────

// ── Champion Picks ───────────────────────────────────────────────────────────

const FIRST_2022_GROUP_MS = new Date("2022-11-20T16:00:00Z").getTime();
const LAST_2022_GROUP_MS  = new Date(LAST_2022_GROUP_DATE.replace(" ", "T") + "Z").getTime();
const FIRST_2022_R16_MS   = new Date("2022-12-03T19:00:00Z").getTime();

app.get("/api/wc2022/champion-pick/:participantId", (req, res) => {
  const { participantId } = req.params;
  const { pool_id } = req.query;
  const pool = pool_id ? db.prepare("SELECT mock_date FROM pools WHERE id = ?").get(pool_id) : null;
  const effectiveNow = pool?.mock_date ? new Date(pool.mock_date.replace(" ", "T") + "Z").getTime() : Date.now();
  // Two open windows: before group stage starts, and after group stage ends before first KO
  const inPreGroupWindow  = effectiveNow < FIRST_2022_GROUP_MS;
  const inPostGroupWindow = effectiveNow >= LAST_2022_GROUP_MS && effectiveNow < FIRST_2022_R16_MS;
  const windowOpen = inPreGroupWindow || inPostGroupWindow;
  const lockedDuringGroups = !windowOpen && effectiveNow < FIRST_2022_R16_MS;
  const pick = db.prepare(`
    SELECT cp.*, t.name as team_name, t.code as team_code
    FROM wc2022_champion_picks cp
    LEFT JOIN wc2022_teams t ON cp.team_id = t.id
    WHERE cp.participant_id = ?
  `).get(participantId);
  const canInitialPick = windowOpen && !pick;
  const canChange = windowOpen && !!pick;
  // 10pt fee applies only on the first change made in the post-group window
  const feePaid = pick && pick.change_cost > 0;
  const changeCost = (inPostGroupWindow && !feePaid) ? 5 : 0;
  const finalMatch = db.prepare("SELECT winner_team_id, match_date FROM wc2022_knockout_matches WHERE id = '22-F'").get();
  const finalPlayed = finalMatch?.winner_team_id &&
    (!pool?.mock_date || !finalMatch.match_date || effectiveNow >= new Date(finalMatch.match_date.replace(" ", "T") + "Z").getTime());
  const pickCorrect = !!(pick && finalPlayed && String(pick.team_id) === String(finalMatch.winner_team_id));
  res.json({ canInitialPick, canChange, locked: lockedDuringGroups, changeCost, pick: pick || null, pickCorrect });
});

app.post("/api/wc2022/champion-pick", (req, res) => {
  const { participant_id, team_id, pool_id } = req.body;
  if (!participant_id || !team_id) return res.status(400).json({ error: "participant_id and team_id required" });
  const pool = pool_id ? db.prepare("SELECT mock_date FROM pools WHERE id = ?").get(pool_id) : null;
  const effectiveNow = pool?.mock_date ? new Date(pool.mock_date.replace(" ", "T") + "Z").getTime() : Date.now();
  const inPreGroupWindow  = effectiveNow < FIRST_2022_GROUP_MS;
  const inPostGroupWindow = effectiveNow >= LAST_2022_GROUP_MS && effectiveNow < FIRST_2022_R16_MS;
  if (!inPreGroupWindow && !inPostGroupWindow) return res.status(403).json({ error: "Champion pick window is closed" });
  const existing = db.prepare("SELECT * FROM wc2022_champion_picks WHERE participant_id = ?").get(participant_id);
  // Charge 5pt fee on the first pick/change made in the post-group window, even if no prior pick
  const isFirstPostGroupChange = inPostGroupWindow && (existing?.change_cost || 0) === 0;
  const newChangeCost = isFirstPostGroupChange ? 5 : (existing?.change_cost || 0);
  const isChanged = existing ? 1 : 0;
  db.prepare(`
    INSERT INTO wc2022_champion_picks (participant_id, team_id, is_changed, change_cost)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(participant_id) DO UPDATE SET team_id=excluded.team_id, is_changed=excluded.is_changed, change_cost=excluded.change_cost, updated_at=datetime('now')
  `).run(participant_id, team_id, isChanged, newChangeCost);
  res.json({ success: true });
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
  // Check if admin has locked champion pick window 2
  const pool = pool_id ? db.prepare("SELECT champion_w2_locked FROM pools WHERE id = ?").get(pool_id) : null;
  const w2AdminLocked = !!(pool && pool.champion_w2_locked && inPostGroupWindow);
  const windowOpen = inPreGroupWindow || (inPostGroupWindow && !w2AdminLocked);
  const lockedDuringGroups = groupStarted && !groupStageComplete;
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
  res.json({ canInitialPick, canChange, locked: lockedDuringGroups, w2AdminLocked, changeCost, pick: pick || null, pickCorrect });
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
  // Check if admin has locked champion pick window 2
  if (inPostGroupWindow) {
    const participant = db.prepare("SELECT pool_id FROM participants WHERE id = ?").get(participant_id);
    if (participant) {
      const pool = db.prepare("SELECT champion_w2_locked FROM pools WHERE id = ?").get(participant.pool_id);
      if (pool && pool.champion_w2_locked) return res.status(403).json({ error: "Champion pick window 2 has been locked by your pool admin" });
    }
  }
  if (!inPreGroupWindow && !inPostGroupWindow) return res.status(403).json({ error: "Champion pick window is closed" });
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

  const pool = pool_id ? db.prepare("SELECT player_awards_locked FROM pools WHERE id = ?").get(pool_id) : null;
  const locked = !!(pool && pool.player_awards_locked);

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

  res.json({ picks, results, locked });
});

app.post("/api/player-award-picks", (req, res) => {
  const { participant_id, award_category, player_id, team_id } = req.body;
  if (!participant_id || !award_category) return res.status(400).json({ error: "participant_id and award_category required" });

  const validCategories = ["golden_ball", "golden_boot", "golden_glove", "young_player", "fair_play"];
  if (!validCategories.includes(award_category)) return res.status(400).json({ error: "Invalid award category" });

  // Check lock
  const participant = db.prepare("SELECT pool_id FROM participants WHERE id = ?").get(participant_id);
  if (participant) {
    const pool = db.prepare("SELECT player_awards_locked FROM pools WHERE id = ?").get(participant.pool_id);
    if (pool && pool.player_awards_locked) return res.status(403).json({ error: "Player awards have been locked by your pool admin" });
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

app.get("/api/wc2022/history/:participantId", (req, res) => {
  const { participantId } = req.params;
  const { pool_id } = req.query;
  const pool = pool_id ? db.prepare("SELECT mock_date, exact_scores_disabled FROM pools WHERE id = ?").get(pool_id) : null;
  const effectiveNow = pool?.mock_date ? new Date(pool.mock_date.replace(" ", "T") + "Z") : new Date();
  const effectiveMs = effectiveNow.getTime();
  const exactScoresDisabledH22 = !!(pool && pool.exact_scores_disabled);

  const allGMatches = db.prepare("SELECT * FROM wc2022_matches WHERE status='finished'").all()
    .filter((m) => !m.match_date || new Date(m.match_date.replace(" ", "T") + "Z").getTime() <= effectiveMs);
  const allTeams22 = db.prepare("SELECT * FROM wc2022_teams").all();
  const allGroups22 = db.prepare("SELECT * FROM wc2022_groups").all();
  const teamById = Object.fromEntries(allTeams22.map((t) => [t.id, t]));

  const stats22 = {};
  for (const t of allTeams22) stats22[t.id] = { team_id: t.id, group_id: t.group_id, played: 0, gf: 0, ga: 0, points: 0 };
  for (const m of allGMatches) {
    const h = stats22[m.home_team_id], a = stats22[m.away_team_id];
    if (!h || !a) continue;
    h.played++; a.played++; h.gf += m.home_score; h.ga += m.away_score; a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) h.points += 3; else if (m.away_score > m.home_score) a.points += 3; else { h.points++; a.points++; }
  }

  const events = [];
  const groupLastDate = {};
  for (const m of allGMatches) {
    const gid = m.group_id;
    if (!groupLastDate[gid] || m.match_date > groupLastDate[gid]) groupLastDate[gid] = m.match_date;
  }

  for (const g of allGroups22) {
    const gt = Object.values(stats22).filter((t) => t.group_id === g.id).sort((a, b) => b.points - a.points || (b.gf-b.ga)-(a.gf-a.ga) || b.gf-a.gf);
    if (!gt.every((t) => t.played >= 3)) continue;
    const qualified = [gt[0]?.team_id, gt[1]?.team_id];
    const lastDate = groupLastDate[g.id];
    if (!lastDate || new Date(lastDate.replace(" ", "T") + "Z").getTime() > effectiveMs) continue;
    const pred = db.prepare("SELECT * FROM wc2022_group_predictions WHERE participant_id = ? AND group_id = ?").get(participantId, g.id);
    if (!pred) continue;
    const correct = [pred.team1_id, pred.team2_id].filter((t) => qualified.includes(t)).length;
    const pts = correct === 2 ? 5 : correct === 1 ? 2 : 0;
    const t1 = teamById[pred.team1_id]?.name || "?";
    const t2 = teamById[pred.team2_id]?.name || "?";
    const label = correct === 2 ? "Both correct" : correct === 1 ? "1 correct" : "None correct";
    events.push({ event_date: lastDate, type: "group", description: `Group ${g.name}: ${t1} & ${t2} — ${label}`, pts_change: pts });
  }

  const allKoMatches22 = db.prepare("SELECT * FROM wc2022_knockout_matches WHERE status='finished'").all()
    .filter((m) => !m.match_date || new Date(m.match_date.replace(" ", "T") + "Z").getTime() <= effectiveMs);
  const koPointsMap = { R16: 5, QF: 7, SF: 10, F: 15 };
  const koRoundLabels = { R16: "Round of 16", QF: "Quarter-Final", SF: "Semi-Final", F: "Final" };
  for (const m of allKoMatches22) {
    const kp = db.prepare("SELECT * FROM wc2022_knockout_predictions WHERE participant_id = ? AND match_id = ?").get(participantId, m.id);
    if (!kp) continue;
    const home = teamById[m.home_team_id]?.name || "?";
    const away = teamById[m.away_team_id]?.name || "?";
    const winner = teamById[m.winner_team_id]?.name || "?";
    const roundLabel = koRoundLabels[m.round] || m.round;
    const basePts = koPointsMap[m.round] || 0;
    let pts = 0;
    let desc = `${roundLabel}: ${home} vs ${away}`;
    if (String(kp.predicted_winner) === String(m.winner_team_id)) {
      pts = basePts;
      const scoreCorrect = !exactScoresDisabledH22 &&
                           kp.predicted_home_score !== null && kp.predicted_away_score !== null &&
                           m.home_score !== null && m.away_score !== null &&
                           kp.predicted_home_score === m.home_score && kp.predicted_away_score === m.away_score;
      if (scoreCorrect) pts *= 2;
      desc += ` — predicted ${winner} ✓${scoreCorrect ? " (correct score, ×2)" : ""}`;
    } else {
      const predictedTeam = teamById[kp.predicted_winner]?.name || "?";
      desc += ` — predicted ${predictedTeam} ✗`;
    }
    events.push({ event_date: m.match_date, type: "ko", description: desc, pts_change: pts });
  }

  const champPick = db.prepare(`
    SELECT cp.*, t.name as team_name
    FROM wc2022_champion_picks cp LEFT JOIN wc2022_teams t ON cp.team_id = t.id
    WHERE cp.participant_id = ?
  `).get(participantId);
  if (champPick?.team_id && champPick.updated_at) {
    const pickDate = champPick.updated_at.slice(0, 16);
    if (champPick.change_cost > 0) {
      events.push({ event_date: pickDate, type: "champion_change", description: `Winner pick: ${champPick.team_name} (−${champPick.change_cost} pts fee)`, pts_change: -champPick.change_cost });
    } else {
      events.push({ event_date: pickDate, type: "champion_pick", description: `Winner pick: ${champPick.team_name}`, pts_change: 0 });
    }
    const finalMatch = allKoMatches22.find((m) => m.id === "22-F");
    if (finalMatch?.winner_team_id && String(champPick.team_id) === String(finalMatch.winner_team_id)) {
      events.push({ event_date: finalMatch.match_date, type: "champion_bonus", description: `Winner pick correct: ${champPick.team_name} won the tournament!`, pts_change: 20 });
    }
  }

  events.sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""));
  let running = 0;
  for (const e of events) { running += e.pts_change; e.running_total = running; }
  res.json(events);
});

app.get("/api/history/:participantId", (req, res) => {
  const { participantId } = req.params;
  const { pool_id } = req.query;
  const events = [];
  const poolRowH = pool_id ? db.prepare("SELECT exact_scores_disabled FROM pools WHERE id = ?").get(pool_id) : null;
  const exactScoresDisabledH = !!(poolRowH && poolRowH.exact_scores_disabled);

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

    if (pred.team3_id && allGroupsDoneH) {
      // 3-pick combined scoring
      const qualSet = [gt[0]?.team_id, gt[1]?.team_id];
      if (gt.length >= 3 && thirdQualifiersH.has(gt[2].team_id)) qualSet.push(gt[2].team_id);
      const picked = [pred.team1_id, pred.team2_id, pred.team3_id];
      const correct = picked.filter((t) => qualSet.includes(t)).length;
      const pts = correct === 3 ? 10 : correct === 2 ? 5 : correct === 1 ? 2 : 0;
      const names = picked.map((t) => teamById[t]?.name || "?").join(", ");
      const label = correct === 3 ? "All 3 correct" : `${correct} correct`;
      events.push({ event_date: lastDate, type: "group", description: `Group ${g.name}: ${names} — ${label}`, pts_change: pts });
    } else {
      // 2-pick scoring
      const qualified = [gt[0]?.team_id, gt[1]?.team_id];
      const correct = [pred.team1_id, pred.team2_id].filter((t) => qualified.includes(t)).length;
      const pts = correct === 2 ? 5 : correct === 1 ? 2 : 0;
      const t1 = teamById[pred.team1_id]?.name || "?";
      const t2 = teamById[pred.team2_id]?.name || "?";
      const label = correct === 2 ? "Both correct" : correct === 1 ? "1 correct" : "None correct";
      events.push({ event_date: lastDate, type: "group", description: `Group ${g.name}: ${t1} & ${t2} — ${label}`, pts_change: pts });
    }
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
      if (String(predictedTeamId) === String(m.winner_team_id)) {
        pts = basePts;
        const scoreCorrect = !exactScoresDisabledH &&
                             kp.predicted_home_score !== null && kp.predicted_away_score !== null &&
                             m.home_score !== null && m.away_score !== null &&
                             kp.predicted_home_score === m.home_score && kp.predicted_away_score === m.away_score;
        if (scoreCorrect) pts *= 2;
        desc += ` — predicted ${teamById[m.winner_team_id]?.name || "?"} ✓${scoreCorrect ? " (correct score, ×2)" : ""}`;
      } else {
        const predictedTeam = teamById[m.winner_team_id]?.name || "?";
        desc += ` — wrong prediction ✗`;
        void predictedTeam;
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
      const pts = isCorrect ? awardPointsMap[ap.award_category] : 0;
      const winnerName = ap.award_category === "fair_play" ? result.team_name : result.player_name;
      const desc = isCorrect
        ? `${label}: ${pickName} ✓`
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

  const totalPlayers = champTotal;

  res.json({ champions, groups: Object.values(groups), totalPlayers });
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

// Client-side routing fallback
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`World Cup Pool API running on port ${PORT}`);
  startScoreRefresh();
});
