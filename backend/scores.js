const db = require("./db");
const { runResolver, syncWCKnockouts } = require("./koResolver");
const { leagues: LEAGUE_CONFIG, matchdayForFdMatch, koRoundForMatchday } = require("./leagues");

const API_BASE = "https://api.football-data.org/v4";
const COMPETITION = "WC"; // FIFA World Cup

// football-data.org's 3-letter code (tla) differs from our league_teams.code for a few clubs.
// Map their tla -> our code, per league, so fixture/score sync can match them. Without this,
// e.g. Nottingham Forest's fixtures are all skipped. Extend LALIGA when football-data's PD tlas
// are confirmed against our laliga.com-derived codes (unmatched codes are logged as unknownCodes).
// KEY = football-data.org's tla, VALUE = our league_teams.code. Only clubs whose codes differ
// need an entry; matching codes fall through untouched. A wrong entry would misattribute a club's
// fixtures, so only high-confidence, collision-free mappings live here — anything unconfirmed is
// left out and will surface as an unknownCode in the sync log once PD season 2026 publishes.
const TLA_ALIASES = {
  epl2627: { NOT: "NFO" }, // Nottingham Forest
  laliga2627: {
    // Confirmed against football-data's PD/2026 team list (the other 15 clubs' tlas match ours).
    ATL: "ATM", // Atlético de Madrid
    FCB: "BAR", // FC Barcelona
    MAL: "MGA", // Málaga
    DEP: "RCD", // Deportivo de La Coruña
    SAN: "RAC", // Racing Santander
  },
};
const mapCode = (leagueCode, tla) => (TLA_ALIASES[leagueCode] || {})[tla] || tla;

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

// ── Domestic league fixture & score sync (config-driven: EPL, La Liga, …) ────────

// Ensure the shared league_matches has the api-id column + indexes (idempotent). The unique
// index is scoped by league so two leagues can share a matchday/home/away without colliding.
function ensureLeagueMatchIndexes() {
  try { db.exec("ALTER TABLE league_matches ADD COLUMN api_match_id INTEGER"); } catch (_) { /* exists */ }
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_league_matches_api ON league_matches(league, api_match_id)"); } catch (_) {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_league_matches_unique ON league_matches(league, matchday, home_team_id, away_team_id)"); } catch (_) {}
}

// Resolve a football-data match side ({ id, tla }) to our league_teams.id.
//
// Round-robin leagues match on the tla (via TLA_ALIASES where ours differs). That can't work for
// a pan-European competition: football-data hands the same tla to different clubs — Bayern
// München and Barcelona are both "FCB" — so a feed-seeded league matches on the feed's own team
// id instead, which is unique and already stored as league_teams.api_team_id.
function buildTeamResolver(leagueCode, cfg) {
  const byCode = {}, byApiId = {};
  for (const t of db.prepare("SELECT id, code, api_team_id FROM league_teams WHERE league = ?").all(leagueCode)) {
    byCode[t.code] = t.id;
    if (t.api_team_id != null) byApiId[t.api_team_id] = t.id;
  }
  const fn = (side) => (cfg?.seedTeamsFromFeed
    ? byApiId[side?.id] ?? null
    : byCode[mapCode(leagueCode, side?.tla)] ?? null);
  // Callers log the codes they couldn't place; for feed-seeded leagues that's the club name.
  fn.label = (side) => (cfg?.seedTeamsFromFeed ? (side?.shortName || side?.name || `id:${side?.id}`) : mapCode(leagueCode, side?.tla));
  return fn;
}

// Sync one league's fixtures into league_matches, dispatching to whichever feed owns it.
async function syncLeagueFixtures(leagueCode) {
  const cfg = LEAGUE_CONFIG[leagueCode];
  if (!cfg) return { ok: false, reason: "unknown_league" };
  if (cfg.feed === "espn") return syncEspnFixtures(leagueCode);
  // Clubs must exist before fixtures can reference them: a feed-seeded league has no squad file
  // to seed from, so the draw's team list has to land first.
  if (cfg.seedTeamsFromFeed) await syncFootballDataTeams(leagueCode);
  const result = await syncFootballDataFixtures(leagueCode);
  if (cfg.koRounds) syncKoTies(leagueCode);
  return result;
}

