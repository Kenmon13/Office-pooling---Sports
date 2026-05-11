const path = require("path");
const express = require("express");
const cors = require("cors");
const db = require("./db");

// Seed on first run
require("./seed");
const { startScoreRefresh } = require("./scores");

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static build
app.use(express.static(path.join(__dirname, "public")));

// --- Admin ---

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "messi";

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const pools = db.prepare(`
      SELECT p.id, p.name, p.sport, p.tournament, p.created_at,
        (SELECT COUNT(*) FROM participants pt WHERE pt.pool_id = p.id) as user_count
      FROM pools p
      ORDER BY p.sport, p.tournament, p.created_at DESC
    `).all();
    return res.json({ success: true, pools });
  }
  res.status(401).json({ error: "Invalid admin credentials" });
});

app.delete("/api/admin/pools/:id", (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid admin credentials" });
  }
  const poolId = req.params.id;
  db.prepare("DELETE FROM predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM participants WHERE pool_id = ?").run(poolId);
  db.prepare("DELETE FROM pools WHERE id = ?").run(poolId);
  res.json({ success: true });
});

// --- Pools ---

app.post("/api/pools", (req, res) => {
  const { name, sport, tournament, password } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Pool name is required" });
  if (!password || !password.trim()) return res.status(400).json({ error: "Password is required" });
  try {
    const result = db.prepare("INSERT INTO pools (name, sport, tournament, password) VALUES (?, ?, ?, ?)").run(name.trim(), sport || "soccer", tournament || "wc2026", password.trim());
    res.json({ id: result.lastInsertRowid, name: name.trim(), sport: sport || "soccer", tournament: tournament || "wc2026" });
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
  if (!password || !password.trim()) return res.status(400).json({ error: "Password is required" });
  const pool = db.prepare("SELECT * FROM pools WHERE name = ?").get(name.trim());
  if (!pool) return res.status(404).json({ error: "Pool not found" });
  if (pool.password !== password.trim()) return res.status(401).json({ error: "Wrong password" });
  res.json({ id: pool.id, name: pool.name, sport: pool.sport, tournament: pool.tournament });
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

app.post("/api/participants", (req, res) => {
  const { name, pool_id } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }
  try {
    const result = db.prepare("INSERT INTO participants (name, pool_id) VALUES (?, ?)").run(name.trim(), pool_id || null);
    res.json({ id: result.lastInsertRowid, name: name.trim(), pool_id: pool_id || null });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "Name already taken in this pool" });
    }
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

app.get("/api/group-predictions/:participantId", (req, res) => {
  const predictions = db
    .prepare(`
      SELECT gp.*, t1.name as team1_name, t1.code as team1_code,
        t2.name as team2_name, t2.code as team2_code
      FROM group_predictions gp
      JOIN teams t1 ON gp.team1_id = t1.id
      JOIN teams t2 ON gp.team2_id = t2.id
      WHERE gp.participant_id = ?
    `)
    .all(req.params.participantId);
  res.json(predictions);
});

app.post("/api/group-predictions", (req, res) => {
  const { participant_id, group_id, team1_id, team2_id } = req.body;

  if (!participant_id || !group_id || !team1_id || !team2_id) {
    return res.status(400).json({ error: "All fields are required" });
  }
  if (team1_id === team2_id) {
    return res.status(400).json({ error: "Must pick two different teams" });
  }

  // Check both teams belong to this group
  const teams = db.prepare("SELECT id FROM teams WHERE group_id = ? AND id IN (?, ?)").all(group_id, team1_id, team2_id);
  if (teams.length !== 2) {
    return res.status(400).json({ error: "Teams must belong to this group" });
  }

  try {
    db.prepare(`
      INSERT INTO group_predictions (participant_id, group_id, team1_id, team2_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(participant_id, group_id) DO UPDATE SET team1_id = excluded.team1_id, team2_id = excluded.team2_id
    `).run(participant_id, group_id, team1_id, team2_id);
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
  res.json(result);
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

  // Get participants
  let participants;
  if (poolId) {
    participants = db.prepare("SELECT * FROM participants WHERE pool_id = ?").all(poolId);
  } else {
    participants = db.prepare("SELECT * FROM participants").all();
  }

  // Get all group predictions
  const allPredictions = db.prepare("SELECT * FROM group_predictions").all();

  const leaderboard = participants.map((p) => {
    const myPreds = allPredictions.filter((gp) => gp.participant_id === p.id);
    let points = 0;
    let groups_correct = 0;
    let groups_half = 0;
    let groups_predicted = myPreds.length;

    for (const pred of myPreds) {
      const q = qualified[pred.group_id];
      if (!q) continue; // group not finished yet
      const picked = [pred.team1_id, pred.team2_id];
      const correctCount = picked.filter((t) => q.includes(t)).length;
      if (correctCount === 2) { points += 5; groups_correct++; }
      else if (correctCount === 1) { points += 2; groups_half++; }
    }

    return { id: p.id, name: p.name, points, groups_predicted, groups_correct, groups_half };
  });

  leaderboard.sort((a, b) => b.points - a.points || b.groups_correct - a.groups_correct || a.name.localeCompare(b.name));
  res.json(leaderboard);
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
