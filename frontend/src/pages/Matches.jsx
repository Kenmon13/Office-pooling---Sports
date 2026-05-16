import { useState, useEffect, useRef } from "react";
import { fetchMatches, fetchGroups, fetchGroupPredictions, submitGroupPrediction, fetchStandings, fetchPredictionDeadline } from "../api";
import { flag } from "../flags";

function formatMatchDate(dateStr) {
  if (!dateStr) return "";
  const [date, time] = dateStr.split(" ");
  const d = new Date(date + "T00:00:00");
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return time ? `${formatted}, ${time}` : formatted;
}

function formatDeadlineFull(dateStr) {
  if (!dateStr) return "";
  const [date, time] = dateStr.split(" ");
  const d = new Date(date + "T00:00:00");
  const formatted = d.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
  return time ? `${formatted} at ${time}` : formatted;
}

function useCountdown(deadline) {
  const [remaining, setRemaining] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!deadline) return;
    const target = new Date(deadline.replace(" ", "T")).getTime();

    const update = () => {
      const diff = target - Date.now();
      if (diff <= 0) {
        setRemaining(null);
        clearInterval(intervalRef.current);
        return;
      }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setRemaining({ days, hours, minutes, seconds });
    };

    update();
    intervalRef.current = setInterval(update, 1000);
    return () => clearInterval(intervalRef.current);
  }, [deadline]);

  return remaining;
}

