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

// --- Auth ---

app.post("/api/auth/signup", (req, res) => {
  const { username, password, display_name } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: "Username is required" });
  if (!password || !password.trim()) return res.status(400).json({ error: "Password is required" });
  if (!display_name || !display_name.trim()) return res.status(400).json({ error: "Display name is required" });
  try {
    const result = db.prepare("INSERT INTO users (username, password, display_name) VALUES (?, ?, ?)").run(username.trim().toLowerCase(), password.trim(), display_name.trim());
    res.json({ id: result.lastInsertRowid, username: username.trim().toLowerCase(), display_name: display_name.trim() });
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
  const user = db.prepare("SELECT id, username, display_name, is_admin FROM users WHERE username = ? AND password = ?").get(username.trim().toLowerCase(), password.trim());
  if (!user) return res.status(401).json({ error: "Invalid username or password" });
  res.json(user);
});

// --- Admin ---

app.get("/api/admin/users", (req, res) => {
  const userId = req.query.user_id;
  const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  if (!user || !user.is_admin) return res.status(401).json({ error: "Not authorized" });

  const users = db.prepare("SELECT id, username, display_name, is_admin, created_at FROM users ORDER BY created_at DESC").all();
  res.json(users);
});

app.delete("/api/admin/users/:id", (req, res) => {
  const userId = req.query.user_id;
  const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  if (!user || !user.is_admin) return res.status(401).json({ error: "Not authorized" });

  const targetId = req.params.id;
  // Don't allow deleting yourself
  if (String(targetId) === String(userId)) return res.status(400).json({ error: "Cannot delete yourself" });

  // Delete all their data: knockout_predictions, group_predictions, predictions, participants, then user
  db.prepare("DELETE FROM knockout_predictions WHERE participant_id IN (SELECT id FROM participants WHERE user_id = ?)").run(targetId);
  db.prepare("DELETE FROM group_predictions WHERE participant_id IN (SELECT id FROM participants WHERE user_id = ?)").run(targetId);
  db.prepare("DELETE FROM predictions WHERE participant_id IN (SELECT id FROM participants WHERE user_id = ?)").run(targetId);
  db.prepare("DELETE FROM participants WHERE user_id = ?").run(targetId);
  db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
  res.json({ success: true });
});

app.get("/api/admin/pools", (req, res) => {
  const userId = req.query.user_id;
  const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  if (!user || !user.is_admin) return res.status(401).json({ error: "Not authorized" });

  const pools = db.prepare(`
    SELECT p.id, p.name, p.sport, p.tournament, p.created_at,
      (SELECT COUNT(*) FROM participants pt WHERE pt.pool_id = p.id) as user_count
    FROM pools p
    ORDER BY p.sport, p.tournament, p.created_at DESC
  `).all();
  res.json(pools);
});

