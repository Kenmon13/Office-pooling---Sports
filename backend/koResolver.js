const db = require("./db");

const API_BASE = "https://api.football-data.org/v4";
const COMPETITION = "WC";

const STAGE_TO_ROUND = {
  LAST_32: "R32", ROUND_OF_32: "R32",
  LAST_16: "R16", ROUND_OF_16: "R16",
  QUARTER_FINALS: "QF",
  SEMI_FINALS: "SF",
  FINAL: "F",
};

function apiToDbDate(utc) {
  if (!utc) return null;
  return utc.replace("T", " ").replace("Z", "").slice(0, 16);
}

function computeGroupStandings() {
  const matches = db.prepare("SELECT * FROM matches WHERE status = 'finished'").all();
  const teams = db.prepare("SELECT id, name, code, group_id FROM teams").all();
  const groups = db.prepare("SELECT id, name FROM groups").all();

  const stats = {};
  for (const t of teams) {
    stats[t.id] = { team_id: t.id, name: t.name, code: t.code, group_id: t.group_id, played: 0, gf: 0, ga: 0, points: 0 };
  }
  for (const m of matches) {
    const h = stats[m.home_team_id], a = stats[m.away_team_id];
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) { h.points += 3; }
    else if (m.away_score > m.home_score) { a.points += 3; }
    else { h.points += 1; a.points += 1; }
  }

  const byGroup = {};
  for (const g of groups) {
    const groupTeams = Object.values(stats)
      .filter((t) => t.group_id === g.id)
      .sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    const allFinished = groupTeams.length > 0 && groupTeams.every((t) => t.played >= 3);
    byGroup[g.name] = { groupId: g.id, teams: groupTeams, allFinished };
  }
  return byGroup;
}

// Two teams are "tiebreak-ambiguous" if they are tied on points, GD, AND GF.
// FIFA's next tiebreakers (head-to-head, fair-play, drawing lots) are not modelled here,
// so we refuse to promote when this happens — the API or admin PATCH fills it correctly.
function tiebreakAmbiguous(a, b) {
  if (!a || !b) return false;
  return a.points === b.points && (a.gf - a.ga) === (b.gf - b.ga) && a.gf === b.gf;
}

function promoteFinishedGroups() {
  const byGroup = computeGroupStandings();
  const koMatches = db.prepare("SELECT id, home_slot, away_slot, home_team_id, away_team_id, home_admin_set, away_admin_set FROM knockout_matches").all();
  const updateHome = db.prepare("UPDATE knockout_matches SET home_team_id = ? WHERE id = ? AND home_team_id IS NULL");
  const updateAway = db.prepare("UPDATE knockout_matches SET away_team_id = ? WHERE id = ? AND away_team_id IS NULL");

  // Precompute per-group ambiguity flags.
  // skipFirst  = 1st-place team is ambiguous (positions 1 & 2 tied on pts/GD/GF).
  // skipSecond = 2nd-place team is ambiguous (1&2 tied, or 2&3 tied).
  const ambiguityByGroup = {};
  for (const [name, g] of Object.entries(byGroup)) {
    if (!g.allFinished) continue;
    const sorted = g.teams;
    const ambig12 = tiebreakAmbiguous(sorted[0], sorted[1]);
    const ambig23 = tiebreakAmbiguous(sorted[1], sorted[2]);
    ambiguityByGroup[name] = { skipFirst: ambig12, skipSecond: ambig12 || ambig23 };
    if (ambig12 || ambig23) {
      console.log(`KO resolver: group ${name} tiebreak ambiguous (1-2 tied: ${ambig12}, 2-3 tied: ${ambig23}) — skipping promotion, deferring to API/admin.`);
    }
  }

  let promotions = 0;
  for (const ko of koMatches) {
    for (const side of ["home", "away"]) {
      const slot = ko[`${side}_slot`];
      const currentId = ko[`${side}_team_id`];
      const adminSet = ko[`${side}_admin_set`] === 1;
      if (currentId || adminSet) continue;
      const m = /^([12])([A-L])$/.exec(slot);
      if (!m) continue;
      const pos = parseInt(m[1], 10);
      const groupName = m[2];
      const g = byGroup[groupName];
      if (!g || !g.allFinished) continue;
      const ambig = ambiguityByGroup[groupName];
      if (pos === 1 && ambig && ambig.skipFirst) continue;
      if (pos === 2 && ambig && ambig.skipSecond) continue;
      const team = g.teams[pos - 1];
      if (!team) continue;
      const fn = side === "home" ? updateHome : updateAway;
      const result = fn.run(team.team_id, ko.id);
      if (result.changes > 0) {
        promotions++;
        console.log(`KO promote: ${ko.id} ${side}_slot ${slot} -> ${team.name} (${team.code})`);
      }
    }
  }
  return promotions;
}