// Refresh one league's live/finished scores, dispatching to whichever feed owns it.
async function syncLeagueScores(leagueCode) {
  const cfg = LEAGUE_CONFIG[leagueCode];
  if (!cfg) return;
  if (cfg.feed === "espn") return syncEspnScores(leagueCode);
  const result = await syncFootballDataScores(leagueCode);
  // A finished leg can settle a tie, so the bracket is recomputed off the back of every score run.
  if (cfg.koRounds) syncKoTies(leagueCode);
  return result;
}

// Sync one league's fixtures from football-data.org into league_matches (WHERE league=code).
// ── football-data fallbacks for a feed-seeded competition ──────────────────────
//
// football-data's competition-wide match endpoints return an empty list for the Champions
// League's current season even after the draw and the calendar are published — both
// /competitions/CL/matches?season=2026 and the date-windowed /matches?competitions=CL answer 200
// with count 0, while the same season's clubs and the previous season's 189 matches come back
// fine. The fixtures are only reachable per club, via /teams/{id}/matches.
//
// The domestic leagues are unaffected, so this is a fallback rather than the default path: it
// costs one request per club (36 for the UCL) against a free-tier budget of 10 requests a minute,
// which is why the requests are spaced rather than fired in parallel.
const FD_REQUEST_SPACING_MS = 6500;
const fdSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fdGet(path, apiKey, { retryOn429 = true } = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: { "X-Auth-Token": apiKey } });
    // The free tier answers a burst with 429 and clears on the minute boundary. One wait-and-retry
    // is enough; a second failure means the budget is genuinely gone, so give the caller the miss.
    if (res.status === 429 && retryOn429) {
      await fdSleep(60_000);
      return fdGet(path, apiKey, { retryOn429: false });
    }
    if (!res.ok) return { ok: false, status: res.status, matches: [] };
    const json = await res.json().catch(() => null);
    return { ok: true, status: res.status, matches: json?.matches || [] };
  } catch (err) {
    return { ok: false, status: 0, matches: [], message: err.message };
  }
}

// Gather a feed-seeded league's fixtures one club at a time. Every match comes back twice, once
// from each side, so they're de-duplicated on the feed's match id.
async function fetchFixturesPerTeam(leagueCode, cfg, apiKey) {
  const teams = db.prepare(
    "SELECT api_team_id FROM league_teams WHERE league = ? AND api_team_id IS NOT NULL"
  ).all(leagueCode);
  const byId = new Map();
  let failed = 0;
  for (const [i, t] of teams.entries()) {
    if (i > 0) await fdSleep(FD_REQUEST_SPACING_MS);
    const r = await fdGet(`/teams/${t.api_team_id}/matches?competitions=${cfg.fdCompetition}&season=2026`, apiKey);
    if (!r.ok) { failed++; continue; }
    for (const m of r.matches) if (m.id != null) byId.set(m.id, m);
  }
  return { matches: [...byId.values()], teamsQueried: teams.length, failed };
}

// Scores for a feed-seeded league can't come off the competition endpoint either. The fixtures
// already carry the feed's own match ids, so ask for exactly the ones that could have moved —
// kicked off, not yet recorded as finished — which is one request on a matchday and none the
// rest of the time. The day-old floor keeps a match we somehow never closed out from being
// re-fetched forever.
async function fetchScoresByStoredIds(leagueCode, apiKey) {
  const ids = db.prepare(`
    SELECT api_match_id FROM league_matches
    WHERE league = ? AND api_match_id IS NOT NULL AND status IN ('upcoming', 'live')
      AND match_date IS NOT NULL
      AND match_date <= datetime('now') AND match_date >= datetime('now', '-1 day')
  `).all(leagueCode).map((r) => r.api_match_id);
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    if (i > 0) await fdSleep(FD_REQUEST_SPACING_MS);
    const r = await fdGet(`/matches?ids=${ids.slice(i, i + 50).join(",")}`, apiKey);
    out.push(...r.matches);
  }
  return out;
}