app.delete("/api/admin/pools/:id", (req, res) => {
  const userId = req.query.user_id;
  const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  if (!user || !user.is_admin) return res.status(401).json({ error: "Not authorized" });

  const poolId = req.params.id;
  db.prepare("DELETE FROM knockout_predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM group_predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
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

app.get("/api/prediction-deadline", (req, res) => {
  const firstMatch = db.prepare("SELECT match_date FROM matches ORDER BY match_date ASC LIMIT 1").get();
  if (!firstMatch) return res.json({ deadline: null });
  res.json({ deadline: firstMatch.match_date });
});

app.post("/api/group-predictions", (req, res) => {
  const { participant_id, group_id, team1_id, team2_id } = req.body;

  // Check deadline - lock predictions before first match
  const firstMatch = db.prepare("SELECT match_date FROM matches ORDER BY match_date ASC LIMIT 1").get();
  if (firstMatch) {
    const deadline = new Date(firstMatch.match_date.replace(" ", "T"));
    if (new Date() >= deadline) {
      return res.status(403).json({ error: "Predictions are locked - the tournament has started" });
    }
  }

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

// --- Knockout Matches & Predictions ---

app.get("/api/knockout-matches", (req, res) => {
  const matches = db.prepare("SELECT * FROM knockout_matches ORDER BY id").all();
  res.json(matches);
});

app.get("/api/knockout-predictions/:participantId", (req, res) => {
  const predictions = db
    .prepare("SELECT * FROM knockout_predictions WHERE participant_id = ?")
    .all(req.params.participantId);
  res.json(predictions);
});

app.post("/api/knockout-predictions", (req, res) => {
  const { participant_id, match_id, predicted_winner } = req.body;
  if (!participant_id || !match_id || !predicted_winner) {
    return res.status(400).json({ error: "All fields are required" });
  }
  try {
    db.prepare(`
      INSERT INTO knockout_predictions (participant_id, match_id, predicted_winner)
      VALUES (?, ?, ?)
      ON CONFLICT(participant_id, match_id) DO UPDATE SET predicted_winner = excluded.predicted_winner
    `).run(participant_id, match_id, predicted_winner);
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

  // Get knockout data for scoring
  const koMatches = db.prepare("SELECT * FROM knockout_matches WHERE status = 'finished'").all();
  const allKoPredictions = db.prepare("SELECT * FROM knockout_predictions").all();

  const koPointsMap = { R32: 3, R16: 5, QF: 7, SF: 10, F: 15 };

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
      if (!q) continue; // group not finished yet
      const picked = [pred.team1_id, pred.team2_id];
      const correctCount = picked.filter((t) => q.includes(t)).length;
      if (correctCount === 2) { points += 5; groups_correct++; }
      else if (correctCount === 1) { points += 2; groups_half++; }
    }

    // Knockout prediction scoring
    const myKoPreds = allKoPredictions.filter((kp) => kp.participant_id === p.id);
    for (const kp of myKoPreds) {
      const match = koMatches.find((m) => m.id === kp.match_id);
      if (!match || !match.winner_team_id) continue;
      if (String(kp.predicted_winner) === String(match.winner_team_id)) {
        const roundPts = koPointsMap[match.round] || 0;
        ko_points += roundPts;
        ko_correct++;
      }
    }
    points += ko_points;

    return { id: p.id, name: p.name, points, groups_predicted, groups_correct, groups_half, ko_correct, ko_points };
  });

  leaderboard.sort((a, b) => b.points - a.points || b.groups_correct - a.groups_correct || a.name.localeCompare(b.name));
  res.json(leaderboard);
});

// --- Knockout Deadline ---

// Which two feeder matches must have winners before a match opens
const KO_PREREQUISITES = {
  "R16-1": ["R32-1", "R32-2"],  "R16-2": ["R32-3",  "R32-4"],
  "R16-3": ["R32-5", "R32-6"],  "R16-4": ["R32-7",  "R32-8"],
  "R16-5": ["R32-9", "R32-10"], "R16-6": ["R32-11", "R32-12"],
  "R16-7": ["R32-13","R32-14"], "R16-8": ["R32-15", "R32-16"],
  "QF-1":  ["R16-1", "R16-2"],  "QF-2":  ["R16-3",  "R16-4"],
  "QF-3":  ["R16-5", "R16-6"],  "QF-4":  ["R16-7",  "R16-8"],
  "SF-1":  ["QF-1",  "QF-2"],   "SF-2":  ["QF-3",   "QF-4"],
  "F":     ["SF-1",  "SF-2"],
};

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

app.get("/api/knockout-deadline", (req, res) => {
  const totalMatches = db.prepare("SELECT COUNT(*) as c FROM matches").get().c;
  const finishedMatches = db.prepare("SELECT COUNT(*) as c FROM matches WHERE status = 'finished'").get().c;
  const groupStageComplete = totalMatches > 0 && finishedMatches === totalMatches;

  const koMatches = db.prepare("SELECT * FROM knockout_matches").all();
  const koById = Object.fromEntries(koMatches.map((m) => [m.id, m]));
  const now = Date.now();

  const isMatchOpen = (matchId) => {
    const match = koById[matchId];
    if (!match) return false;
    if (match.status === "live" || match.status === "finished") return false;
    if (match.match_date) {
      const kickoff = new Date(match.match_date.replace(" ", "T")).getTime();
      if (now >= kickoff - TWELVE_HOURS_MS) return false;
    }
    const prereqs = KO_PREREQUISITES[matchId];
    if (!prereqs) return groupStageComplete; // R32 — opens when group stage done
    return prereqs.every((pid) => koById[pid]?.winner_team_id);
  };

  const openMatchIds = koMatches.filter((m) => isMatchOpen(m.id)).map((m) => m.id);
  res.json({ openMatchIds, groupStageComplete });
});

app.put("/api/admin/knockout-matches/:id", (req, res) => {
  const userId = req.query.user_id;
  const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  if (!user || !user.is_admin) return res.status(401).json({ error: "Not authorized" });
  const { match_date } = req.body;
  db.prepare("UPDATE knockout_matches SET match_date = ? WHERE id = ?").run(match_date || null, req.params.id);
  res.json({ success: true });
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
