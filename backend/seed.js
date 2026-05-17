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
    for (const [groupName, teams] of Object.entries(groupsData)) {
      const groupResult = insertGroup.run(groupName);
      const groupId = groupResult.lastInsertRowid;

      const teamIds = [];
      for (const team of teams) {
        const result = insertTeam.run(team, teamCodes[team], groupId);
        teamIds.push(result.lastInsertRowid);
      }

      // Generate round-robin matches for each group (6 matches per group)
      // Dates are approximate - spread across June 11 - June 27, 2026
      const kickoffTimes = ["13:00", "16:00", "19:00"];
      const baseDateMs = new Date("2026-06-11").getTime();
      let matchIndex = 0;
      for (let i = 0; i < teamIds.length; i++) {
        for (let j = i + 1; j < teamIds.length; j++) {
          const dayOffset = matchIndex * 3; // space matches 3 days apart
          const matchDate = new Date(baseDateMs + dayOffset * 86400000)
            .toISOString()
            .split("T")[0];
          const kickoff = kickoffTimes[matchIndex % kickoffTimes.length];
          insertMatch.run(groupId, teamIds[i], teamIds[j], `${matchDate} ${kickoff}`);
          matchIndex++;
        }
      }
    }
  });

  transaction();
  console.log("Database seeded with 2026 World Cup group stage data.");
}

seed();
module.exports = seed;
