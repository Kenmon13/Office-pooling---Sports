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

// Add match_date to knockout_matches if not already present
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN match_date TEXT"); } catch (_) {}

// Add test-pool columns to pools
try { db.exec("ALTER TABLE pools ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE pools ADD COLUMN mock_date TEXT"); } catch (_) {}

// Add actual score columns to knockout matches (for score-prediction scoring)
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN home_score INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN away_score INTEGER"); } catch (_) {}

// Add predicted score columns to KO prediction tables
try { db.exec("ALTER TABLE knockout_predictions ADD COLUMN predicted_home_score INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE knockout_predictions ADD COLUMN predicted_away_score INTEGER"); } catch (_) {}

// WC2022 isolated tables
db.exec(`
  CREATE TABLE IF NOT EXISTS wc2022_groups (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS wc2022_teams (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    code     TEXT NOT NULL,
    group_id INTEGER NOT NULL REFERENCES wc2022_groups(id)
  );

  CREATE TABLE IF NOT EXISTS wc2022_matches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id     INTEGER NOT NULL REFERENCES wc2022_groups(id),
    home_team_id INTEGER NOT NULL REFERENCES wc2022_teams(id),
    away_team_id INTEGER NOT NULL REFERENCES wc2022_teams(id),
    match_date   TEXT,
    home_score   INTEGER,
    away_score   INTEGER,
    status       TEXT DEFAULT 'finished'
  );

  CREATE TABLE IF NOT EXISTS wc2022_knockout_matches (
    id             TEXT PRIMARY KEY,
    round          TEXT NOT NULL,
    home_slot      TEXT NOT NULL,
    away_slot      TEXT NOT NULL,
    home_team_id   INTEGER REFERENCES wc2022_teams(id),
    away_team_id   INTEGER REFERENCES wc2022_teams(id),
    winner_team_id INTEGER REFERENCES wc2022_teams(id),
    status         TEXT DEFAULT 'finished',
    match_date     TEXT
  );

  CREATE TABLE IF NOT EXISTS wc2022_group_predictions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    group_id       INTEGER NOT NULL REFERENCES wc2022_groups(id),
    team1_id       INTEGER NOT NULL REFERENCES wc2022_teams(id),
    team2_id       INTEGER NOT NULL REFERENCES wc2022_teams(id),
    created_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS wc2022_knockout_predictions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    match_id       TEXT NOT NULL REFERENCES wc2022_knockout_matches(id),
    predicted_winner INTEGER NOT NULL,
    created_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, match_id)
  );

  CREATE TABLE IF NOT EXISTS champion_picks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL UNIQUE REFERENCES participants(id),
    team_id        INTEGER REFERENCES teams(id),
    is_changed     INTEGER NOT NULL DEFAULT 0,
    change_cost    INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wc2022_champion_picks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL UNIQUE REFERENCES participants(id),
    team_id        INTEGER REFERENCES wc2022_teams(id),
    is_changed     INTEGER NOT NULL DEFAULT 0,
    change_cost    INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT DEFAULT (datetime('now'))
  );
`);

