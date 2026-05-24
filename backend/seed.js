const db = require("./db");

// 2026 FIFA World Cup Groups (48 teams, 12 groups of 4)
const groupsData = {
  A: ["Mexico", "South Africa", "South Korea", "Czechia"],
  B: ["Canada", "Switzerland", "Qatar", "Bosnia and Herzegovina"],
  C: ["Brazil", "Morocco", "Haiti", "Scotland"],
  D: ["USA", "Paraguay", "Australia", "Türkiye"],
  E: ["Germany", "Curaçao", "Ivory Coast", "Ecuador"],
  F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
  G: ["Belgium", "Egypt", "Iran", "New Zealand"],
  H: ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"],
  I: ["France", "Senegal", "Norway", "Iraq"],
  J: ["Argentina", "Algeria", "Austria", "Jordan"],
  K: ["Portugal", "DR Congo", "Uzbekistan", "Colombia"],
  L: ["England", "Croatia", "Ghana", "Panama"],
};

// Team codes (FIFA 3-letter codes)
const teamCodes = {
  Mexico: "MEX", "South Africa": "RSA", "South Korea": "KOR", Czechia: "CZE",
  Canada: "CAN", Switzerland: "SUI", Qatar: "QAT", "Bosnia and Herzegovina": "BIH",
  Brazil: "BRA", Morocco: "MAR", Haiti: "HAI", Scotland: "SCO",
  USA: "USA", Paraguay: "PAR", Australia: "AUS", "Türkiye": "TUR",
  Germany: "GER", "Curaçao": "CUW", "Ivory Coast": "CIV", Ecuador: "ECU",
  Netherlands: "NED", Japan: "JPN", Sweden: "SWE", Tunisia: "TUN",
  Belgium: "BEL", Egypt: "EGY", Iran: "IRN", "New Zealand": "NZL",
  Spain: "ESP", "Cape Verde": "CPV", "Saudi Arabia": "KSA", Uruguay: "URU",
  France: "FRA", Senegal: "SEN", Norway: "NOR", Iraq: "IRQ",
  Argentina: "ARG", Algeria: "ALG", Austria: "AUT", Jordan: "JOR",
  Portugal: "POR", "DR Congo": "COD", Uzbekistan: "UZB", Colombia: "COL",
  England: "ENG", Croatia: "CRO", Ghana: "GHA", Panama: "PAN",
};

