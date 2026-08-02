// Config-driven league engine. Each league (EPL, La Liga, Serie A, NFL, and — later — Bundesliga /
// Ligue 1) is described here once; db.js seeding, the /api/league/:code endpoints, leaderboard
// scoring, and the sync layer all read from this config instead of hard-forking per competition.
// WC2022/WC2026 are knockout-shaped and stay separate.
//
// `sport` is the top-level discriminator, because NFL genuinely differs in shape from soccer and
// the engine has to branch in a few places rather than pretend otherwise:
//
//                    soccer (epl/laliga/seriea)        nfl
//   table            one 1..N table, 3pts/win, GD      W-L-T + win pct, split AFC/NFC × 4 divisions
//   season preds     rank every team 1..N              named slots (div winners, conf champs, SB)
//   match bonus      exact scoreline                   margin band (a 24-17 exact pick never lands)
//   feed             football-data.org                 ESPN (free, no key)
//
// Per-league knobs:
//   sport          — 'soccer' | 'nfl'. Drives the branches above.
//   feed           — 'football-data' | 'espn'. Which sync adapter in scores.js owns this league.
//   fdCompetition  — football-data.org competition code (fixtures/scores). PL/PD/SA/BL1/FL1.
//   espnPath/espnSeason — ESPN sport path + season year (nfl only).
//   squadSource    — live squad refresh source: 'pulselive' | 'laliga' | 'espn' | 'none'.
//   squadData      — { teams:[{name,code,short_name,manager,crest}], squads:{CODE:[{name,pos}]} }
//   teamCount / matchdays — league size (20/38 for EPL·La Liga·Serie A; 32/18 for NFL).
//   zones          — soccer only: table zones by finishing position (drives season-prediction
//                    scoring + UI labels). ranges are inclusive [from,to]. NFL has none — anything
//                    reading zones must guard for their absence.
//   divisions      — nfl only: ordered conference/division groupings for standings + slot picks.
//   seasonSlots    — nfl only: the named things you predict. See NFL_SLOTS below.
//   marginBands    — nfl only: margin buckets for the weekly pick bonus.
//   playoffRounds  — nfl only: matchday number -> round name, synced after the 18-week season.
//   awards         — award categories. type 'player' = pick a player_id; 'manager' = pick a
//                    team_id (the club/franchise whose boss wins).
//   scoring        — point values, shared shape so every league scores identically by default.

const EPL_SQUADS = require("./epl-squad-data");
const LALIGA_SQUADS = require("./laliga-squad-data");
const SERIEA_SQUADS = require("./seriea-squad-data");
const NFL_SQUADS = require("./nfl-squad-data");
const UCL_SQUADS = require("./ucl-data");

const DEFAULT_SCORING = {
  matchOutcome: 2,   // correct result (home/draw/away)
  matchExact: 4,     // correct result AND exact scoreline
  seasonChampion: 25,
  seasonCL: 5,       // each predicted top-4 team that finishes top 4
  seasonEuropa: 2,   // exact 5th
  seasonConference: 2, // exact 6th
  seasonRelegation: 5, // each predicted bottom-3 team that finishes bottom 3
  seasonExact: 1,    // each team in its exact predicted position
  award: 5,          // each correct award pick
};

// Standard 20-team European table zones (EPL / La Liga / Serie A share this shape).
const ZONES_20 = { champion: 1, cl: [1, 4], europa: 5, conference: 6, relegation: [18, 20] };

// ── NFL shape ────────────────────────────────────────────────────────────────────
const NFL_DIVISIONS = [
  { conference: "AFC", name: "AFC East" },
  { conference: "AFC", name: "AFC North" },
  { conference: "AFC", name: "AFC South" },
  { conference: "AFC", name: "AFC West" },
  { conference: "NFC", name: "NFC East" },
  { conference: "NFC", name: "NFC North" },
  { conference: "NFC", name: "NFC South" },
  { conference: "NFC", name: "NFC West" },
];

