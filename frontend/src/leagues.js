// Frontend league UI config. The backend (/api/league/:code/config) is the source of truth for
// scoring, award keys, zones and team counts; this file carries the presentation-only bits the
// API doesn't need to know about — award emoji/descriptions, per-zone display labels — plus small
// helpers so components can stay league-agnostic. Keep award `key`s in sync with backend/leagues.js.
//
// Award `type`: "player" = pick a player, "team" = pick a club (its manager/coach wins). This
// mirrors the backend's "manager" type; the frontend picker uses "team".
//
// `sport` mirrors the backend discriminator: "soccer" leagues rank one table 1..N; "nfl" is split
// into conferences/divisions and predicted as named slots. Components branch on isNFL(code).

const ZONES_20 = { champion: 1, cl: [1, 4], europa: 5, conference: 6, relegation: [18, 20] };
const ZONE_LABELS_EU = {
  champion: "Champion",
  cl: "Champions League",
  europa: "Europa League",
  conference: "Conference League",
  relegation: "Relegation",
};

// NFL season-prediction slots — the presentation half of backend NFL_SLOTS. `pos` must match the
// backend exactly: it's what gets stored in league_season_predictions.position.
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

const NFL_SLOTS = [
  ...NFL_DIVISIONS.map((d, i) => ({
    pos: i + 1,
    key: `div_${d.name.toLowerCase().replace(/\s+/g, "_")}`,
    label: `${d.name} Winner`,
    scope: "division",
    division: d.name,
    conference: d.conference,
    pts: 5,
    emoji: "\u{1F3C6}",
  })),
  { pos: 9, key: "afc_champion", label: "AFC Champion", scope: "conference", conference: "AFC", pts: 10, emoji: "\u{1F947}" },
  { pos: 10, key: "nfc_champion", label: "NFC Champion", scope: "conference", conference: "NFC", pts: 10, emoji: "\u{1F947}" },
  { pos: 11, key: "super_bowl", label: "Super Bowl Winner", scope: "champion", pts: 25, emoji: "\u{1F3C8}" },
];

const NFL_MARGIN_BANDS = [
  { key: "tie", label: "Tie", desc: "Scores level", min: 0, max: 0 },
  { key: "close", label: "1-3", desc: "One score", min: 1, max: 3 },
  { key: "clear", label: "4-10", desc: "Comfortable", min: 4, max: 10 },
  { key: "blowout", label: "11+", desc: "Blowout", min: 11, max: null },
];

// Champions League: one 36-club league phase table, but finishing position decides a knockout
// path rather than European qualification, so the shared zone keys are relabelled.
const ZONES_36 = { champion: 1, cl: [1, 8], europa: null, conference: null, relegation: [25, 36] };
const ZONE_LABELS_UCL = {
  champion: "Top of the league phase",
  cl: "Direct to Last 16",
  europa: null,
  conference: null,
  relegation: "Eliminated",
};

// Mirrors backend UCL_SLOTS — `pos` must match exactly, it's what's stored as
// league_season_predictions.position. Ranking 36 clubs isn't a game anyone finishes, so the
// Champions League is predicted as named slots like the NFL.
const UCL_SLOTS = [
  { pos: 1, key: "winner", label: "Winner", scope: "champion", pts: 25, emoji: "\u{1F3C6}" },
  { pos: 2, key: "finalist_a", label: "Finalist", scope: "finalist", pts: 8, emoji: "\u{1F948}" },
  { pos: 3, key: "finalist_b", label: "Finalist", scope: "finalist", pts: 8, emoji: "\u{1F948}" },
  ...Array.from({ length: 8 }, (_, i) => ({
    pos: 4 + i,
    key: `top8_${i + 1}`,
    label: `Top 8 — pick ${i + 1}`,
    scope: "top8",
    pts: 5,
    emoji: "\u{2B50}",
  })),
];

// Knockout rounds, mirroring backend UCL_KO_ROUNDS. `pts` is what a correctly picked tie winner
// is worth, rising by round so a deep bracket run outscores calling eight playoff ties.
const UCL_KO_ROUNDS = [
  { key: "po", label: "Knockout Playoff", legs: 2, pts: 3 },
  { key: "r16", label: "Last 16", legs: 2, pts: 5 },
  { key: "qf", label: "Quarter-finals", legs: 2, pts: 8 },
  { key: "sf", label: "Semi-finals", legs: 2, pts: 12 },
  { key: "final", label: "Final", legs: 1, pts: 20 },
];