// Official FIFA World Cup 2026 group stage schedule (all times UTC)
const matchSchedule = {
  A: [
    { home: "Mexico", away: "South Africa", date: "2026-06-11 19:00" },
    { home: "South Korea", away: "Czechia", date: "2026-06-12 02:00" },
    { home: "Czechia", away: "South Africa", date: "2026-06-18 16:00" },
    { home: "Mexico", away: "South Korea", date: "2026-06-19 01:00" },
    { home: "Czechia", away: "Mexico", date: "2026-06-25 01:00" },
    { home: "South Korea", away: "South Africa", date: "2026-06-25 01:00" },
  ],
  B: [
    { home: "Canada", away: "Bosnia and Herzegovina", date: "2026-06-12 19:00" },
    { home: "Switzerland", away: "Qatar", date: "2026-06-12 22:00" },
    { home: "Switzerland", away: "Bosnia and Herzegovina", date: "2026-06-18 19:00" },
    { home: "Canada", away: "Qatar", date: "2026-06-18 22:00" },
    { home: "Switzerland", away: "Canada", date: "2026-06-24 19:00" },
    { home: "Bosnia and Herzegovina", away: "Qatar", date: "2026-06-24 19:00" },
  ],
  C: [
    { home: "Brazil", away: "Morocco", date: "2026-06-13 22:00" },
    { home: "Haiti", away: "Scotland", date: "2026-06-14 01:00" },
    { home: "Scotland", away: "Morocco", date: "2026-06-19 22:00" },
    { home: "Brazil", away: "Haiti", date: "2026-06-20 00:30" },
    { home: "Scotland", away: "Brazil", date: "2026-06-24 22:00" },
    { home: "Morocco", away: "Haiti", date: "2026-06-24 22:00" },
  ],
  D: [
    { home: "USA", away: "Paraguay", date: "2026-06-13 01:00" },
    { home: "Australia", away: "Türkiye", date: "2026-06-13 04:00" },
    { home: "USA", away: "Australia", date: "2026-06-19 19:00" },
    { home: "Türkiye", away: "Paraguay", date: "2026-06-20 03:00" },
    { home: "Türkiye", away: "USA", date: "2026-06-25 02:00" },
    { home: "Paraguay", away: "Australia", date: "2026-06-25 02:00" },
  ],
  E: [
    { home: "Germany", away: "Curaçao", date: "2026-06-14 17:00" },
    { home: "Ivory Coast", away: "Ecuador", date: "2026-06-14 23:00" },
    { home: "Germany", away: "Ivory Coast", date: "2026-06-20 20:00" },
    { home: "Ecuador", away: "Curaçao", date: "2026-06-21 00:00" },
    { home: "Ecuador", away: "Germany", date: "2026-06-25 20:00" },
    { home: "Curaçao", away: "Ivory Coast", date: "2026-06-25 20:00" },
  ],
  F: [
    { home: "Netherlands", away: "Japan", date: "2026-06-14 20:00" },
    { home: "Sweden", away: "Tunisia", date: "2026-06-15 02:00" },
    { home: "Netherlands", away: "Sweden", date: "2026-06-20 17:00" },
    { home: "Tunisia", away: "Japan", date: "2026-06-21 04:00" },
    { home: "Japan", away: "Sweden", date: "2026-06-25 23:00" },
    { home: "Tunisia", away: "Netherlands", date: "2026-06-25 23:00" },
  ],
  G: [
    { home: "Belgium", away: "Egypt", date: "2026-06-15 19:00" },
    { home: "Iran", away: "New Zealand", date: "2026-06-16 01:00" },
    { home: "Belgium", away: "Iran", date: "2026-06-21 19:00" },
    { home: "New Zealand", away: "Egypt", date: "2026-06-22 01:00" },
    { home: "Egypt", away: "Iran", date: "2026-06-27 03:00" },
    { home: "New Zealand", away: "Belgium", date: "2026-06-27 03:00" },
  ],
  H: [
    { home: "Spain", away: "Cape Verde", date: "2026-06-15 16:00" },
    { home: "Saudi Arabia", away: "Uruguay", date: "2026-06-15 22:00" },
    { home: "Spain", away: "Saudi Arabia", date: "2026-06-21 16:00" },
    { home: "Uruguay", away: "Cape Verde", date: "2026-06-21 22:00" },
    { home: "Cape Verde", away: "Saudi Arabia", date: "2026-06-27 00:00" },
    { home: "Uruguay", away: "Spain", date: "2026-06-27 00:00" },
  ],
  I: [
    { home: "France", away: "Senegal", date: "2026-06-16 19:00" },
    { home: "Iraq", away: "Norway", date: "2026-06-16 22:00" },
    { home: "France", away: "Iraq", date: "2026-06-22 21:00" },
    { home: "Norway", away: "Senegal", date: "2026-06-23 00:00" },
    { home: "Norway", away: "France", date: "2026-06-26 19:00" },
    { home: "Senegal", away: "Iraq", date: "2026-06-26 19:00" },
  ],
  J: [
    { home: "Argentina", away: "Algeria", date: "2026-06-17 01:00" },
    { home: "Austria", away: "Jordan", date: "2026-06-17 04:00" },
    { home: "Argentina", away: "Austria", date: "2026-06-22 17:00" },
    { home: "Jordan", away: "Algeria", date: "2026-06-23 03:00" },
    { home: "Jordan", away: "Argentina", date: "2026-06-28 02:00" },
    { home: "Algeria", away: "Austria", date: "2026-06-28 02:00" },
  ],
  K: [
    { home: "Portugal", away: "DR Congo", date: "2026-06-17 17:00" },
    { home: "Uzbekistan", away: "Colombia", date: "2026-06-18 02:00" },
    { home: "Portugal", away: "Uzbekistan", date: "2026-06-23 17:00" },
    { home: "Colombia", away: "DR Congo", date: "2026-06-24 02:00" },
    { home: "DR Congo", away: "Uzbekistan", date: "2026-06-27 23:30" },
    { home: "Colombia", away: "Portugal", date: "2026-06-27 23:30" },
  ],
  L: [
    { home: "England", away: "Croatia", date: "2026-06-17 20:00" },
    { home: "Ghana", away: "Panama", date: "2026-06-17 23:00" },
    { home: "England", away: "Ghana", date: "2026-06-23 20:00" },
    { home: "Panama", away: "Croatia", date: "2026-06-23 23:00" },
    { home: "Panama", away: "England", date: "2026-06-27 21:00" },
    { home: "Croatia", away: "Ghana", date: "2026-06-27 21:00" },
  ],
};

function seed() {
  const existingGroups = db.prepare("SELECT COUNT(*) as count FROM groups").get();
  if (existingGroups.count > 0) {
    console.log("Database already seeded, skipping.");
    return;
  }

  const insertGroup = db.prepare("INSERT INTO groups (name) VALUES (?)");
  const insertTeam = db.prepare("INSERT INTO teams (name, code, group_id) VALUES (?, ?, ?)");
  const insertMatch = db.prepare("INSERT INTO matches (group_id, home_team_id, away_team_id, match_date, status) VALUES (?, ?, ?, ?, 'upcoming')");

  const transaction = db.transaction(() => {
    // First insert all groups and teams
    const groupIds = {};
    const teamIds = {};

    for (const [groupName, teams] of Object.entries(groupsData)) {
      const groupResult = insertGroup.run(groupName);
      groupIds[groupName] = groupResult.lastInsertRowid;

      for (const team of teams) {
        const result = insertTeam.run(team, teamCodes[team], groupIds[groupName]);
        teamIds[team] = result.lastInsertRowid;
      }
    }

    // Insert matches using the official schedule
    for (const [groupName, matches] of Object.entries(matchSchedule)) {
      for (const match of matches) {
        insertMatch.run(groupIds[groupName], teamIds[match.home], teamIds[match.away], match.date);
      }
    }
  });

  transaction();
  console.log("Database seeded with 2026 World Cup group stage data.");
}

seed();
module.exports = seed;
