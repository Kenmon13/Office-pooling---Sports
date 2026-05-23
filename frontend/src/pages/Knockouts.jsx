import { useState, useEffect } from "react";
import {
  fetchKnockoutMatches, fetchKnockoutPredictions, submitKnockoutPrediction, fetchKnockoutDeadline,
  fetchWC2022KnockoutMatches, fetchWC2022KnockoutPredictions, submitWC2022KnockoutPrediction, fetchWC2022KnockoutDeadline,
} from "../api";
import Bracket from "../components/Bracket";
import Bracket2022 from "../components/Bracket2022";

function Knockouts({ currentUser, tournament = "wc2026", poolId, mockDate }) {
  const isWC2022 = tournament === "wc2022";
  const [koMatches, setKoMatches] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [scores, setScores] = useState({});
  const [saving, setSaving] = useState(null);
  const [openMatchIds, setOpenMatchIds] = useState(new Set());
  const [groupStageComplete, setGroupStageComplete] = useState(false);
  const [koStageComplete, setKoStageComplete] = useState(false);
  const [matchMeta, setMatchMeta] = useState({});

  useEffect(() => {
    if (isWC2022) {
      fetchWC2022KnockoutMatches(poolId).then(setKoMatches);
      fetchWC2022KnockoutDeadline(poolId).then((data) => {
        setOpenMatchIds(new Set(data.openMatchIds));
        setGroupStageComplete(data.groupStageComplete);
        setKoStageComplete(data.koStageComplete || false);
        setMatchMeta(data.matchMeta || {});
      });
    } else {
      fetchKnockoutMatches().then(setKoMatches);
      fetchKnockoutDeadline().then((data) => {
        setOpenMatchIds(new Set(data.openMatchIds));
        setGroupStageComplete(data.groupStageComplete);
        setKoStageComplete(data.koStageComplete || false);
        setMatchMeta(data.matchMeta || {});
      });
    }
  }, [isWC2022, poolId, mockDate]);

  useEffect(() => {
    if (currentUser) {
      const fetchFn = isWC2022 ? fetchWC2022KnockoutPredictions : fetchKnockoutPredictions;
      fetchFn(currentUser.id).then((preds) => {
        const map = {};
        const scoreMap = {};
        preds.forEach((p) => {
          map[p.match_id] = p.predicted_winner;
          if (p.predicted_home_score !== null || p.predicted_away_score !== null) {
            scoreMap[p.match_id] = { home: p.predicted_home_score, away: p.predicted_away_score };
          }
        });
        setPredictions(map);
        setScores(scoreMap);
      });
    }
  }, [currentUser, isWC2022]);

  const handlePick = async (matchId, teamId) => {
    if (!currentUser) return;
    setSaving(matchId);
    setPredictions((prev) => ({ ...prev, [matchId]: teamId }));
    const submitFn = isWC2022 ? submitWC2022KnockoutPrediction : submitKnockoutPrediction;
    const existing = scores[matchId];
    await submitFn(currentUser.id, matchId, teamId, existing?.home ?? null, existing?.away ?? null);
    setSaving(null);
  };

  const handleScore = async (matchId, home, away) => {
    if (!currentUser) return;
    const winner = predictions[matchId];
    if (winner === undefined || winner === null) return;
    setSaving(matchId);
    const submitFn = isWC2022 ? submitWC2022KnockoutPrediction : submitKnockoutPrediction;
    await submitFn(currentUser.id, matchId, winner, home, away);
    setScores((prev) => ({ ...prev, [matchId]: { home, away } }));
    setSaving(null);
  };

  const pointsMap2026 = { "Round of 32": 3, "Round of 16": 5, "Quarter-Finals": 7, "Semi-Finals": 10, "Final": 15 };
  const pointsMap2022 = { "Round of 16": 5, "Quarter-Finals": 7, "Semi-Finals": 10, "Final": 15 };

  if (isWC2022) {
    return (
      <div className="page">
        <h2>Knockout Stage</h2>

        <div className="ko-rules">
          <p className="ko-rules-title">How predictions work</p>
          <ul>
            <li>Round of 16 opens once all group stage matches are complete.</li>
            <li>Each later match opens individually as soon as both of its feeder matches have confirmed winners — you don&apos;t have to wait for a full round to finish.</li>
            <li>Predictions lock automatically when each match kicks off — check the closing time shown on each match.</li>
            <li><strong>Score prediction bonus:</strong> also predict the final score (including extra time). If you get both the winner <em>and</em> the exact score correct, you earn <strong>double points</strong>.</li>
            <li>Points for each correct winner prediction:
              <div className="ko-points-grid">
                <span>Round of 16</span><span>5 pts (10 if correct score)</span>
                <span>Quarter-Finals</span><span>7 pts (14 if correct score)</span>
                <span>Semi-Finals</span><span>10 pts (20 if correct score)</span>
                <span>Final</span><span>15 pts (30 if correct score)</span>
              </div>
            </li>
          </ul>
        </div>

        {koStageComplete && (
          <div className="deadline-banner" style={{ marginBottom: 16 }}>
            <span className="deadline-locked-text">Knockout stage complete — Argentina are the 2022 World Cup champions!</span>
          </div>
        )}
        {!groupStageComplete && !koStageComplete && (
          <div className="deadline-banner locked" style={{ marginBottom: 16 }}>
            <span className="deadline-locked-text">Knockout predictions open once the group stage is complete</span>
          </div>
        )}
        {!currentUser && <p className="notice">Join the pool to make knockout predictions.</p>}

        <Bracket2022
          predictions={predictions}
          scores={scores}
          onPick={currentUser ? handlePick : null}
          onScore={currentUser ? handleScore : null}
          saving={saving}
          koMatches={koMatches}
          pointsMap={pointsMap2022}
          openMatchIds={openMatchIds}
          matchMeta={matchMeta}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Knockout Stage</h2>

      <div className="ko-rules">
        <p className="ko-rules-title">How predictions work</p>
        <ul>
          <li>Round of 32 opens once all group stage matches are complete.</li>
          <li>Each later match opens individually as soon as both of its feeder matches have confirmed winners — you don't have to wait for a full round to finish.</li>
          <li>Predictions lock automatically when each match kicks off — check the closing time shown on each match.</li>
          <li><strong>Score prediction bonus:</strong> also predict the final score (including extra time). If you get both the winner <em>and</em> the exact score correct, you earn <strong>double points</strong>.</li>
          <li>Points for each correct winner prediction:
            <div className="ko-points-grid">
              <span>Round of 32</span><span>3 pts (6 if correct score)</span>
              <span>Round of 16</span><span>5 pts (10 if correct score)</span>
              <span>Quarter-Finals</span><span>7 pts (14 if correct score)</span>
              <span>Semi-Finals</span><span>10 pts (20 if correct score)</span>
              <span>Final</span><span>15 pts (30 if correct score)</span>
            </div>
          </li>
        </ul>
      </div>

      {koStageComplete && (
        <div className="deadline-banner" style={{ marginBottom: 16 }}>
          <span className="deadline-locked-text">Knockout stage complete</span>
        </div>
      )}
      {!groupStageComplete && !koStageComplete && (
        <div className="deadline-banner locked" style={{ marginBottom: 16 }}>
          <span className="deadline-locked-text">Knockout predictions open once the group stage is complete</span>
        </div>
      )}
      {!currentUser && (
        <p className="notice">Join the pool to make knockout predictions.</p>
      )}

      <Bracket
        predictions={predictions}
        scores={scores}
        onPick={currentUser ? handlePick : null}
        onScore={currentUser ? handleScore : null}
        saving={saving}
        koMatches={koMatches}
        pointsMap={pointsMap2026}
        openMatchIds={openMatchIds}
        matchMeta={matchMeta}
      />
    </div>
  );
}

export default Knockouts;
