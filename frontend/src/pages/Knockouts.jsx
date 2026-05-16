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
          <li>Predictions lock automatically when each match kicks off — check the closing time shown on each match.</li>
          <li>Points for each correct winner prediction:
            <div className="ko-points-grid">
              <span>Round of 32</span><span>3 pts</span>
              <span>Round of 16</span><span>5 pts</span>
              <span>Quarter-Finals</span><span>7 pts</span>
              <span>Semi-Finals</span><span>10 pts</span>
              <span>Final</span><span>15 pts</span>
            </div>
          </li>
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