function cascadeKoWinners() {
  const koMatches = db.prepare("SELECT id, home_slot, away_slot, home_team_id, away_team_id, winner_team_id, home_admin_set, away_admin_set FROM knockout_matches").all();
  const koById = Object.fromEntries(koMatches.map((m) => [m.id, m]));
  const updateHome = db.prepare("UPDATE knockout_matches SET home_team_id = ? WHERE id = ? AND home_team_id IS NULL AND home_admin_set = 0");
  const updateAway = db.prepare("UPDATE knockout_matches SET away_team_id = ? WHERE id = ? AND away_team_id IS NULL AND away_admin_set = 0");

  let promotions = 0;
  for (const ko of koMatches) {
    for (const side of ["home", "away"]) {
      const slot = ko[`${side}_slot`];
      const currentId = ko[`${side}_team_id`];
      const adminSet = ko[`${side}_admin_set`] === 1;
      if (currentId || adminSet) continue;
      const m = /^W\s+(\S+)$/.exec(slot);
      if (!m) continue;
      const feederId = m[1];
      const feeder = koById[feederId];
      if (!feeder || !feeder.winner_team_id) continue;
      const fn = side === "home" ? updateHome : updateAway;
      const result = fn.run(feeder.winner_team_id, ko.id);
      if (result.changes > 0) {
        promotions++;
        console.log(`KO cascade: ${ko.id} ${side}_slot ${slot} -> team id ${feeder.winner_team_id} (winner of ${feederId})`);
      }
    }
  }
  return promotions;
}

