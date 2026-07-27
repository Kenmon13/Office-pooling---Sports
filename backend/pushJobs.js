// Decides *what* to notify about. backend/push.js handles delivery.
//
// Two notifications, both tied to something the user would actually want to open
// the app for:
//   reminder — a match kicks off soon and they have not made a pick yet
//   result   — a match they picked has finished
//
// match_date is stored as UTC 'YYYY-MM-DD HH:MM', directly comparable to SQLite's
// datetime('now') at minute granularity.

const db = require("./db");
const push = require("./push");

const SCAN_INTERVAL_MS = 10 * 60 * 1000;

// How far ahead of kickoff to nag. Wide enough that a 10-minute scan cannot skip a
// match, narrow enough that the reminder still feels timely.
const REMIND_FROM_MIN = 30;
const REMIND_TO_MIN = 180;

// Results older than this are never announced. Without it, the first run after a
// deploy would blast every historical result at once.
const RESULT_LOOKBACK_HOURS = 24;

const WC_TOURNAMENT = "wc2026";

function fmt(sqlModifier) {
  return db.prepare(`SELECT strftime('%Y-%m-%d %H:%M', 'now', ?) v`).get(sqlModifier).v;
}

// --- match lookups -----------------------------------------------------------

function upcomingLeagueMatches() {
  return db.prepare(`
    SELECT m.id, m.league, m.match_date,
           h.name AS home_name, a.name AS away_name
    FROM league_matches m
    JOIN league_teams h ON h.id = m.home_team_id
    JOIN league_teams a ON a.id = m.away_team_id
    WHERE m.status = 'upcoming'
      AND m.match_date >= ? AND m.match_date <= ?
  `).all(fmt(`+${REMIND_FROM_MIN} minutes`), fmt(`+${REMIND_TO_MIN} minutes`));
}

function upcomingWcMatches() {
  return db.prepare(`
    SELECT m.id, m.match_date,
           h.name AS home_name, a.name AS away_name
    FROM matches m
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
    WHERE m.status = 'upcoming'
      AND m.match_date >= ? AND m.match_date <= ?
  `).all(fmt(`+${REMIND_FROM_MIN} minutes`), fmt(`+${REMIND_TO_MIN} minutes`));
}

function finishedLeagueMatches() {
  return db.prepare(`
    SELECT m.id, m.league, m.home_score, m.away_score,
           h.name AS home_name, a.name AS away_name
    FROM league_matches m
    JOIN league_teams h ON h.id = m.home_team_id
    JOIN league_teams a ON a.id = m.away_team_id
    WHERE m.status = 'finished'
      AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      AND m.match_date >= ?
  `).all(fmt(`-${RESULT_LOOKBACK_HOURS} hours`));
}

function finishedWcMatches() {
  return db.prepare(`
    SELECT m.id, m.home_score, m.away_score,
           h.name AS home_name, a.name AS away_name
    FROM matches m
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
    WHERE m.status = 'finished'
      AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      AND m.match_date >= ?
  `).all(fmt(`-${RESULT_LOOKBACK_HOURS} hours`));
}

// --- audience lookups --------------------------------------------------------

// Users in a pool for this tournament who have not picked this match in at least
// one of their pools.
function usersMissingLeaguePick(tournament, matchId) {
  return db.prepare(`
    SELECT DISTINCT p.user_id
    FROM participants p
    JOIN pools po ON po.id = p.pool_id
    WHERE po.tournament = ? AND p.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM league_match_predictions lmp
        WHERE lmp.participant_id = p.id AND lmp.match_id = ?
      )
  `).all(tournament, matchId).map((r) => r.user_id);
}

function usersMissingWcPick(matchId) {
  return db.prepare(`
    SELECT DISTINCT p.user_id
    FROM participants p
    JOIN pools po ON po.id = p.pool_id
    WHERE po.tournament = ? AND p.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM predictions pr
        WHERE pr.participant_id = p.id AND pr.match_id = ?
      )
  `).all(WC_TOURNAMENT, matchId).map((r) => r.user_id);
}

function leaguePredictors(tournament, matchId) {
  return db.prepare(`
    SELECT p.user_id, lmp.predicted_outcome
    FROM participants p
    JOIN pools po ON po.id = p.pool_id
    JOIN league_match_predictions lmp
      ON lmp.participant_id = p.id AND lmp.match_id = ?
    WHERE po.tournament = ? AND p.user_id IS NOT NULL
  `).all(matchId, tournament);
}

