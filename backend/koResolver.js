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

// What team should fill a KO slot, judged from local standings only?
// - Top-2 group slots (e.g. "1G", "2G"): returns { kind: "expected", teamId } once the group
//   is fully finished locally. The API may only write here if its team matches.
// - Third-place slots (e.g. "3A/E/H/I/J"): returns { kind: "third-place", eligibleGroups }.
//   The API may write here only if (a) the team is in our local best-thirds set, and
//   (b) the team is from one of eligibleGroups. We don't encode FIFA's full combination
//   table (which group → which specific slot), so this is a loose check, not exact.
// - Cascade slots (e.g. "W R32-5"): always { kind: "cascade" } — cascadeKoWinners handles
//   these locally from feeder winner_team_id. Never accept API team IDs.
function expectedTeamForSlot(slot, byGroup) {
  const top2 = /^([12])([A-L])$/.exec(slot || "");
  if (top2) {
    const pos = parseInt(top2[1], 10);
    const g = byGroup[top2[2]];
    if (!g || !g.allFinished) return { kind: "unresolved" };
    return { kind: "expected", teamId: g.teams[pos - 1]?.team_id ?? null };
  }
  const third = /^3([A-L](?:\/[A-L])*)$/.exec(slot || "");
  if (third) {
    const eligibleGroups = new Set(third[1].split("/"));
    return { kind: "third-place", eligibleGroups };
  }
  if (/^W\s/.test(slot || "")) return { kind: "cascade" };
  return { kind: "unknown" };
}

