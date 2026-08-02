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
    name TEXT NOT NULL,
    sport TEXT NOT NULL DEFAULT 'soccer',
    tournament TEXT NOT NULL DEFAULT 'wc2026',
    password TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(name, tournament)
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

  CREATE TABLE IF NOT EXISTS ko_mismatches (
    match_id TEXT NOT NULL REFERENCES knockout_matches(id),
    field TEXT NOT NULL CHECK (field IN ('home_team_id', 'away_team_id')),
    local_team_id INTEGER REFERENCES teams(id),
    api_team_id INTEGER REFERENCES teams(id),
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (match_id, field)
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

// Sign in with Apple. Apple's `sub` is stable per Apple-developer-team, so it is
// stored alongside google_id rather than replacing it.
try { db.exec("ALTER TABLE users ADD COLUMN apple_id TEXT"); } catch (_) {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_id ON users(apple_id)"); } catch (_) {}

// Push notifications. One row per device: a user with a phone and a tablet has two.
// The FCM registration token is the primary key because FCM can reassign a token to a
// different user (same device, new login), and the newest owner wins.
db.exec(`
  CREATE TABLE IF NOT EXISTS device_tokens (
    token        TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    platform     TEXT NOT NULL CHECK(platform IN ('ios','android','web')),
    created_at   TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

  -- Dedupe ledger: guarantees a user is told about a given match at most once per
  -- kind, no matter how often the scan runs or how many pools they are in.
  CREATE TABLE IF NOT EXISTS push_log (
    user_id  INTEGER NOT NULL REFERENCES users(id),
    kind     TEXT NOT NULL,
    ref      TEXT NOT NULL,
    sent_at  TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, kind, ref)
  );

  -- Per-user opt-out. Absent row means opted in.
  CREATE TABLE IF NOT EXISTS push_prefs (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id),
    reminders   INTEGER NOT NULL DEFAULT 1,
    results     INTEGER NOT NULL DEFAULT 1
  );
`);

// "What should we build next?" poll — one row per user, either a vote or a dismissal.
db.exec(`
  CREATE TABLE IF NOT EXISTS poll_responses (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    choices TEXT,
    other_text TEXT,
    status TEXT NOT NULL DEFAULT 'voted',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Add public pool column
try { db.exec("ALTER TABLE pools ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Add chat_closed column to pools
try { db.exec("ALTER TABLE pools ADD COLUMN chat_closed INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Add actual score columns to knockout matches (for score-prediction scoring)
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN home_score INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN away_score INTEGER"); } catch (_) {}

// Admin-override flags for knockout slot/winner assignments. When set, the football-data.org
// auto-correct sync and the resolver both leave that field alone.
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN home_admin_set INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN away_admin_set INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN winner_admin_set INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

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

// v1.31: extra-time and penalty shootout fields for WC2026 KO matches.
// duration mirrors football-data.org v4 score.duration: REGULAR / EXTRA_TIME / PENALTY_SHOOTOUT.
// home_et / away_et = goals scored in extra time (delta only, not cumulative).
// home_pens / away_pens = penalty shootout score.
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN duration TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN home_et INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN away_et INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN home_pens INTEGER"); } catch (_) {}
try { db.exec("ALTER TABLE knockout_matches ADD COLUMN away_pens INTEGER"); } catch (_) {}

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

// One-off production fix (2026-06-27): WC2026 R32-16's away slot got polluted with IRN
// when football-data.org briefly published a wrong projection. Reset it to EGY (Group G
// 2nd by standings). Idempotent: only fires when the current value is IRN and admin
// hasn't locked it. No-op on subsequent deploys.
try {
  db.prepare(`
    UPDATE knockout_matches
    SET away_team_id = (SELECT id FROM teams WHERE code = 'EGY')
    WHERE id = 'R32-16'
      AND away_admin_set = 0
      AND away_team_id = (SELECT id FROM teams WHERE code = 'IRN')
  `).run();
} catch (_) {}

// One-off production fix (2026-06-27): two group-stage matches got stuck with wrong
// scores because scores.js's `WHERE status IN ('upcoming', 'live')` clause blocks
// updates once a match flips to 'finished'. API briefly published wrong intermediate
// values during live play, sync wrote them, then later corrections never applied.
// Real scores per football-data.org: EGY-IRN 1-1, ESP-KSA 4-0. Patches cover both
// possible home/away orderings (production might have seeded differently).
// Idempotent: only fires when stored score differs from target.
try {
  // EGY-IRN should be 1-1 (draw, symmetric — order doesn't matter)
  db.prepare(`
    UPDATE matches
    SET home_score = 1, away_score = 1
    WHERE status = 'finished'
      AND ((home_team_id = (SELECT id FROM teams WHERE code = 'EGY')
            AND away_team_id = (SELECT id FROM teams WHERE code = 'IRN'))
        OR (home_team_id = (SELECT id FROM teams WHERE code = 'IRN')
            AND away_team_id = (SELECT id FROM teams WHERE code = 'EGY')))
      AND (home_score != 1 OR away_score != 1)
  `).run();
  // ESP-KSA should be 4-0 (Spain home in API). Cover both local orderings.
  db.prepare(`
    UPDATE matches
    SET home_score = 4, away_score = 0
    WHERE status = 'finished'
      AND home_team_id = (SELECT id FROM teams WHERE code = 'ESP')
      AND away_team_id = (SELECT id FROM teams WHERE code = 'KSA')
      AND (home_score != 4 OR away_score != 0)
  `).run();
  db.prepare(`
    UPDATE matches
    SET home_score = 0, away_score = 4
    WHERE status = 'finished'
      AND home_team_id = (SELECT id FROM teams WHERE code = 'KSA')
      AND away_team_id = (SELECT id FROM teams WHERE code = 'ESP')
      AND (home_score != 0 OR away_score != 4)
  `).run();
} catch (_) {}

// One-off production fix (2026-06-28): football-data.org hasn't published the seven
// third-place R32 assignments yet (all 16 R32 teams still TBD upstream as of group-stage
// end). koResolver only auto-fills 1st/2nd via local standings; 3rd-place slots wait for
// the API, with a loose-validation check. Backfill from FIFA's official bracket so users
// see the full R32 immediately. Idempotent — each UPDATE guards on `away_team_id IS NULL
// AND away_admin_set = 0`, so no-ops once filled by API or admin. Each sets
// away_admin_set = 1 to lock against any wrong API publish (matches admin PATCH behavior).
try {
  const fill = db.prepare(`
    UPDATE knockout_matches
    SET away_team_id = (SELECT id FROM teams WHERE code = ?), away_admin_set = 1
    WHERE id = ? AND away_team_id IS NULL AND away_admin_set = 0
  `);
  fill.run("PAR", "R32-2");   // Paraguay (3D) — Germany vs Paraguay
  fill.run("SWE", "R32-5");   // Sweden (3F) — France vs Sweden
  fill.run("ECU", "R32-7");   // Ecuador (3E) — Mexico vs Ecuador
  fill.run("COD", "R32-8");   // DR Congo (3K) — England vs DR Congo
  fill.run("SEN", "R32-10");  // Senegal (3I) — Belgium vs Senegal
  fill.run("ALG", "R32-13");  // Algeria (3J) — Switzerland vs Algeria
  fill.run("GHA", "R32-15");  // Ghana (3L) — Colombia vs Ghana
} catch (_) {}

// One-off goodwill fix (2026-06-28): user 'joshoreilly' moved with his friend
// group from 'Aqua for All' to 'Football for All' and many of his group-stage
// picks didn't carry across (picks are per-pool by design — no copy mechanism).
// Fill the 5 groups (A, B, C, D, J) where Football has no pick from his Aqua
// picks, verified visually against both pools 2026-06-28. Scoped to one user via
// subquery on username + pool name — no other user is read or written.
// Idempotent: INSERT OR IGNORE on UNIQUE(participant_id, group_id), so every row
// no-ops on rerun. Fill-gaps semantics — never overwrites a pick already in
// Football, even if that pick differs from Aqua (e.g. Group G NZ vs none).
// Team3 cap check: Football already has team3 in 5 groups (E,F,G,H,I); this
// adds 3 more (A,C,D) → exactly the 8-pool cap, no overflow.
// Bypasses per-group deadline (group stage long over) — intentional: the picks
// pre-existed in Aqua, so they are legitimate predictions just made in another
// pool. No other user gets this treatment without explicit ask.
try {
  const fillRow3 = db.prepare(`
    INSERT OR IGNORE INTO group_predictions (participant_id, group_id, team1_id, team2_id, team3_id)
    VALUES (
      (SELECT id FROM participants
         WHERE pool_id = (SELECT id FROM pools WHERE name = 'Football for All')
           AND user_id = (SELECT id FROM users WHERE username = 'joshoreilly')),
      (SELECT id FROM groups WHERE name = ?),
      (SELECT t.id FROM teams t JOIN groups g ON t.group_id = g.id WHERE g.name = ? AND t.name = ?),
      (SELECT t.id FROM teams t JOIN groups g ON t.group_id = g.id WHERE g.name = ? AND t.name = ?),
      (SELECT t.id FROM teams t JOIN groups g ON t.group_id = g.id WHERE g.name = ? AND t.name = ?)
    )
  `);
  const fillRow2 = db.prepare(`
    INSERT OR IGNORE INTO group_predictions (participant_id, group_id, team1_id, team2_id, team3_id)
    VALUES (
      (SELECT id FROM participants
         WHERE pool_id = (SELECT id FROM pools WHERE name = 'Football for All')
           AND user_id = (SELECT id FROM users WHERE username = 'joshoreilly')),
      (SELECT id FROM groups WHERE name = ?),
      (SELECT t.id FROM teams t JOIN groups g ON t.group_id = g.id WHERE g.name = ? AND t.name = ?),
      (SELECT t.id FROM teams t JOIN groups g ON t.group_id = g.id WHERE g.name = ? AND t.name = ?),
      NULL
    )
  `);
  fillRow3.run("A", "A", "Mexico",    "A", "South Africa", "A", "South Korea");
  fillRow2.run("B", "B", "Canada",    "B", "Switzerland");
  fillRow3.run("C", "C", "Brazil",    "C", "Morocco",      "C", "Scotland");
  fillRow3.run("D", "D", "Australia", "D", "Paraguay",     "D", "USA");
  fillRow2.run("J", "J", "Argentina", "J", "Austria");
} catch (_) {}

// One-off goodwill fix (2026-06-29): R32-1 finished South Africa 0-1 Canada (Canada/away
// won). These 58 users had predicted_winner = 'home' (South Africa) but entered a score
// where the away side wins — their winner toggle contradicted their own predicted score,
// so they scored 0 even though their score called Canada correctly. (At pick time the
// winner/score validation was advisory-only and didn't block the save — PR #39 fixes that
// going forward.) Flip these 58 to 'away' so the pick matches their score and earns the
// R32 winner points. Scoped to an explicit id allowlist AND guarded on predicted_winner =
// 'home', so it touches ONLY these rows and ONLY while still 'home'. Idempotent: once
// flipped, the WHERE no longer matches (0 rows on rerun); R32-1 is finished/locked so a
// pick can't revert to 'home'. Deliberately does NOT touch the 15 Case-B users (correct
// winner 'away' + a contradicting score) — flipping them would strip points they earned.
// Reversible via the explicit id list (flip the same 58 back to 'home').
try {
  db.prepare(`
    UPDATE knockout_predictions
    SET predicted_winner = 'away'
    WHERE match_id = 'R32-1' AND predicted_winner = 'home'
      AND participant_id IN (55,98,152,258,400,444,596,654,733,764,905,1075,1182,1300,1301,1377,1501,1504,1540,1547,1558,1620,1636,1657,2280,2287,2333,2346,2391,2513,2530,2704,2776,2889,3100,3248,3264,3348,3411,3433,3529,3533,3827,3870,3898,3913,3980,4077,4163,4173,4193,4221,4295,4310,4408,4420,4550,4558)
  `).run();
} catch (_) {}

// One-off goodwill fix (2026-06-30): R32-4 finished Brazil 2-1 Japan (Brazil/home won).
// These 49 users had predicted_winner = 'away' (Japan) but entered a score where the home
// side (Brazil) wins — their winner toggle contradicted their own predicted score, so they
// scored 0 KO-winner points even though their score called Brazil correctly. (Same class as
// the R32-1 fix above; PR #39 blocks this going forward.) Flip these 49 to 'home' so the
// pick matches their score and earns the R32 winner points (3, doubled to 6 for the 18 who
// entered exactly 2-1). Scoped to an explicit id allowlist AND guarded on predicted_winner =
// 'away' + home_score > away_score, so it touches ONLY these rows and ONLY while still
// contradicting. Idempotent: once flipped the WHERE no longer matches (0 rows on rerun);
// R32-4 is finished/locked so a pick can't revert. Deliberately does NOT touch the 150 users
// who picked Japan consistently, the 47 with a draw score, or the 45 with no score entered.
// Reversible via the explicit id list (flip the same 49 back to 'away').
// Verified on a prod-backup copy: 49 rows change, rerun = 0, R32-4 distribution away 291->242
// / home 1553->1602 with no other rows touched, 201 points restored across the 49.
try {
  db.prepare(`
    UPDATE knockout_predictions
    SET predicted_winner = 'home'
    WHERE match_id = 'R32-4' AND predicted_winner = 'away'
      AND predicted_home_score IS NOT NULL AND predicted_away_score IS NOT NULL
      AND predicted_home_score > predicted_away_score
      AND participant_id IN (30,55,189,261,292,544,591,1028,1131,1481,1534,1659,1881,1964,2046,2064,2170,2187,2240,2417,2418,2422,2447,2753,2791,3062,3068,3072,3121,3142,3166,3235,3256,3351,3433,3434,3526,3739,3913,3953,4021,4028,4210,4480,4544,4569,4570,4633,4635)
  `).run();
} catch (_) {}

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

// Seed default public pool for EPL 26/27
const existingEPLPool = db.prepare("SELECT id FROM pools WHERE name = 'English Premier League 26/27' AND is_public = 1").get();
if (!existingEPLPool) {
  db.prepare("INSERT INTO pools (name, sport, tournament, password, is_public) VALUES (?, ?, ?, ?, 1)").run("English Premier League 26/27", "soccer", "epl2627", "");
}

// Seed default public pool for La Liga 26/27
const existingLaLigaPool = db.prepare("SELECT id FROM pools WHERE name = 'La Liga 26/27' AND is_public = 1").get();
if (!existingLaLigaPool) {
  db.prepare("INSERT INTO pools (name, sport, tournament, password, is_public) VALUES (?, ?, ?, ?, 1)").run("La Liga 26/27", "soccer", "laliga2627", "");
}

// Seed default public pool for Serie A 26/27
const existingSerieAPool = db.prepare("SELECT id FROM pools WHERE name = 'Serie A 26/27' AND is_public = 1").get();
if (!existingSerieAPool) {
  db.prepare("INSERT INTO pools (name, sport, tournament, password, is_public) VALUES (?, ?, ?, ?, 1)").run("Serie A 26/27", "soccer", "seriea2627", "");
}

// Seed default public pool for NFL 26/27
const existingNFLPool = db.prepare("SELECT id FROM pools WHERE name = 'NFL 26/27' AND is_public = 1").get();
if (!existingNFLPool) {
  db.prepare("INSERT INTO pools (name, sport, tournament, password, is_public) VALUES (?, ?, ?, ?, 1)").run("NFL 26/27", "americanfootball", "nfl2627", "");
}

// Seed default public pool for Champions League 26/27. Created before the 2026-08-27 league-phase
// draw, so it exists with no clubs or fixtures until the sync seeds them — joinable throughout,
// and the season/bracket entry window opens off the fixtures once they land.
const existingUCLPool = db.prepare("SELECT id FROM pools WHERE name = 'Champions League 26/27' AND is_public = 1").get();
if (!existingUCLPool) {
  db.prepare("INSERT INTO pools (name, sport, tournament, password, is_public) VALUES (?, ?, ?, ?, 1)").run("Champions League 26/27", "soccer", "ucl2627", "");
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

// Admin void for player awards: freezes picks AND makes the section score 0 for the whole pool
try { db.exec("ALTER TABLE pools ADD COLUMN player_awards_voided INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Pool admin toggle to disable exact score predictions
try { db.exec("ALTER TABLE pools ADD COLUMN exact_scores_disabled INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Pool admin toggle to unlock group stage predictions after matches have started
try { db.exec("ALTER TABLE pools ADD COLUMN group_stage_unlocked INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Pool admin toggle to unlock champion picks during group stage
try { db.exec("ALTER TABLE pools ADD COLUMN champion_unlocked INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

// Manual score adjustments a pool admin can apply to a participant (league pools).
// Itemized: each row is one +/- adjustment with a reason; the participant's total gets the sum.
db.exec(`
  CREATE TABLE IF NOT EXISTS score_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    points INTEGER NOT NULL,
    reason TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Add dob column to wc_players
try { db.exec("ALTER TABLE wc_players ADD COLUMN dob TEXT"); } catch (_) {}

// Seed / refresh WC 2026 squad players from squad-data.js.
// Re-seeds automatically when the DB is empty or contains stale pre-2026-final data
// (detected by checking for a player added in the June 2026 official squads update).
try {
  const WC2026_SQUADS = require("./squad-data");
  const teamsByCode = {};
  for (const row of db.prepare("SELECT id, code FROM teams").all()) teamsByCode[row.code] = row.id;

  const totalSquadPlayers = Object.values(WC2026_SQUADS).reduce((s, arr) => s + arr.length, 0);
  const currentCount = db.prepare("SELECT COUNT(*) as c FROM wc_players").get().c;

  // Reseed if empty or count doesn't match the official squad list
  if (currentCount !== totalSquadPlayers) {
    const reseed = db.transaction(() => {
      // Clear dependent tables first to satisfy FK constraints
      db.prepare("DELETE FROM player_award_results").run();
      db.prepare("DELETE FROM player_award_picks").run();
      db.prepare("DELETE FROM wc_players").run();
      const insert = db.prepare("INSERT OR IGNORE INTO wc_players (name, team_id, position, dob) VALUES (?, ?, ?, ?)");
      for (const [code, players] of Object.entries(WC2026_SQUADS)) {
        const teamId = teamsByCode[code];
        if (!teamId) { console.log(`Skipping unknown team code: ${code}`); continue; }
        for (const p of players) insert.run(p.name, teamId, p.pos, p.dob || null);
      }
    });
    reseed();
    console.log(`Seeded WC 2026 squad players (${totalSquadPlayers} players across 48 teams).`);
  }
} catch (err) {
  console.log("Could not seed WC players:", err.message);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Premier League 26/27 Schema
// ═══════════════════════════════════════════════════════════════════════════════

db.exec(`
  CREATE TABLE IF NOT EXISTS pl2627_teams (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    short_name TEXT
  );

  CREATE TABLE IF NOT EXISTS pl2627_matches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    matchday     INTEGER NOT NULL CHECK(matchday BETWEEN 1 AND 38),
    home_team_id INTEGER NOT NULL REFERENCES pl2627_teams(id),
    away_team_id INTEGER NOT NULL REFERENCES pl2627_teams(id),
    match_date   TEXT,
    home_score   INTEGER,
    away_score   INTEGER,
    status       TEXT DEFAULT 'upcoming' CHECK(status IN ('upcoming','live','finished'))
  );

  CREATE TABLE IF NOT EXISTS pl2627_match_predictions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id       INTEGER NOT NULL REFERENCES participants(id),
    match_id             INTEGER NOT NULL REFERENCES pl2627_matches(id),
    predicted_outcome    TEXT NOT NULL CHECK(predicted_outcome IN ('home','draw','away')),
    predicted_home_score INTEGER,
    predicted_away_score INTEGER,
    created_at           TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, match_id)
  );

  CREATE TABLE IF NOT EXISTS pl2627_season_predictions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    position       INTEGER NOT NULL CHECK(position BETWEEN 1 AND 20),
    team_id        INTEGER NOT NULL REFERENCES pl2627_teams(id),
    created_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, position)
  );

  CREATE TABLE IF NOT EXISTS pl2627_players (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    team_id  INTEGER NOT NULL REFERENCES pl2627_teams(id),
    position TEXT NOT NULL CHECK(position IN ('GK','DF','MF','FW')),
    UNIQUE(name, team_id)
  );

  CREATE TABLE IF NOT EXISTS pl2627_player_award_picks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id  INTEGER NOT NULL REFERENCES participants(id),
    award_category  TEXT NOT NULL CHECK(award_category IN ('golden_boot','golden_glove','pots','ypots','mots')),
    player_id       INTEGER REFERENCES pl2627_players(id),
    team_id         INTEGER REFERENCES pl2627_teams(id),
    updated_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, award_category)
  );

  CREATE TABLE IF NOT EXISTS pl2627_player_award_results (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    award_category TEXT NOT NULL UNIQUE CHECK(award_category IN ('golden_boot','golden_glove','pots','ypots','mots')),
    player_id      INTEGER REFERENCES pl2627_players(id),
    team_id        INTEGER REFERENCES pl2627_teams(id),
    set_at         TEXT DEFAULT (datetime('now'))
  );
`);

// Add manager column if missing
try { db.exec("ALTER TABLE pl2627_teams ADD COLUMN manager TEXT"); } catch (_) { /* already exists */ }

// Seed PL 26/27 teams (2026-27 season)
const PL_TEAMS_2627 = [
  { name: "Arsenal", code: "ARS", short_name: "Arsenal", manager: "Mikel Arteta" },
  { name: "Aston Villa", code: "AVL", short_name: "Aston Villa", manager: "Unai Emery" },
  { name: "AFC Bournemouth", code: "BOU", short_name: "Bournemouth", manager: "Marco Rose" },
  { name: "Brentford", code: "BRE", short_name: "Brentford", manager: "Keith Andrews" },
  { name: "Brighton & Hove Albion", code: "BHA", short_name: "Brighton", manager: "Fabian Hürzeler" },
  { name: "Chelsea", code: "CHE", short_name: "Chelsea", manager: "Xabi Alonso" },
  { name: "Coventry City", code: "COV", short_name: "Coventry", manager: "Frank Lampard" },
  { name: "Crystal Palace", code: "CRY", short_name: "Crystal Palace", manager: "Oliver Glasner" },
  { name: "Everton", code: "EVE", short_name: "Everton", manager: "David Moyes" },
  { name: "Fulham", code: "FUL", short_name: "Fulham", manager: "Marco Silva" },
  { name: "Hull City", code: "HUL", short_name: "Hull City", manager: "Sergej Jakirović" },
  { name: "Ipswich Town", code: "IPS", short_name: "Ipswich", manager: "Kieran McKenna" },
  { name: "Leeds United", code: "LEE", short_name: "Leeds", manager: "Daniel Farke" },
  { name: "Liverpool", code: "LIV", short_name: "Liverpool", manager: "Andoni Iraola" },
  { name: "Manchester City", code: "MCI", short_name: "Man City", manager: "Pep Guardiola" },
  { name: "Manchester United", code: "MUN", short_name: "Man United", manager: "Michael Carrick" },
  { name: "Newcastle United", code: "NEW", short_name: "Newcastle", manager: "Eddie Howe" },
  { name: "Nottingham Forest", code: "NFO", short_name: "Nott'm Forest", manager: "Vítor Pereira" },
  { name: "Sunderland", code: "SUN", short_name: "Sunderland", manager: "Régis Le Bris" },
  { name: "Tottenham Hotspur", code: "TOT", short_name: "Tottenham", manager: "Roberto De Zerbi" },
];

const pl2627Seeded = db.prepare("SELECT COUNT(*) as c FROM pl2627_teams").get().c > 0;
if (!pl2627Seeded) {
  const insertPLTeam = db.prepare("INSERT INTO pl2627_teams (name, code, short_name, manager) VALUES (?, ?, ?, ?)");
  for (const t of PL_TEAMS_2627) insertPLTeam.run(t.name, t.code, t.short_name, t.manager);
  console.log("Seeded PL 26/27 teams (20 clubs).");
}

// Update manager names on existing teams
for (const t of PL_TEAMS_2627) {
  db.prepare("UPDATE pl2627_teams SET manager = ? WHERE code = ? AND (manager IS NULL OR manager != ?)").run(t.manager, t.code, t.manager);
}

// Migrate existing PL teams from 25/26 to 26/27 if needed
const existingPLTeams = db.prepare("SELECT code FROM pl2627_teams").all().map(t => t.code);
const expectedCodes = PL_TEAMS_2627.map(t => t.code);
const hasOldTeams = existingPLTeams.some(c => !expectedCodes.includes(c));
if (hasOldTeams) {
  const relegated = ["WHU", "WOL", "LEI", "SOU"];
  for (const code of relegated) {
    const team = db.prepare("SELECT id FROM pl2627_teams WHERE code = ?").get(code);
    if (team) {
      // Only delete if no match/prediction data references this team
      const hasMatches = db.prepare("SELECT COUNT(*) as c FROM pl2627_matches WHERE home_team_id = ? OR away_team_id = ?").get(team.id, team.id).c > 0;
      const hasSeasonPreds = db.prepare("SELECT COUNT(*) as c FROM pl2627_season_predictions WHERE team_id = ?").get(team.id).c > 0;
      if (!hasMatches && !hasSeasonPreds) {
        db.prepare("DELETE FROM pl2627_player_award_picks WHERE team_id = ?").run(team.id);
        db.prepare("DELETE FROM pl2627_player_award_results WHERE team_id = ?").run(team.id);
        db.prepare("DELETE FROM pl2627_players WHERE team_id = ?").run(team.id);
        db.prepare("DELETE FROM pl2627_teams WHERE id = ?").run(team.id);
        console.log(`Removed old PL team: ${code}`);
      } else {
        console.log(`Skipped removing ${code} — has existing match/prediction data.`);
      }
    }
  }
  // Add new promoted teams
  const insertPLTeam = db.prepare("INSERT OR IGNORE INTO pl2627_teams (name, code, short_name) VALUES (?, ?, ?)");
  for (const t of PL_TEAMS_2627) {
    if (!existingPLTeams.includes(t.code)) {
      insertPLTeam.run(t.name, t.code, t.short_name);
      console.log(`Added new PL team: ${t.code}`);
    }
  }
}

// Seed / refresh PL 26/27 squad players from pl-squad-data.js. Re-seeds automatically when
// pl2627_players is empty or its count no longer matches the squad file (so editing the file
// and redeploying updates squads). Only player-based award picks/results are cleared on reseed;
// manager-of-the-season picks (team-based, player_id NULL) are preserved.
try {
  const PL_SQUADS = require("./pl-squad-data");
  const plTeamsByCode = {};
  for (const row of db.prepare("SELECT id, code FROM pl2627_teams").all()) plTeamsByCode[row.code] = row.id;

  const totalPLPlayers = Object.values(PL_SQUADS).reduce((s, arr) => s + arr.length, 0);
  const currentPLCount = db.prepare("SELECT COUNT(*) as c FROM pl2627_players").get().c;

  if (currentPLCount !== totalPLPlayers) {
    const reseed = db.transaction(() => {
      db.prepare("DELETE FROM pl2627_player_award_results").run();
      db.prepare("DELETE FROM pl2627_player_award_picks WHERE player_id IS NOT NULL").run();
      db.prepare("DELETE FROM pl2627_players").run();
      const insert = db.prepare("INSERT OR IGNORE INTO pl2627_players (name, team_id, position) VALUES (?, ?, ?)");
      for (const [code, players] of Object.entries(PL_SQUADS)) {
        const teamId = plTeamsByCode[code];
        if (!teamId) { console.log(`PL squads: skipping unknown team code ${code}`); continue; }
        for (const p of players) insert.run(p.name, teamId, p.pos);
      }
    });
    reseed();
    console.log(`Seeded PL 26/27 squad players (${totalPLPlayers} across ${Object.keys(PL_SQUADS).length} clubs).`);
  }
} catch (err) {
  console.log("PL squad seed skipped:", err.message);
}

// ── Generalized league engine (EPL + La Liga + Serie A + NFL + future leagues) ───────
// One config-driven set of tables shared by every league (see leagues.js), keyed by a `league`
// discriminator. EPL is migrated off pl2627_* below (one-time). WC2022/WC2026 stay separate
// (knockout shape).
//
// The tables are sport-agnostic; the sport-specific meaning lives in leagues.js:
//   league_teams.conference/division    — NFL only (AFC/NFC × 4). NULL for soccer.
//   league_season_predictions.position  — soccer: finishing position 1..N.
//                                         NFL:    the slot's `pos` (see NFL_SLOTS).
//   league_match_predictions.predicted_margin_band — NFL only; soccer uses the score columns.
db.exec(`
  CREATE TABLE IF NOT EXISTS league_teams (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    league     TEXT NOT NULL,
    name       TEXT NOT NULL,
    code       TEXT NOT NULL,
    short_name TEXT,
    manager    TEXT,
    crest_url  TEXT,
    conference TEXT,
    division   TEXT,
    UNIQUE(league, code)
  );
  CREATE TABLE IF NOT EXISTS league_matches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    league       TEXT NOT NULL,
    matchday     INTEGER NOT NULL,
    home_team_id INTEGER NOT NULL REFERENCES league_teams(id),
    away_team_id INTEGER NOT NULL REFERENCES league_teams(id),
    match_date   TEXT,
    home_score   INTEGER,
    away_score   INTEGER,
    status       TEXT DEFAULT 'upcoming' CHECK(status IN ('upcoming','live','finished'))
  );
  CREATE TABLE IF NOT EXISTS league_match_predictions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id       INTEGER NOT NULL REFERENCES participants(id),
    match_id             INTEGER NOT NULL REFERENCES league_matches(id),
    predicted_outcome    TEXT NOT NULL CHECK(predicted_outcome IN ('home','draw','away')),
    predicted_home_score INTEGER,
    predicted_away_score INTEGER,
    created_at           TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, match_id)
  );
  CREATE TABLE IF NOT EXISTS league_season_predictions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    league         TEXT NOT NULL,
    position       INTEGER NOT NULL,
    team_id        INTEGER NOT NULL REFERENCES league_teams(id),
    created_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, league, position)
  );
  CREATE TABLE IF NOT EXISTS league_players (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    league   TEXT NOT NULL,
    name     TEXT NOT NULL,
    team_id  INTEGER NOT NULL REFERENCES league_teams(id),
    position TEXT NOT NULL,
    UNIQUE(league, name, team_id)
  );
  CREATE TABLE IF NOT EXISTS league_award_picks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id  INTEGER NOT NULL REFERENCES participants(id),
    league          TEXT NOT NULL,
    award_category  TEXT NOT NULL,
    player_id       INTEGER REFERENCES league_players(id),
    team_id         INTEGER REFERENCES league_teams(id),
    updated_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, league, award_category)
  );
  CREATE TABLE IF NOT EXISTS league_award_results (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    league         TEXT NOT NULL,
    award_category TEXT NOT NULL,
    player_id      INTEGER REFERENCES league_players(id),
    team_id        INTEGER REFERENCES league_teams(id),
    set_at         TEXT DEFAULT (datetime('now')),
    UNIQUE(league, award_category)
  );
  -- Champions League knockout bracket. A tie is the unit users predict: two legs for every round
  -- before the final, one match for the final itself, so leg2_match_id is NULL there. Ties are
  -- created by the CL sync as each round's draw publishes — a round simply has no rows until its
  -- pairings exist. round is a UCL_KO_ROUNDS key (po/r16/qf/sf/final) and tie_no orders the
  -- bracket within a round.
  CREATE TABLE IF NOT EXISTS league_ko_ties (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    league         TEXT NOT NULL,
    round          TEXT NOT NULL,
    tie_no         INTEGER NOT NULL,
    home_team_id   INTEGER REFERENCES league_teams(id),
    away_team_id   INTEGER REFERENCES league_teams(id),
    leg1_match_id  INTEGER REFERENCES league_matches(id),
    leg2_match_id  INTEGER REFERENCES league_matches(id),
    winner_team_id INTEGER REFERENCES league_teams(id),
    UNIQUE(league, round, tie_no)
  );
  -- One pick per participant per tie: who goes through. Scored per UCL_KO_ROUNDS.pts.
  CREATE TABLE IF NOT EXISTS league_ko_predictions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    league         TEXT NOT NULL,
    tie_id         INTEGER NOT NULL REFERENCES league_ko_ties(id),
    team_id        INTEGER NOT NULL REFERENCES league_teams(id),
    updated_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(participant_id, tie_id)
  );
  CREATE INDEX IF NOT EXISTS idx_league_ko_ties_league ON league_ko_ties(league, round);
  CREATE INDEX IF NOT EXISTS idx_league_ko_preds_league ON league_ko_predictions(league, tie_id);
