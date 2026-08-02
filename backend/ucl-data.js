// Champions League 26/27 club list for the generalized league engine.
//
// Unlike the domestic leagues this file ships EMPTY on purpose. The 36 clubs are not known until
// the league-phase draw on 2026-08-27 — the last six come out of the play-off round that ends on
// 26 August — so there is nothing truthful to hard-code here beforehand. leagues.js sets
// `seedTeamsFromFeed: true` for ucl2627, and scores.js seeds league_teams straight from
// football-data.org's CL teams endpoint (36 clubs, TLA codes, crests) once the draw publishes.
//
// `squads` stays empty until the clubs are known; player awards (top scorer, goalkeeper of the
// season) only become pickable once squads are backfilled after the draw.
//
// Consumed by db.js to seed league_teams + league_players tagged league='ucl2627'.

const teams = [];

const squads = {};

module.exports = { teams, squads };
