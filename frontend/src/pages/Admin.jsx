import { useState, useEffect } from "react";
import { fetchMatches, updateMatch } from "../api";

function Admin() {
  const [matches, setMatches] = useState([]);
  const [scores, setScores] = useState({});

  useEffect(() => {
    fetchMatches().then((data) => {
      setMatches(data);
      const initial = {};
      data.forEach((m) => {
        initial[m.id] = {
          home_score: m.home_score ?? "",
          away_score: m.away_score ?? "",
        };
      });
      setScores(initial);
    });
  }, []);

  const handleUpdate = async (matchId) => {
    const s = scores[matchId];
    if (s.home_score === "" || s.away_score === "") return;
    await updateMatch(matchId, Number(s.home_score), Number(s.away_score), "finished");
    setMatches((prev) =>
      prev.map((m) =>
        m.id === matchId
          ? {
              ...m,
              home_score: Number(s.home_score),
              away_score: Number(s.away_score),
              status: "finished",
            }
          : m
      )
    );
  };

  const updateScore = (matchId, field, value) => {
    setScores((prev) => ({
      ...prev,
      [matchId]: { ...prev[matchId], [field]: value },
    }));
  };

  const upcomingMatches = matches.filter((m) => m.status === "upcoming");
  const finishedMatches = matches.filter((m) => m.status === "finished");

  return (
    <div className="page">
      <h2>Admin - Enter Results</h2>

      {upcomingMatches.length > 0 && (
        <>
          <h3>Upcoming Matches</h3>
          <div className="admin-list">
            {upcomingMatches.map((m) => (
              <div key={m.id} className="admin-card">
                <div className="match-info">
                  <span className="group-badge">Group {m.group_name}</span>
                  <span className="match-date">{m.match_date}</span>
                </div>
                <div className="score-input-row">
                  <span className="team">{m.home_team}</span>
                  <input
                    type="number"
                    min="0"
                    value={scores[m.id]?.home_score ?? ""}
                    onChange={(e) =>
                      updateScore(m.id, "home_score", e.target.value)
                    }
                    className="score-input"
                  />
                  <span className="vs">-</span>
                  <input
                    type="number"
                    min="0"
                    value={scores[m.id]?.away_score ?? ""}
                    onChange={(e) =>
                      updateScore(m.id, "away_score", e.target.value)
                    }
                    className="score-input"
                  />
                  <span className="team">{m.away_team}</span>
                  <button
                    onClick={() => handleUpdate(m.id)}
                    className="btn-submit"
                  >
                    Save Result
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {finishedMatches.length > 0 && (
        <>
          <h3>Finished Matches</h3>
          <div className="admin-list">
            {finishedMatches.map((m) => (
              <div key={m.id} className="admin-card finished">
                <span className="group-badge">Group {m.group_name}</span>
                <span>
                  {m.home_team} {m.home_score} - {m.away_score} {m.away_team}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default Admin;
