// Display metadata for the sports and tournaments a pool can belong to — the single source of
// truth for every place the UI turns a `pools.sport` / `pools.tournament` value into a name and
// an emoji.
//
// This exists because four screens each kept their own private copy of these maps and they
// drifted: the admin dashboard and Settings were both missing `nfl2627` and `seriea2627`, so
// anyone in an NFL or Serie A pool saw the raw code ("nfl2627") in Settings > My Pools, and the
// admin Pools tab listed a sport called "americanfootball" with no emoji. Everything derivable
// is derived here instead, so adding a league only means adding it to LEAGUES.
import { LEAGUES } from "./leagues";

// Keyed by the value stored in pools.sport. `available` gates the picker, not existing pools.
export const SPORTS = {
  soccer: { id: "soccer", name: "Soccer", emoji: "⚽", available: true },
  americanfootball: { id: "americanfootball", name: "American Football", emoji: "🏈", available: true },
  basketball: { id: "basketball", name: "Basketball", emoji: "🏀", available: false },
};

// Order the sport picker renders in.
const SPORT_ORDER = ["soccer", "americanfootball", "basketball"];

// LEAGUES[].sport is the *scoring* discriminator ("soccer" ranks one table, "nfl" splits into
// conferences), which is not the same vocabulary as the pools.sport column. Translate rather
// than conflate — one entry per sport, so a new league needs nothing here.
const POOL_SPORT_BY_LEAGUE_SPORT = { soccer: "soccer", nfl: "americanfootball" };

// Keyed by pools.tournament. The World Cup is the one hand-written entry — it isn't a league, so
// it has no LEAGUES row; every league is derived from there.
export const TOURNAMENTS = {
  wc2026: { id: "wc2026", name: "World Cup 2026", emoji: "🏆", sport: "soccer", available: true },
  ...Object.fromEntries(
    Object.values(LEAGUES).map((l) => [
      l.code,
      {
        id: l.code,
        name: l.name,
        shortName: l.shortName,
        emoji: l.emoji,
        sport: POOL_SPORT_BY_LEAGUE_SPORT[l.sport] || l.sport,
        available: true,
      },
    ])
  ),
};

// Order the tournament picker renders in. LEAGUES is keyed for lookup, so it carries no order of
// its own; anything missing here falls to the end rather than disappearing.
const TOURNAMENT_ORDER = ["wc2026", "ucl2627", "epl2627", "laliga2627", "seriea2627", "nfl2627"];

const orderedTournaments = () => {
  const ranked = Object.values(TOURNAMENTS).map((t) => {
    const i = TOURNAMENT_ORDER.indexOf(t.id);
    return { t, rank: i === -1 ? TOURNAMENT_ORDER.length : i };
  });
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((r) => r.t);
};

// Lookups for rendering a pool that already exists. Unknown ids fall back to showing the raw
// value, which is still better than a blank row.
export const sportMeta = (id) => SPORTS[id] || { id, name: id, emoji: "" };
export const tournamentMeta = (id) => TOURNAMENTS[id] || { id, name: id, emoji: "" };

// Picker sources.
export const sportList = () => SPORT_ORDER.map((id) => SPORTS[id]).filter(Boolean);
export const tournamentsForSport = (sportId) => orderedTournaments().filter((t) => t.sport === sportId);
