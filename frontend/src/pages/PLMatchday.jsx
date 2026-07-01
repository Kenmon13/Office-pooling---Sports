import { useState, useEffect } from "react";
import {
  fetchEPL2627Matches,
  fetchEPL2627MatchPredictions,
  submitEPL2627MatchPredictions,
} from "../api";
import { plCrest } from "../flags";

// A predicted score must agree with the predicted outcome. Returns a message when both score
// fields are filled and contradict the outcome, otherwise "". Unlike the WC knockout rule
// (ties allowed, decided by penalties), league matches have an explicit draw outcome, so the
// mapping is exact: home => home>away, away => away>home, draw => equal.
function evalPLConflict(outcome, h, a) {
  if (h == null || a == null) return "";
  if (outcome === "home" && !(h > a)) return "Home win — home score must be higher";
  if (outcome === "away" && !(a > h)) return "Away win — away score must be higher";
  if (outcome === "draw" && h !== a) return "Draw — scores must be equal";
  return "";
}

// Split a positive millisecond gap into d/h/m/s for the countdown display; null once elapsed.
function breakdown(diffMs) {
  if (diffMs <= 0) return null;
  return {
    days: Math.floor(diffMs / 86400000),
    hours: Math.floor((diffMs % 86400000) / 3600000),
    minutes: Math.floor((diffMs % 3600000) / 60000),
    seconds: Math.floor((diffMs % 60000) / 1000),
  };
}

function formatMatchDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr.replace(" ", "T") + "Z");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${h % 12 || 12}:${m} ${ampm}`;
}

function formatDeadlineFull(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr.replace(" ", "T") + "Z");
  const weekdays = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${weekdays[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} at ${h % 12 || 12}:${m} ${ampm}`;
}