async function syncFootballDataFixtures(leagueCode) {
  const cfg = LEAGUE_CONFIG[leagueCode];
  if (!cfg) return { ok: false, reason: "unknown_league" };
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    console.log(`No FOOTBALL_API_KEY set, skipping ${leagueCode} fixture sync.`);
    return { ok: false, reason: "no_api_key" };
  }

  try {
    const res = await fetch(`${API_BASE}/competitions/${cfg.fdCompetition}/matches?season=2026`, {
      headers: { "X-Auth-Token": apiKey },
    });
    if (!res.ok) {
      console.log(`${leagueCode} fixture API responded ${res.status}, skipping.`);
      return { ok: false, reason: "api_status", status: res.status };
    }

    const data = await res.json();
    let matches = data.matches || [];
    let via = "competition endpoint";
    // An empty competition response is the normal, permanent state for the Champions League —
    // see fetchFixturesPerTeam. For a domestic league it just means the season isn't loaded yet.
    if (matches.length === 0 && cfg.seedTeamsFromFeed) {
      const fb = await fetchFixturesPerTeam(leagueCode, cfg, apiKey);
      matches = fb.matches;
      via = `per-team fan-out (${fb.teamsQueried} clubs, ${fb.failed} failed)`;
    }
    if (matches.length === 0) {
      console.log(`${leagueCode} fixtures: no matches returned from API yet (${via}).`);
      return { ok: false, reason: "api_empty", apiCount: 0 };
    }

    const resolveTeam = buildTeamResolver(leagueCode, cfg);

    ensureLeagueMatchIndexes();
    const findByApiId = db.prepare("SELECT id, matchday FROM league_matches WHERE league = ? AND api_match_id = ?");
    const findByTuple = db.prepare("SELECT id FROM league_matches WHERE league = ? AND matchday = ? AND home_team_id = ? AND away_team_id = ? AND api_match_id IS NULL");
    const updateRow = db.prepare(`UPDATE league_matches
      SET matchday = ?, home_team_id = ?, away_team_id = ?, match_date = ?,
        home_score = COALESCE(?, home_score), away_score = COALESCE(?, away_score),
        status = ?, api_match_id = ? WHERE id = ?`);
    const insertRow = db.prepare(`INSERT INTO league_matches
      (league, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, api_match_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    let inserted = 0, updated = 0, remapped = 0, skipped = 0, pruned = 0;
    const unknownCodes = new Set();
    const seenApiIds = new Set();

    const applyAll = db.transaction(() => {
      for (const m of matches) {
        // Knockout legs are renumbered onto their own matchdays so they can't collide with the
        // league phase; round-robin leagues just get the API's matchday back.
        const matchday = matchdayForFdMatch(cfg, m);
        const apiId = m.id ?? null;
        if (!matchday) { skipped++; continue; }

        const homeId = resolveTeam(m.homeTeam);
        const awayId = resolveTeam(m.awayTeam);
        if (!homeId || !awayId) {
          if (!homeId) unknownCodes.add(resolveTeam.label(m.homeTeam));
          if (!awayId) unknownCodes.add(resolveTeam.label(m.awayTeam));
          skipped++;
          continue;
        }

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

        const byId = apiId != null ? findByApiId.get(leagueCode, apiId) : null;
        if (byId) {
          updateRow.run(matchday, homeId, awayId, matchDate, homeScore, awayScore, status, apiId, byId.id);
          if (byId.matchday !== matchday) remapped++; else updated++;
          continue;
        }
        const byTuple = findByTuple.get(leagueCode, matchday, homeId, awayId);
        if (byTuple) {
          updateRow.run(matchday, homeId, awayId, matchDate, homeScore, awayScore, status, apiId, byTuple.id);
          updated++;
          continue;
        }
        insertRow.run(leagueCode, matchday, homeId, awayId, matchDate, homeScore, awayScore, status, apiId);
        inserted++;
      }

      // Prune fixtures the API no longer returns — only API-sourced, still-upcoming, un-predicted
      // rows, and only on a plausibly-complete response (guards against a short/partial reply).
      if (matches.length >= 300) {
        const candidates = db.prepare(`
          SELECT m.id, m.api_match_id FROM league_matches m
          WHERE m.league = ? AND m.api_match_id IS NOT NULL AND m.status = 'upcoming'
            AND NOT EXISTS (SELECT 1 FROM league_match_predictions p WHERE p.match_id = m.id)
        `).all(leagueCode);
        const del = db.prepare("DELETE FROM league_matches WHERE id = ?");
        for (const c of candidates) {
          if (!seenApiIds.has(c.api_match_id)) { del.run(c.id); pruned++; }
        }
      }
    });
    applyAll();

    console.log(`${leagueCode} fixture sync: ${inserted} inserted, ${updated} updated, ${remapped} remapped, ${pruned} pruned, ${skipped} skipped (${matches.length} from API via ${via}).`);
    return { ok: true, apiCount: matches.length, inserted, updated, remapped, pruned, skipped, unknownCodes: [...unknownCodes] };
  } catch (err) {
    console.log(`${leagueCode} fixture sync error:`, err.message);
    return { ok: false, reason: "exception", message: err.message };
  }
}

// Refresh one league's live/finished scores from football-data.org into league_matches.
async function syncFootballDataScores(leagueCode) {
  const cfg = LEAGUE_CONFIG[leagueCode];
  if (!cfg) return;
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) return;

  try {
    const res = await fetch(`${API_BASE}/competitions/${cfg.fdCompetition}/matches?season=2026&status=IN_PLAY,PAUSED,FINISHED`, {
      headers: { "X-Auth-Token": apiKey },
    });
    if (!res.ok) return;

    let matches = (await res.json()).matches || [];
    if (matches.length === 0 && cfg.seedTeamsFromFeed) matches = await fetchScoresByStoredIds(leagueCode, apiKey);
    const resolveTeam = buildTeamResolver(leagueCode, cfg);

    const updateFinished = db.prepare(
      "UPDATE league_matches SET home_score = ?, away_score = ?, status = 'finished' WHERE league = ? AND home_team_id = ? AND away_team_id = ? AND status IN ('upcoming', 'live')"
    );
    const updateLive = db.prepare(
      "UPDATE league_matches SET home_score = ?, away_score = ?, status = 'live' WHERE league = ? AND home_team_id = ? AND away_team_id = ? AND status IN ('upcoming', 'live')"
    );

    let finished = 0, live = 0;
    for (const m of matches) {
      const homeId = resolveTeam(m.homeTeam);
      const awayId = resolveTeam(m.awayTeam);
      if (!homeId || !awayId) continue;

      if (m.status === "FINISHED") {
        const hs = m.score?.fullTime?.home, as_ = m.score?.fullTime?.away;
        if (hs != null && as_ != null && updateFinished.run(hs, as_, leagueCode, homeId, awayId).changes > 0) finished++;
      } else {
        const hs = m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? 0;
        const as_ = m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? 0;
        if (updateLive.run(hs, as_, leagueCode, homeId, awayId).changes > 0) live++;
      }
    }
    if (finished > 0 || live > 0) console.log(`${leagueCode} score update: ${finished} finished, ${live} live.`);
  } catch (err) {
    console.log(`${leagueCode} score fetch error:`, err.message);
  }
}

// ── ESPN fixture & score sync (NFL) ─────────────────────────────────────────────
// ESPN's public scoreboard is free and needs no key. Our league_teams.code IS ESPN's team
// abbreviation (nfl-squad-data.js is generated from this same feed), so there's no code mapping.
//
// ESPN splits the season into `seasontype`s, each with its own week numbering. We flatten both
// onto league_matches.matchday so the whole season is one continuous 1..22 sequence:
//
//   seasontype=2 (regular)   weeks 1..18  -> matchday 1..18
//   seasontype=3 (postseason) week 1 Wild Card    -> 19
//                             week 2 Divisional   -> 20
//                             week 3 Conference   -> 21   (resolves the conf-champion slots)
//                             week 4 Pro Bowl     -> skipped: an exhibition whose "teams" are
//                                                    AFC/NFC, not franchises
//                             week 5 Super Bowl   -> 22   (resolves the Super Bowl slot)
const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_PLAYOFF_WEEK_TO_MATCHDAY = { 1: 19, 2: 20, 3: 21, 5: 22 };

async function espnScoreboard(cfg, params) {
  const qs = new URLSearchParams({ dates: String(cfg.espnSeason), ...params });
  const res = await fetch(`${ESPN_SITE}/${cfg.espnPath}/scoreboard?${qs}`);
  if (!res.ok) throw new Error(`ESPN scoreboard responded ${res.status}`);
  return res.json();
}

// Flatten one ESPN event into the columns league_matches wants, or null if it isn't usable.
function normalizeEspnEvent(ev, matchday) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c) => c.homeAway === "home");
  const away = comp.competitors?.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const state = comp.status?.type?.state; // pre | in | post
  const status = state === "post" ? "finished" : state === "in" ? "live" : "upcoming";
  // Scores come back as strings, and are "0" (not null) before kickoff — only trust them once
  // the game is actually under way, otherwise every upcoming fixture looks like a 0-0 draw.
  const hs = status === "upcoming" ? null : Number(home.score ?? 0);
  const as_ = status === "upcoming" ? null : Number(away.score ?? 0);

  return {
    apiId: Number(ev.id),
    matchday,
    homeCode: home.team?.abbreviation,
    awayCode: away.team?.abbreviation,
    // "2026-09-13T17:00Z" -> "2026-09-13 17:00", matching the football-data path.
    matchDate: ev.date ? ev.date.replace("T", " ").replace("Z", "").slice(0, 16) : null,
    homeScore: Number.isFinite(hs) ? hs : null,
    awayScore: Number.isFinite(as_) ? as_ : null,
    status,
  };
}

// Pull the full season (regular + playoffs) from ESPN. Runs on boot and daily.
async function syncEspnFixtures(leagueCode) {
  const cfg = LEAGUE_CONFIG[leagueCode];
  if (!cfg) return { ok: false, reason: "unknown_league" };

  try {
    const events = [];
    for (let week = 1; week <= cfg.matchdays; week++) {
      const data = await espnScoreboard(cfg, { seasontype: "2", week: String(week) });
      for (const ev of data.events || []) events.push([ev, week]);
    }
    for (const [espnWeek, matchday] of Object.entries(ESPN_PLAYOFF_WEEK_TO_MATCHDAY)) {
      const data = await espnScoreboard(cfg, { seasontype: "3", week: espnWeek });
      for (const ev of data.events || []) events.push([ev, matchday]);
    }

    if (events.length === 0) {
      console.log(`${leagueCode} fixtures: no events returned from ESPN yet.`);
      return { ok: false, reason: "api_empty", apiCount: 0 };
    }

    const teamByCode = {};
    for (const t of db.prepare("SELECT id, code FROM league_teams WHERE league = ?").all(leagueCode)) teamByCode[t.code] = t.id;

    ensureLeagueMatchIndexes();
    const findByApiId = db.prepare("SELECT id, matchday FROM league_matches WHERE league = ? AND api_match_id = ?");
    const updateRow = db.prepare(`UPDATE league_matches
      SET matchday = ?, home_team_id = ?, away_team_id = ?, match_date = ?,
        home_score = COALESCE(?, home_score), away_score = COALESCE(?, away_score),
        status = ?, api_match_id = ? WHERE id = ?`);
    const insertRow = db.prepare(`INSERT INTO league_matches
      (league, matchday, home_team_id, away_team_id, match_date, home_score, away_score, status, api_match_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    let inserted = 0, updated = 0, remapped = 0, skipped = 0;
    const unknownCodes = new Set();

    db.transaction(() => {
      for (const [ev, matchday] of events) {
        const m = normalizeEspnEvent(ev, matchday);
        if (!m || !m.apiId) { skipped++; continue; }

        const homeId = teamByCode[m.homeCode];
        const awayId = teamByCode[m.awayCode];
        if (!homeId || !awayId) {
          if (!homeId) unknownCodes.add(m.homeCode);
          if (!awayId) unknownCodes.add(m.awayCode);
          skipped++;
          continue;
        }

        const existing = findByApiId.get(leagueCode, m.apiId);
        if (existing) {
          updateRow.run(m.matchday, homeId, awayId, m.matchDate, m.homeScore, m.awayScore, m.status, m.apiId, existing.id);
          if (existing.matchday !== m.matchday) remapped++; else updated++;
          continue;
        }
        insertRow.run(leagueCode, m.matchday, homeId, awayId, m.matchDate, m.homeScore, m.awayScore, m.status, m.apiId);
        inserted++;
      }
    })();

    console.log(`${leagueCode} fixture sync (ESPN): ${inserted} inserted, ${updated} updated, ${remapped} remapped, ${skipped} skipped (${events.length} events).`);
    return { ok: true, apiCount: events.length, inserted, updated, remapped, skipped, unknownCodes: [...unknownCodes] };
  } catch (err) {
    console.log(`${leagueCode} fixture sync error (ESPN):`, err.message);
    return { ok: false, reason: "exception", message: err.message };
  }
}

// Refresh live/finished scores. Unlike the fixture sync this only asks for the current slate —
// ESPN's bare scoreboard returns whatever week is in play, so it's one request, not 22.
async function syncEspnScores(leagueCode) {
  const cfg = LEAGUE_CONFIG[leagueCode];
  if (!cfg) return;

  try {
    const res = await fetch(`${ESPN_SITE}/${cfg.espnPath}/scoreboard`);
    if (!res.ok) return;
    const events = (await res.json()).events || [];

    // Matched on ESPN's event id, so a fixture that got rescheduled to another week still lands.
    const update = db.prepare(
      "UPDATE league_matches SET home_score = ?, away_score = ?, status = ? WHERE league = ? AND api_match_id = ? AND status IN ('upcoming', 'live')"
    );

    let finished = 0, live = 0;
    for (const ev of events) {
      const m = normalizeEspnEvent(ev, null);
      if (!m || !m.apiId || m.status === "upcoming") continue;
      if (update.run(m.homeScore, m.awayScore, m.status, leagueCode, m.apiId).changes > 0) {
        if (m.status === "finished") finished++; else live++;
      }
    }
    if (finished > 0 || live > 0) console.log(`${leagueCode} score update (ESPN): ${finished} finished, ${live} live.`);
  } catch (err) {
    console.log(`${leagueCode} score fetch error (ESPN):`, err.message);
  }
}

// Back-compat alias for the admin "sync PL fixtures" button.
// Seed league_teams straight from football-data.org for a league whose clubs aren't known ahead
// of time (ucl2627 — the 36 come out of the league-phase draw). Idempotent and additive: it never
// deletes, so a club that drops out of the feed keeps any predictions already made against it.
async function syncFootballDataTeams(leagueCode) {
  const cfg = LEAGUE_CONFIG[leagueCode];
  if (!cfg?.seedTeamsFromFeed) return { ok: false, reason: "not_feed_seeded" };
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) return { ok: false, reason: "no_api_key" };

  try {
    const res = await fetch(`${API_BASE}/competitions/${cfg.fdCompetition}/teams?season=2026`, {
      headers: { "X-Auth-Token": apiKey },
    });
    // Before the draw the season simply doesn't exist yet — a 404 here is the normal state, not
    // a failure worth shouting about.
    if (!res.ok) return { ok: false, reason: "api_status", status: res.status };
    const teams = (await res.json()).teams || [];
    if (teams.length === 0) return { ok: false, reason: "api_empty" };
    // Guard against a partial response overwriting a complete draw.
    if (teams.length < cfg.teamCount) return { ok: false, reason: "api_short", got: teams.length };

    const insert = db.prepare(`INSERT INTO league_teams (league, name, code, short_name, manager, crest_url, api_team_id)
      VALUES (?, ?, ?, ?, NULL, ?, ?)`);
    const update = db.prepare("UPDATE league_teams SET name = ?, short_name = ?, crest_url = ? WHERE id = ?");
    const findByApi = db.prepare("SELECT id FROM league_teams WHERE league = ? AND api_team_id = ?");
    let added = 0;
    const apply = db.transaction(() => {
      // Codes must stay unique per league, but football-data's tla is NOT unique across Europe —
      // Bayern München and Barcelona are both "FCB". Clubs are therefore identified by the feed's
      // team id, and a tla that's already taken falls back to letters from the club's name.
      const taken = new Set(
        db.prepare("SELECT code FROM league_teams WHERE league = ?").all(leagueCode).map((r) => r.code)
      );
      const uniqueCode = (t) => {
        if (t.tla && !taken.has(t.tla)) return t.tla;
        const base = (t.shortName || t.name || t.tla || "").toUpperCase().replace(/[^A-Z]/g, "");
        for (let n = 3; n <= base.length; n++) {
          if (!taken.has(base.slice(0, n))) return base.slice(0, n);
        }
        for (let i = 2; i < 100; i++) {
          const c = `${t.tla || base.slice(0, 2)}${i}`;
          if (!taken.has(c)) return c;
        }
        return null;
      };

      for (const t of teams) {
        if (t.id == null) continue;
        const name = t.name || t.shortName || String(t.id);
        const short = t.shortName || name;
        const existing = findByApi.get(leagueCode, t.id);
        if (existing) { update.run(name, short, t.crest ?? null, existing.id); continue; }
        const code = uniqueCode(t);
        if (!code) continue;
        taken.add(code);
        insert.run(leagueCode, name, code, short, t.crest ?? null, t.id);
        added++;
      }
    });
    apply();
    console.log(`${leagueCode} team sync: ${teams.length} from API, ${added} new.`);
    return { ok: true, apiCount: teams.length, added };
  } catch (err) {
    console.log(`${leagueCode} team sync error:`, err.message);
    return { ok: false, reason: "exception", message: err.message };
  }
}