// Seed WC2022 data once
const wc2022Seeded = db.prepare("SELECT COUNT(*) as c FROM wc2022_groups").get().c > 0;
if (!wc2022Seeded) {
  const WC2022_GROUPS = ["A","B","C","D","E","F","G","H"];
  const insertGroup22 = db.prepare("INSERT INTO wc2022_groups (name) VALUES (?)");
  for (const g of WC2022_GROUPS) insertGroup22.run(g);

  const g22 = {};
  for (const row of db.prepare("SELECT * FROM wc2022_groups").all()) g22[row.name] = row.id;

  const WC2022_TEAMS = [
    // Group A
    { name:"Qatar",        code:"QAT", group:"A" },
    { name:"Ecuador",      code:"ECU", group:"A" },
    { name:"Senegal",      code:"SEN", group:"A" },
    { name:"Netherlands",  code:"NED", group:"A" },
    // Group B
    { name:"England",      code:"ENG", group:"B" },
    { name:"Iran",         code:"IRN", group:"B" },
    { name:"USA",          code:"USA", group:"B" },
    { name:"Wales",        code:"WAL", group:"B" },
    // Group C
    { name:"Argentina",    code:"ARG", group:"C" },
    { name:"Saudi Arabia", code:"KSA", group:"C" },
    { name:"Mexico",       code:"MEX", group:"C" },
    { name:"Poland",       code:"POL", group:"C" },
    // Group D
    { name:"France",       code:"FRA", group:"D" },
    { name:"Australia",    code:"AUS", group:"D" },
    { name:"Denmark",      code:"DEN", group:"D" },
    { name:"Tunisia",      code:"TUN", group:"D" },
    // Group E
    { name:"Spain",        code:"ESP", group:"E" },
    { name:"Costa Rica",   code:"CRC", group:"E" },
    { name:"Germany",      code:"GER", group:"E" },
    { name:"Japan",        code:"JPN", group:"E" },
    // Group F
    { name:"Belgium",      code:"BEL", group:"F" },
    { name:"Canada",       code:"CAN", group:"F" },
    { name:"Morocco",      code:"MAR", group:"F" },
    { name:"Croatia",      code:"CRO", group:"F" },
    // Group G
    { name:"Brazil",       code:"BRA", group:"G" },
    { name:"Serbia",       code:"SRB", group:"G" },
    { name:"Switzerland",  code:"SUI", group:"G" },
    { name:"Cameroon",     code:"CMR", group:"G" },
    // Group H
    { name:"Portugal",     code:"POR", group:"H" },
    { name:"Ghana",        code:"GHA", group:"H" },
    { name:"Uruguay",      code:"URU", group:"H" },
    { name:"South Korea",  code:"KOR", group:"H" },
  ];
  const insertTeam22 = db.prepare("INSERT INTO wc2022_teams (name, code, group_id) VALUES (?, ?, ?)");
  for (const t of WC2022_TEAMS) insertTeam22.run(t.name, t.code, g22[t.group]);

  // Build name→id lookup
  const t22 = {};
  for (const row of db.prepare("SELECT * FROM wc2022_teams").all()) t22[row.name] = row.id;

  // 48 group-stage matches (all finished with actual 2022 WC scores)
  const WC2022_MATCHES = [
    // Group A
    { g:"A", home:"Qatar",       away:"Ecuador",     hs:0, as:2, d:"2022-11-20 16:00" },
    { g:"A", home:"Senegal",     away:"Netherlands", hs:0, as:2, d:"2022-11-21 13:00" },
    { g:"A", home:"Qatar",       away:"Senegal",     hs:1, as:3, d:"2022-11-25 10:00" },
    { g:"A", home:"Netherlands", away:"Ecuador",     hs:1, as:1, d:"2022-11-25 13:00" },
    { g:"A", home:"Netherlands", away:"Qatar",       hs:2, as:0, d:"2022-11-29 15:00" },
    { g:"A", home:"Senegal",     away:"Ecuador",     hs:2, as:1, d:"2022-11-29 15:00" },
    // Group B
    { g:"B", home:"England",     away:"Iran",        hs:6, as:2, d:"2022-11-21 16:00" },
    { g:"B", home:"USA",         away:"Wales",       hs:1, as:1, d:"2022-11-21 19:00" },
    { g:"B", home:"Wales",       away:"Iran",        hs:0, as:2, d:"2022-11-25 10:00" },
    { g:"B", home:"England",     away:"USA",         hs:0, as:0, d:"2022-11-25 19:00" },
    { g:"B", home:"England",     away:"Wales",       hs:3, as:0, d:"2022-11-29 19:00" },
    { g:"B", home:"Iran",        away:"USA",         hs:0, as:1, d:"2022-11-29 19:00" },
    // Group C
    { g:"C", home:"Argentina",   away:"Saudi Arabia",hs:1, as:2, d:"2022-11-22 13:00" },
    { g:"C", home:"Mexico",      away:"Poland",      hs:0, as:0, d:"2022-11-22 16:00" },
    { g:"C", home:"Poland",      away:"Saudi Arabia",hs:2, as:0, d:"2022-11-26 13:00" },
    { g:"C", home:"Argentina",   away:"Mexico",      hs:2, as:0, d:"2022-11-26 22:00" },
    { g:"C", home:"Poland",      away:"Argentina",   hs:0, as:2, d:"2022-11-30 19:00" },
    { g:"C", home:"Saudi Arabia",away:"Mexico",      hs:1, as:2, d:"2022-11-30 19:00" },
    // Group D
    { g:"D", home:"Denmark",     away:"Tunisia",     hs:0, as:0, d:"2022-11-22 10:00" },
    { g:"D", home:"France",      away:"Australia",   hs:4, as:1, d:"2022-11-22 19:00" },
    { g:"D", home:"Tunisia",     away:"Australia",   hs:0, as:1, d:"2022-11-26 10:00" },
    { g:"D", home:"France",      away:"Denmark",     hs:2, as:1, d:"2022-11-26 19:00" },
    { g:"D", home:"Tunisia",     away:"France",      hs:1, as:0, d:"2022-11-30 15:00" },
    { g:"D", home:"Australia",   away:"Denmark",     hs:1, as:0, d:"2022-11-30 15:00" },
    // Group E
    { g:"E", home:"Germany",     away:"Japan",       hs:1, as:2, d:"2022-11-23 13:00" },
    { g:"E", home:"Spain",       away:"Costa Rica",  hs:7, as:0, d:"2022-11-23 16:00" },
    { g:"E", home:"Japan",       away:"Costa Rica",  hs:1, as:0, d:"2022-11-27 13:00" },
    { g:"E", home:"Spain",       away:"Germany",     hs:1, as:1, d:"2022-11-27 19:00" },
    { g:"E", home:"Japan",       away:"Spain",       hs:2, as:1, d:"2022-12-01 19:00" },
    { g:"E", home:"Costa Rica",  away:"Germany",     hs:2, as:4, d:"2022-12-01 19:00" },
    // Group F
    { g:"F", home:"Morocco",     away:"Croatia",     hs:0, as:0, d:"2022-11-23 10:00" },
    { g:"F", home:"Belgium",     away:"Canada",      hs:1, as:0, d:"2022-11-23 19:00" },
    { g:"F", home:"Belgium",     away:"Morocco",     hs:0, as:2, d:"2022-11-27 10:00" },
    { g:"F", home:"Croatia",     away:"Canada",      hs:4, as:1, d:"2022-11-27 16:00" },
    { g:"F", home:"Belgium",     away:"Croatia",     hs:0, as:0, d:"2022-12-01 15:00" },
    { g:"F", home:"Canada",      away:"Morocco",     hs:1, as:2, d:"2022-12-01 15:00" },
    // Group G
    { g:"G", home:"Switzerland", away:"Cameroon",    hs:1, as:0, d:"2022-11-24 13:00" },
    { g:"G", home:"Brazil",      away:"Serbia",      hs:2, as:0, d:"2022-11-24 19:00" },
    { g:"G", home:"Cameroon",    away:"Serbia",      hs:3, as:3, d:"2022-11-28 19:00" },
    { g:"G", home:"Brazil",      away:"Switzerland", hs:1, as:0, d:"2022-11-28 22:00" },
    { g:"G", home:"Cameroon",    away:"Brazil",      hs:1, as:0, d:"2022-12-02 19:00" },
    { g:"G", home:"Serbia",      away:"Switzerland", hs:2, as:3, d:"2022-12-02 19:00" },
    // Group H
    { g:"H", home:"Uruguay",     away:"South Korea", hs:0, as:0, d:"2022-11-24 10:00" },
    { g:"H", home:"Portugal",    away:"Ghana",       hs:3, as:2, d:"2022-11-24 16:00" },
    { g:"H", home:"South Korea", away:"Ghana",       hs:2, as:3, d:"2022-11-28 13:00" },
    { g:"H", home:"Portugal",    away:"Uruguay",     hs:2, as:0, d:"2022-11-28 16:00" },
    { g:"H", home:"South Korea", away:"Portugal",    hs:2, as:1, d:"2022-12-02 15:00" },
    { g:"H", home:"Ghana",       away:"Uruguay",     hs:0, as:2, d:"2022-12-02 15:00" },
  ];
  const insertMatch22 = db.prepare("INSERT INTO wc2022_matches (group_id, home_team_id, away_team_id, match_date, home_score, away_score, status) VALUES (?, ?, ?, ?, ?, ?, 'finished')");
  for (const m of WC2022_MATCHES) {
    insertMatch22.run(g22[m.g], t22[m.home], t22[m.away], m.d, m.hs, m.as);
  }

  // Knockout matches (15 total: R16 x8, QF x4, SF x2, F x1)
  // WC2022 bracket: SF-1 = QF-1 vs QF-3; SF-2 = QF-2 vs QF-4
  const WC2022_KO = [
    { id:"22-R16-1", round:"R16", home:"Netherlands",  away:"USA",          winner:"Netherlands",  home_slot:"1A", away_slot:"2B", match_date:"2022-12-03 19:00" },
    { id:"22-R16-2", round:"R16", home:"Argentina",    away:"Australia",    winner:"Argentina",    home_slot:"1C", away_slot:"2D", match_date:"2022-12-03 23:00" },
    { id:"22-R16-3", round:"R16", home:"France",       away:"Poland",       winner:"France",       home_slot:"1D", away_slot:"2C", match_date:"2022-12-04 19:00" },
    { id:"22-R16-4", round:"R16", home:"England",      away:"Senegal",      winner:"England",      home_slot:"1B", away_slot:"2A", match_date:"2022-12-04 23:00" },
    { id:"22-R16-5", round:"R16", home:"Japan",        away:"Croatia",      winner:"Croatia",      home_slot:"1E", away_slot:"2F", match_date:"2022-12-05 19:00" },
    { id:"22-R16-6", round:"R16", home:"Brazil",       away:"South Korea",  winner:"Brazil",       home_slot:"1G", away_slot:"2H", match_date:"2022-12-05 23:00" },
    { id:"22-R16-7", round:"R16", home:"Morocco",      away:"Spain",        winner:"Morocco",      home_slot:"1F", away_slot:"2E", match_date:"2022-12-06 19:00" },
    { id:"22-R16-8", round:"R16", home:"Portugal",     away:"Switzerland",  winner:"Portugal",     home_slot:"1H", away_slot:"2G", match_date:"2022-12-06 23:00" },
    { id:"22-QF-1",  round:"QF",  home:"Netherlands",  away:"Argentina",    winner:"Argentina",    home_slot:"W 22-R16-1", away_slot:"W 22-R16-2", match_date:"2022-12-09 19:00" },
    { id:"22-QF-2",  round:"QF",  home:"France",       away:"England",      winner:"France",       home_slot:"W 22-R16-3", away_slot:"W 22-R16-4", match_date:"2022-12-10 19:00" },
    { id:"22-QF-3",  round:"QF",  home:"Croatia",      away:"Brazil",       winner:"Croatia",      home_slot:"W 22-R16-5", away_slot:"W 22-R16-6", match_date:"2022-12-09 23:00" },
    { id:"22-QF-4",  round:"QF",  home:"Morocco",      away:"Portugal",     winner:"Morocco",      home_slot:"W 22-R16-7", away_slot:"W 22-R16-8", match_date:"2022-12-10 23:00" },
    { id:"22-SF-1",  round:"SF",  home:"Argentina",    away:"Croatia",      winner:"Argentina",    home_slot:"W 22-QF-1",  away_slot:"W 22-QF-3",  match_date:"2022-12-13 23:00" },
    { id:"22-SF-2",  round:"SF",  home:"France",       away:"Morocco",      winner:"France",       home_slot:"W 22-QF-2",  away_slot:"W 22-QF-4",  match_date:"2022-12-14 23:00" },
    { id:"22-F",     round:"F",   home:"Argentina",    away:"France",       winner:"Argentina",    home_slot:"W 22-SF-1",  away_slot:"W 22-SF-2",  match_date:"2022-12-18 19:00" },
  ];
  const insertKo22 = db.prepare("INSERT INTO wc2022_knockout_matches (id, round, home_slot, away_slot, home_team_id, away_team_id, winner_team_id, status, match_date) VALUES (?, ?, ?, ?, ?, ?, ?, 'finished', ?)");
  for (const m of WC2022_KO) {
    insertKo22.run(m.id, m.round, m.home_slot, m.away_slot, t22[m.home], t22[m.away], t22[m.winner], m.match_date);
  }
}

