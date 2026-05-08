const db = require("./db");

// 2026 FIFA World Cup Groups (48 teams, 12 groups of 4)
const groupsData = {
  A: ["Morocco", "Peru", "Canada", "Australia"],
  B: ["Cameroon", "Ireland", "Portugal", "Colombia"],
  C: ["Argentina", "Uzbekistan", "Egypt", "Bolivia"],
  D: ["Italy", "Ivory Coast", "Ecuador", "Puerto Rico"],
  E: ["Mexico", "Japan", "Serbia", "New Zealand"],
  F: ["Brazil", "Nigeria", "Turkey", "Kenya"],
  G: ["France", "Panama", "South Korea", "Honduras"],
  H: ["England", "Senegal", "Chile", "Bahrain"],
  I: ["Spain", "Netherlands", "Paraguay", "Algeria"],
  J: ["Germany", "Saudi Arabia", "Croatia", "Iran"],
  K: ["USA", "Denmark", "China", "Indonesia"],
  L: ["Belgium", "Qatar", "Uruguay", "Venezuela"],
};

// Team codes (ISO-ish short codes)
const teamCodes = {
  Morocco: "MAR", Peru: "PER", Canada: "CAN", Australia: "AUS",
  Cameroon: "CMR", Ireland: "IRL", Portugal: "POR", Colombia: "COL",
  Argentina: "ARG", Uzbekistan: "UZB", Egypt: "EGY", Bolivia: "BOL",
  Italy: "ITA", "Ivory Coast": "CIV", Ecuador: "ECU", "Puerto Rico": "PUR",
  Mexico: "MEX", Japan: "JPN", Serbia: "SRB", "New Zealand": "NZL",
  Brazil: "BRA", Nigeria: "NGA", Turkey: "TUR", Kenya: "KEN",
  France: "FRA", Panama: "PAN", "South Korea": "KOR", Honduras: "HON",
  England: "ENG", Senegal: "SEN", Chile: "CHI", Bahrain: "BHR",
  Spain: "ESP", Netherlands: "NED", Paraguay: "PAR", Algeria: "ALG",
  Germany: "GER", "Saudi Arabia": "KSA", Croatia: "CRO", Iran: "IRN",
  USA: "USA", Denmark: "DEN", China: "CHN", Indonesia: "IDN",
  Belgium: "BEL", Qatar: "QAT", Uruguay: "URU", Venezuela: "VEN",
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
      const baseDateMs = new Date("2026-06-11").getTime();
      let matchIndex = 0;
      for (let i = 0; i < teamIds.length; i++) {
        for (let j = i + 1; j < teamIds.length; j++) {
          const dayOffset = matchIndex * 3; // space matches 3 days apart
          const matchDate = new Date(baseDateMs + dayOffset * 86400000)
            .toISOString()
            .split("T")[0];
          insertMatch.run(groupId, teamIds[i], teamIds[j], matchDate);
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