// Returns a Set of the 8 best-third team_ids, OR null if not yet determined
// (i.e. not all groups are fully finished). Mirrors the logic in
// backend/index.js /api/standings best-third computation.
function computeBestThirds(byGroup) {
  const groups = Object.values(byGroup);
  if (groups.length === 0) return null;
  if (!groups.every((g) => g.allFinished)) return null;
  const thirds = groups.map((g) => g.teams[2]).filter(Boolean);
  thirds.sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
  return new Set(thirds.slice(0, 8).map((t) => t.team_id));
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
        home_slot, away_slot,
        home_team_id, away_team_id, winner_team_id, status,
        home_score, away_score,
        home_admin_set, away_admin_set, winner_admin_set
      FROM knockout_matches`).all();
    // Pre-compute local group standings. Used by the defensive guard below to refuse any
    // API-supplied KO team ID that doesn't agree with our own standings projection
    // (prevents the API publishing a wrong pre-bracket projection from polluting slots).
    const byGroup = computeGroupStandings();
    // Best-thirds set (null while group stage is in progress) + a team->group lookup,
    // used by the loose third-place validation below.
    const bestThirds = computeBestThirds(byGroup);
    const groupByTeamId = {};
    for (const [name, g] of Object.entries(byGroup)) {
      for (const t of g.teams) groupByTeamId[t.team_id] = name;
    }
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

    // Per-field statements. Team-id writes are guarded with `IS NULL` so they only ever fill
    // an empty slot — never overwrite. This protects user picks (stored as home/away slots,
    // not team_ids) from being silently reinterpreted under them when API and local disagree.
    // For mismatches, we log loudly and defer to admin PATCH instead of auto-correcting.
    const setHome   = db.prepare("UPDATE knockout_matches SET home_team_id = ? WHERE id = ? AND home_team_id IS NULL AND home_admin_set = 0");
    const setAway   = db.prepare("UPDATE knockout_matches SET away_team_id = ? WHERE id = ? AND away_team_id IS NULL AND away_admin_set = 0");
    const setWinner = db.prepare("UPDATE knockout_matches SET winner_team_id = ? WHERE id = ? AND winner_admin_set = 0");
    const setDate   = db.prepare("UPDATE knockout_matches SET match_date = ? WHERE id = ?");
    const setScores = db.prepare(`
      UPDATE knockout_matches SET
        home_score = COALESCE(?, home_score),
        away_score = COALESCE(?, away_score),
        status     = COALESCE(?, status),
        duration   = COALESCE(?, duration),
        home_et    = COALESCE(?, home_et),
        away_et    = COALESCE(?, away_et),
        home_pens  = COALESCE(?, home_pens),
        away_pens  = COALESCE(?, away_pens)
      WHERE id = ?
    `);

    // Mismatch tracking — surfaces in the admin dashboard. Upsert on detection,
    // clear when teams come back into agreement (or admin lock takes effect).
    // detected_at only advances when the local or API value actually changes;
    // a mismatch that's been sitting unchanged for days keeps its original timestamp
    // instead of showing "detected 2 minutes ago" after every 30-min sync run.
    const upsertMismatch = db.prepare(`
      INSERT INTO ko_mismatches (match_id, field, local_team_id, api_team_id, detected_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(match_id, field) DO UPDATE SET
        local_team_id = excluded.local_team_id,
        api_team_id = excluded.api_team_id,
        detected_at = CASE
          WHEN local_team_id = excluded.local_team_id AND api_team_id = excluded.api_team_id
          THEN detected_at
          ELSE excluded.detected_at
        END
    `);
    const clearMismatch = db.prepare("DELETE FROM ko_mismatches WHERE match_id = ? AND field = ?");

    let touched = 0, mismatches = 0;
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
        let duration = null, homeEt = null, awayEt = null, homePens = null, awayPens = null;
        const dur = api.score && api.score.duration;
        const wentBeyond90 = dur === "EXTRA_TIME" || dur === "PENALTY_SHOOTOUT";
        if (api.status === "FINISHED") {
          dbStatus = "finished";
          duration = dur ?? null;
          // The exact-score bonus is judged on the 90' regulation score, so for matches
          // that went to extra time or penalties we use `regularTime` (90' + stoppage).
          // For REGULAR matches there is no `regularTime` field — `fullTime` IS the 90' score.
          // football-data.org v4 `fullTime` is the cumulative final including the shootout,
          // which would silently make exact-score bonuses unwinnable on any penalty match.
          const src = wentBeyond90 ? api.score?.regularTime : api.score?.fullTime;
          homeScore = src?.home ?? null;
          awayScore = src?.away ?? null;
          if (wentBeyond90) {
            homeEt = api.score?.extraTime?.home ?? 0;
            awayEt = api.score?.extraTime?.away ?? 0;
          }
          if (dur === "PENALTY_SHOOTOUT") {
            homePens = api.score?.penalties?.home ?? null;
            awayPens = api.score?.penalties?.away ?? null;
          }
          // Winner: prefer `api.score.winner` (authoritative; correctly reflects shootout
          // result). Fall back to score comparison for older payloads or DRAW edge cases.
          const apiWinner = api.score && api.score.winner;
          if (apiWinner === "HOME_TEAM" && homeId) winnerId = homeId;
          else if (apiWinner === "AWAY_TEAM" && awayId) winnerId = awayId;
          else if (homeScore != null && awayScore != null) {
            if (homeScore > awayScore && homeId) winnerId = homeId;
            else if (awayScore > homeScore && awayId) winnerId = awayId;
          }
        } else if (api.status === "IN_PLAY" || api.status === "PAUSED") {
          dbStatus = "live";
          duration = dur ?? null;
          if (wentBeyond90) {
            // Regulation is locked once we're in ET/pens. Pull regularTime as the
            // main score; et / pens fields are running until the phase ends.
            const src = api.score?.regularTime;
            homeScore = src?.home ?? null;
            awayScore = src?.away ?? null;
            homeEt = api.score?.extraTime?.home ?? 0;
            awayEt = api.score?.extraTime?.away ?? 0;
            if (dur === "PENALTY_SHOOTOUT") {
              homePens = api.score?.penalties?.home ?? null;
              awayPens = api.score?.penalties?.away ?? null;
            }
          } else {
            // Live in regulation — running 90' score.
            const ft = api.score && api.score.fullTime;
            const ht = api.score && api.score.halfTime;
            homeScore = (ft && ft.home != null) ? ft.home : (ht && ht.home != null ? ht.home : 0);
            awayScore = (ft && ft.away != null) ? ft.away : (ht && ht.away != null ? ht.away : 0);
          }
        }

        // match_date always refreshes — schedule shifts are benign and don't reinterpret picks.
        const matchDate = apiToDbDate(api.utcDate);
        if (matchDate && matchDate !== local.match_date) setDate.run(matchDate, local.id);

        // If API teams disagree with locally-set teams, halt all further sync for this match.
        // Otherwise we'd mark it finished / set a winner against the wrong matchup. Admin
        // must resolve via PATCH /api/admin/knockout-matches/:id.
        const homeMismatch = homeId != null && local.home_team_id != null && homeId !== local.home_team_id;
        const awayMismatch = awayId != null && local.away_team_id != null && awayId !== local.away_team_id;
        if (homeMismatch) {
          mismatches++;
          upsertMismatch.run(local.id, "home_team_id", local.home_team_id, homeId);
          console.log(`WC KO API mismatch (manual review): ${local.id} home local=${teamById[local.home_team_id] || local.home_team_id} api=${api.homeTeam.tla}; keeping local.`);
        } else {
          clearMismatch.run(local.id, "home_team_id");
        }
        if (awayMismatch) {
          mismatches++;
          upsertMismatch.run(local.id, "away_team_id", local.away_team_id, awayId);
          console.log(`WC KO API mismatch (manual review): ${local.id} away local=${teamById[local.away_team_id] || local.away_team_id} api=${api.awayTeam.tla}; keeping local.`);
        } else {
          clearMismatch.run(local.id, "away_team_id");
        }
        if (homeMismatch || awayMismatch) continue;

        // scores/status: COALESCE — never overwrite once entered
        setScores.run(homeScore, awayScore, dbStatus, duration, homeEt, awayEt, homePens, awayPens, local.id);

        // home_team_id / away_team_id: fill only when locally null AND the API team agrees
        // with what local standings project for the slot. Top-2 slots ("1G", "2G") only
        // accept the API team if it matches our own group-standings #1 / #2. Third-place
        // and cascade slots never accept the API team (those are handled by the local
        // resolver or admin PATCH). This prevents a wrong API projection from polluting
        // a slot, which would then stick because of the IS NULL guard.
        function tryFillSide(side, apiTeamId, apiTla) {
          if (apiTeamId == null) return;
          if (local[`${side}_team_id`] != null) return;
          if (local[`${side}_admin_set`] !== 0) return;
          const slot = local[`${side}_slot`];
          const expected = expectedTeamForSlot(slot, byGroup);
          if (expected.kind === "expected") {
            if (expected.teamId !== apiTeamId) {
              console.log(`WC KO API skip: ${local.id} ${side}_slot ${slot} — API says ${apiTla} (id ${apiTeamId}) but local standings expect id ${expected.teamId}; deferring.`);
              return;
            }
          } else if (expected.kind === "third-place") {
            // Loose check: accept the API team only if it's in our local best-thirds set
            // AND from one of the eligible groups in the slot pattern. We don't encode
            // FIFA's exact group->slot table, so a wrong team from an eligible group can
            // still slip through — but a team from outside the eligible set never can.
            if (!bestThirds) {
              console.log(`WC KO API skip: ${local.id} ${side}_slot ${slot} — best-thirds undetermined (group stage in progress); deferring.`);
              return;
            }
            if (!bestThirds.has(apiTeamId)) {
              console.log(`WC KO API skip: ${local.id} ${side}_slot ${slot} — API team ${apiTla} (id ${apiTeamId}) not in local best-thirds set; deferring.`);
              return;
            }
            const teamGroup = groupByTeamId[apiTeamId];
            if (!expected.eligibleGroups.has(teamGroup)) {
              console.log(`WC KO API skip: ${local.id} ${side}_slot ${slot} — API team ${apiTla} from group ${teamGroup}, eligible groups are ${[...expected.eligibleGroups].join("/")}; deferring.`);
              return;
            }
          } else if (expected.kind === "cascade") {
            // Never accept API fills for cascade slots — cascadeKoWinners handles these
            // from feeder winner_team_id.
            return;
          } else if (expected.kind === "unresolved") {
            // Group not yet fully finished locally. Wait — if we accept the API write now
            // we have no way to validate it. Local sync usually catches up within a tick.
            console.log(`WC KO API skip: ${local.id} ${side}_slot ${slot} — local group not yet finished, deferring.`);
            return;
          } else {
            return;
          }
          const fn = side === "home" ? setHome : setAway;
          const r = fn.run(apiTeamId, local.id);
          if (r.changes > 0) {
            touched++;
            console.log(`WC KO API: ${local.id} ${side}_team_id <- ${apiTla} (id ${apiTeamId})`);
          }
        }
        tryFillSide("home", homeId, api.homeTeam?.tla);
        tryFillSide("away", awayId, api.awayTeam?.tla);

        // winner_team_id: still auto-corrects (objective fact from scores; gated on no team mismatch above).
        if (winnerId != null && winnerId !== local.winner_team_id && local.winner_admin_set === 0) {
          const r = setWinner.run(winnerId, local.id);
          if (r.changes > 0) {
            touched++;
            if (local.winner_team_id == null) {
              console.log(`WC KO API: ${local.id} winner <- team id ${winnerId} (${homeScore}-${awayScore})`);
            } else {
              console.log(`WC KO API winner correction: ${local.id} ${teamById[local.winner_team_id] || local.winner_team_id} -> ${teamById[winnerId] || winnerId}`);
            }
          }
        }
      }
    }
    if (touched > 0 || mismatches > 0) {
      console.log(`WC KO sync: ${touched} field updates, ${mismatches} mismatches deferred to admin review.`);
    }
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