function Matches({ currentUser }) {
  const [matches, setMatches] = useState([]);
  const [groups, setGroups] = useState([]);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [predictions, setPredictions] = useState({});
  const [selections, setSelections] = useState({});
  const [standings, setStandings] = useState({});
  const [saving, setSaving] = useState(null);
  const [deadline, setDeadline] = useState(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    fetchMatches().then(setMatches);
    fetchGroups().then(setGroups);
    fetchStandings().then((data) => {
      const map = {};
      data.forEach((g) => { map[g.id] = g; });
      setStandings(map);
    });
    fetchPredictionDeadline().then((data) => {
      if (data.deadline) {
        setDeadline(data.deadline);
        const dl = new Date(data.deadline.replace(" ", "T"));
        setLocked(new Date() >= dl);
      }
    });
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchGroupPredictions(currentUser.id).then((preds) => {
        const map = {};
        const sel = {};
        preds.forEach((p) => {
          map[p.group_id] = p;
          sel[p.group_id] = [p.team1_id, p.team2_id];
        });
        setPredictions(map);
        setSelections(sel);
      });
    }
  }, [currentUser]);

  const toggleGroup = (groupName) => {
    setExpandedGroup((prev) => (prev === groupName ? null : groupName));
  };

  const toggleTeam = (groupId, teamId) => {
    setSelections((prev) => {
      const current = prev[groupId] || [];
      if (current.includes(teamId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== teamId) };
      }
      if (current.length >= 2) {
        return { ...prev, [groupId]: [current[1], teamId] };
      }
      return { ...prev, [groupId]: [...current, teamId] };
    });
  };

  const handleSave = async (groupId) => {
    const picked = selections[groupId] || [];
    if (picked.length !== 2) return;
    setSaving(groupId);
    await submitGroupPrediction(currentUser.id, groupId, picked[0], picked[1]);
    const preds = await fetchGroupPredictions(currentUser.id);
    const map = {};
    preds.forEach((p) => { map[p.group_id] = p; });
    setPredictions(map);
    setSaving(null);
  };

  const getScore = (groupId) => {
    const pred = predictions[groupId];
    const standing = standings[groupId];
    if (!pred || !standing || standing.qualified.length === 0) return null;
    const picked = [pred.team1_id, pred.team2_id];
    const correct = picked.filter((t) => standing.qualified.includes(t)).length;
    if (correct === 2) return { points: 5, label: "Both correct", cls: "correct" };
    if (correct === 1) return { points: 2, label: "1 correct", cls: "half" };
    return { points: 0, label: "0 correct", cls: "wrong" };
  };

  const groupMatches = matches.reduce((acc, m) => {
    if (!acc[m.group_name]) acc[m.group_name] = [];
    acc[m.group_name].push(m);
    return acc;
  }, {});

  const countdown = useCountdown(deadline);

  return (
    <div className="page">
      <h2>Group Stages</h2>

      {deadline && !locked && countdown && (
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
            <span className="deadline-label">Predictions lock on</span>
            <span className="deadline-date">{formatDeadlineFull(deadline)}</span>
          </div>
        </div>
      )}
      {locked && (
        <div className="deadline-banner locked">
          <span className="deadline-locked-text">Predictions are locked - the tournament has started</span>
        </div>
      )}
      {currentUser && !locked && (
        <p className="select-subtitle" style={{ marginBottom: 16 }}>
          Pick 2 teams to advance from each group. Both correct = 5 pts, one correct = 2 pts.
        </p>
      )}

      <div className="group-grid">
        {groups.map((g) => {
          const isExpanded = expandedGroup === g.name;
          const picked = selections[g.id] || [];
          const saved = predictions[g.id];
          const score = getScore(g.id);
          const hasChanged = saved
            ? !(picked.length === 2 && [saved.team1_id, saved.team2_id].sort().join() === [...picked].sort().join())
            : picked.length === 2;
          const gMatches = groupMatches[g.name] || [];

          return (
            <div key={g.id} className={`group-card ${score ? score.cls : !saved && !locked ? "unpicked" : ""} ${isExpanded ? "expanded" : ""}`}>
              <div className="group-card-header" onClick={() => toggleGroup(g.name)}>
                <span className="group-badge">Group {g.name}</span>
                {score && (
                  <span className={`result-badge ${score.cls}`}>
                    {score.label} &middot; +{score.points} pts
                  </span>
                )}
                {!score && saved && <span className="saved-label">Saved</span>}
                <span className="group-toggle">{isExpanded ? "\u25B2" : "\u25BC"}</span>
              </div>

              <div className="group-card-teams">
                <div className="group-standings-header">
                  <span className="standings-team-col">Team</span>
                  <span className="standings-stat">W</span>
                  <span className="standings-stat">D</span>
                  <span className="standings-stat">L</span>
                  <span className="standings-stat">GF</span>
                  <span className="standings-stat">GA</span>
                  <span className="standings-stat">GD</span>
                  <span className="standings-stat pts">Pts</span>
                </div>
                {(standings[g.id] ? standings[g.id].teams : g.teams).map((t) => {
                  const teamId = t.team_id || t.id;
                  const code = t.code;
                  return (
                    <div
                      key={teamId}
                      className={`group-card-team-row ${currentUser && !locked ? "clickable" : ""} ${picked.includes(teamId) ? "selected" : ""}`}
                      onClick={currentUser && !locked ? (e) => { e.stopPropagation(); toggleTeam(g.id, teamId); } : undefined}
                    >
                      <span className="standings-team-col">{flag(code)} {t.name}</span>
                      <span className="standings-stat">{t.won ?? 0}</span>
                      <span className="standings-stat">{t.drawn ?? 0}</span>
                      <span className="standings-stat">{t.lost ?? 0}</span>
                      <span className="standings-stat">{t.gf ?? 0}</span>
                      <span className="standings-stat">{t.ga ?? 0}</span>
                      <span className="standings-stat">{(t.gf ?? 0) - (t.ga ?? 0)}</span>
                      <span className="standings-stat pts">{t.points ?? 0}</span>
                    </div>
                  );
                })}
              </div>

              {currentUser && !locked && (
                <div className="group-card-footer">
                  {picked.length === 2 && hasChanged && (
                    <button
                      className="btn-submit"
                      onClick={() => handleSave(g.id)}
                      disabled={saving === g.id}
                    >
                      {saving === g.id ? "Saving..." : saved ? "Update" : "Save"}
                    </button>
                  )}
                  {picked.length < 2 && (
                    <span className="pick-hint">Pick {2 - picked.length} more</span>
                  )}
                </div>
              )}

              {isExpanded && (
                <div className="group-card-matches">
                  {gMatches.length === 0 && (
                    <p className="pick-hint">No matches scheduled yet.</p>
                  )}
                  {gMatches.map((m) => (
                    <div key={m.id} className={`match-card ${m.status}`}>
                      <div className="match-date">{formatMatchDate(m.match_date)}</div>
                      <div className="match-teams">
                        <span className="team home">{flag(m.home_code)} {m.home_team}</span>
                        <span className="vs">
                          {m.status === "finished"
                            ? `${m.home_score} - ${m.away_score}`
                            : "vs"}
                        </span>
                        <span className="team away">{m.away_team} {flag(m.away_code)}</span>
                      </div>
                      <div className={`match-status ${m.status}`}>{m.status}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Matches;
