import { useState, useEffect } from "react";
import { fetchKnockoutMatches, fetchKnockoutPredictions, submitKnockoutPrediction, fetchKnockoutDeadline } from "../api";
import Bracket from "../components/Bracket";

function Knockouts({ currentUser }) {
  const [koMatches, setKoMatches] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [saving, setSaving] = useState(null);
  const [openMatchIds, setOpenMatchIds] = useState(new Set());
  const [groupStageComplete, setGroupStageComplete] = useState(false);
  const [matchMeta, setMatchMeta] = useState({});

  useEffect(() => {
    fetchKnockoutMatches().then(setKoMatches);
    fetchKnockoutDeadline().then((data) => {
      setOpenMatchIds(new Set(data.openMatchIds));
      setGroupStageComplete(data.groupStageComplete);
      setMatchMeta(data.matchMeta || {});
    });
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

      <div className="ko-rules">
        <p className="ko-rules-title">How predictions work</p>
        <ul>
          <li>Round of 32 opens once all group stage matches are complete.</li>
          <li>Each later match opens individually as soon as both of its feeder matches have confirmed winners — you don't have to wait for a full round to finish.</li>
          <li>Predictions lock automatically 12 hours before each match kicks off, so submit your pick before then.</li>
          <li>The further you go in the tournament, the more points a correct winner prediction is worth: 3 points in the Round of 32, 5 in the Round of 16, 7 in the Quarter-Finals, 10 in the Semi-Finals, and 15 for the Final.</li>
        </ul>
      </div>

      {!groupStageComplete && (
        <div className="deadline-banner locked" style={{ marginBottom: 16 }}>
          <span className="deadline-locked-text">Knockout predictions open once the group stage is complete</span>
        </div>
      )}
      {!currentUser && (
        <p className="notice">Join the pool to make knockout predictions.</p>
      )}

      <Bracket
        predictions={predictions}
        onPick={currentUser ? handlePick : null}
        saving={saving}
        koMatches={koMatches}
        pointsMap={pointsMap}
        openMatchIds={openMatchIds}
        matchMeta={matchMeta}
      />
    </div>
  );
}

export default Knockouts;