export const LEAGUES = {
  epl2627: {
    code: "epl2627",
    name: "Premier League 26/27",
    shortName: "Premier League",
    emoji: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    sport: "soccer",
    teamCount: 20,
    matchdays: 38,
    zones: ZONES_20,
    zoneLabels: ZONE_LABELS_EU,
    awards: [
      { key: "golden_boot",  label: "Golden Boot",              emoji: "\u{1F45F}", pts: 5, type: "player", desc: "Awarded to the top goalscorer of the season." },
      { key: "golden_glove", label: "Golden Glove",             emoji: "\u{1F9E4}", pts: 5, type: "player", posFilter: "GK", desc: "Awarded to the goalkeeper with the most clean sheets." },
      { key: "pots",         label: "Player of the Season",     emoji: "\u{1F947}", pts: 5, type: "player", desc: "Awarded to the best overall player of the season." },
      { key: "ypots",        label: "Young Player of the Season", emoji: "\u{1F31F}", pts: 5, type: "player", desc: "Awarded to the best player aged 23 or younger." },
      { key: "mots",         label: "Manager of the Season",    emoji: "\u{1F9D1}‍\u{1F4BC}", pts: 5, type: "team", desc: "Awarded to the best manager of the season." },
    ],
  },

  laliga2627: {
    code: "laliga2627",
    name: "La Liga 26/27",
    shortName: "La Liga",
    emoji: "🇪🇸",
    sport: "soccer",
    teamCount: 20,
    matchdays: 38,
    zones: ZONES_20,
    zoneLabels: ZONE_LABELS_EU,
    awards: [
      { key: "pichichi",   label: "Pichichi",           emoji: "\u{1F45F}", pts: 5, type: "player", desc: "Awarded to the top goalscorer of the season." },
      { key: "zamora",     label: "Zamora",             emoji: "\u{1F9E4}", pts: 5, type: "player", posFilter: "GK", desc: "Awarded to the goalkeeper with the lowest goals-to-games ratio." },
      { key: "mvp",        label: "MVP",                emoji: "\u{1F947}", pts: 5, type: "player", desc: "Awarded to the best overall player of the season." },
      { key: "best_young", label: "Best Young Player",  emoji: "\u{1F31F}", pts: 5, type: "player", desc: "Awarded to the best player aged 23 or younger." },
      { key: "best_coach", label: "Best Coach",         emoji: "\u{1F9D1}‍\u{1F4BC}", pts: 5, type: "team", desc: "Awarded to the best coach of the season." },
    ],
  },

  seriea2627: {
    code: "seriea2627",
    name: "Serie A 26/27",
    shortName: "Serie A",
    emoji: "🇮🇹",
    sport: "soccer",
    teamCount: 20,
    matchdays: 38,
    zones: ZONES_20,
    zoneLabels: ZONE_LABELS_EU,
    awards: [
      { key: "capocannoniere", label: "Capocannoniere",       emoji: "\u{1F45F}", pts: 5, type: "player", desc: "Awarded to the top goalscorer of the season." },
      { key: "best_gk",        label: "Best Goalkeeper",       emoji: "\u{1F9E4}", pts: 5, type: "player", posFilter: "GK", desc: "Awarded to the best goalkeeper of the season." },
      { key: "mvp",            label: "MVP",                   emoji: "\u{1F947}", pts: 5, type: "player", desc: "Awarded to the best overall player of the season." },
      { key: "best_young",     label: "Best Young Player",     emoji: "\u{1F31F}", pts: 5, type: "player", desc: "Awarded to the best player aged 23 or younger." },
      { key: "best_coach",     label: "Coach of the Season",   emoji: "\u{1F9D1}‍\u{1F4BC}", pts: 5, type: "team", desc: "Awarded to the best coach of the season." },
    ],
  },

  nfl2627: {
    code: "nfl2627",
    name: "NFL 26/27",
    shortName: "NFL",
    emoji: "🏈",
    sport: "nfl",
    teamCount: 32,
    matchdays: 18,
    divisions: NFL_DIVISIONS,
    seasonSlots: NFL_SLOTS,
    marginBands: NFL_MARGIN_BANDS,
    // Playoff weeks arrive after the 18-week regular season and are pickable like any other week.
    playoffRounds: { 19: "Wild Card", 20: "Divisional", 21: "Conference Championships", 22: "Super Bowl" },
    awards: [
      { key: "mvp",    label: "Most Valuable Player",         emoji: "\u{1F947}", pts: 5, type: "player", desc: "Awarded to the best overall player of the season." },
      { key: "opoy",   label: "Offensive Player of the Year",  emoji: "\u{1F3AF}", pts: 5, type: "player", desc: "Awarded to the best offensive player of the season." },
      { key: "dpoy",   label: "Defensive Player of the Year",  emoji: "\u{1F6E1}️", pts: 5, type: "player", desc: "Awarded to the best defensive player of the season." },
      { key: "oroy",   label: "Offensive Rookie of the Year",  emoji: "\u{1F31F}", pts: 5, type: "player", desc: "Awarded to the best first-year offensive player." },
      { key: "droy",   label: "Defensive Rookie of the Year",  emoji: "\u{1F4AB}", pts: 5, type: "player", desc: "Awarded to the best first-year defensive player." },
      { key: "cpoy",   label: "Comeback Player of the Year",   emoji: "\u{1F4AA}", pts: 5, type: "player", desc: "Awarded to the player who best returned to form after injury or absence." },
      { key: "sb_mvp", label: "Super Bowl MVP",                emoji: "\u{1F3C8}", pts: 5, type: "player", desc: "Awarded to the standout player of the Super Bowl." },
      { key: "coy",    label: "Coach of the Year",             emoji: "\u{1F9D1}‍\u{1F4BC}", pts: 5, type: "team", desc: "Awarded to the best head coach of the season." },
    ],
  },

  ucl2627: {
    code: "ucl2627",
    name: "Champions League 26/27",
    shortName: "Champions League",
    emoji: "⭐",
    sport: "soccer",
    teamCount: 36,
    matchdays: 8,          // league phase; knockout legs arrive on matchdays 9-17
    zones: ZONES_36,
    zoneLabels: ZONE_LABELS_UCL,
    seasonSlots: UCL_SLOTS,
    koRounds: UCL_KO_ROUNDS,
    awards: [
      { key: "top_scorer", label: "Top Scorer",               emoji: "\u{1F45F}", pts: 5, type: "player", desc: "Awarded to the top goalscorer of the competition." },
      { key: "best_gk",    label: "Goalkeeper of the Season", emoji: "\u{1F9E4}", pts: 5, type: "player", posFilter: "GK", desc: "Awarded to the best goalkeeper of the competition." },
      { key: "ucl_winner", label: "Winning Club",             emoji: "\u{1F3C6}", pts: 5, type: "team", desc: "Awarded to the club that lifts the trophy." },
    ],
  },
};

