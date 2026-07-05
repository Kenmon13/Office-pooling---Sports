// Frontend league UI config. The backend (/api/league/:code/config) is the source of truth for
// scoring, award keys, zones and team counts; this file carries the presentation-only bits the
// API doesn't need to know about — award emoji/descriptions, per-zone display labels — plus small
// helpers so components can stay league-agnostic. Keep award `key`s in sync with backend/leagues.js.
//
// Award `type`: "player" = pick a player, "team" = pick a club (its manager/coach wins). This
// mirrors the backend's "manager" type; the frontend picker uses "team".

const ZONES_20 = { champion: 1, cl: [1, 4], europa: 5, conference: 6, relegation: [18, 20] };
const ZONE_LABELS_EU = {
  champion: "Champion",
  cl: "Champions League",
  europa: "Europa League",
  conference: "Conference League",
  relegation: "Relegation",
};

export const LEAGUES = {
  epl2627: {
    code: "epl2627",
    name: "Premier League 26/27",
    shortName: "Premier League",
    emoji: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
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
};

export function isLeague(code) {
  return Object.prototype.hasOwnProperty.call(LEAGUES, code);
}

export function getLeague(code) {
  return LEAGUES[code] || null;
}

// Zone (Champions League / relegation / …) for a 1-based finishing position, for table coloring.
export function zoneForPosition(code, pos) {
  const L = LEAGUES[code];
  if (!L) return null;
  const z = L.zones;
  if (pos === z.champion) return "champion";
  if (Array.isArray(z.cl) && pos >= z.cl[0] && pos <= z.cl[1]) return "cl";
  if (pos === z.europa) return "europa";
  if (pos === z.conference) return "conference";
  if (Array.isArray(z.relegation) && pos >= z.relegation[0] && pos <= z.relegation[1]) return "relegation";
  return null;
}
