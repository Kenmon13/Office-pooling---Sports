const db = require("./db");
const { runResolver, syncWCKnockouts } = require("./koResolver");

const API_BASE = "https://api.football-data.org/v4";
const COMPETITION = "WC"; // FIFA World Cup
const PL_COMPETITION = "PL"; // Premier League

// football-data.org's 3-letter code (tla) differs from our seeded pl2627_teams.code
// for a few clubs. Map their tla -> our code so fixture/score sync can match them.
// Without this, e.g. Nottingham Forest's fixtures are all skipped.
const PL_TLA_ALIASES = { NOT: "NFO" }; // Nottingham Forest
const plCode = (tla) => PL_TLA_ALIASES[tla] || tla;

// Squads + managers come from premierleague.com's own public JSON API (Pulselive) — free,
// no key. compSeason 841 = the 2026/27 Premier League; club.abbr matches our pl2627_teams.code.
const PULSELIVE_BASE = "https://footballapi.pulselive.com/football";
const PULSELIVE_HEADERS = { Origin: "https://www.premierleague.com", Referer: "https://www.premierleague.com/" };
const PL_COMPSEASON = 841;
const PULSELIVE_POS = { G: "GK", D: "DF", M: "MF", F: "FW" };
// Auto-refresh of squads/managers STOPS after the summer transfer window closes, so late data
// changes can't disturb picks once the window is shut. TODO: confirm the exact 2026 deadline day.
const PL_SQUAD_LOCK_DATE = "2026-09-01T22:00:00Z";

async function fetchLiveScores() {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    console.log("No FOOTBALL_API_KEY set, skipping score refresh.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/competitions/${COMPETITION}/matches?status=IN_PLAY,PAUSED,FINISHED`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!res.ok) {
      console.log(`Score API responded ${res.status}, skipping.`);
      return;
    }

    const data = await res.json();
    const matches = data.matches || [];

    // Try both home/away orderings — the API's home/away may differ from our seed data
    const updateFinished = db.prepare(
      "UPDATE matches SET home_score = ?, away_score = ?, status = 'finished' WHERE home_team_id = (SELECT id FROM teams WHERE code = ?) AND away_team_id = (SELECT id FROM teams WHERE code = ?) AND status IN ('upcoming', 'live')"
    );

    const updateLive = db.prepare(
      "UPDATE matches SET home_score = ?, away_score = ?, status = 'live' WHERE home_team_id = (SELECT id FROM teams WHERE code = ?) AND away_team_id = (SELECT id FROM teams WHERE code = ?) AND status IN ('upcoming', 'live')"
    );

    let finished = 0;
    let live = 0;
    for (const m of matches) {
      const homeCode = m.homeTeam?.tla;
      const awayCode = m.awayTeam?.tla;
      if (!homeCode || !awayCode) continue;

      if (m.status === "FINISHED") {
        const homeScore = m.score?.fullTime?.home;
        const awayScore = m.score?.fullTime?.away;
        if (homeScore != null && awayScore != null) {
          // Try matching as-is first
          let result = updateFinished.run(homeScore, awayScore, homeCode, awayCode);
          if (result.changes === 0) {
            // Try reversed — our DB may have home/away swapped vs the API
            result = updateFinished.run(awayScore, homeScore, awayCode, homeCode);
          }
          if (result.changes > 0) finished++;
        }
      } else {
        // IN_PLAY or PAUSED — use current score
        const homeScore = m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? 0;
        const awayScore = m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? 0;
        let result = updateLive.run(homeScore, awayScore, homeCode, awayCode);
        if (result.changes === 0) {
          result = updateLive.run(awayScore, homeScore, awayCode, homeCode);
        }
        if (result.changes > 0) live++;
      }
    }

    if (finished > 0 || live > 0) {
      const parts = [];
      if (finished > 0) parts.push(`${finished} finished`);
      if (live > 0) parts.push(`${live} live`);
      console.log(`Score update: ${parts.join(", ")} (${matches.length} from API).`);
    } else if (matches.length > 0) {
      console.log(`Score check: ${matches.length} matches from API, 0 new updates.`);
    }

  } catch (err) {
    console.log("Score fetch error:", err.message);
  } finally {
    // Promote finished groups to KO slots + cascade KO winners into the next round. This runs
    // on every cycle regardless of whether the group-score fetch above succeeded — it is a
    // local DB operation and must not be gated behind the external API. Otherwise a KO winner
    // set by the separate 30-min KO sync never advances whenever the group-score fetch is
    // rate-limited (football-data free tier) or transiently failing.
    runResolver();
  }
}

