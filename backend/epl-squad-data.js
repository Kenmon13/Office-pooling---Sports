// Premier League 26/27 teams + squads for the generalized league engine. Wraps the existing
// squad roster (pl-squad-data.js) and adds club metadata so db.js can seed league_teams +
// league_players uniformly across leagues (see also laliga-squad-data.js). crest is null for
// EPL — the frontend renders PL badges from its local sprite (plCrest). pos in 'GK'|'DF'|'MF'|'FW'.

const squads = require("./pl-squad-data");

const teams = [
  { name: "Arsenal", code: "ARS", short_name: "Arsenal", manager: "Mikel Arteta", crest: null },
  { name: "Aston Villa", code: "AVL", short_name: "Aston Villa", manager: "Unai Emery", crest: null },
  { name: "AFC Bournemouth", code: "BOU", short_name: "Bournemouth", manager: "Marco Rose", crest: null },
  { name: "Brentford", code: "BRE", short_name: "Brentford", manager: "Keith Andrews", crest: null },
  { name: "Brighton & Hove Albion", code: "BHA", short_name: "Brighton", manager: "Fabian Hürzeler", crest: null },
  { name: "Chelsea", code: "CHE", short_name: "Chelsea", manager: "Xabi Alonso", crest: null },
  { name: "Coventry City", code: "COV", short_name: "Coventry", manager: "Frank Lampard", crest: null },
  { name: "Crystal Palace", code: "CRY", short_name: "Crystal Palace", manager: "Oliver Glasner", crest: null },
  { name: "Everton", code: "EVE", short_name: "Everton", manager: "David Moyes", crest: null },
  { name: "Fulham", code: "FUL", short_name: "Fulham", manager: "Marco Silva", crest: null },
  { name: "Hull City", code: "HUL", short_name: "Hull City", manager: "Sergej Jakirović", crest: null },
  { name: "Ipswich Town", code: "IPS", short_name: "Ipswich", manager: "Kieran McKenna", crest: null },
  { name: "Leeds United", code: "LEE", short_name: "Leeds", manager: "Daniel Farke", crest: null },
  { name: "Liverpool", code: "LIV", short_name: "Liverpool", manager: "Andoni Iraola", crest: null },
  { name: "Manchester City", code: "MCI", short_name: "Man City", manager: "Pep Guardiola", crest: null },
  { name: "Manchester United", code: "MUN", short_name: "Man United", manager: "Michael Carrick", crest: null },
  { name: "Newcastle United", code: "NEW", short_name: "Newcastle", manager: "Eddie Howe", crest: null },
  { name: "Nottingham Forest", code: "NFO", short_name: "Nott'm Forest", manager: "Vítor Pereira", crest: null },
  { name: "Sunderland", code: "SUN", short_name: "Sunderland", manager: "Régis Le Bris", crest: null },
  { name: "Tottenham Hotspur", code: "TOT", short_name: "Tottenham", manager: "Roberto De Zerbi", crest: null },
];

module.exports = { teams, squads };