`);

// Columns added after the tables shipped — idempotent, safe to re-run on an existing DB.
// football-data's team id. Needed for feed-seeded leagues because its 3-letter tla is NOT unique
// across Europe (Bayern München and Barcelona are both "FCB"), so the Champions League has to
// match clubs and fixtures on this id rather than on code.
try { db.exec("ALTER TABLE league_teams ADD COLUMN api_team_id INTEGER"); } catch (_) { /* exists */ }
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_league_teams_api ON league_teams(league, api_team_id) WHERE api_team_id IS NOT NULL"); } catch (_) {}
try { db.exec("ALTER TABLE league_teams ADD COLUMN conference TEXT"); } catch (_) { /* exists */ }
try { db.exec("ALTER TABLE league_teams ADD COLUMN division TEXT"); } catch (_) { /* exists */ }
try { db.exec("ALTER TABLE league_match_predictions ADD COLUMN predicted_margin_band TEXT"); } catch (_) { /* exists */ }

// league_players.position originally carried CHECK(position IN ('GK','DF','MF','FW')) — soccer's
// four positions. NFL rosters use QB/WR/CB/…, which that CHECK rejects outright, and SQLite can't
// drop a CHECK in place, so rebuild the table without it. Same shape as the pools rebuild below:
// guarded by a settings flag, foreign_keys toggled OUTSIDE the transaction (the pragma is a no-op
// mid-transaction), ids copied verbatim so award picks/results FKing into league_players survive,
// and an in-transaction foreign_key_check rolls it all back if anything is off.
try {
  const hasCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'league_players'").get()?.sql?.includes("CHECK");
  if (hasCheck) {
    // api_player_id is added later by scores.js, so it may or may not exist yet — carry it only if present.
    const cols = db.prepare("PRAGMA table_info(league_players)").all().map((c) => c.name);
    const hasApiId = cols.includes("api_player_id");
    const fkWasOn = db.pragma("foreign_keys", { simple: true });
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE league_players_new (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            league   TEXT NOT NULL,
            name     TEXT NOT NULL,
            team_id  INTEGER NOT NULL REFERENCES league_teams(id),
            position TEXT NOT NULL,
            ${hasApiId ? "api_player_id INTEGER," : ""}
            UNIQUE(league, name, team_id)
          );
          INSERT INTO league_players_new (id, league, name, team_id, position${hasApiId ? ", api_player_id" : ""})
            SELECT id, league, name, team_id, position${hasApiId ? ", api_player_id" : ""} FROM league_players;
          DROP TABLE league_players;
          ALTER TABLE league_players_new RENAME TO league_players;
        `);
        if (hasApiId) db.exec("CREATE INDEX IF NOT EXISTS idx_league_players_api ON league_players(league, api_player_id)");
        const violations = db.pragma("foreign_key_check", { simple: false });
        if (violations.length > 0) throw new Error(`foreign_key_check failed: ${JSON.stringify(violations.slice(0, 3))}`);
      })();
      console.log("Rebuilt league_players without the soccer-only position CHECK.");
    } finally {
      if (fkWasOn) db.pragma("foreign_keys = ON");
    }
  }
} catch (err) {
  console.log("league_players position-CHECK rebuild skipped:", err.message);
}