// What an NFL player predicts before the season. These reuse the league_season_predictions table:
// `position` stores the slot's `pos` below rather than a table finishing position, so the existing
// (participant_id, league, position) upsert works untouched.
//
// `scope` tells the scorer how to resolve the slot:
//   division   — the team that finishes top of `division` in the regular-season standings
//   conference — the team that wins `conference`, i.e. the conference championship game (week 21)
//   champion   — the Super Bowl winner (week 22)
const NFL_SLOTS = [
  ...NFL_DIVISIONS.map((d, i) => ({
    pos: i + 1,
    key: `div_${d.name.toLowerCase().replace(/\s+/g, "_")}`,
    label: `${d.name} Winner`,
    scope: "division",
    division: d.name,
    conference: d.conference,
    pts: 5,
  })),
  { pos: 9, key: "afc_champion", label: "AFC Champion", scope: "conference", conference: "AFC", pts: 10 },
  { pos: 10, key: "nfc_champion", label: "NFC Champion", scope: "conference", conference: "NFC", pts: 10 },
  { pos: 11, key: "super_bowl", label: "Super Bowl Winner", scope: "champion", pts: 25 },
];

// Margin buckets for the weekly pick bonus. An exact 27-20 scoreline is effectively unguessable in
// football, so instead of the soccer exact-score bonus you call the winner AND how comfortably.
// `max: null` = open-ended. A tie is its own band (margin 0) so the shape stays total.
const NFL_MARGIN_BANDS = [
  { key: "tie", label: "Tie", min: 0, max: 0 },
  { key: "close", label: "1-3", min: 1, max: 3 },
  { key: "clear", label: "4-10", min: 4, max: 10 },
  { key: "blowout", label: "11+", min: 11, max: null },
];

// Playoff rounds are synced into league_matches after the 18-week regular season. They're pickable
// like any other week, and they're what resolves the conference-champion and Super Bowl slots.
const NFL_PLAYOFF_ROUNDS = { 19: "Wild Card", 20: "Divisional", 21: "Conference Championships", 22: "Super Bowl" };

const NFL_SCORING = {
  matchOutcome: 2,   // correct winner
  matchMargin: 2,    // bonus: correct winner AND the final margin lands in the predicted band
  award: 5,          // each correct award pick
  // Season-prediction points are per-slot (see NFL_SLOTS.pts) rather than zone-based.
};

// ── Champions League shape ───────────────────────────────────────────────────
// The 36-team league phase is one table, but finishing position decides a knockout path rather
// than European qualification: 1-8 go straight to the last 16, 9-24 into a two-legged playoff
// round, 25-36 are out. `cl`/`europa`/`conference`/`relegation` keep the shared zone key names so
// anything already reading zones keeps working; ZONE_LABELS in the frontend renames them.
const ZONES_36 = { champion: 1, cl: [1, 8], europa: null, conference: null, relegation: [25, 36] };

// Ranking 36 clubs is not a game anyone finishes, so the Champions League is predicted as named
// slots like the NFL. Same storage: league_season_predictions.position holds `pos` below.
//
// `scope` tells the scorer how to resolve each slot:
//   champion   — lifts the trophy (winner of the final)
//   finalist   — either team in the final; both finalist slots accept either, scored once each
//   top8       — finishes 1-8 in the league phase, i.e. straight into the last 16
const UCL_SLOTS = [
  { pos: 1, key: "winner", label: "Winner", scope: "champion", pts: 25 },
  { pos: 2, key: "finalist_a", label: "Finalist", scope: "finalist", pts: 8 },
  { pos: 3, key: "finalist_b", label: "Finalist", scope: "finalist", pts: 8 },
  ...Array.from({ length: 8 }, (_, i) => ({
    pos: 4 + i,
    key: `top8_${i + 1}`,
    label: "Top 8 (direct to Last 16)",
    scope: "top8",
    pts: 5,
  })),
];

// Knockout rounds as football-data.org reports them. Every round before the final is a two-legged
// tie (FD sends leg 1 as matchday 1 and leg 2 as matchday 2 within the stage); the final is a
// single match. `pts` is what a correctly picked tie winner is worth — rising by round, so a
// deep bracket run is worth more than calling eight playoff ties.
// `md` maps each leg onto a league_matches.matchday. football-data reports knockout legs as
// matchday 1 and 2 *within their stage*, which would collide head-on with league-phase matchdays
// 1-8, so legs are renumbered onto 9+ — the same trick NFL uses to carry playoffs as weeks 19-22.
// Everything that locks or scores a match then works on knockout legs untouched.
const UCL_KO_ROUNDS = [
  { stage: "PLAYOFFS", key: "po", label: "Knockout Playoff", legs: 2, ties: 8, pts: 3, md: [9, 10] },
  { stage: "LAST_16", key: "r16", label: "Last 16", legs: 2, ties: 8, pts: 5, md: [11, 12] },
  { stage: "QUARTER_FINALS", key: "qf", label: "Quarter-finals", legs: 2, ties: 4, pts: 8, md: [13, 14] },
  { stage: "SEMI_FINALS", key: "sf", label: "Semi-finals", legs: 2, ties: 2, pts: 12, md: [15, 16] },
  { stage: "FINAL", key: "final", label: "Final", legs: 1, ties: 1, pts: 20, md: [17] },
];