// Add score columns to wc2022_knockout_matches (AET scores)
try { db.exec("ALTER TABLE wc2022_knockout_matches ADD COLUMN home_score INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE wc2022_knockout_matches ADD COLUMN away_score INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE wc2022_knockout_predictions ADD COLUMN predicted_home_score INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE wc2022_knockout_predictions ADD COLUMN predicted_away_score INTEGER"); } catch (_) {}

// Seed WC2022 actual KO scores (AET where applicable; penalties not counted in score)
const WC2022_KO_SCORES = [
  { id: "22-R16-1", hs: 3, as: 1 }, // Netherlands 3-1 USA
  { id: "22-R16-2", hs: 2, as: 1 }, // Argentina 2-1 Australia
  { id: "22-R16-3", hs: 3, as: 1 }, // France 3-1 Poland
  { id: "22-R16-4", hs: 3, as: 0 }, // England 3-0 Senegal
  { id: "22-R16-5", hs: 1, as: 1 }, // Japan 1-1 Croatia AET (CRO wins pens)
  { id: "22-R16-6", hs: 4, as: 1 }, // Brazil 4-1 South Korea
  { id: "22-R16-7", hs: 0, as: 0 }, // Morocco 0-0 Spain AET (MAR wins pens)
  { id: "22-R16-8", hs: 6, as: 1 }, // Portugal 6-1 Switzerland
  { id: "22-QF-1",  hs: 2, as: 2 }, // Netherlands 2-2 Argentina AET (ARG wins pens)
  { id: "22-QF-2",  hs: 2, as: 1 }, // France 2-1 England
  { id: "22-QF-3",  hs: 1, as: 1 }, // Croatia 1-1 Brazil AET (CRO wins pens)
  { id: "22-QF-4",  hs: 1, as: 0 }, // Morocco 1-0 Portugal
  { id: "22-SF-1",  hs: 3, as: 0 }, // Argentina 3-0 Croatia
  { id: "22-SF-2",  hs: 2, as: 0 }, // France 2-0 Morocco
  { id: "22-F",     hs: 3, as: 3 }, // Argentina 3-3 France AET (ARG wins pens)
];
const updateKo22Score = db.prepare("UPDATE wc2022_knockout_matches SET home_score = ?, away_score = ? WHERE id = ? AND home_score IS NULL");
for (const s of WC2022_KO_SCORES) updateKo22Score.run(s.hs, s.as, s.id);

