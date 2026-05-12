const Database = require("better-sqlite3");
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "worldcup.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sport TEXT NOT NULL DEFAULT 'soccer',
    tournament TEXT NOT NULL DEFAULT 'wc2026',
    password TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    pool_id INTEGER REFERENCES pools(id),
    user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, pool_id)
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    group_id INTEGER NOT NULL REFERENCES groups(id)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id),
    home_team_id INTEGER NOT NULL REFERENCES teams(id),
    away_team_id INTEGER NOT NULL REFERENCES teams(id),
    match_date TEXT,
    home_score INTEGER,
    away_score INTEGER,
    status TEXT DEFAULT 'upcoming' CHECK(status IN ('upcoming', 'live', 'finished'))
  );

  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    match_id INTEGER NOT NULL REFERENCES matches(id),
    predicted_outcome TEXT NOT NULL CHECK(predicted_outcome IN ('home', 'away', 'draw')),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, match_id)
  );

  CREATE TABLE IF NOT EXISTS group_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    group_id INTEGER NOT NULL REFERENCES groups(id),
    team1_id INTEGER NOT NULL REFERENCES teams(id),
    team2_id INTEGER NOT NULL REFERENCES teams(id),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS knockout_matches (
    id TEXT PRIMARY KEY,
    round TEXT NOT NULL,
    home_slot TEXT NOT NULL,
    away_slot TEXT NOT NULL,
    home_team_id INTEGER REFERENCES teams(id),
    away_team_id INTEGER REFERENCES teams(id),
    winner_team_id INTEGER REFERENCES teams(id),
    status TEXT DEFAULT 'upcoming' CHECK(status IN ('upcoming', 'live', 'finished'))
  );

  CREATE TABLE IF NOT EXISTS knockout_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    match_id TEXT NOT NULL REFERENCES knockout_matches(id),
    predicted_winner TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, match_id)
  );
`);

// Seed knockout matches
const koExists = db.prepare("SELECT COUNT(*) as c FROM knockout_matches").get();
if (koExists.c === 0) {
  const koMatches = [
    // Round of 32
    { id: "R32-1", round: "R32", home_slot: "1A", away_slot: "3C/D/E" },
    { id: "R32-2", round: "R32", home_slot: "2B", away_slot: "2C" },
    { id: "R32-3", round: "R32", home_slot: "1D", away_slot: "3A/B/F" },
    { id: "R32-4", round: "R32", home_slot: "1B", away_slot: "3A/C/D" },
    { id: "R32-5", round: "R32", home_slot: "1E", away_slot: "3B/F/G" },
    { id: "R32-6", round: "R32", home_slot: "2F", away_slot: "2E" },
    { id: "R32-7", round: "R32", home_slot: "1C", away_slot: "3D/E/F" },
    { id: "R32-8", round: "R32", home_slot: "2A", away_slot: "2D" },
    { id: "R32-9", round: "R32", home_slot: "1G", away_slot: "3H/I/J" },
    { id: "R32-10", round: "R32", home_slot: "2H", away_slot: "2I" },
    { id: "R32-11", round: "R32", home_slot: "1J", away_slot: "3G/K/L" },
    { id: "R32-12", round: "R32", home_slot: "1H", away_slot: "3G/I/J" },
    { id: "R32-13", round: "R32", home_slot: "1K", away_slot: "3H/K/L" },
    { id: "R32-14", round: "R32", home_slot: "2L", away_slot: "2K" },
    { id: "R32-15", round: "R32", home_slot: "1I", away_slot: "3J/K/L" },
    { id: "R32-16", round: "R32", home_slot: "2G", away_slot: "2J" },
    // Round of 16
    { id: "R16-1", round: "R16", home_slot: "W R32-1", away_slot: "W R32-2" },
    { id: "R16-2", round: "R16", home_slot: "W R32-3", away_slot: "W R32-4" },
    { id: "R16-3", round: "R16", home_slot: "W R32-5", away_slot: "W R32-6" },
    { id: "R16-4", round: "R16", home_slot: "W R32-7", away_slot: "W R32-8" },
    { id: "R16-5", round: "R16", home_slot: "W R32-9", away_slot: "W R32-10" },
    { id: "R16-6", round: "R16", home_slot: "W R32-11", away_slot: "W R32-12" },
    { id: "R16-7", round: "R16", home_slot: "W R32-13", away_slot: "W R32-14" },
    { id: "R16-8", round: "R16", home_slot: "W R32-15", away_slot: "W R32-16" },
    // Quarter-finals
    { id: "QF-1", round: "QF", home_slot: "W R16-1", away_slot: "W R16-2" },
    { id: "QF-2", round: "QF", home_slot: "W R16-3", away_slot: "W R16-4" },
    { id: "QF-3", round: "QF", home_slot: "W R16-5", away_slot: "W R16-6" },
    { id: "QF-4", round: "QF", home_slot: "W R16-7", away_slot: "W R16-8" },
    // Semi-finals
    { id: "SF-1", round: "SF", home_slot: "W QF-1", away_slot: "W QF-2" },
    { id: "SF-2", round: "SF", home_slot: "W QF-3", away_slot: "W QF-4" },
    // Final
    { id: "F", round: "F", home_slot: "W SF-1", away_slot: "W SF-2" },
  ];
  const insertKo = db.prepare("INSERT INTO knockout_matches (id, round, home_slot, away_slot) VALUES (?, ?, ?, ?)");
  for (const m of koMatches) {
    insertKo.run(m.id, m.round, m.home_slot, m.away_slot);
  }
}

// Seed admin user
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "messi";
const existingAdmin = db.prepare("SELECT id FROM users WHERE username = ?").get(adminUsername);
if (!existingAdmin) {
  db.prepare("INSERT INTO users (username, password, display_name, is_admin) VALUES (?, ?, ?, 1)").run(adminUsername, adminPassword, "Admin");
}

module.exports = db;