// Seed league_teams (idempotent) + refresh manager/crest/name/conference/division, then bring
// league_players in line with each league's squad file: a first-time seed when the league is
// empty, otherwise a row-by-row reconcile that leaves award picks on unaffected players intact.
const LIVE_SQUAD_SOURCES = new Set(["pulselive"]);
try {
  const { leagues: LEAGUE_CONFIG } = require("./leagues");
  for (const [code, cfg] of Object.entries(LEAGUE_CONFIG)) {
    const { teams: cfgTeams, squads: cfgSquads } = cfg.squadData;
    const insertTeam = db.prepare("INSERT OR IGNORE INTO league_teams (league, name, code, short_name, manager, crest_url, conference, division) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const updateTeam = db.prepare("UPDATE league_teams SET name = ?, short_name = ?, manager = ?, crest_url = ?, conference = ?, division = ? WHERE league = ? AND code = ?");
    for (const t of cfgTeams) {
      insertTeam.run(code, t.name, t.code, t.short_name, t.manager ?? null, t.crest ?? null, t.conference ?? null, t.division ?? null);
      updateTeam.run(t.name, t.short_name, t.manager ?? null, t.crest ?? null, t.conference ?? null, t.division ?? null, code, t.code);
    }
    const teamIdByCode = {};
    for (const row of db.prepare("SELECT id, code FROM league_teams WHERE league = ?").all(code)) teamIdByCode[row.code] = row.id;

    const totalPlayers = Object.values(cfgSquads).reduce((s, a) => s + a.length, 0);
    const currentCount = db.prepare("SELECT COUNT(*) AS c FROM league_players WHERE league = ?").get(code).c;

    // Leagues with a live squad feed own their roster once seeded — re-applying the file would
    // undo the feed's transfers (see syncPLSquads in scores.js). Only seed those from empty.
    // Gate on the sources actually implemented, not on cfg.squadSource: 'laliga' and 'espn' are
    // declared in leagues.js but no squad sync exists for them, so those leagues are file-driven.
    const liveSourced = LIVE_SQUAD_SOURCES.has(cfg.squadSource);
    if (totalPlayers === 0) {
      // A league whose clubs come from the feed rather than a squad file (ucl2627 before the
      // league-phase draw). An empty file describes nothing, so it must never be treated as
      // "this league should have no players" — that would delete squads backfilled later.
    } else if (currentCount === 0) {
      const seed = db.transaction(() => {
        const insP = db.prepare("INSERT OR IGNORE INTO league_players (league, name, team_id, position) VALUES (?, ?, ?, ?)");
        for (const [tc, players] of Object.entries(cfgSquads)) {
          const tid = teamIdByCode[tc];
          if (!tid) { console.log(`${code}: squads skip unknown team ${tc}`); continue; }
          for (const p of players) insP.run(code, p.name, tid, p.pos);
        }
      });
      seed();
      console.log(`Seeded ${code} squads (${totalPlayers} players across ${cfgTeams.length} clubs).`);
    } else if (!liveSourced && currentCount !== totalPlayers) {
      // File-driven league whose squad file changed (a manual transfer-window refresh). Reconcile
      // row-by-row instead of wiping the league: rows are keyed on the player's name, so unchanged
      // players keep their id and everyone's award picks on them survive. Only a player who has
      // actually left the league loses his row — and with it any pick, matching how the PL sync
      // treats a transfer out.
      const key = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
      // Keyed by name, but a name can legitimately belong to two different players at different
      // clubs (e.g. two Moussa Diarras in La Liga), so each key holds a list.
      const desired = new Map();
      for (const [tc, players] of Object.entries(cfgSquads)) {
        const tid = teamIdByCode[tc];
        if (!tid) { console.log(`${code}: squads skip unknown team ${tc}`); continue; }
        for (const p of players) {
          const k = key(p.name);
          if (!desired.has(k)) desired.set(k, []);
          desired.get(k).push({ name: p.name, pos: p.pos, tid });
        }
      }
      const reconcile = db.transaction(() => {
        const insP = db.prepare("INSERT INTO league_players (league, name, team_id, position) VALUES (?, ?, ?, ?)");
        const updP = db.prepare("UPDATE league_players SET name = ?, position = ?, team_id = ? WHERE id = ?");
        const delPicks = db.prepare("DELETE FROM league_award_picks WHERE player_id = ?");
        const delResults = db.prepare("DELETE FROM league_award_results WHERE player_id = ?");
        const delP = db.prepare("DELETE FROM league_players WHERE id = ?");
        // Player picks denormalise the club at pick time, and the community-predictions query
        // prefers that copy over the player's live club — so it has to follow him on a transfer
        // or the pick renders under his old badge.
        const syncPickTeam = db.prepare("UPDATE league_award_picks SET team_id = ? WHERE player_id = ?");
        let added = 0, removed = 0, moved = 0;

        for (const row of db.prepare("SELECT id, name, team_id, position FROM league_players WHERE league = ?").all(code)) {
          const candidates = desired.get(key(row.name)) || [];
          if (!candidates.length) { delPicks.run(row.id); delResults.run(row.id); delP.run(row.id); removed++; continue; }
          // Prefer the candidate still at this club, so a same-named pair isn't swapped and a
          // genuine intra-league transfer falls through to the club change below.
          let i = candidates.findIndex((c) => c.tid === row.team_id);
          if (i < 0) i = 0;
          const [want] = candidates.splice(i, 1);
          if (want.name !== row.name || want.pos !== row.position || want.tid !== row.team_id) {
            updP.run(want.name, want.pos, want.tid, row.id);
            if (want.tid !== row.team_id) { syncPickTeam.run(want.tid, row.id); moved++; }
          }
        }
        for (const list of desired.values()) for (const p of list) { insP.run(code, p.name, p.tid, p.pos); added++; }
        console.log(`Reconciled ${code} squads: +${added} / -${removed} / ${moved} moved club (${totalPlayers} players).`);
      });
      reconcile();
    }
  }
} catch (err) {
  console.log("League seed skipped:", err.message);
}

// One-time migration of EPL data off pl2627_* into league_* (league='epl2627'). Idempotent —
// guarded by a settings flag; pl2627_* tables are left intact until a later cleanup.
try {
  const eplHasLegacy = db.prepare("SELECT COUNT(*) AS c FROM pl2627_teams").get().c > 0;
  const alreadyMigrated = db.prepare("SELECT value FROM settings WHERE key = 'epl_migrated_to_league'").get();
  if (eplHasLegacy && !alreadyMigrated) {
    // Diagnostics: predictions/picks are re-linked to freshly-seeded rows, mostly by structural
    // id (safe) but award picks by player name (can drift vs the live-synced pl2627_players).
    // Count anything that fails to re-link so a silent data loss shows up in the deploy log.
    const stats = { matchPreds: 0, matchPredsSkipped: 0, seasonPreds: 0, seasonPredsSkipped: 0,
      awardPicks: 0, awardPicksUnmapped: 0, awardResults: 0, awardResultsUnmapped: 0 };
    const unmappedPlayers = new Set();
    const migrate = db.transaction(() => {
      // old pl2627_teams.id -> new league_teams.id (matched by code, seeded above)
      const newTeamByCode = {};
      for (const r of db.prepare("SELECT id, code FROM league_teams WHERE league = 'epl2627'").all()) newTeamByCode[r.code] = r.id;
      const insTeam = db.prepare("INSERT OR IGNORE INTO league_teams (league, name, code, short_name, manager) VALUES ('epl2627', ?, ?, ?, ?)");
      const teamMap = {};
      for (const t of db.prepare("SELECT * FROM pl2627_teams").all()) {
        if (!newTeamByCode[t.code]) {
          insTeam.run(t.name, t.code, t.short_name, t.manager);
          newTeamByCode[t.code] = db.prepare("SELECT id FROM league_teams WHERE league = 'epl2627' AND code = ?").get(t.code).id;
        }
        teamMap[t.id] = newTeamByCode[t.code];
      }
      // matches: old id -> new id
      const matchMap = {};
      const insMatch = db.prepare("INSERT INTO league_matches (league, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status) VALUES ('epl2627', ?, ?, ?, ?, ?, ?, ?)");
      for (const m of db.prepare("SELECT * FROM pl2627_matches").all()) {
        const h = teamMap[m.home_team_id], a = teamMap[m.away_team_id];
        if (!h || !a) continue;
        matchMap[m.id] = insMatch.run(m.matchday, h, a, m.match_date, m.home_score, m.away_score, m.status).lastInsertRowid;
      }
      const insMP = db.prepare("INSERT OR IGNORE INTO league_match_predictions (participant_id, match_id, predicted_outcome, predicted_home_score, predicted_away_score, created_at) VALUES (?, ?, ?, ?, ?, ?)");
      for (const p of db.prepare("SELECT * FROM pl2627_match_predictions").all()) {
        const nm = matchMap[p.match_id];
        if (nm) { insMP.run(p.participant_id, nm, p.predicted_outcome, p.predicted_home_score, p.predicted_away_score, p.created_at); stats.matchPreds++; }
        else stats.matchPredsSkipped++;
      }
      const insSP = db.prepare("INSERT OR IGNORE INTO league_season_predictions (participant_id, league, position, team_id, created_at) VALUES (?, 'epl2627', ?, ?, ?)");
      for (const s of db.prepare("SELECT * FROM pl2627_season_predictions").all()) {
        const nt = teamMap[s.team_id];
        if (nt) { insSP.run(s.participant_id, s.position, nt, s.created_at); stats.seasonPreds++; }
        else stats.seasonPredsSkipped++;
      }
      // old player id -> new player id (matched by team code + player name)
      const newPlayerByKey = {};
      for (const r of db.prepare("SELECT lp.id, lp.name, lt.code FROM league_players lp JOIN league_teams lt ON lp.team_id = lt.id WHERE lp.league = 'epl2627'").all()) newPlayerByKey[`${r.code}|${r.name}`] = r.id;
      const oldPlayerMap = {};
      const oldPlayerName = {};
      for (const op of db.prepare("SELECT pl.id, pl.name, t.code FROM pl2627_players pl JOIN pl2627_teams t ON pl.team_id = t.id").all()) {
        oldPlayerMap[op.id] = newPlayerByKey[`${op.code}|${op.name}`] || null;
        oldPlayerName[op.id] = `${op.code}|${op.name}`;
      }
      const insAP = db.prepare("INSERT OR IGNORE INTO league_award_picks (participant_id, league, award_category, player_id, team_id, updated_at) VALUES (?, 'epl2627', ?, ?, ?, ?)");
      for (const ap of db.prepare("SELECT * FROM pl2627_player_award_picks").all()) {
        const mappedPlayer = ap.player_id ? oldPlayerMap[ap.player_id] : null;
        // A player-type pick (had a player_id) that maps to null lost its player — a real,
        // silent data loss. A team-type pick (team_id only) legitimately has no player.
        if (ap.player_id && !mappedPlayer) { stats.awardPicksUnmapped++; unmappedPlayers.add(oldPlayerName[ap.player_id] || `id:${ap.player_id}`); }
        insAP.run(ap.participant_id, ap.award_category, mappedPlayer, ap.team_id ? teamMap[ap.team_id] : null, ap.updated_at);
        stats.awardPicks++;
      }
      const insAR = db.prepare("INSERT OR IGNORE INTO league_award_results (league, award_category, player_id, team_id, set_at) VALUES ('epl2627', ?, ?, ?, ?)");
      for (const ar of db.prepare("SELECT * FROM pl2627_player_award_results").all()) {
        const mappedPlayer = ar.player_id ? oldPlayerMap[ar.player_id] : null;
        if (ar.player_id && !mappedPlayer) { stats.awardResultsUnmapped++; unmappedPlayers.add(oldPlayerName[ar.player_id] || `id:${ar.player_id}`); }
        insAR.run(ar.award_category, mappedPlayer, ar.team_id ? teamMap[ar.team_id] : null, ar.set_at);
        stats.awardResults++;
      }
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('epl_migrated_to_league', ?)").run(new Date().toISOString());
    });
    migrate();
    console.log(`Migrated EPL (pl2627_*) into the league_* engine: ${stats.matchPreds} match preds, ${stats.seasonPreds} season preds, ${stats.awardPicks} award picks, ${stats.awardResults} award results.`);
    if (stats.matchPredsSkipped || stats.seasonPredsSkipped) {
      console.log(`  ⚠ EPL migration skipped predictions (unmapped team/match): ${stats.matchPredsSkipped} match, ${stats.seasonPredsSkipped} season.`);
    }
    if (stats.awardPicksUnmapped || stats.awardResultsUnmapped) {
      console.log(`  ⚠ EPL migration: ${stats.awardPicksUnmapped} award pick(s) + ${stats.awardResultsUnmapped} award result(s) had a player that did not match the new squad seed and were migrated WITHOUT a player. Unmatched players: ${[...unmappedPlayers].join(", ")}`);
    }
  }
} catch (err) {
  console.log("EPL migration skipped:", err.message);
}

// One-time migration: pool names are unique *per tournament* rather than globally, so
// e.g. an EPL pool and a World Cup pool may share a name. SQLite can't drop the original
// column-level `name UNIQUE`, so we rebuild the table with UNIQUE(name, tournament).
// Guarded by a settings flag (idempotent). foreign_keys must be toggled OUTSIDE the
// transaction (the pragma is a no-op mid-transaction); participants/messages/pool_admins
// FK into pools by id, and ids are copied verbatim, so no child rows are orphaned. An
// in-transaction foreign_key_check rolls the whole thing back if anything is off.
try {
  const alreadyDone = db.prepare("SELECT value FROM settings WHERE key = 'pools_name_unique_per_tournament'").get();
  if (!alreadyDone) {
    const fkWasOn = db.pragma("foreign_keys", { simple: true });
    db.pragma("foreign_keys = OFF");
    try {
      const rebuildPools = db.transaction(() => {
        db.exec(`
          CREATE TABLE pools_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            sport TEXT NOT NULL DEFAULT 'soccer',
            tournament TEXT NOT NULL DEFAULT 'wc2026',
            password TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            is_test INTEGER NOT NULL DEFAULT 0,
            mock_date TEXT,
            is_public INTEGER NOT NULL DEFAULT 0,
            chat_closed INTEGER NOT NULL DEFAULT 0,
            champion_w2_locked INTEGER NOT NULL DEFAULT 0,
            player_awards_locked INTEGER NOT NULL DEFAULT 0,
            exact_scores_disabled INTEGER NOT NULL DEFAULT 0,
            group_stage_unlocked INTEGER NOT NULL DEFAULT 0,
            champion_unlocked INTEGER NOT NULL DEFAULT 0,
            player_awards_voided INTEGER NOT NULL DEFAULT 0,
            UNIQUE(name, tournament)
          )
        `);
        db.exec(`
          INSERT INTO pools_new
            (id, name, sport, tournament, password, created_at, is_test, mock_date, is_public,
             chat_closed, champion_w2_locked, player_awards_locked, exact_scores_disabled,
             group_stage_unlocked, champion_unlocked, player_awards_voided)
          SELECT
            id, name, sport, tournament, password, created_at, is_test, mock_date, is_public,
            chat_closed, champion_w2_locked, player_awards_locked, exact_scores_disabled,
            group_stage_unlocked, champion_unlocked, player_awards_voided
          FROM pools
        `);

        const before = db.prepare("SELECT COUNT(*) c FROM pools").get().c;
        const after = db.prepare("SELECT COUNT(*) c FROM pools_new").get().c;
        if (before !== after) throw new Error(`pools row count mismatch (${before} -> ${after}); aborting`);

        db.exec("DROP TABLE pools");
        db.exec("ALTER TABLE pools_new RENAME TO pools");

        const violations = db.pragma("foreign_key_check", { simple: false });
        if (violations && violations.length) throw new Error("foreign_key_check failed: " + JSON.stringify(violations));

        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pools_name_unique_per_tournament', ?)").run(new Date().toISOString());
      });
      rebuildPools();
      console.log("pools: migrated to UNIQUE(name, tournament) — names are now unique per tournament");
    } finally {
      if (fkWasOn) db.pragma("foreign_keys = ON");
    }
  }
} catch (err) {
  console.log("pools name-uniqueness migration skipped:", err.message);
}

// NOTE: add any new `ALTER TABLE pools ADD COLUMN` *below* the rebuild above — the rebuild
// recreates pools from a fixed column list and would drop columns added before it.

// League pools: admin override of the season-prediction lock. NULL = follow the auto
// deadline (first matchday); 1 = force locked; 0 = force open. Lets a league pool admin
// lock the champion/season picks early or reopen them after the deadline.
try { db.exec("ALTER TABLE pools ADD COLUMN season_locked_override INTEGER"); } catch (_) {}

module.exports = db;