const UCL_SCORING = {
  ...DEFAULT_SCORING,
  // Season points come from UCL_SLOTS.pts, and knockout points from UCL_KO_ROUNDS.pts, so the
  // zone-based season keys inherited from DEFAULT_SCORING are unused here.
};

const leagues = {
  epl2627: {
    code: "epl2627",
    name: "Premier League 26/27",
    shortName: "Premier League",
    emoji: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    sport: "soccer",
    feed: "football-data",
    fdCompetition: "PL",
    squadSource: "pulselive",
    squadData: EPL_SQUADS,
    teamCount: 20,
    matchdays: 38,
    zones: ZONES_20,
    awards: [
      { key: "golden_boot", label: "Golden Boot", type: "player" },
      { key: "golden_glove", label: "Golden Glove", type: "player" },
      { key: "pots", label: "Player of the Season", type: "player" },
      { key: "ypots", label: "Young Player of the Season", type: "player" },
      { key: "mots", label: "Manager of the Season", type: "manager" },
    ],
    scoring: DEFAULT_SCORING,
  },

  laliga2627: {
    code: "laliga2627",
    name: "La Liga 26/27",
    shortName: "La Liga",
    emoji: "🇪🇸",
    sport: "soccer",
    feed: "football-data",
    fdCompetition: "PD",
    squadSource: "laliga",
    laligaSubscription: "laliga-easports-2026",
    squadData: LALIGA_SQUADS,
    teamCount: 20,
    matchdays: 38,
    zones: ZONES_20,
    awards: [
      { key: "pichichi", label: "Pichichi", type: "player" },       // top scorer
      { key: "zamora", label: "Zamora", type: "player" },           // best goalkeeper
      { key: "mvp", label: "MVP", type: "player" },
      { key: "best_young", label: "Best Young Player", type: "player" },
      { key: "best_coach", label: "Best Coach", type: "manager" },
    ],
    scoring: DEFAULT_SCORING,
  },

  seriea2627: {
    code: "seriea2627",
    name: "Serie A 26/27",
    shortName: "Serie A",
    emoji: "🇮🇹",
    sport: "soccer",
    feed: "football-data",
    fdCompetition: "SA",
    // No live Serie A squad feed exists; squads are file-seeded from seriea-squad-data.js and
    // refreshed manually. Team codes are football-data.org TLAs, so fixtures need no code mapping.
    squadSource: "none",
    squadData: SERIEA_SQUADS,
    teamCount: 20,
    matchdays: 38,
    zones: ZONES_20,
    awards: [
      { key: "capocannoniere", label: "Capocannoniere", type: "player" }, // top scorer
      { key: "best_gk", label: "Best Goalkeeper", type: "player" },
      { key: "mvp", label: "MVP", type: "player" },
      { key: "best_young", label: "Best Young Player", type: "player" },
      { key: "best_coach", label: "Coach of the Season", type: "manager" },
    ],
    scoring: DEFAULT_SCORING,
  },

  nfl2627: {
    code: "nfl2627",
    name: "NFL 26/27",
    shortName: "NFL",
    emoji: "🏈",
    sport: "nfl",
    // ESPN's public API — free, no key, and it already carries the full 2026 schedule. Team codes
    // are ESPN abbreviations (see nfl-squad-data.js), so fixtures need no code mapping.
    feed: "espn",
    espnPath: "football/nfl",
    espnSeason: 2026,
    squadSource: "espn",
    squadData: NFL_SQUADS,
    teamCount: 32,
    matchdays: 18,          // regular season; playoffs sync as weeks 19-22
    divisions: NFL_DIVISIONS,
    seasonSlots: NFL_SLOTS,
    marginBands: NFL_MARGIN_BANDS,
    playoffRounds: NFL_PLAYOFF_ROUNDS,
    conferenceRoundMatchday: 21, // winners of these two games take the conference-champion slots
    finalMatchday: 22,           // the Super Bowl — winner takes the champion slot
    awards: [
      { key: "mvp", label: "Most Valuable Player", type: "player" },
      { key: "opoy", label: "Offensive Player of the Year", type: "player" },
      { key: "dpoy", label: "Defensive Player of the Year", type: "player" },
      { key: "oroy", label: "Offensive Rookie of the Year", type: "player" },
      { key: "droy", label: "Defensive Rookie of the Year", type: "player" },
      { key: "cpoy", label: "Comeback Player of the Year", type: "player" },
      { key: "sb_mvp", label: "Super Bowl MVP", type: "player" },
      { key: "coy", label: "Coach of the Year", type: "manager" },
    ],
    scoring: NFL_SCORING,
  },

  ucl2627: {
    code: "ucl2627",
    name: "Champions League 26/27",
    shortName: "Champions League",
    emoji: "⭐",
    sport: "soccer",
    feed: "football-data",
    fdCompetition: "CL",
    // No squad file: the 36 clubs aren't known until the league-phase draw on 2026-08-27, so
    // teams are seeded straight from football-data.org (see syncFootballDataTeams in scores.js)
    // and player squads are backfilled afterwards. squadData stays empty rather than absent so
    // db.js's seeding loop can read it uniformly.
    squadSource: "none",
    squadData: UCL_SQUADS,
    seedTeamsFromFeed: true,
    // Nothing exists in the feed until the draw, so don't start polling a 404 for 24 days.
    fixtureRelease: "2026-08-27T18:00:00Z",
    teamCount: 36,
    matchdays: 8,               // league phase: 36 clubs, 8 opponents each, one 1..36 table
    // The league phase feeds a knockout bracket instead of European qualification, so the
    // finishing-position zones describe who advances rather than who qualifies for what.
    zones: ZONES_36,
    seasonSlots: UCL_SLOTS,     // named picks, not a 1..36 ranking — see UCL_SLOTS
    koRounds: UCL_KO_ROUNDS,    // two-legged ties + the one-off final
    awards: [
      { key: "top_scorer", label: "Top Scorer", type: "player" },
      { key: "best_gk", label: "Goalkeeper of the Season", type: "player" },
      { key: "ucl_winner", label: "Winning Club", type: "manager" },
    ],
    scoring: UCL_SCORING,
  },
};