// Build/refresh the knockout bracket from already-synced league_matches. Each two-legged tie is
// one row keyed on the pairing; the final is a single leg. A tie resolves only when every leg is
// finished — on aggregate, and if that's level, on the second leg's penalty shootout, which is
// the only place football-data carries the tiebreak.
function syncKoTies(leagueCode) {
  const cfg = LEAGUE_CONFIG[leagueCode];
  if (!cfg?.koRounds) return { ok: false, reason: "no_ko_rounds" };

  const rows = db.prepare(`SELECT id, matchday, home_team_id, away_team_id, home_score, away_score, status
    FROM league_matches WHERE league = ? ORDER BY matchday, match_date, id`).all(leagueCode);

  const findTie = db.prepare("SELECT * FROM league_ko_ties WHERE league = ? AND round = ? AND tie_no = ?");
  const insertTie = db.prepare(`INSERT INTO league_ko_ties
    (league, round, tie_no, home_team_id, away_team_id, leg1_match_id, leg2_match_id, winner_team_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateTie = db.prepare(`UPDATE league_ko_ties
    SET home_team_id = ?, away_team_id = ?, leg1_match_id = ?, leg2_match_id = ?, winner_team_id = ? WHERE id = ?`);

  let created = 0, resolved = 0;
  const apply = db.transaction(() => {
    for (const round of cfg.koRounds) {
      const legs = round.md.map((md) => rows.filter((r) => r.matchday === md));
      if (!legs[0]?.length) continue; // this round hasn't been drawn yet

      // Leg 1 defines the tie and its home/away orientation; leg 2 is the reverse pairing.
      legs[0].forEach((first, i) => {
        const tieNo = i + 1;
        const second = round.legs === 2
          ? (legs[1] || []).find((r) => r.home_team_id === first.away_team_id && r.away_team_id === first.home_team_id)
          : null;

        let winner = null;
        const bothDone = first.status === "finished" && (round.legs === 1 || second?.status === "finished");
        if (bothDone) {
          if (round.legs === 1) {
            winner = first.home_score > first.away_score ? first.home_team_id
              : first.away_score > first.home_score ? first.away_team_id : null;
          } else {
            const aggHome = (first.home_score ?? 0) + (second.away_score ?? 0);
            const aggAway = (first.away_score ?? 0) + (second.home_score ?? 0);
            if (aggHome !== aggAway) winner = aggHome > aggAway ? first.home_team_id : first.away_team_id;
          }
          if (winner) resolved++;
        }

        const existing = findTie.get(leagueCode, round.key, tieNo);
        if (!existing) {
          insertTie.run(leagueCode, round.key, tieNo, first.home_team_id, first.away_team_id,
            first.id, second?.id ?? null, winner);
          created++;
        } else {
          // Never clear a winner already recorded (an admin may have settled a shootout by hand).
          updateTie.run(first.home_team_id, first.away_team_id, first.id, second?.id ?? null,
            winner ?? existing.winner_team_id, existing.id);
        }
      });
    }
  });
  apply();
  return { ok: true, created, resolved };
}

async function syncPLFixtures() { return syncLeagueFixtures("epl2627"); }

// ── Start all refresh loops ────────────────────────────────────────────────────

// Start the sync loops for one league: live/finished scores every 5 min, plus a fixture sync
// (immediately, or scheduled to the release date if it's still in the future) and a daily re-sync
// afterwards to pick up date/time changes.
function startLeagueSync(code) {
  const cfg = LEAGUE_CONFIG[code];

  syncLeagueScores(code);
  setInterval(() => syncLeagueScores(code), 5 * 60 * 1000);

  const dailyFixtureSync = () => {
    syncLeagueFixtures(code);
    setInterval(() => syncLeagueFixtures(code), 24 * 60 * 60 * 1000);
  };

  const release = cfg.fixtureRelease ? new Date(cfg.fixtureRelease) : null;
  const msUntilRelease = release ? release.getTime() - Date.now() : 0;

  if (msUntilRelease > 0) {
    console.log(`${code} fixture sync scheduled for ${cfg.fixtureRelease} (in ${Math.round(msUntilRelease / 3600000)}h).`);
    setTimeout(() => {
      console.log(`${code} fixture release time reached — syncing fixtures now.`);
      dailyFixtureSync();
    }, msUntilRelease);
  } else {
    const existingMatches = db.prepare("SELECT COUNT(*) as c FROM league_matches WHERE league = ?").get(code).c;
    console.log(existingMatches === 0
      ? `${code} fixtures: none in DB — syncing now.`
      : `${code} fixtures: ${existingMatches} matches in DB. Daily re-sync enabled.`);
    dailyFixtureSync();
  }
}

// Check for new results every 5 minutes.
function startScoreRefresh() {
  // ESPN-fed leagues (NFL) need no API key, so they sync regardless of how football-data.org is
  // configured. Only the football-data.org-fed work below is gated on FOOTBALL_API_KEY.
  const espnLeagues = Object.keys(LEAGUE_CONFIG).filter((c) => LEAGUE_CONFIG[c].feed === "espn");
  for (const code of espnLeagues) startLeagueSync(code);
  if (espnLeagues.length > 0) console.log(`ESPN sync enabled for: ${espnLeagues.join(", ")}.`);

  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    console.log("FOOTBALL_API_KEY not set. Soccer scores will not auto-update.");
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

  // Domestic leagues (EPL, La Liga, Serie A), config-driven from LEAGUE_CONFIG.
  for (const code of Object.keys(LEAGUE_CONFIG)) {
    if (LEAGUE_CONFIG[code].feed === "espn") continue; // already started above
    startLeagueSync(code);
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
  const leagueCode = "epl2627"; // Pulselive is Premier-League-only
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

    try { db.exec("ALTER TABLE league_players ADD COLUMN api_player_id INTEGER"); } catch (_) { /* exists */ }
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_league_players_api ON league_players(league, api_player_id)"); } catch (_) {}

    const localByCode = {};
    for (const t of db.prepare("SELECT id, code FROM league_teams WHERE league = ?").all(leagueCode)) localByCode[t.code] = t.id;

    const findByPid = db.prepare("SELECT id, team_id FROM league_players WHERE league = ? AND api_player_id = ?");
    const findByName = db.prepare("SELECT id FROM league_players WHERE league = ? AND team_id = ? AND name = ? AND api_player_id IS NULL");
    const updatePlayer = db.prepare("UPDATE league_players SET name = ?, position = ?, team_id = ?, api_player_id = ? WHERE id = ?");
    const insertPlayer = db.prepare("INSERT OR IGNORE INTO league_players (league, name, team_id, position, api_player_id) VALUES (?, ?, ?, ?, ?)");
    const teamPlayers = db.prepare("SELECT id, api_player_id FROM league_players WHERE league = ? AND team_id = ?");
    const delPicks = db.prepare("DELETE FROM league_award_picks WHERE player_id = ?");
    const delResults = db.prepare("DELETE FROM league_award_results WHERE player_id = ?");
    const delPlayer = db.prepare("DELETE FROM league_players WHERE id = ?");
    // Award picks cache the player's club at pick time and that copy wins when the pick is
    // rendered, so a move between two PL clubs has to carry the pick's club with it.
    const syncPickTeam = db.prepare("UPDATE league_award_picks SET team_id = ? WHERE player_id = ?");
    const updateManager = db.prepare("UPDATE league_teams SET manager = ? WHERE id = ?");

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

          const byPid = findByPid.get(leagueCode, pid);
          if (byPid) {
            updatePlayer.run(name, pos, teamId, pid, byPid.id);
            if (byPid.team_id !== teamId) syncPickTeam.run(teamId, byPid.id);
            continue;
          }
          const byName = findByName.get(leagueCode, teamId, name); // adopt file-seeded row, backfill pid
          if (byName) { updatePlayer.run(name, pos, teamId, pid, byName.id); continue; }
          if (insertPlayer.run(leagueCode, name, teamId, pos, pid).changes) playersAdded++;
        }

        // Remove anyone on this team not in the fresh squad: transferred out (pid unseen) or a
        // stale file-seeded row that Pulselive superseded (api_player_id still NULL). Their
        // award picks/results go too.
        for (const ex of teamPlayers.all(leagueCode, teamId)) {
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

module.exports = { startScoreRefresh, syncFootballDataTeams, syncKoTies, syncLeagueFixtures, syncLeagueScores, syncPLFixtures, syncPLSquads, fetchLiveScores };
