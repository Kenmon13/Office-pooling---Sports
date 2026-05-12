import { useState, useEffect } from "react";
import { fetchKnockoutMatches, fetchKnockoutPredictions, submitKnockoutPrediction } from "../api";
import Bracket from "../components/Bracket";

function Knockouts({ currentUser }) {
  const [koMatches, setKoMatches] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    fetchKnockoutMatches().then(setKoMatches);
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchKnockoutPredictions(currentUser.id).then((preds) => {
        const map = {};
        preds.forEach((p) => { map[p.match_id] = p.predicted_winner; });
        setPredictions(map);
      });
    }
  }, [currentUser]);

  const handlePick = async (matchId, pick) => {
    if (!currentUser) return;
    setSaving(matchId);
    setPredictions((prev) => ({ ...prev, [matchId]: pick }));
    await submitKnockoutPrediction(currentUser.id, matchId, pick);
    setSaving(null);
  };

  const pointsMap = { "Round of 32": 3, "Round of 16": 5, "Quarter-Finals": 7, "Semi-Finals": 10, "Final": 15 };

  return (
    <div className="page">
      <h2>Knockout Stage</h2>
      {currentUser ? (
        <p className="select-subtitle" style={{ marginBottom: 16 }}>
          Pick a winner for each match. Points per correct pick: R32 = 3 pts, R16 = 5 pts, QF = 7 pts, SF = 10 pts, Final = 15 pts.
        </p>
      ) : (
        <p className="notice">Join the pool to make knockout predictions.</p>
      )}
      <Bracket
        predictions={predictions}
        onPick={currentUser ? handlePick : null}
        saving={saving}
        koMatches={koMatches}
        pointsMap={pointsMap}
      />
    </div>
  );
}

export default Knockouts;
