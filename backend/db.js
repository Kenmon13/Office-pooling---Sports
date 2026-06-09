const Database = require("better-sqlite3");
const path = require("path");
const bcrypt = require("bcryptjs");

const dbPath = process.env.DB_PATH || path.join(__dirname, "worldcup.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    display_name TEXT NOT NULL,
    google_id TEXT UNIQUE,
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
    team3_id INTEGER REFERENCES teams(id),
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

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL REFERENCES pools(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    display_name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS third_place_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    team_id INTEGER NOT NULL REFERENCES teams(id),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, team_id)
  );

  CREATE TABLE IF NOT EXISTS pool_admins (
    pool_id INTEGER NOT NULL REFERENCES pools(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(pool_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    display_name TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS issue_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    display_name TEXT NOT NULL,
    body TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Add team3_id (third-place qualifier) to group_predictions
try { db.exec("ALTER TABLE group_predictions ADD COLUMN team3_id INTEGER REFERENCES teams(id)"); } catch (_) {}

// Migrate existing third_place_predictions into group_predictions.team3_id
try {
  const migrated = db.prepare("SELECT COUNT(*) as n FROM group_predictions WHERE team3_id IS NOT NULL").get();
  const thirdPreds = db.prepare("SELECT participant_id, team_id FROM third_place_predictions").all();
  if (thirdPreds.length > 0 && migrated.n === 0) {
    const teamGroups = db.prepare("SELECT id, group_id FROM teams").all();
    const teamToGroup = {};
    for (const t of teamGroups) teamToGroup[t.id] = t.group_id;
    const update = db.prepare("UPDATE group_predictions SET team3_id = ? WHERE participant_id = ? AND group_id = ? AND team3_id IS NULL");
    const txn = db.transaction(() => {
      for (const tp of thirdPreds) {
        const groupId = teamToGroup[tp.team_id];
        if (groupId) update.run(tp.team_id, tp.participant_id, groupId);
      }
    });
    txn();
  }
} catch (_) {}

// Add match_date to knockout_matches if not already present
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN match_date TEXT"); } catch (_) {}

// Add test-pool columns to pools
try { db.exec("ALTER TABLE pools ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE pools ADD COLUMN mock_date TEXT"); } catch (_) {}

// Add email column to users
try { db.exec("ALTER TABLE users ADD COLUMN email TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE users ADD COLUMN google_id TEXT"); } catch (_) {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)"); } catch (_) {}

// Add public pool column
try { db.exec("ALTER TABLE pools ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Add chat_closed column to pools
try { db.exec("ALTER TABLE pools ADD COLUMN chat_closed INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

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
  // All times in UTC. WC2022 R16/QF had two daily slots: 15:00 UTC (18:00 Qatar) and 19:00 UTC (22:00 Qatar).
  const WC2022_KO = [
    { id:"22-R16-1", round:"R16", home:"Netherlands",  away:"USA",          winner:"Netherlands",  home_slot:"1A", away_slot:"2B", match_date:"2022-12-03 15:00" },
    { id:"22-R16-2", round:"R16", home:"Argentina",    away:"Australia",    winner:"Argentina",    home_slot:"1C", away_slot:"2D", match_date:"2022-12-03 19:00" },
    { id:"22-R16-3", round:"R16", home:"France",       away:"Poland",       winner:"France",       home_slot:"1D", away_slot:"2C", match_date:"2022-12-04 15:00" },
    { id:"22-R16-4", round:"R16", home:"England",      away:"Senegal",      winner:"England",      home_slot:"1B", away_slot:"2A", match_date:"2022-12-04 19:00" },
    { id:"22-R16-5", round:"R16", home:"Japan",        away:"Croatia",      winner:"Croatia",      home_slot:"1E", away_slot:"2F", match_date:"2022-12-05 15:00" },
    { id:"22-R16-6", round:"R16", home:"Brazil",       away:"South Korea",  winner:"Brazil",       home_slot:"1G", away_slot:"2H", match_date:"2022-12-05 19:00" },
    { id:"22-R16-7", round:"R16", home:"Morocco",      away:"Spain",        winner:"Morocco",      home_slot:"1F", away_slot:"2E", match_date:"2022-12-06 15:00" },
    { id:"22-R16-8", round:"R16", home:"Portugal",     away:"Switzerland",  winner:"Portugal",     home_slot:"1H", away_slot:"2G", match_date:"2022-12-06 19:00" },
    { id:"22-QF-1",  round:"QF",  home:"Netherlands",  away:"Argentina",    winner:"Argentina",    home_slot:"W 22-R16-1", away_slot:"W 22-R16-2", match_date:"2022-12-09 15:00" },
    { id:"22-QF-2",  round:"QF",  home:"France",       away:"England",      winner:"France",       home_slot:"W 22-R16-3", away_slot:"W 22-R16-4", match_date:"2022-12-10 15:00" },
    { id:"22-QF-3",  round:"QF",  home:"Croatia",      away:"Brazil",       winner:"Croatia",      home_slot:"W 22-R16-5", away_slot:"W 22-R16-6", match_date:"2022-12-09 19:00" },
    { id:"22-QF-4",  round:"QF",  home:"Morocco",      away:"Portugal",     winner:"Morocco",      home_slot:"W 22-R16-7", away_slot:"W 22-R16-8", match_date:"2022-12-10 19:00" },
    { id:"22-SF-1",  round:"SF",  home:"Argentina",    away:"Croatia",      winner:"Argentina",    home_slot:"W 22-QF-1",  away_slot:"W 22-QF-3",  match_date:"2022-12-13 19:00" },
    { id:"22-SF-2",  round:"SF",  home:"France",       away:"Morocco",      winner:"France",       home_slot:"W 22-QF-2",  away_slot:"W 22-QF-4",  match_date:"2022-12-14 19:00" },
    { id:"22-F",     round:"F",   home:"Argentina",    away:"France",       winner:"Argentina",    home_slot:"W 22-SF-1",  away_slot:"W 22-SF-2",  match_date:"2022-12-18 15:00" },
  ];
  const insertKo22 = db.prepare("INSERT INTO wc2022_knockout_matches (id, round, home_slot, away_slot, home_team_id, away_team_id, winner_team_id, status, match_date) VALUES (?, ?, ?, ?, ?, ?, ?, 'finished', ?)");
  for (const m of WC2022_KO) {
    insertKo22.run(m.id, m.round, m.home_slot, m.away_slot, t22[m.home], t22[m.away], t22[m.winner], m.match_date);
  }
}

// Migrate WC2022 KO match times: original seed had all times 4 hours too late
// (Qatar local time was mistakenly stored instead of UTC). Correct times are UTC.
const WC2022_KO_TIME_FIXES = {
  "22-R16-1": "2022-12-03 15:00", "22-R16-2": "2022-12-03 19:00",
  "22-R16-3": "2022-12-04 15:00", "22-R16-4": "2022-12-04 19:00",
  "22-R16-5": "2022-12-05 15:00", "22-R16-6": "2022-12-05 19:00",
  "22-R16-7": "2022-12-06 15:00", "22-R16-8": "2022-12-06 19:00",
  "22-QF-1":  "2022-12-09 15:00", "22-QF-2":  "2022-12-10 15:00",
  "22-QF-3":  "2022-12-09 19:00", "22-QF-4":  "2022-12-10 19:00",
  "22-SF-1":  "2022-12-13 19:00", "22-SF-2":  "2022-12-14 19:00",
  "22-F":     "2022-12-18 15:00",
};
const fixKo22Time = db.prepare("UPDATE wc2022_knockout_matches SET match_date = ? WHERE id = ? AND match_date != ?");
for (const [id, date] of Object.entries(WC2022_KO_TIME_FIXES)) {
  fixKo22Time.run(date, id, date);
}

// Add score columns to wc2022_knockout_matches (AET scores)
try { db.exec("ALTER TABLE wc2022_knockout_matches ADD COLUMN home_score INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE wc2022_knockout_matches ADD COLUMN away_score INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE wc2022_knockout_predictions ADD COLUMN predicted_home_score INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE wc2022_knockout_predictions ADD COLUMN predicted_away_score INTEGER"); } catch (_) {}

// Add change_cost to champion pick tables (for post-group window fee tracking)
try { db.exec("ALTER TABLE champion_picks ADD COLUMN change_cost INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE wc2022_champion_picks ADD COLUMN change_cost INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE champion_picks ADD COLUMN is_changed INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE wc2022_champion_picks ADD COLUMN is_changed INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Add champion_w2_locked to pools (admin can lock champion pick window 2)
try { db.exec("ALTER TABLE pools ADD COLUMN champion_w2_locked INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

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
// Source: FIFA official match schedule (published Dec 2025)
const KO_SCHEDULE = [
  // Round of 32 — June 28 - July 4
  { id: "R32-1",  round: "R32", home_slot: "2A",      away_slot: "2B",           match_date: "2026-06-28 19:00" },
  { id: "R32-2",  round: "R32", home_slot: "1E",      away_slot: "3A/B/C/D/F",   match_date: "2026-06-29 20:30" },
  { id: "R32-3",  round: "R32", home_slot: "1F",      away_slot: "2C",           match_date: "2026-06-30 01:00" },
  { id: "R32-4",  round: "R32", home_slot: "1C",      away_slot: "2F",           match_date: "2026-06-29 17:00" },
  { id: "R32-5",  round: "R32", home_slot: "1I",      away_slot: "3C/D/F/G/H",   match_date: "2026-06-30 21:00" },
  { id: "R32-6",  round: "R32", home_slot: "2E",      away_slot: "2I",           match_date: "2026-06-30 17:00" },
  { id: "R32-7",  round: "R32", home_slot: "1A",      away_slot: "3C/E/F/H/I",   match_date: "2026-07-01 01:00" },
  { id: "R32-8",  round: "R32", home_slot: "1L",      away_slot: "3E/H/I/J/K",   match_date: "2026-07-01 16:00" },
  { id: "R32-9",  round: "R32", home_slot: "1D",      away_slot: "3B/E/F/I/J",   match_date: "2026-07-02 00:00" },
  { id: "R32-10", round: "R32", home_slot: "1G",      away_slot: "3A/E/H/I/J",   match_date: "2026-07-01 20:00" },
  { id: "R32-11", round: "R32", home_slot: "2K",      away_slot: "2L",           match_date: "2026-07-02 23:00" },
  { id: "R32-12", round: "R32", home_slot: "1H",      away_slot: "2J",           match_date: "2026-07-02 19:00" },
  { id: "R32-13", round: "R32", home_slot: "1B",      away_slot: "3E/F/G/I/J",   match_date: "2026-07-03 03:00" },
  { id: "R32-14", round: "R32", home_slot: "1J",      away_slot: "2H",           match_date: "2026-07-03 22:00" },
  { id: "R32-15", round: "R32", home_slot: "1K",      away_slot: "3D/E/I/J/L",   match_date: "2026-07-04 01:30" },
  { id: "R32-16", round: "R32", home_slot: "2D",      away_slot: "2G",           match_date: "2026-07-03 18:00" },
  // Round of 16 — July 4-7
  { id: "R16-1",  round: "R16", home_slot: "W R32-2", away_slot: "W R32-5",  match_date: "2026-07-04 21:00" },
  { id: "R16-2",  round: "R16", home_slot: "W R32-1", away_slot: "W R32-3",  match_date: "2026-07-04 17:00" },
  { id: "R16-3",  round: "R16", home_slot: "W R32-4", away_slot: "W R32-6",  match_date: "2026-07-05 20:00" },
  { id: "R16-4",  round: "R16", home_slot: "W R32-7", away_slot: "W R32-8",  match_date: "2026-07-06 00:00" },
  { id: "R16-5",  round: "R16", home_slot: "W R32-11",away_slot: "W R32-12", match_date: "2026-07-06 19:00" },
  { id: "R16-6",  round: "R16", home_slot: "W R32-9", away_slot: "W R32-10", match_date: "2026-07-07 00:00" },
  { id: "R16-7",  round: "R16", home_slot: "W R32-14",away_slot: "W R32-16", match_date: "2026-07-07 16:00" },
  { id: "R16-8",  round: "R16", home_slot: "W R32-13",away_slot: "W R32-15", match_date: "2026-07-07 20:00" },
  // Quarter-finals — July 9-12
  { id: "QF-1",   round: "QF",  home_slot: "W R16-1", away_slot: "W R16-2",  match_date: "2026-07-09 20:00" },
  { id: "QF-2",   round: "QF",  home_slot: "W R16-5", away_slot: "W R16-6",  match_date: "2026-07-10 19:00" },
  { id: "QF-3",   round: "QF",  home_slot: "W R16-3", away_slot: "W R16-4",  match_date: "2026-07-11 21:00" },
  { id: "QF-4",   round: "QF",  home_slot: "W R16-7", away_slot: "W R16-8",  match_date: "2026-07-12 01:00" },
  // Semi-finals — July 14-15
  { id: "SF-1",   round: "SF",  home_slot: "W QF-1",  away_slot: "W QF-2",   match_date: "2026-07-14 19:00" },
  { id: "SF-2",   round: "SF",  home_slot: "W QF-3",  away_slot: "W QF-4",   match_date: "2026-07-15 19:00" },
  // Final — July 19
  { id: "F",      round: "F",   home_slot: "W SF-1",  away_slot: "W SF-2",   match_date: "2026-07-19 19:00" },
];

// Seed knockout matches if table is empty
const koExists = db.prepare("SELECT COUNT(*) as c FROM knockout_matches").get();
if (koExists.c === 0) {
  const insertKo = db.prepare("INSERT INTO knockout_matches (id, round, home_slot, away_slot, match_date) VALUES (?, ?, ?, ?, ?)");
  for (const m of KO_SCHEDULE) {
    insertKo.run(m.id, m.round, m.home_slot, m.away_slot, m.match_date);
  }
}

// Migration: update knockout match dates and slots to official FIFA schedule
const updateKo = db.prepare("UPDATE knockout_matches SET match_date = ?, home_slot = ?, away_slot = ? WHERE id = ?");
for (const m of KO_SCHEDULE) {
  updateKo.run(m.match_date, m.home_slot, m.away_slot, m.id);
}

// Seed admin user
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "messi";
const existingAdmin = db.prepare("SELECT id, password FROM users WHERE username = ?").get(adminUsername);
if (!existingAdmin) {
  const hashedAdminPw = bcrypt.hashSync(adminPassword, 10);
  db.prepare("INSERT INTO users (username, password, display_name, is_admin) VALUES (?, ?, ?, 1)").run(adminUsername, hashedAdminPw, "Admin");
} else if (!bcrypt.compareSync(adminPassword, existingAdmin.password)) {
  const hashedAdminPw = bcrypt.hashSync(adminPassword, 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedAdminPw, existingAdmin.id);
}

// Migrate existing plaintext passwords to bcrypt
const plaintextUsers = db.prepare("SELECT id, password FROM users WHERE password NOT LIKE '$2%'").all();
if (plaintextUsers.length > 0) {
  const updatePw = db.prepare("UPDATE users SET password = ? WHERE id = ?");
  const migrateAll = db.transaction(() => {
    for (const u of plaintextUsers) {
      updatePw.run(bcrypt.hashSync(u.password, 10), u.id);
    }
  });
  migrateAll();
}

// Seed default public pool for WC2026
const existingPublicPool = db.prepare("SELECT id FROM pools WHERE name = 'World Cup 2026 Open' AND is_public = 1").get();
if (!existingPublicPool) {
  db.prepare("INSERT INTO pools (name, sport, tournament, password, is_public) VALUES (?, ?, ?, ?, 1)").run("World Cup 2026 Open", "soccer", "wc2026", "");
}

// Migration: update WC2026 group stage match dates to official FIFA schedule
const WC2026_MATCH_DATES = [
  // Group A
  { home: "MEX", away: "RSA", date: "2026-06-11 19:00" },
  { home: "KOR", away: "CZE", date: "2026-06-12 02:00" },
  { home: "CZE", away: "RSA", date: "2026-06-18 16:00" },
  { home: "MEX", away: "KOR", date: "2026-06-19 01:00" },
  { home: "CZE", away: "MEX", date: "2026-06-25 01:00" },
  { home: "KOR", away: "RSA", date: "2026-06-25 01:00" },
  // Group B
  { home: "CAN", away: "BIH", date: "2026-06-12 19:00" },
  { home: "SUI", away: "QAT", date: "2026-06-13 19:00" },
  { home: "SUI", away: "BIH", date: "2026-06-18 19:00" },
  { home: "CAN", away: "QAT", date: "2026-06-18 22:00" },
  { home: "SUI", away: "CAN", date: "2026-06-24 19:00" },
  { home: "BIH", away: "QAT", date: "2026-06-24 19:00" },
  // Group C
  { home: "BRA", away: "MAR", date: "2026-06-13 22:00" },
  { home: "HAI", away: "SCO", date: "2026-06-14 01:00" },
  { home: "SCO", away: "MAR", date: "2026-06-19 22:00" },
  { home: "BRA", away: "HAI", date: "2026-06-20 00:30" },
  { home: "SCO", away: "BRA", date: "2026-06-24 22:00" },
  { home: "MAR", away: "HAI", date: "2026-06-24 22:00" },
  // Group D
  { home: "USA", away: "PAR", date: "2026-06-13 01:00" },
  { home: "AUS", away: "TUR", date: "2026-06-14 04:00" },
  { home: "USA", away: "AUS", date: "2026-06-19 19:00" },
  { home: "TUR", away: "PAR", date: "2026-06-20 03:00" },
  { home: "TUR", away: "USA", date: "2026-06-26 02:00" },
  { home: "PAR", away: "AUS", date: "2026-06-26 02:00" },
  // Group E
  { home: "GER", away: "CUW", date: "2026-06-14 17:00" },
  { home: "CIV", away: "ECU", date: "2026-06-14 23:00" },
  { home: "GER", away: "CIV", date: "2026-06-20 20:00" },
  { home: "ECU", away: "CUW", date: "2026-06-21 00:00" },
  { home: "ECU", away: "GER", date: "2026-06-25 20:00" },
  { home: "CUW", away: "CIV", date: "2026-06-25 20:00" },
  // Group F
  { home: "NED", away: "JPN", date: "2026-06-14 20:00" },
  { home: "SWE", away: "TUN", date: "2026-06-15 02:00" },
  { home: "NED", away: "SWE", date: "2026-06-20 17:00" },
  { home: "TUN", away: "JPN", date: "2026-06-21 04:00" },
  { home: "JPN", away: "SWE", date: "2026-06-25 23:00" },
  { home: "TUN", away: "NED", date: "2026-06-25 23:00" },
  // Group G
  { home: "BEL", away: "EGY", date: "2026-06-15 19:00" },
  { home: "IRN", away: "NZL", date: "2026-06-16 01:00" },
  { home: "BEL", away: "IRN", date: "2026-06-21 19:00" },
  { home: "NZL", away: "EGY", date: "2026-06-22 01:00" },
  { home: "EGY", away: "IRN", date: "2026-06-27 03:00" },
  { home: "NZL", away: "BEL", date: "2026-06-27 03:00" },
  // Group H
  { home: "ESP", away: "CPV", date: "2026-06-15 16:00" },
  { home: "KSA", away: "URU", date: "2026-06-15 22:00" },
  { home: "ESP", away: "KSA", date: "2026-06-21 16:00" },
  { home: "URU", away: "CPV", date: "2026-06-21 22:00" },
  { home: "CPV", away: "KSA", date: "2026-06-27 00:00" },
  { home: "URU", away: "ESP", date: "2026-06-27 00:00" },
  // Group I
  { home: "FRA", away: "SEN", date: "2026-06-16 19:00" },
  { home: "IRQ", away: "NOR", date: "2026-06-16 22:00" },
  { home: "FRA", away: "IRQ", date: "2026-06-22 21:00" },
  { home: "NOR", away: "SEN", date: "2026-06-23 00:00" },
  { home: "NOR", away: "FRA", date: "2026-06-26 19:00" },
  { home: "SEN", away: "IRQ", date: "2026-06-26 19:00" },
  // Group J
  { home: "ARG", away: "ALG", date: "2026-06-17 01:00" },
  { home: "AUT", away: "JOR", date: "2026-06-17 04:00" },
  { home: "ARG", away: "AUT", date: "2026-06-22 17:00" },
  { home: "JOR", away: "ALG", date: "2026-06-23 03:00" },
  { home: "JOR", away: "ARG", date: "2026-06-28 02:00" },
  { home: "ALG", away: "AUT", date: "2026-06-28 02:00" },
  // Group K
  { home: "POR", away: "COD", date: "2026-06-17 17:00" },
  { home: "UZB", away: "COL", date: "2026-06-18 02:00" },
  { home: "POR", away: "UZB", date: "2026-06-23 17:00" },
  { home: "COL", away: "COD", date: "2026-06-24 02:00" },
  { home: "COD", away: "UZB", date: "2026-06-27 23:30" },
  { home: "COL", away: "POR", date: "2026-06-27 23:30" },
  // Group L
  { home: "ENG", away: "CRO", date: "2026-06-17 20:00" },
  { home: "GHA", away: "PAN", date: "2026-06-17 23:00" },
  { home: "ENG", away: "GHA", date: "2026-06-23 20:00" },
  { home: "PAN", away: "CRO", date: "2026-06-23 23:00" },
  { home: "PAN", away: "ENG", date: "2026-06-27 21:00" },
  { home: "CRO", away: "GHA", date: "2026-06-27 21:00" },
];

// Update match dates for existing seeded matches
const updateMatchDate = db.prepare(`
  UPDATE matches SET match_date = ?
  WHERE home_team_id = (SELECT id FROM teams WHERE code = ?)
    AND away_team_id = (SELECT id FROM teams WHERE code = ?)
`);
for (const m of WC2026_MATCH_DATES) {
  updateMatchDate.run(m.date, m.home, m.away);
}

// --- Player Award Predictions ---

// Individual players table (WC 2026 squads)
db.exec(`
  CREATE TABLE IF NOT EXISTS wc_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    team_id INTEGER NOT NULL REFERENCES teams(id),
    position TEXT NOT NULL CHECK(position IN ('GK','DF','MF','FW')),
    UNIQUE(name, team_id)
  );
`);

// Player award picks (one per participant per award category)
db.exec(`
  CREATE TABLE IF NOT EXISTS player_award_picks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    award_category TEXT NOT NULL CHECK(award_category IN ('golden_ball','golden_boot','golden_glove','young_player','fair_play')),
    player_id INTEGER REFERENCES wc_players(id),
    team_id INTEGER REFERENCES teams(id),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, award_category)
  );
`);

// Actual award results (admin sets these after tournament)
db.exec(`
  CREATE TABLE IF NOT EXISTS player_award_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    award_category TEXT NOT NULL UNIQUE CHECK(award_category IN ('golden_ball','golden_boot','golden_glove','young_player','fair_play')),
    player_id INTEGER REFERENCES wc_players(id),
    team_id INTEGER REFERENCES teams(id),
    set_at TEXT DEFAULT (datetime('now'))
  );
`);

// Admin lock for player awards section
try { db.exec("ALTER TABLE pools ADD COLUMN player_awards_locked INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Pool admin toggle to disable exact score predictions
try { db.exec("ALTER TABLE pools ADD COLUMN exact_scores_disabled INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Add dob column to wc_players
try { db.exec("ALTER TABLE wc_players ADD COLUMN dob TEXT"); } catch (_) {}

// Seed WC 2026 squad players
const wcPlayersSeeded = db.prepare("SELECT COUNT(*) as c FROM wc_players").get().c > 0;
if (!wcPlayersSeeded) {
  try {
    const WC2026_SQUADS = require("./squad-data");
    const teamsByCode = {};
    for (const row of db.prepare("SELECT id, code FROM teams").all()) teamsByCode[row.code] = row.id;
    const insertPlayer = db.prepare("INSERT OR IGNORE INTO wc_players (name, team_id, position, dob) VALUES (?, ?, ?, ?)");
    const seedPlayers = db.transaction(() => {
      for (const [code, players] of Object.entries(WC2026_SQUADS)) {
        const teamId = teamsByCode[code];
        if (!teamId) { console.log(`Skipping unknown team code: ${code}`); continue; }
        for (const p of players) insertPlayer.run(p.name, teamId, p.pos, p.dob || null);
      }
    });
    seedPlayers();
    console.log("Seeded WC 2026 squad players.");
  } catch (err) {
    console.log("Could not seed WC players (squad-data.js may not exist yet):", err.message);
  }
}

// Migration: backfill dob for existing wc_players rows
try {
  const missingDob = db.prepare("SELECT COUNT(*) as c FROM wc_players WHERE dob IS NULL").get().c;
  if (missingDob > 0) {
    const WC2026_SQUADS = require("./squad-data");
    const teamsByCode = {};
    for (const row of db.prepare("SELECT id, code FROM teams").all()) teamsByCode[row.code] = row.id;
    const updateDob = db.prepare("UPDATE wc_players SET dob = ? WHERE name = ? AND team_id = ? AND dob IS NULL");
    const backfill = db.transaction(() => {
      for (const [code, players] of Object.entries(WC2026_SQUADS)) {
        const teamId = teamsByCode[code];
        if (!teamId) continue;
        for (const p of players) {
          if (p.dob) updateDob.run(p.dob, p.name, teamId);
        }
      }
    });
    backfill();
    console.log("Backfilled dob for WC 2026 players.");
  }
} catch (_) {}

module.exports = db;