function getLeague(code) {
  return leagues[code] || null;
}

function isLeague(code) {
  return Object.prototype.hasOwnProperty.call(leagues, code);
}

// Team-based award keys (pick a club, not a player) for a league — used by scoring + validation.
function managerAwardKeys(league) {
  return (league.awards || []).filter((a) => a.type === "manager").map((a) => a.key);
}

// The margin band a final scoreline falls into, or null if the league doesn't use bands.
// Callers pass the absolute margin (|home - away|).
function marginBandFor(league, margin) {
  for (const b of league.marginBands || []) {
    if (margin >= b.min && (b.max == null || margin <= b.max)) return b.key;
  }
  return null;
}

// Which league_matches.matchday a football-data match belongs to. Round-robin leagues use the
// API's own matchday; a league with knockout rounds (ucl2627) renumbers each leg onto its own
// matchday so legs can't collide with the league phase. Returns null for a stage we don't carry.
function matchdayForFdMatch(league, fdMatch) {
  const stage = fdMatch.stage;
  const rounds = league.koRounds || [];
  if (!rounds.length || !stage || stage === "LEAGUE_STAGE" || stage === "REGULAR_SEASON") {
    return fdMatch.matchday ?? null;
  }
  const round = rounds.find((r) => r.stage === stage);
  if (!round) return null;
  // Single-match rounds (the final) report matchday null; two-legged ties report 1 then 2.
  const legIndex = round.legs === 1 ? 0 : (fdMatch.matchday ?? 1) - 1;
  return round.md[legIndex] ?? null;
}

// The knockout round a renumbered matchday belongs to, plus which leg it is (1-based).
function koRoundForMatchday(league, matchday) {
  for (const r of league.koRounds || []) {
    const leg = r.md.indexOf(matchday);
    if (leg >= 0) return { round: r, leg: leg + 1 };
  }
  return null;
}

module.exports = {
  leagues, getLeague, isLeague, managerAwardKeys, marginBandFor,
  matchdayForFdMatch, koRoundForMatchday, DEFAULT_SCORING,
};
