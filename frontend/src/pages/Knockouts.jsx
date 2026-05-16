import { useState, useEffect } from "react";
import {
  fetchKnockoutMatches, fetchKnockoutPredictions, submitKnockoutPrediction, fetchKnockoutDeadline,
  fetchWC2022KnockoutMatches, fetchWC2022KnockoutPredictions, submitWC2022KnockoutPrediction, fetchWC2022KnockoutDeadline,
} from "../api";
import Bracket from "../components/Bracket";
import { flag } from "../flags";

function formatKoTime(utcStr) {
  if (!utcStr) return null;
  const d = new Date(utcStr.replace(" ", "T") + "Z");
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Knockouts({ currentUser, tournament = "wc2026", poolId }) {
  const isWC2022 = tournament === "wc2022";
  const [koMatches, setKoMatches] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [saving, setSaving] = useState(null);
  const [openMatchIds, setOpenMatchIds] = useState(new Set());
  const [groupStageComplete, setGroupStageComplete] = useState(false);
  const [matchMeta, setMatchMeta] = useState({});

  useEffect(() => {
    if (isWC2022) {
      fetchWC2022KnockoutMatches().then(setKoMatches);
      fetchWC2022KnockoutDeadline(poolId).then((data) => {
        setOpenMatchIds(new Set(data.openMatchIds));
        setGroupStageComplete(data.groupStageComplete);
        setMatchMeta(data.matchMeta || {});
      });
    } else {
      fetchKnockoutMatches().then(setKoMatches);
      fetchKnockoutDeadline().then((data) => {
        setOpenMatchIds(new Set(data.openMatchIds));
        setGroupStageComplete(data.groupStageComplete);
        setMatchMeta(data.matchMeta || {});
      });
    }
  }, [isWC2022, poolId]);

  useEffect(() => {
    if (currentUser) {
      const fetchFn = isWC2022 ? fetchWC2022KnockoutPredictions : fetchKnockoutPredictions;
      fetchFn(currentUser.id).then((preds) => {
        const map = {};
        preds.forEach((p) => { map[p.match_id] = p.predicted_winner; });
        setPredictions(map);
      });
    }
  }, [currentUser, isWC2022]);

  const handlePick = async (matchId, teamId) => {
    if (!currentUser) return;
    setSaving(matchId);
    setPredictions((prev) => ({ ...prev, [matchId]: teamId }));
    const submitFn = isWC2022 ? submitWC2022KnockoutPrediction : submitKnockoutPrediction;
    await submitFn(currentUser.id, matchId, teamId);
    setSaving(null);
  };

  const pointsMap2026 = { "Round of 32": 3, "Round of 16": 5, "Quarter-Finals": 7, "Semi-Finals": 10, "Final": 15 };

  if (isWC2022) {
    const byRound = { R16: [], QF: [], SF: [], F: [] };
    for (const m of koMatches) if (byRound[m.round]) byRound[m.round].push(m);
    const rounds2022 = [
      { key: "R16", label: "Round of 16",    pts: 5 },
      { key: "QF",  label: "Quarter-Finals", pts: 7 },
      { key: "SF",  label: "Semi-Finals",    pts: 10 },
      { key: "F",   label: "Final",          pts: 15 },
    ];

    return (
      <div className="page">
        <h2>Knockout Stage <span className="test-badge" style={{ fontSize: 12, verticalAlign: "middle" }}>WC2022</span></h2>

        <div className="ko-rules">
          <p className="ko-rules-title">How predictions work</p>
          <ul>
            <li>Each match opens individually based on simulated date.</li>
            <li>Predictions lock at each match kickoff.</li>
            <li>Points for each correct winner prediction:
              <div className="ko-points-grid">
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
        {!currentUser && <p className="notice">Join the pool to make knockout predictions.</p>}

        {rounds2022.map(({ key, label, pts }) => (
          <div key={key} className="ko22-round">
            <div className="ko22-round-title">{label} <span className="bracket-pts-label">({pts} pts)</span></div>
            <div className="ko22-cards">
              {(byRound[key] || []).map((m) => {
                const matchOpen = openMatchIds.has(m.id);
                const pred = predictions[m.id];
                const isSaving = saving === m.id;
                const canPick = !!currentUser && matchOpen;
                const meta = matchMeta[m.id] || {};

                const isCorrect = (teamId) => m.winner_team_id && String(teamId) === String(m.winner_team_id);
                const predCorrect = pred && isCorrect(pred);
                const predWrong = pred && m.winner_team_id && !predCorrect;

                return (
                  <div key={m.id} className={`ko22-card ${isSaving ? "saving" : ""} ${!matchOpen ? "not-open" : ""} ${predCorrect ? "correct" : predWrong ? "wrong" : ""}`}>
                    <div className="ko22-teams">
                      <button
                        className={`ko22-team ${canPick ? "clickable" : ""} ${pred && String(pred) === String(m.home_team_id) ? "picked" : ""} ${m.winner_team_id && String(m.winner_team_id) === String(m.home_team_id) ? "winner" : ""}`}
                        onClick={canPick ? () => handlePick(m.id, m.home_team_id) : undefined}
                        disabled={!canPick}
                      >
                        {m.home_team_name ? <>{flag(m.home_team_code)} {m.home_team_name}</> : "TBC"}
                      </button>
                      <span className="ko22-vs">vs</span>
                      <button
                        className={`ko22-team ${canPick ? "clickable" : ""} ${pred && String(pred) === String(m.away_team_id) ? "picked" : ""} ${m.winner_team_id && String(m.winner_team_id) === String(m.away_team_id) ? "winner" : ""}`}
                        onClick={canPick ? () => handlePick(m.id, m.away_team_id) : undefined}
                        disabled={!canPick}
                      >
                        {m.away_team_name ? <>{flag(m.away_team_code)} {m.away_team_name}</> : "TBC"}
                      </button>
                    </div>
                    <div className="ko22-meta">
                      {matchOpen
                        ? <span style={{ color: "#ff6b6b" }}>Closes: {formatKoTime(meta.closesAt)}</span>
                        : meta.closesAt && <span>Opens after: {formatKoTime(meta.opensAfter)}</span>
                      }
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
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
        pointsMap={pointsMap2026}
        openMatchIds={openMatchIds}
        matchMeta={matchMeta}
      />
    </div>
  );
}

export default Knockouts;