export function isLeague(code) {
  return Object.prototype.hasOwnProperty.call(LEAGUES, code);
}

export function getLeague(code) {
  return LEAGUES[code] || null;
}

export function isNFL(code) {
  return LEAGUES[code]?.sport === "nfl";
}

// Leagues predicted as a fixed set of named picks (NFL slots, Champions League slots) rather than
// by ranking the whole table. Keyed on the config, not the sport, so any league can opt in.
export function isSlotBased(code) {
  return (LEAGUES[code]?.seasonSlots || []).length > 0;
}

// Leagues that carry a knockout bracket on top of their league phase.
export function hasBracket(code) {
  return (LEAGUES[code]?.koRounds || []).length > 0;
}

// Zone (Champions League / relegation / …) for a 1-based finishing position, for table coloring.
// NFL has no zones — it returns null, so table rendering stays uncolored rather than throwing.
export function zoneForPosition(code, pos) {
  const L = LEAGUES[code];
  if (!L?.zones) return null;
  const z = L.zones;
  if (pos === z.champion) return "champion";
  if (Array.isArray(z.cl) && pos >= z.cl[0] && pos <= z.cl[1]) return "cl";
  if (pos === z.europa) return "europa";
  if (pos === z.conference) return "conference";
  if (Array.isArray(z.relegation) && pos >= z.relegation[0] && pos <= z.relegation[1]) return "relegation";
  return null;
}

// The margin band a final scoreline falls into — mirrors backend marginBandFor().
export function marginBandFor(code, margin) {
  for (const b of LEAGUES[code]?.marginBands || []) {
    if (margin >= b.min && (b.max == null || margin <= b.max)) return b.key;
  }
  return null;
}