function PLMatchday({ currentUser }) {
  const [matchday, setMatchday] = useState(1);
  const [matches, setMatches] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [saved, setSaved] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // Tick every second so each match locks the instant its own kickoff passes.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const kickoffMs = (m) => (m.match_date ? new Date(m.match_date.replace(" ", "T") + "Z").getTime() : null);
  // A match is locked once it kicks off (or is already live / finished).
  const isMatchLocked = (m) => {
    if (m.status === "finished" || m.status === "live") return true;
    const k = kickoffMs(m);
    return k != null && now >= k;
  };
  const lockedIds = new Set(matches.filter(isMatchLocked).map((m) => m.id));
  const allLocked = matches.length > 0 && matches.every(isMatchLocked);

  // Earliest still-open kickoff drives the "next match locks" countdown banner.
  const nextLock = matches
    .filter((m) => !isMatchLocked(m) && kickoffMs(m) != null)
    .reduce((min, m) => (min == null || kickoffMs(m) < kickoffMs(min) ? m : min), null);
  const countdown = nextLock ? breakdown(kickoffMs(nextLock) - now) : null;

  useEffect(() => {
    let cancelled = false;
    fetchEPL2627Matches(matchday).then((matchData) => {
      if (!cancelled) setMatches(matchData);
    });
    return () => { cancelled = true; };
  }, [matchday]);

  useEffect(() => {
    if (currentUser) {
      fetchEPL2627MatchPredictions(currentUser.id, matchday).then((preds) => {
        const map = {};
        preds.forEach((p) => {
          map[p.match_id] = {
            outcome: p.predicted_outcome,
            home_score: p.predicted_home_score,
            away_score: p.predicted_away_score,
          };
        });
        setPredictions(map);
        setSaved(map);
      });
    }
  }, [currentUser, matchday]);

  const setOutcome = (matchId, outcome) => {
    if (lockedIds.has(matchId)) return;
    setPredictions((prev) => ({
      ...prev,
      [matchId]: { ...prev[matchId], outcome },
    }));
  };

  const setScore = (matchId, field, value) => {
    if (lockedIds.has(matchId)) return;
    const num = value === "" ? null : parseInt(value, 10);
    if (value !== "" && isNaN(num)) return;
    setPredictions((prev) => ({
      ...prev,
      [matchId]: { ...prev[matchId], [field]: num },
    }));
  };

  // Only still-open matches can be saved, so changes/validation ignore locked ones.
  const hasChanges = (() => {
    for (const m of matches) {
      if (isMatchLocked(m)) continue;
      const pred = predictions[m.id];
      const sv = saved[m.id];
      if (!pred && !sv) continue;
      if (!pred || !sv) return true;
      if (pred.outcome !== sv.outcome || pred.home_score !== sv.home_score || pred.away_score !== sv.away_score) return true;
    }
    return false;
  })();

  const anyPredictions = matches.some((m) => !isMatchLocked(m) && predictions[m.id]?.outcome);

  // Matches whose entered score contradicts the chosen outcome — these block the save.
  const conflicts = matches
    .filter((m) => !isMatchLocked(m) && predictions[m.id]?.outcome)
    .map((m) => ({ id: m.id, msg: evalPLConflict(predictions[m.id].outcome, predictions[m.id].home_score, predictions[m.id].away_score) }))
    .filter((c) => c.msg);
  const hasConflict = conflicts.length > 0;

  const handleSave = async () => {
    if (!currentUser || !anyPredictions) return;
    if (hasConflict) {
      setSaveError("Each predicted score must match its Home / Draw / Away pick. Fix the highlighted matches to save.");
      return;
    }
    setSaving(true);
    setSaveError("");

    const preds = matches
      .filter((m) => !isMatchLocked(m) && predictions[m.id]?.outcome)
      .map((m) => ({
        match_id: m.id,
        predicted_outcome: predictions[m.id].outcome,
        predicted_home_score: predictions[m.id].home_score ?? null,
        predicted_away_score: predictions[m.id].away_score ?? null,
      }));

    const res = await submitEPL2627MatchPredictions(currentUser.id, preds);
    if (res.error) {
      setSaveError(res.error);
    } else {
      const refreshed = await fetchEPL2627MatchPredictions(currentUser.id, matchday);
      const map = {};
      refreshed.forEach((p) => {
        map[p.match_id] = {
          outcome: p.predicted_outcome,
          home_score: p.predicted_home_score,
          away_score: p.predicted_away_score,
        };
      });
      setPredictions(map);
      setSaved(map);
      if (res.errors && res.errors.length > 0) {
        setSaveError(res.errors.join("; "));
      }
    }
    setSaving(false);
    window.dispatchEvent(new CustomEvent("picks-saved"));
  };

  const getMatchResult = (m, pred) => {
    if (m.status !== "finished" || !pred?.outcome) return null;
    const actualOutcome = m.home_score > m.away_score ? "home" : m.home_score < m.away_score ? "away" : "draw";
    const outcomeCorrect = pred.outcome === actualOutcome;
    const exactCorrect = outcomeCorrect && pred.home_score === m.home_score && pred.away_score === m.away_score;
    if (exactCorrect) return { points: 4, label: "Exact score!", cls: "correct" };
    if (outcomeCorrect) return { points: 2, label: "Correct outcome", cls: "half" };
    return { points: 0, label: "Wrong", cls: "wrong" };
  };

  return (
    <div className="page">
      <h2>Matchday Predictions</h2>

      <div className="ko-rules">
        <p className="ko-rules-title">How predictions work</p>
        <ul>
          <li>Predict the outcome (Home / Draw / Away) for each match: <strong>2 pts</strong> for correct outcome.</li>
          <li>Optionally predict the exact score: <strong>4 pts</strong> if correct score (replaces 2 pts).</li>
          <li>Each match locks when it kicks off — you can keep editing later games in the same matchday.</li>
        </ul>
      </div>

      <div className="matchday-nav">
        <button
          className="matchday-arrow"
          onClick={() => setMatchday((d) => Math.max(1, d - 1))}
          disabled={matchday <= 1}
        >
          &larr;
        </button>
        <span className="matchday-label">Matchday {matchday}</span>
        <button
          className="matchday-arrow"
          onClick={() => setMatchday((d) => Math.min(38, d + 1))}
          disabled={matchday >= 38}
        >
          &rarr;
        </button>
      </div>

      {nextLock && countdown && (
        <div className="deadline-banner">
          <div className="deadline-timer">
            <div className="timer-unit">
              <span className="timer-value">{countdown.days}</span>
              <span className="timer-label">days</span>
            </div>
            <span className="timer-sep">:</span>
            <div className="timer-unit">
              <span className="timer-value">{String(countdown.hours).padStart(2, "0")}</span>
              <span className="timer-label">hrs</span>
            </div>
            <span className="timer-sep">:</span>
            <div className="timer-unit">
              <span className="timer-value">{String(countdown.minutes).padStart(2, "0")}</span>
              <span className="timer-label">min</span>
            </div>
            <span className="timer-sep">:</span>
            <div className="timer-unit">
              <span className="timer-value">{String(countdown.seconds).padStart(2, "0")}</span>
              <span className="timer-label">sec</span>
            </div>
          </div>
          <div className="deadline-info">
            <span className="deadline-label">Next match locks on</span>
            <span className="deadline-date">{formatDeadlineFull(nextLock.match_date)}</span>
          </div>
        </div>
      )}

      {allLocked && (
        <div className="deadline-banner locked">
          <span className="deadline-locked-text">Matchday {matchday} is locked — all matches have started</span>
        </div>
      )}

      {matches.length === 0 ? (
        <p className="pick-hint">No matches scheduled for Matchday {matchday}.</p>
      ) : (
        <div className="pl-match-list">
          {matches.map((m) => {
            const pred = predictions[m.id] || {};
            const result = getMatchResult(m, pred);
            const isLive = m.status === "live";
            const isFinished = m.status === "finished";
            const locked = isMatchLocked(m);
            const conflictMsg = !locked && !isFinished ? evalPLConflict(pred.outcome, pred.home_score, pred.away_score) : "";

            return (
              <div key={m.id} className={`pl-match-card ${isLive ? "live" : ""} ${isFinished ? "finished" : ""}`}>
                {m.match_date && (
                  <div className="pl-match-date">{formatMatchDate(m.match_date)}</div>
                )}

                <div className="pl-match-teams">
                  <span className="pl-team home">{plCrest(m.home_code)} {m.home_short || m.home_team}</span>
                  <span className={`pl-score ${isLive ? "live" : ""}`}>
                    {isFinished || isLive
                      ? `${m.home_score ?? 0} - ${m.away_score ?? 0}`
                      : "vs"}
                  </span>
                  <span className="pl-team away">{m.away_short || m.away_team} {plCrest(m.away_code)}</span>
                </div>

                {isLive && <div className="match-status live">LIVE</div>}
                {isFinished && result && (
                  <div className={`pl-result-badge ${result.cls}`}>
                    {result.label} &middot; +{result.points} pts
                  </div>
                )}

                {currentUser && !locked && !isFinished && (
                  <div className="pl-outcome-btns">
                    <button
                      className={`outcome-btn ${pred.outcome === "home" ? "selected" : ""}`}
                      onClick={() => setOutcome(m.id, "home")}
                    >
                      H
                    </button>
                    <button
                      className={`outcome-btn ${pred.outcome === "draw" ? "selected" : ""}`}
                      onClick={() => setOutcome(m.id, "draw")}
                    >
                      D
                    </button>
                    <button
                      className={`outcome-btn ${pred.outcome === "away" ? "selected" : ""}`}
                      onClick={() => setOutcome(m.id, "away")}
                    >
                      A
                    </button>
                  </div>
                )}

                {locked && pred.outcome && !isFinished && (
                  <div className="pl-outcome-btns locked">
                    <span className={`outcome-btn ${pred.outcome === "home" ? "selected" : ""}`}>H</span>
                    <span className={`outcome-btn ${pred.outcome === "draw" ? "selected" : ""}`}>D</span>
                    <span className={`outcome-btn ${pred.outcome === "away" ? "selected" : ""}`}>A</span>
                  </div>
                )}

                {currentUser && !locked && !isFinished && pred.outcome && (
                  <div className="pl-score-inputs">
                    <input
                      type="number"
                      min="0"
                      max="20"
                      placeholder="H"
                      value={pred.home_score ?? ""}
                      onChange={(e) => setScore(m.id, "home_score", e.target.value)}
                    />
                    <span className="score-dash">-</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      placeholder="A"
                      value={pred.away_score ?? ""}
                      onChange={(e) => setScore(m.id, "away_score", e.target.value)}
                    />
                    <span className="score-label">Exact score (optional)</span>
                  </div>
                )}

                {conflictMsg && (
                  <div className="pl-score-conflict">⚠ {conflictMsg}</div>
                )}

                {locked && pred.home_score != null && pred.away_score != null && !isFinished && (
                  <div className="pl-score-inputs locked">
                    <span className="locked-score">{pred.home_score} - {pred.away_score}</span>
                    <span className="score-label">Your predicted score</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {currentUser && !allLocked && (
        <div className="save-all-footer">
          {saveError && <p className="error">{saveError}</p>}
          {hasChanges && anyPredictions && (
            <button
              className="btn-submit btn-save-all"
              onClick={handleSave}
              disabled={saving || hasConflict}
            >
              {saving ? "Saving..." : Object.keys(saved).length > 0 ? "Update Picks" : "Save Picks"}
            </button>
          )}
          {!hasChanges && Object.keys(saved).length > 0 && (
            <span className="saved-label">All picks saved</span>
          )}
        </div>
      )}
    </div>
  );
}

export default PLMatchday;
