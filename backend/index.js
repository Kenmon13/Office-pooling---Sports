const express = require("express");
const cors = require("cors");
const db = require("./db");

// Seed on first run
require("./seed");

const app = express();
app.use(cors());
app.use(express.json());

// --- Participants ---

app.get("/api/participants", (req, res) => {
  const participants = db.prepare("SELECT * FROM participants ORDER BY name").all();
  res.json(participants);
});

app.post("/api/participants", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }
  try {
    const result = db.prepare("INSERT INTO participants (name) VALUES (?)").run(name.trim());
    res.json({ id: result.lastInsertRowid, name: name.trim() });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "Name already taken" });
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

// Update match result (admin)
app.put("/api/matches/:id", (req, res) => {
  const { home_score, away_score, status } = req.body;
  const { id } = req.params;

  db.prepare(
    "UPDATE matches SET home_score = ?, away_score = ?, status = ? WHERE id = ?"
  ).run(home_score, away_score, status || "finished", id);

  res.json({ success: true });
});

// --- Predictions ---

app.get("/api/predictions/:participantId", (req, res) => {
  const predictions = db
    .prepare("SELECT * FROM predictions WHERE participant_id = ?")
    .all(req.params.participantId);
  res.json(predictions);
});

app.post("/api/predictions", (req, res) => {
  const { participant_id, match_id, predicted_outcome } = req.body;

  if (!["home", "away", "draw"].includes(predicted_outcome)) {
    return res.status(400).json({ error: "Invalid prediction" });
  }

  // Check match is still upcoming
  const match = db.prepare("SELECT status FROM matches WHERE id = ?").get(match_id);
  if (!match) return res.status(404).json({ error: "Match not found" });
  if (match.status !== "upcoming") {
    return res.status(400).json({ error: "Match already started or finished" });
  }

  try {
    db.prepare(`
      INSERT INTO predictions (participant_id, match_id, predicted_outcome)
      VALUES (?, ?, ?)
      ON CONFLICT(participant_id, match_id) DO UPDATE SET predicted_outcome = excluded.predicted_outcome
    `).run(participant_id, match_id, predicted_outcome);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Leaderboard ---

app.get("/api/leaderboard", (req, res) => {
  // Calculate points for each participant based on finished matches
  const leaderboard = db
    .prepare(
      `SELECT
        p.id,
        p.name,
        COUNT(CASE WHEN m.status = 'finished' THEN 1 END) as matches_predicted,
        SUM(
          CASE
            WHEN m.status != 'finished' THEN 0
            WHEN pred.predicted_outcome = 'home' AND m.home_score > m.away_score THEN 3
            WHEN pred.predicted_outcome = 'away' AND m.away_score > m.home_score THEN 3
            WHEN pred.predicted_outcome = 'draw' AND m.home_score = m.away_score THEN 3
            ELSE 0
          END
        ) as points,
        COUNT(
          CASE
            WHEN m.status = 'finished' AND (
              (pred.predicted_outcome = 'home' AND m.home_score > m.away_score) OR
              (pred.predicted_outcome = 'away' AND m.away_score > m.home_score) OR
              (pred.predicted_outcome = 'draw' AND m.home_score = m.away_score)
            ) THEN 1
          END
        ) as correct_predictions
      FROM participants p
      LEFT JOIN predictions pred ON p.id = pred.participant_id
      LEFT JOIN matches m ON pred.match_id = m.id
      GROUP BY p.id
      ORDER BY points DESC, correct_predictions DESC, p.name`
    )
    .all();
  res.json(leaderboard);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`World Cup Pool API running on http://localhost:${PORT}`);
});
