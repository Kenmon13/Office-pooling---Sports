// Config-driven league engine. Each domestic round-robin league (EPL, La Liga, and — later —
// Serie A / Bundesliga / Ligue 1) is described here once; db.js seeding, the /api/league/:code
// endpoints, leaderboard scoring, and the sync layer all read from this config instead of
// hard-forking per competition. WC2022/WC2026 are knockout-shaped and stay separate.
//
// Per-league knobs:
//   fdCompetition  — football-data.org competition code (fixtures/scores). PL/PD/SA/BL1/FL1.
//   squadSource    — live squad refresh source: 'pulselive' (premierleague.com) | 'laliga'.
//   squadData      — { teams:[{name,code,short_name,manager,crest}], squads:{CODE:[{name,pos}]} }
//   teamCount / matchdays — league size (20/38 for EPL·La Liga·Serie A; 18/34 for BL1·FL1).
//   zones          — table zones by finishing position (drives season-prediction scoring + UI
//                    labels). ranges are inclusive [from,to]; relegation defaults to the last 3.
//   awards         — award categories. type 'player' = pick a player_id; 'manager' = pick a
//                    team_id (the club whose boss wins). Replaces the old hardcoded award lists.
//   scoring        — point values, shared shape so every league scores identically by default.

const EPL_SQUADS = require("./epl-squad-data");
const LALIGA_SQUADS = require("./laliga-squad-data");
const SERIEA_SQUADS = require("./seriea-squad-data");

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

const leagues = {
  epl2627: {
    code: "epl2627",
    name: "Premier League 26/27",
    shortName: "Premier League",
    emoji: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
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

module.exports = { leagues, getLeague, isLeague, managerAwardKeys, DEFAULT_SCORING };
