const db = require("./db");

const API_BASE = "https://api.football-data.org/v4";
const COMPETITION = "WC"; // FIFA World Cup

async function fetchLiveScores() {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    console.log("No FOOTBALL_API_KEY set, skipping score refresh.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/competitions/${COMPETITION}/matches?status=FINISHED`, {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!res.ok) {
      console.log(`Score API responded ${res.status}, skipping.`);
      return;
    }

    const data = await res.json();
    const matches = data.matches || [];

    const updateMatch = db.prepare(
      "UPDATE matches SET home_score = ?, away_score = ?, status = 'finished' WHERE home_team_id = (SELECT id FROM teams WHERE code = ?) AND away_team_id = (SELECT id FROM teams WHERE code = ?) AND status = 'upcoming'"
    );

    let updated = 0;
    for (const m of matches) {
      const homeCode = m.homeTeam?.tla;
      const awayCode = m.awayTeam?.tla;
      const homeScore = m.score?.fullTime?.home;
      const awayScore = m.score?.fullTime?.away;

      if (homeCode && awayCode && homeScore != null && awayScore != null) {
        const result = updateMatch.run(homeScore, awayScore, homeCode, awayCode);
        if (result.changes > 0) updated++;
      }
    }

    if (updated > 0) {
      console.log(`Updated ${updated} match result(s) from API.`);
    }
  } catch (err) {
    console.log("Score fetch error:", err.message);
  }
}

// Check for new results every 5 minutes
function startScoreRefresh() {
  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    console.log("FOOTBALL_API_KEY not set. Scores will not auto-update.");
    console.log("Get a free key at https://www.football-data.org/client/register");
    return;
  }

  console.log("Auto score refresh enabled (every 5 minutes).");
  fetchLiveScores();
  setInterval(fetchLiveScores, 5 * 60 * 1000);
}

module.exports = { startScoreRefresh };