async function syncWCKnockouts() {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) return;
  try {
    const res = await fetch(`${API_BASE}/competitions/${COMPETITION}/matches`, {
      headers: { "X-Auth-Token": apiKey },
    });
    if (!res.ok) {
      console.log(`WC KO sync: API responded ${res.status}, skipping.`);
      return;
    }
    const data = await res.json();
    const apiMatches = (data.matches || []).filter((m) => STAGE_TO_ROUND[m.stage]);
    if (apiMatches.length === 0) {
      console.log("WC KO sync: no KO matches returned from API yet.");
      return;
    }

    const koMatches = db.prepare(`SELECT id, round, match_date,
        home_team_id, away_team_id, winner_team_id, status,
        home_score, away_score,
        home_admin_set, away_admin_set, winner_admin_set
      FROM knockout_matches`).all();
    const teamByCode = {};
    for (const t of db.prepare("SELECT id, code FROM teams").all()) teamByCode[t.code] = t.id;
    const teamById = {};
    for (const t of db.prepare("SELECT id, code FROM teams").all()) teamById[t.id] = t.code;

    const localByRound = {};
    for (const m of koMatches) {
      if (!localByRound[m.round]) localByRound[m.round] = [];
      localByRound[m.round].push(m);
    }
    for (const r of Object.keys(localByRound)) {
      localByRound[r].sort((a, b) => (a.match_date || "").localeCompare(b.match_date || ""));
    }

    const apiByRound = {};
    for (const m of apiMatches) {
      const round = STAGE_TO_ROUND[m.stage];
      if (!apiByRound[round]) apiByRound[round] = [];
      apiByRound[round].push(m);
    }
    for (const r of Object.keys(apiByRound)) {
      apiByRound[r].sort((a, b) => (a.utcDate || "").localeCompare(b.utcDate || ""));
    }

    // Per-field statements so we can auto-correct team assignments while preserving
    // admin overrides and not nuking already-entered scores.
    const setHome   = db.prepare("UPDATE knockout_matches SET home_team_id = ? WHERE id = ? AND home_admin_set = 0");
    const setAway   = db.prepare("UPDATE knockout_matches SET away_team_id = ? WHERE id = ? AND away_admin_set = 0");
    const setWinner = db.prepare("UPDATE knockout_matches SET winner_team_id = ? WHERE id = ? AND winner_admin_set = 0");
    const setDate   = db.prepare("UPDATE knockout_matches SET match_date = ? WHERE id = ?");
    const setScores = db.prepare("UPDATE knockout_matches SET home_score = COALESCE(?, home_score), away_score = COALESCE(?, away_score), status = COALESCE(?, status) WHERE id = ?");

    let touched = 0, corrected = 0;
    for (const round of Object.keys(apiByRound)) {
      const apis = apiByRound[round];
      const locals = localByRound[round] || [];
      if (apis.length !== locals.length) {
        console.log(`WC KO sync: round ${round} count mismatch (API=${apis.length}, local=${locals.length}).`);
      }
      const limit = Math.min(apis.length, locals.length);
      for (let i = 0; i < limit; i++) {
        const api = apis[i];
        const local = locals[i];
        const homeId = api.homeTeam && api.homeTeam.tla ? teamByCode[api.homeTeam.tla] : null;
        const awayId = api.awayTeam && api.awayTeam.tla ? teamByCode[api.awayTeam.tla] : null;

        let dbStatus = null, homeScore = null, awayScore = null, winnerId = null;
        if (api.status === "FINISHED") {
          dbStatus = "finished";
          homeScore = api.score && api.score.fullTime ? api.score.fullTime.home : null;
          awayScore = api.score && api.score.fullTime ? api.score.fullTime.away : null;
          if (homeScore != null && awayScore != null) {
            if (homeScore > awayScore && homeId) winnerId = homeId;
            else if (awayScore > homeScore && awayId) winnerId = awayId;
          }
        } else if (api.status === "IN_PLAY" || api.status === "PAUSED") {
          dbStatus = "live";
          const ft = api.score && api.score.fullTime;
          const ht = api.score && api.score.halfTime;
          homeScore = (ft && ft.home != null) ? ft.home : (ht && ht.home != null ? ht.home : 0);
          awayScore = (ft && ft.away != null) ? ft.away : (ht && ht.away != null ? ht.away : 0);
        }

        // match_date always refreshes from API
        const matchDate = apiToDbDate(api.utcDate);
        if (matchDate && matchDate !== local.match_date) setDate.run(matchDate, local.id);

        // scores/status: COALESCE — never overwrite once entered
        setScores.run(homeScore, awayScore, dbStatus, local.id);

        // home_team_id: write if API differs and admin hasn't locked. Logs auto-correct.
        if (homeId != null && homeId !== local.home_team_id && local.home_admin_set === 0) {
          const r = setHome.run(homeId, local.id);
          if (r.changes > 0) {
            touched++;
            if (local.home_team_id == null) {
              console.log(`WC KO API: ${local.id} home_team_id <- ${api.homeTeam.tla} (id ${homeId})`);
            } else {
              corrected++;
              console.log(`WC KO API auto-correct: ${local.id} home_team_id ${teamById[local.home_team_id] || local.home_team_id} -> ${api.homeTeam.tla} (id ${homeId})`);
            }
          }
        }

        // away_team_id: same treatment
        if (awayId != null && awayId !== local.away_team_id && local.away_admin_set === 0) {
          const r = setAway.run(awayId, local.id);
          if (r.changes > 0) {
            touched++;
            if (local.away_team_id == null) {
              console.log(`WC KO API: ${local.id} away_team_id <- ${api.awayTeam.tla} (id ${awayId})`);
            } else {
              corrected++;
              console.log(`WC KO API auto-correct: ${local.id} away_team_id ${teamById[local.away_team_id] || local.away_team_id} -> ${api.awayTeam.tla} (id ${awayId})`);
            }
          }
        }

        // winner_team_id: same treatment
        if (winnerId != null && winnerId !== local.winner_team_id && local.winner_admin_set === 0) {
          const r = setWinner.run(winnerId, local.id);
          if (r.changes > 0) {
            touched++;
            if (local.winner_team_id == null) {
              console.log(`WC KO API: ${local.id} winner <- team id ${winnerId} (${homeScore}-${awayScore})`);
            } else {
              corrected++;
              console.log(`WC KO API auto-correct: ${local.id} winner ${teamById[local.winner_team_id] || local.winner_team_id} -> ${teamById[winnerId] || winnerId}`);
            }
          }
        }
      }
    }
    if (touched > 0) console.log(`WC KO sync: ${touched} team-field updates (${corrected} auto-corrections).`);
  } catch (err) {
    console.log("WC KO sync error:", err.message);
  }
}

function runResolver() {
  try {
    const p = promoteFinishedGroups();
    const c = cascadeKoWinners();
    if (p > 0 || c > 0) console.log(`KO resolver: ${p} group->KO promotions, ${c} winner cascades.`);
  } catch (err) {
    console.log("KO resolver error:", err.message);
  }
}

module.exports = { runResolver, syncWCKnockouts, promoteFinishedGroups, cascadeKoWinners };