// ── Premier League fixture & score sync ────────────────────────────────────────

async function syncPLFixtures() {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    console.log("No FOOTBALL_API_KEY set, skipping PL fixture sync.");
    return { ok: false, reason: "no_api_key" };
  }

  try {
    const res = await fetch(`${API_BASE}/competitions/${PL_COMPETITION}/matches?season=2026`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!res.ok) {
      console.log(`PL fixture API responded ${res.status}, skipping.`);
      return { ok: false, reason: "api_status", status: res.status };
    }

    const data = await res.json();
    const matches = data.matches || [];
    if (matches.length === 0) {
      console.log("PL fixtures: no matches returned from API yet.");
      return { ok: false, reason: "api_empty", apiCount: 0 };
    }

    // Build team code → local ID lookup
    const localTeams = db.prepare("SELECT id, code FROM pl2627_teams").all();
    const teamByCode = {};
    for (const t of localTeams) teamByCode[t.code] = t.id;

    // Identify each fixture by football-data's stable match id, so a game that is rescheduled
    // — even to a different matchday — updates the same row instead of leaving a stale
    // duplicate. Column + indexes must exist before the statements below are prepared.
    try { db.exec("ALTER TABLE pl2627_matches ADD COLUMN api_match_id INTEGER"); } catch (_) { /* column exists */ }
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_pl2627_matches_api ON pl2627_matches(api_match_id)"); } catch (_) {}
    // Kept for adopting pre-existing rows (seeded before api ids were stored) and guarding dupes.
    try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_pl2627_matches_unique ON pl2627_matches(matchday, home_team_id, away_team_id)"); } catch (_) {}

    const findByApiId = db.prepare("SELECT id, matchday FROM pl2627_matches WHERE api_match_id = ?");
    const findByTuple = db.prepare("SELECT id FROM pl2627_matches WHERE matchday = ? AND home_team_id = ? AND away_team_id = ? AND api_match_id IS NULL");
    const updateRow = db.prepare(`UPDATE pl2627_matches
      SET matchday = ?, home_team_id = ?, away_team_id = ?, match_date = ?,
        home_score = COALESCE(?, home_score), away_score = COALESCE(?, away_score),
        status = ?, api_match_id = ? WHERE id = ?`);
    const insertRow = db.prepare(`INSERT INTO pl2627_matches
      (matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, api_match_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    let inserted = 0, updated = 0, remapped = 0, skipped = 0, pruned = 0;
    const unknownCodes = new Set();
    const seenApiIds = new Set();

    const applyAll = db.transaction(() => {
      for (const m of matches) {
        const homeCode = plCode(m.homeTeam?.tla);
        const awayCode = plCode(m.awayTeam?.tla);
        const matchday = m.matchday;
        const apiId = m.id ?? null;
        if (!homeCode || !awayCode || !matchday) { skipped++; continue; }

        const homeId = teamByCode[homeCode];
        const awayId = teamByCode[awayCode];
        if (!homeId || !awayId) {
          if (!homeId) unknownCodes.add(homeCode);
          if (!awayId) unknownCodes.add(awayCode);
          skipped++;
          continue;
        }

        // Convert UTC date to the format we use (YYYY-MM-DD HH:MM)
        let matchDate = null;
        if (m.utcDate) matchDate = m.utcDate.replace("T", " ").replace("Z", "").slice(0, 16);

        let status = "upcoming";
        let homeScore = null, awayScore = null;
        if (m.status === "FINISHED") {
          status = "finished";
          homeScore = m.score?.fullTime?.home ?? null;
          awayScore = m.score?.fullTime?.away ?? null;
        } else if (m.status === "IN_PLAY" || m.status === "PAUSED") {
          status = "live";
          homeScore = m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? 0;
          awayScore = m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? 0;
        }

        if (apiId != null) seenApiIds.add(apiId);

        // 1) Known fixture (by stable api id) — updates in place, incl. a matchday change.
        const byId = apiId != null ? findByApiId.get(apiId) : null;
        if (byId) {
          updateRow.run(matchday, homeId, awayId, matchDate, homeScore, awayScore, status, apiId, byId.id);
          if (byId.matchday !== matchday) remapped++; else updated++;
          continue;
        }
        // 2) Adopt a pre-existing row seeded before api ids were tracked; backfill its api id.
        const byTuple = findByTuple.get(matchday, homeId, awayId);
        if (byTuple) {
          updateRow.run(matchday, homeId, awayId, matchDate, homeScore, awayScore, status, apiId, byTuple.id);
          updated++;
          continue;
        }
        // 3) Brand-new fixture.
        insertRow.run(matchday, homeId, awayId, matchDate, homeScore, awayScore, status, apiId);
        inserted++;
      }

      // Prune fixtures the API no longer returns — but only the safe ones: rows that came from
      // the API (have an api id), are still upcoming, and that nobody has predicted. Guarded on
      // a plausibly-complete response so a partial/short API reply can't wipe the schedule.
      if (matches.length >= 300) {
        const candidates = db.prepare(`
          SELECT m.id, m.api_match_id FROM pl2627_matches m
          WHERE m.api_match_id IS NOT NULL AND m.status = 'upcoming'
            AND NOT EXISTS (SELECT 1 FROM pl2627_match_predictions p WHERE p.match_id = m.id)
        `).all();
        const del = db.prepare("DELETE FROM pl2627_matches WHERE id = ?");
        for (const c of candidates) {
          if (!seenApiIds.has(c.api_match_id)) { del.run(c.id); pruned++; }
        }
      }
    });
    applyAll();

    console.log(`PL fixture sync: ${inserted} inserted, ${updated} updated, ${remapped} remapped, ${pruned} pruned, ${skipped} skipped (${matches.length} total from API).`);
    return {
      ok: true,
      apiCount: matches.length,
      inserted,
      updated,
      remapped,
      pruned,
      skipped,
      unknownCodes: [...unknownCodes],
    };
  } catch (err) {
    console.log("PL fixture sync error:", err.message);
    return { ok: false, reason: "exception", message: err.message };
  }
}

async function syncPLScores() {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) return;

  try {
    const res = await fetch(`${API_BASE}/competitions/${PL_COMPETITION}/matches?season=2026&status=IN_PLAY,PAUSED,FINISHED`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!res.ok) return;

    const data = await res.json();
    const matches = data.matches || [];

    const localTeams = db.prepare("SELECT id, code FROM pl2627_teams").all();
    const teamByCode = {};
    for (const t of localTeams) teamByCode[t.code] = t.id;

    const updateFinished = db.prepare(
      "UPDATE pl2627_matches SET home_score = ?, away_score = ?, status = 'finished' WHERE home_team_id = ? AND away_team_id = ? AND status IN ('upcoming', 'live')"
    );
    const updateLive = db.prepare(
      "UPDATE pl2627_matches SET home_score = ?, away_score = ?, status = 'live' WHERE home_team_id = ? AND away_team_id = ? AND status IN ('upcoming', 'live')"
    );

    let finished = 0, live = 0;
    for (const m of matches) {
      const homeId = teamByCode[plCode(m.homeTeam?.tla)];
      const awayId = teamByCode[plCode(m.awayTeam?.tla)];
      if (!homeId || !awayId) continue;

      if (m.status === "FINISHED") {
        const hs = m.score?.fullTime?.home, as_ = m.score?.fullTime?.away;
        if (hs != null && as_ != null) {
          const r = updateFinished.run(hs, as_, homeId, awayId);
          if (r.changes > 0) finished++;
        }
      } else {
        const hs = m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? 0;
        const as_ = m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? 0;
        const r = updateLive.run(hs, as_, homeId, awayId);
        if (r.changes > 0) live++;
      }
    }

    if (finished > 0 || live > 0) {
      console.log(`PL score update: ${finished} finished, ${live} live.`);
    }
  } catch (err) {
    console.log("PL score fetch error:", err.message);
  }
}

// ── Start all refresh loops ────────────────────────────────────────────────────

// Check for new results every 5 minutes
function startScoreRefresh() {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    console.log("FOOTBALL_API_KEY not set. Scores will not auto-update.");
    console.log("Get a free key at https://www.football-data.org/client/register");
    return;
  }

  console.log("Auto score refresh enabled (every 5 minutes).");
  fetchLiveScores();
  setInterval(fetchLiveScores, 5 * 60 * 1000);

  // WC knockout sync (teams + scores from football-data.org for R32 onward).
  // Runs every 30 min — bracket changes far less often than live scores.
  syncWCKnockouts();
  setInterval(syncWCKnockouts, 30 * 60 * 1000);

  // PL score refresh (every 5 minutes)
  syncPLScores();
  setInterval(syncPLScores, 5 * 60 * 1000);

  // Schedule PL fixture sync for June 19, 2026 at 10:00 BST (09:00 UTC)
  // After that, re-sync fixtures daily to pick up any date changes
  const FIXTURE_RELEASE = new Date("2026-06-19T09:00:00Z");
  const now = new Date();
  const msUntilRelease = FIXTURE_RELEASE.getTime() - now.getTime();

  const existingMatches = db.prepare("SELECT COUNT(*) as c FROM pl2627_matches").get().c;

  if (msUntilRelease > 0) {
    console.log(`PL fixture sync scheduled for June 19 10:00 BST (in ${Math.round(msUntilRelease / 3600000)}h).`);
    setTimeout(() => {
      console.log("PL fixture release time reached — syncing fixtures now.");
      syncPLFixtures();
      // After initial sync, re-check daily for date/time updates
      setInterval(syncPLFixtures, 24 * 60 * 60 * 1000);
    }, msUntilRelease);
  } else if (existingMatches === 0) {
    // Past the release date but no matches yet — sync immediately
    console.log("PL fixture release date passed, no matches in DB — syncing now.");
    syncPLFixtures();
    setInterval(syncPLFixtures, 24 * 60 * 60 * 1000);
  } else {
    // Already have matches — just do daily re-syncs for date changes
    console.log(`PL fixtures: ${existingMatches} matches in DB. Daily re-sync enabled.`);
    syncPLFixtures();
    setInterval(syncPLFixtures, 24 * 60 * 60 * 1000);
  }

  // PL squad + manager sync from premierleague.com (Pulselive), daily. Self-guards so it stops
  // once the transfer window closes (PL_SQUAD_LOCK_DATE).
  syncPLSquads();
  setInterval(syncPLSquads, 24 * 60 * 60 * 1000);
}

// Pull PL squads + managers from premierleague.com (Pulselive). Each player is keyed by the
// API's stable playerId (new api_player_id column), so renames update in place while genuine
// departures are removed — along with their award picks (a transfer-out clears the pick). Only
// runs while the transfer window is open (before PL_SQUAD_LOCK_DATE). Per-team, and guarded so a
// short/empty response can't wipe a squad.
async function syncPLSquads() {
  if (new Date() > new Date(PL_SQUAD_LOCK_DATE)) {
    return { ok: false, reason: "window_closed" };
  }

  try {
    const teamsRes = await fetch(
      `${PULSELIVE_BASE}/teams?pageSize=100&compSeasons=${PL_COMPSEASON}&comps=1&altIds=true&page=0&type=team`,
      { headers: PULSELIVE_HEADERS }
    );
    if (!teamsRes.ok) return { ok: false, reason: "api_status", status: teamsRes.status };
    const plTeams = (await teamsRes.json()).content || [];
    if (plTeams.length === 0) return { ok: false, reason: "api_empty" };

    try { db.exec("ALTER TABLE pl2627_players ADD COLUMN api_player_id INTEGER"); } catch (_) { /* exists */ }
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_pl2627_players_api ON pl2627_players(api_player_id)"); } catch (_) {}

    const localByCode = {};
    for (const t of db.prepare("SELECT id, code FROM pl2627_teams").all()) localByCode[t.code] = t.id;

    const findByPid = db.prepare("SELECT id FROM pl2627_players WHERE api_player_id = ?");
    const findByName = db.prepare("SELECT id FROM pl2627_players WHERE team_id = ? AND name = ? AND api_player_id IS NULL");
    const updatePlayer = db.prepare("UPDATE pl2627_players SET name = ?, position = ?, team_id = ?, api_player_id = ? WHERE id = ?");
    const insertPlayer = db.prepare("INSERT OR IGNORE INTO pl2627_players (name, team_id, position, api_player_id) VALUES (?, ?, ?, ?)");
    const teamPlayers = db.prepare("SELECT id, api_player_id FROM pl2627_players WHERE team_id = ?");
    const delPicks = db.prepare("DELETE FROM pl2627_player_award_picks WHERE player_id = ?");
    const delResults = db.prepare("DELETE FROM pl2627_player_award_results WHERE player_id = ?");
    const delPlayer = db.prepare("DELETE FROM pl2627_players WHERE id = ?");
    const updateManager = db.prepare("UPDATE pl2627_teams SET manager = ? WHERE id = ?");

    let teamsProcessed = 0, playersAdded = 0, playersRemoved = 0, managersUpdated = 0;
    const skippedTeams = [];

    for (const plt of plTeams) {
      const code = plt.club?.abbr;
      const teamId = localByCode[code];
      if (!teamId) { if (code) skippedTeams.push(code); continue; }

      const staffRes = await fetch(
        `${PULSELIVE_BASE}/teams/${Math.trunc(plt.id)}/compseasons/${PL_COMPSEASON}/staff?altIds=true`,
        { headers: PULSELIVE_HEADERS }
      );
      if (!staffRes.ok) { skippedTeams.push(code); continue; }
      const staff = await staffRes.json();
      const apiPlayers = Array.isArray(staff.players) ? staff.players : [];
      // Guard: never wipe a squad on a suspiciously thin response.
      if (apiPlayers.length < 15) { skippedTeams.push(code); continue; }

      const applyTeam = db.transaction(() => {
        const seenPids = new Set();
        for (const p of apiPlayers) {
          const name = p.name?.display;
          const pos = PULSELIVE_POS[p.info?.position];
          const pid = p.playerId ?? null;
          if (!name || !pos || pid == null) continue;
          seenPids.add(pid);

          const byPid = findByPid.get(pid);
          if (byPid) { updatePlayer.run(name, pos, teamId, pid, byPid.id); continue; }
          const byName = findByName.get(teamId, name); // adopt file-seeded row, backfill pid
          if (byName) { updatePlayer.run(name, pos, teamId, pid, byName.id); continue; }
          if (insertPlayer.run(name, teamId, pos, pid).changes) playersAdded++;
        }

        // Remove anyone on this team not in the fresh squad: transferred out (pid unseen) or a
        // stale file-seeded row that Pulselive superseded (api_player_id still NULL). Their
        // award picks/results go too.
        for (const ex of teamPlayers.all(teamId)) {
          if (ex.api_player_id == null || !seenPids.has(ex.api_player_id)) {
            delPicks.run(ex.id); delResults.run(ex.id); delPlayer.run(ex.id);
            playersRemoved++;
          }
        }

        const mgr = (staff.officials || []).find((o) => o.role === "Manager" && o.active !== false);
        if (mgr?.name?.display) { updateManager.run(mgr.name.display, teamId); managersUpdated++; }
      });
      applyTeam();
      teamsProcessed++;
    }

    console.log(`PL squad sync: ${teamsProcessed} teams, +${playersAdded} players, -${playersRemoved} removed, ${managersUpdated} managers.`);
    return { ok: true, teamsProcessed, playersAdded, playersRemoved, managersUpdated, skippedTeams };
  } catch (err) {
    console.log("PL squad sync error:", err.message);
    return { ok: false, reason: "exception", message: err.message };
  }
}

module.exports = { startScoreRefresh, syncPLFixtures, syncPLSquads };
