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

app.get("/api/admin/pools", (req, res) => {
  const userId = req.query.user_id;
  const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  if (!user || !user.is_admin) return res.status(401).json({ error: "Not authorized" });

  const pools = db.prepare(`
    SELECT p.id, p.name, p.sport, p.tournament, p.is_test, p.created_at,
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
  db.prepare("DELETE FROM wc2022_champion_picks WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM champion_picks WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM wc2022_knockout_predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM wc2022_group_predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM knockout_predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM group_predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM predictions WHERE participant_id IN (SELECT id FROM participants WHERE pool_id = ?)").run(poolId);
  db.prepare("DELETE FROM participants WHERE pool_id = ?").run(poolId);
  db.prepare("DELETE FROM pools WHERE id = ?").run(poolId);
  res.json({ success: true });
});

// --- Pools ---

app.post("/api/pools", (req, res) => {
  const { name, sport, tournament, password, is_public } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Pool name is required" });
  if (!is_public && (!password || !password.trim())) return res.status(400).json({ error: "Password is required" });
  try {
    const pwd = is_public ? "" : password.trim();
    const result = db.prepare("INSERT INTO pools (name, sport, tournament, password, is_public) VALUES (?, ?, ?, ?, ?)").run(name.trim(), sport || "soccer", tournament || "wc2026", pwd, is_public ? 1 : 0);
    res.json({ id: result.lastInsertRowid, name: name.trim(), sport: sport || "soccer", tournament: tournament || "wc2026", is_public: is_public ? 1 : 0 });
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
  const allChampionPicks = db.prepare("SELECT * FROM champion_picks").all();

  const koPointsMap = { R32: 3, R16: 5, QF: 7, SF: 10, F: 15 };
  const finalMatch = koMatches.find((m) => m.id === "F" && m.winner_team_id);

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
      const picked = [pred.team1_id, pred.team2_id];
      const correctCount = picked.filter((t) => q.includes(t)).length;
      if (correctCount === 2) { points += 5; groups_correct++; }
      else if (correctCount === 1) { points += 2; groups_half++; }
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
        if (kp.predicted_home_score !== null && kp.predicted_away_score !== null &&
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

    return { id: p.id, name: p.name, points, groups_predicted, groups_correct, groups_half, ko_correct, ko_points, champion_bonus, champion_change_cost };
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
    return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
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

function requireAdmin(req, res) {
  const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.query.user_id);
  if (!user || !user.is_admin) { res.status(401).json({ error: "Not authorized" }); return null; }
  return user;
}

app.post("/api/admin/test/pool", (req, res) => {
  if (!requireAdmin(req, res)) return;
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

app.post("/api/admin/test/pool/:poolId/participants", (req, res) => {
  if (!requireAdmin(req, res)) return;
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

app.post("/api/admin/test/pool/:poolId/randomize-picks", (req, res) => {
  if (!requireAdmin(req, res)) return;
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

app.put("/api/admin/test/pool/:poolId/mock-date", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { mock_date } = req.body;
  db.prepare("UPDATE pools SET mock_date = ? WHERE id = ? AND is_test = 1").run(mock_date || null, req.params.poolId);
  res.json({ success: true });
});

app.delete("/api/admin/test/pool/:poolId/mock-date", (req, res) => {
  if (!requireAdmin(req, res)) return;
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
  const pool = poolId ? db.prepare("SELECT mock_date FROM pools WHERE id = ?").get(poolId) : null;
  const effectiveNow = pool?.mock_date ? new Date(pool.mock_date.replace(" ", "T") + "Z") : new Date();

  const participants = poolId
    ? db.prepare("SELECT * FROM participants WHERE pool_id = ?").all(poolId)
    : db.prepare("SELECT * FROM participants").all();

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
        if (kp.predicted_home_score !== null && kp.predicted_away_score !== null &&
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

app.get("/api/admin/test/pools", (req, res) => {
  if (!requireAdmin(req, res)) return;
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
  const changeCost = (inPostGroupWindow && !!pick && !feePaid) ? 5 : 0;
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
  // Charge 5pt fee on the first change made in the post-group window
  const isFirstPostGroupChange = inPostGroupWindow && existing && (existing.change_cost || 0) === 0;
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
  const windowOpen = inPreGroupWindow || inPostGroupWindow;
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
  const changeCost = (inPostGroupWindow && !!pick && !feePaid) ? 5 : 0;
  const finalMatch = db.prepare("SELECT winner_team_id FROM knockout_matches WHERE id = 'F'").get();
  const pickCorrect = !!(pick && finalMatch?.winner_team_id && String(pick.team_id) === String(finalMatch.winner_team_id));
  res.json({ canInitialPick, canChange, locked: lockedDuringGroups, changeCost, pick: pick || null, pickCorrect });
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
  if (!inPreGroupWindow && !inPostGroupWindow) return res.status(403).json({ error: "Champion pick window is closed" });
  const existing = db.prepare("SELECT * FROM champion_picks WHERE participant_id = ?").get(participant_id);
  // Charge 5pt fee on the first change made in the post-group window
  const isFirstPostGroupChange = inPostGroupWindow && existing && (existing.change_cost || 0) === 0;
  const newChangeCost = isFirstPostGroupChange ? 5 : (existing?.change_cost || 0);
  const isChanged = existing ? 1 : 0;
  db.prepare(`
    INSERT INTO champion_picks (participant_id, team_id, is_changed, change_cost)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(participant_id) DO UPDATE SET team_id=excluded.team_id, is_changed=excluded.is_changed, change_cost=excluded.change_cost, updated_at=datetime('now')
  `).run(participant_id, team_id, isChanged, newChangeCost);
  res.json({ success: true });
});

// ── Point History ─────────────────────────────────────────────────────────────

app.get("/api/wc2022/history/:participantId", (req, res) => {
  const { participantId } = req.params;
  const { pool_id } = req.query;
  const pool = pool_id ? db.prepare("SELECT mock_date FROM pools WHERE id = ?").get(pool_id) : null;
  const effectiveNow = pool?.mock_date ? new Date(pool.mock_date.replace(" ", "T") + "Z") : new Date();
  const effectiveMs = effectiveNow.getTime();

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
      const scoreCorrect = kp.predicted_home_score !== null && kp.predicted_away_score !== null &&
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
    if (champPick.is_changed && champPick.change_cost > 0) {
      events.push({ event_date: pickDate, type: "champion_change", description: `Winner pick changed to ${champPick.team_name} (−${champPick.change_cost} pts fee)`, pts_change: -champPick.change_cost });
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

  for (const g of groups) {
    const gt = Object.values(stats).filter((t) => t.group_id === g.id).sort((a, b) => b.points - a.points || (b.gf-b.ga)-(a.gf-a.ga) || b.gf-a.gf);
    if (!gt.every((t) => t.played >= 3)) continue;
    const qualified = [gt[0]?.team_id, gt[1]?.team_id];
    const lastDate = groupLastDate[g.id];
    if (!lastDate) continue;
    const pred = db.prepare("SELECT * FROM group_predictions WHERE participant_id = ? AND group_id = ?").get(participantId, g.id);
    if (!pred) continue;
    const correct = [pred.team1_id, pred.team2_id].filter((t) => qualified.includes(t)).length;
    const pts = correct === 2 ? 5 : correct === 1 ? 2 : 0;
    const t1 = teamById[pred.team1_id]?.name || "?";
    const t2 = teamById[pred.team2_id]?.name || "?";
    const label = correct === 2 ? "Both correct" : correct === 1 ? "1 correct" : "None correct";
    events.push({ event_date: lastDate, type: "group", description: `Group ${g.name}: ${t1} & ${t2} — ${label}`, pts_change: pts });
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
        const scoreCorrect = kp.predicted_home_score !== null && kp.predicted_away_score !== null &&
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
    if (champPick.is_changed && champPick.change_cost > 0) {
      events.push({ event_date: pickDate, type: "champion_change", description: `Winner pick changed to ${champPick.team_name} (−${champPick.change_cost} pts fee)`, pts_change: -champPick.change_cost });
    } else {
      events.push({ event_date: pickDate, type: "champion_pick", description: `Winner pick: ${champPick.team_name}`, pts_change: 0 });
    }
    const finalMatch = koMatches.find((m) => m.id === "F");
    if (finalMatch?.winner_team_id && String(champPick.team_id) === String(finalMatch.winner_team_id)) {
      events.push({ event_date: finalMatch.match_date, type: "champion_bonus", description: `Winner pick correct: ${champPick.team_name} won the tournament!`, pts_change: 20 });
    }
  }

  events.sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""));
  let running = 0;
  for (const e of events) { running += e.pts_change; e.running_total = running; }
  res.json(events);
});

// ─────────────────────────────────────────────────────────────────────────────

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