function wcPredictors(matchId) {
  return db.prepare(`
    SELECT p.user_id, pr.predicted_outcome
    FROM participants p
    JOIN pools po ON po.id = p.pool_id
    JOIN predictions pr
      ON pr.participant_id = p.id AND pr.match_id = ?
    WHERE po.tournament = ? AND p.user_id IS NOT NULL
  `).all(matchId, WC_TOURNAMENT);
}

// --- message building --------------------------------------------------------

function outcomeOf(homeScore, awayScore) {
  if (homeScore > awayScore) return "home";
  if (awayScore > homeScore) return "away";
  return "draw";
}

// A user in several pools can hold several picks for one match. Only claim they
// got it right when every pick they made was right.
function groupPredictorVerdicts(rows, actual) {
  const byUser = new Map();
  for (const { user_id, predicted_outcome } of rows) {
    const prev = byUser.get(user_id);
    const correct = predicted_outcome === actual;
    byUser.set(user_id, prev === undefined ? correct : prev && correct);
  }
  return byUser;
}

function resultBody(m, allCorrect) {
  const score = `${m.home_name} ${m.home_score}–${m.away_score} ${m.away_name}`;
  return allCorrect ? `${score} — you called it ✅` : score;
}

// --- scans -------------------------------------------------------------------

async function sendReminders() {
  let sent = 0;

  for (const m of upcomingLeagueMatches()) {
    const payload = {
      title: "Pick not in yet",
      body: `${m.home_name} v ${m.away_name} kicks off soon — you haven't predicted it.`,
      data: { kind: "reminder", tournament: m.league, matchId: m.id },
    };
    for (const userId of usersMissingLeaguePick(m.league, m.id)) {
      if (await push.notifyOnce(userId, "reminder", `league:${m.id}`, payload)) sent++;
    }
  }

  for (const m of upcomingWcMatches()) {
    const payload = {
      title: "Pick not in yet",
      body: `${m.home_name} v ${m.away_name} kicks off soon — you haven't predicted it.`,
      data: { kind: "reminder", tournament: WC_TOURNAMENT, matchId: m.id },
    };
    for (const userId of usersMissingWcPick(m.id)) {
      if (await push.notifyOnce(userId, "reminder", `wc:${m.id}`, payload)) sent++;
    }
  }

  return sent;
}

async function sendResults() {
  let sent = 0;

  for (const m of finishedLeagueMatches()) {
    const actual = outcomeOf(m.home_score, m.away_score);
    const verdicts = groupPredictorVerdicts(leaguePredictors(m.league, m.id), actual);
    for (const [userId, allCorrect] of verdicts) {
      const payload = {
        title: "Full time",
        body: resultBody(m, allCorrect),
        data: { kind: "result", tournament: m.league, matchId: m.id },
      };
      if (await push.notifyOnce(userId, "result", `league:${m.id}`, payload)) sent++;
    }
  }

  for (const m of finishedWcMatches()) {
    const actual = outcomeOf(m.home_score, m.away_score);
    const verdicts = groupPredictorVerdicts(wcPredictors(m.id), actual);
    for (const [userId, allCorrect] of verdicts) {
      const payload = {
        title: "Full time",
        body: resultBody(m, allCorrect),
        data: { kind: "result", tournament: WC_TOURNAMENT, matchId: m.id },
      };
      if (await push.notifyOnce(userId, "result", `wc:${m.id}`, payload)) sent++;
    }
  }

  return sent;
}

async function runScan() {
  try {
    const reminders = await sendReminders();
    const results = await sendResults();
    if (reminders || results) {
      console.log(`Push scan: ${reminders} reminder(s), ${results} result(s) sent.`);
    }
  } catch (err) {
    console.error("Push scan failed:", err.message || err);
  }
}

function startPushJobs() {
  if (!push.isEnabled()) {
    console.log("FCM_SERVICE_ACCOUNT not set. Push notifications are disabled.");
    return;
  }
  console.log("Push notifications enabled (scanning every 10 minutes).");
  runScan();
  setInterval(runScan, SCAN_INTERVAL_MS);
}

module.exports = {
  startPushJobs,
  runScan,
  _internals: { outcomeOf, groupPredictorVerdicts, resultBody },
};