// 2026 FIFA World Cup knockout schedule (all times UTC)
// Sources: FIFA official calendar. Exact kickoff times TBC closer to the event —
// update match_date values here when the detailed schedule is confirmed.
const KO_SCHEDULE = [
  // Round of 32 — June 28 - July 1
  { id: "R32-1",  round: "R32", home_slot: "1A",      away_slot: "3C/D/E",   match_date: "2026-06-28 23:00" },
  { id: "R32-2",  round: "R32", home_slot: "2B",      away_slot: "2C",       match_date: "2026-06-29 02:00" },
  { id: "R32-3",  round: "R32", home_slot: "1D",      away_slot: "3A/B/F",   match_date: "2026-06-29 19:00" },
  { id: "R32-4",  round: "R32", home_slot: "1B",      away_slot: "3A/C/D",   match_date: "2026-06-29 23:00" },
  { id: "R32-5",  round: "R32", home_slot: "1E",      away_slot: "3B/F/G",   match_date: "2026-06-30 19:00" },
  { id: "R32-6",  round: "R32", home_slot: "2F",      away_slot: "2E",       match_date: "2026-06-30 23:00" },
  { id: "R32-7",  round: "R32", home_slot: "1C",      away_slot: "3D/E/F",   match_date: "2026-07-01 19:00" },
  { id: "R32-8",  round: "R32", home_slot: "2A",      away_slot: "2D",       match_date: "2026-07-01 23:00" },
  { id: "R32-9",  round: "R32", home_slot: "1G",      away_slot: "3H/I/J",   match_date: "2026-07-02 19:00" },
  { id: "R32-10", round: "R32", home_slot: "2H",      away_slot: "2I",       match_date: "2026-07-02 23:00" },
  { id: "R32-11", round: "R32", home_slot: "1J",      away_slot: "3G/K/L",   match_date: "2026-07-03 19:00" },
  { id: "R32-12", round: "R32", home_slot: "1H",      away_slot: "3G/I/J",   match_date: "2026-07-03 23:00" },
  { id: "R32-13", round: "R32", home_slot: "1K",      away_slot: "3H/K/L",   match_date: "2026-07-04 19:00" },
  { id: "R32-14", round: "R32", home_slot: "2L",      away_slot: "2K",       match_date: "2026-07-04 23:00" },
  { id: "R32-15", round: "R32", home_slot: "1I",      away_slot: "3J/K/L",   match_date: "2026-07-05 19:00" },
  { id: "R32-16", round: "R32", home_slot: "2G",      away_slot: "2J",       match_date: "2026-07-05 23:00" },
  // Round of 16 — July 7-10
  { id: "R16-1",  round: "R16", home_slot: "W R32-1", away_slot: "W R32-2",  match_date: "2026-07-07 23:00" },
  { id: "R16-2",  round: "R16", home_slot: "W R32-3", away_slot: "W R32-4",  match_date: "2026-07-08 02:00" },
  { id: "R16-3",  round: "R16", home_slot: "W R32-5", away_slot: "W R32-6",  match_date: "2026-07-08 19:00" },
  { id: "R16-4",  round: "R16", home_slot: "W R32-7", away_slot: "W R32-8",  match_date: "2026-07-08 23:00" },
  { id: "R16-5",  round: "R16", home_slot: "W R32-9", away_slot: "W R32-10", match_date: "2026-07-09 19:00" },
  { id: "R16-6",  round: "R16", home_slot: "W R32-11",away_slot: "W R32-12", match_date: "2026-07-09 23:00" },
  { id: "R16-7",  round: "R16", home_slot: "W R32-13",away_slot: "W R32-14", match_date: "2026-07-10 19:00" },
  { id: "R16-8",  round: "R16", home_slot: "W R32-15",away_slot: "W R32-16", match_date: "2026-07-10 23:00" },
  // Quarter-finals — July 13-14
  { id: "QF-1",   round: "QF",  home_slot: "W R16-1", away_slot: "W R16-2",  match_date: "2026-07-13 23:00" },
  { id: "QF-2",   round: "QF",  home_slot: "W R16-3", away_slot: "W R16-4",  match_date: "2026-07-14 02:00" },
  { id: "QF-3",   round: "QF",  home_slot: "W R16-5", away_slot: "W R16-6",  match_date: "2026-07-14 19:00" },
  { id: "QF-4",   round: "QF",  home_slot: "W R16-7", away_slot: "W R16-8",  match_date: "2026-07-14 23:00" },
  // Semi-finals — July 17-18
  { id: "SF-1",   round: "SF",  home_slot: "W QF-1",  away_slot: "W QF-2",   match_date: "2026-07-17 23:00" },
  { id: "SF-2",   round: "SF",  home_slot: "W QF-3",  away_slot: "W QF-4",   match_date: "2026-07-18 23:00" },
  // Final — July 22
  { id: "F",      round: "F",   home_slot: "W SF-1",  away_slot: "W SF-2",   match_date: "2026-07-22 23:00" },
];

// Seed knockout matches if table is empty
const koExists = db.prepare("SELECT COUNT(*) as c FROM knockout_matches").get();
if (koExists.c === 0) {
  const insertKo = db.prepare("INSERT INTO knockout_matches (id, round, home_slot, away_slot, match_date) VALUES (?, ?, ?, ?, ?)");
  for (const m of KO_SCHEDULE) {
    insertKo.run(m.id, m.round, m.home_slot, m.away_slot, m.match_date);
  }
}

// Migration: backfill match_date for existing rows that were seeded without dates
const updateKoDate = db.prepare("UPDATE knockout_matches SET match_date = ? WHERE id = ? AND match_date IS NULL");
for (const m of KO_SCHEDULE) {
  updateKoDate.run(m.match_date, m.id);
}

// Seed admin user
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "messi";
const existingAdmin = db.prepare("SELECT id FROM users WHERE username = ?").get(adminUsername);
if (!existingAdmin) {
  db.prepare("INSERT INTO users (username, password, display_name, is_admin) VALUES (?, ?, ?, 1)").run(adminUsername, adminPassword, "Admin");
}

module.exports = db;
