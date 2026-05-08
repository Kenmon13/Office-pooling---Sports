import { useState, useEffect } from "react";
import { fetchMatches, fetchPredictions, submitPrediction } from "../api";

function Predictions({ currentUser }) {
  const [matches, setMatches] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    fetchMatches().then(setMatches);
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchPredictions(currentUser.id).then((preds) => {
        const map = {};
        preds.forEach((p) => {
          map[p.match_id] = p.predicted_outcome;
        });
        setPredictions(map);
      });
    }
  }, [currentUser]);

  if (!currentUser) {
    return (
      <div className="page">
        <h2>My Predictions</h2>
        <p className="notice">Join the pool first to make predictions.</p>
      </div>
    );
  }

  const handlePredict = async (matchId, outcome) => {
    setSaving(matchId);
    await submitPrediction(currentUser.id, matchId, outcome);
    setPredictions((prev) => ({ ...prev, [matchId]: outcome }));
    setSaving(null);
  };

  const upcomingMatches = matches.filter((m) => m.status === "upcoming");
  const finishedMatches = matches.filter((m) => m.status === "finished");

  const getActualOutcome = (m) => {
    if (m.home_score > m.away_score) return "home";
    if (m.away_score > m.home_score) return "away";
    return "draw";
  };

  return (
    <div className="page">
      <h2>My Predictions</h2>

      {upcomingMatches.length > 0 && (
        <>
          <h3>Upcoming Matches</h3>
          <div className="prediction-list">
            {upcomingMatches.map((m) => (
              <div key={m.id} className="prediction-card">
                <div className="match-info">
                  <span className="group-badge">Group {m.group_name}</span>
                  <span className="match-date">{m.match_date}</span>
                </div>
                <div className="prediction-row">
                  <button
                    className={`pred-btn ${predictions[m.id] === "home" ? "selected" : ""}`}
                    onClick={() => handlePredict(m.id, "home")}
                    disabled={saving === m.id}
                  >
                    {m.home_team} wins
                  </button>
                  <button
                    className={`pred-btn draw ${predictions[m.id] === "draw" ? "selected" : ""}`}
                    onClick={() => handlePredict(m.id, "draw")}
                    disabled={saving === m.id}
                  >
                    Draw
                  </button>
                  <button
                    className={`pred-btn ${predictions[m.id] === "away" ? "selected" : ""}`}
                    onClick={() => handlePredict(m.id, "away")}
                    disabled={saving === m.id}
                  >
                    {m.away_team} wins
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {finishedMatches.length > 0 && (
        <>
          <h3>Results</h3>
          <div className="prediction-list">
            {finishedMatches.map((m) => {
              const actual = getActualOutcome(m);
              const myPick = predictions[m.id];
              const correct = myPick === actual;
              return (
                <div
                  key={m.id}
                  className={`prediction-card ${correct ? "correct" : "wrong"}`}
                >
                  <div className="match-info">
                    <span className="group-badge">Group {m.group_name}</span>
                    <span>
                      {m.home_team} {m.home_score} - {m.away_score}{" "}
                      {m.away_team}
                    </span>
                    <span className={`result-badge ${correct ? "correct" : "wrong"}`}>
                      {correct ? "+3 pts" : "0 pts"}
                    </span>
                  </div>
                  <div className="my-pick">
                    You picked:{" "}
                    {myPick
                      ? myPick === "home"
                        ? m.home_team
                        : myPick === "away"
                          ? m.away_team
                          : "Draw"
                      : "No prediction"}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default Predictions;
