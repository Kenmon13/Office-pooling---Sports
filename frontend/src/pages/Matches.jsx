import { useState, useEffect, useRef } from "react";
import {
  fetchMatches, fetchGroups, fetchGroupPredictions, submitGroupPrediction, fetchStandings, fetchPredictionDeadline,
  fetchWC2022Matches, fetchWC2022Groups, fetchWC2022GroupPredictions, submitWC2022GroupPrediction, fetchWC2022Standings, fetchWC2022PredictionDeadline,
  fetchThirdPlacePredictions, submitThirdPlacePredictions,
} from "../api";
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

function Matches({ currentUser, tournament = "wc2026", poolId, mockDate }) {
  const isWC2022 = tournament === "wc2022";
  const [matches, setMatches] = useState([]);
  const [groups, setGroups] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [predictions, setPredictions] = useState({});
  const [selections, setSelections] = useState({});
  const [standings, setStandings] = useState({});
  const [saving, setSaving] = useState(null);
  const [deadline, setDeadline] = useState(null);
  const [locked, setLocked] = useState(false);
  const [thirdPicks, setThirdPicks] = useState([]);
  const [savedThirdPicks, setSavedThirdPicks] = useState([]);
  const [savingThird, setSavingThird] = useState(false);
  const [thirdError, setThirdError] = useState("");

  useEffect(() => {
    if (isWC2022) {
      fetchWC2022Matches(poolId).then(setMatches);
      fetchWC2022Groups().then(setGroups);
      fetchWC2022Standings(poolId).then((data) => {
        const map = {};
        data.forEach((g) => { map[g.id] = g; });
        setStandings(map);
      });
      fetchWC2022PredictionDeadline(poolId).then((data) => {
        if (data.deadline) {
          setDeadline(data.deadline);
          setLocked(data.locked);
        }
      });
    } else {
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
    }
  }, [isWC2022, poolId, mockDate]);

  useEffect(() => {
    if (currentUser) {
      const fetchFn = isWC2022 ? fetchWC2022GroupPredictions : fetchGroupPredictions;
      fetchFn(currentUser.id).then((preds) => {
        const map = {};
        const sel = {};
        preds.forEach((p) => {
          map[p.group_id] = p;
          sel[p.group_id] = [p.team1_id, p.team2_id];
        });
        setPredictions(map);
        setSelections(sel);
      });
      if (!isWC2022) {
        fetchThirdPlacePredictions(currentUser.id).then((preds) => {
          const ids = preds.map((p) => p.team_id);
          setThirdPicks(ids);
          setSavedThirdPicks(ids);
        });
      }
    }
  }, [currentUser, isWC2022]);

  const toggleGroup = (groupName) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  };

  const allExpanded = groups.length > 0 && groups.every((g) => expandedGroups.has(g.name));
  const toggleAll = () => {
    if (allExpanded) {
      setExpandedGroups(new Set());
    } else {
      setExpandedGroups(new Set(groups.map((g) => g.name)));
    }
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
    const submitFn = isWC2022 ? submitWC2022GroupPrediction : submitGroupPrediction;
    await submitFn(currentUser.id, groupId, picked[0], picked[1]);
    const preds = await (isWC2022 ? fetchWC2022GroupPredictions : fetchGroupPredictions)(currentUser.id);
    const map = {};
    const sel = {};
    preds.forEach((p) => {
      map[p.group_id] = p;
      sel[p.group_id] = [p.team1_id, p.team2_id];
    });
    setPredictions(map);
    setSelections((prev) => ({ ...prev, ...sel }));
    setSaving(null);
  };

  // Build set of teams the user picked as top-2 in group predictions
  const top2Set = new Set();
  for (const groupId in selections) {
    for (const tid of (selections[groupId] || [])) {
      // Only count if this group prediction was saved
      if (predictions[groupId]) top2Set.add(tid);
    }
  }

  const toggleThirdPick = (teamId) => {
    setThirdError("");
    setThirdPicks((prev) => {
      if (prev.includes(teamId)) return prev.filter((id) => id !== teamId);
      if (prev.length >= 8) return prev;
      return [...prev, teamId];
    });
  };

  const handleSaveThird = async () => {
    if (thirdPicks.length !== 8) return;
    setSavingThird(true);
    setThirdError("");
    const res = await submitThirdPlacePredictions(currentUser.id, thirdPicks);
    if (res.error) {
      setThirdError(res.error);
    } else {
      setSavedThirdPicks([...thirdPicks]);
    }
    setSavingThird(false);
  };

  const thirdHasChanged = (() => {
    if (thirdPicks.length !== savedThirdPicks.length) return true;
    const a = [...thirdPicks].sort();
    const b = [...savedThirdPicks].sort();
    return a.some((v, i) => v !== b[i]);
  })();

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

      <div className="ko-rules">
        <p className="ko-rules-title">How predictions work</p>
        <ul>
          <li>Pick the 2 teams you think will qualify from each group. Both correct = 5 pts &middot; One correct = 2 pts.</li>
          {!isWC2022 && <li>Pick 8 third-place teams you think will still qualify for the knockouts. Each correct pick = 1 pt. You cannot pick teams you already selected as top 2.</li>}
          <li>Predictions lock once the first match of the group stage kicks off — you can update your picks until that time.</li>
        </ul>
      </div>

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
      <button className="btn-toggle-all" onClick={toggleAll}>
        {allExpanded ? "Hide All Matches" : "Show All Matches"}
      </button>
      <div className="group-grid">
        {groups.map((g) => {
          const isExpanded = expandedGroups.has(g.name);
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
                  {picked.length < 2 && (
                    <span className="pick-hint">Pick {2 - picked.length} more</span>
                  )}
                  {picked.length === 2 && !hasChanged && (
                    <span className="saved-label">Saved ✓</span>
                  )}
                  {picked.length === 2 && hasChanged && (
                    <button
                      className="btn-submit"
                      onClick={() => handleSave(g.id)}
                      disabled={saving === g.id}
                    >
                      {saving === g.id ? "Saving..." : saved ? "Update" : "Save"}
                    </button>
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

      {/* Third-Place Qualifier Predictions — WC2026 only */}
      {!isWC2022 && currentUser && (
        <div className="third-place-section">
          <h3>Third-Place Qualifiers</h3>
          <p className="third-place-desc">
            Pick 8 teams you think will finish 3rd in their group but still qualify for the knockouts.
            Each correct pick = 1 pt. Teams you already picked as top 2 are excluded.
          </p>
          {thirdError && <p className="error">{thirdError}</p>}

          <div className="third-place-counter">
            {thirdPicks.length}/8 selected
          </div>

          <div className="third-place-grid">
            {groups.map((g) => {
              // Available teams = those NOT in this group's saved top-2 picks
              const availableTeams = (g.teams || []).filter((t) => {
                const tid = t.team_id || t.id;
                return !top2Set.has(tid);
              });
              if (availableTeams.length === 0) return null;
              return (
                <div key={g.id} className="third-place-group">
                  <div className="third-place-group-label">Group {g.name}</div>
                  <div className="third-place-group-teams">
                    {availableTeams.map((t) => {
                      const tid = t.team_id || t.id;
                      const code = t.code;
                      const isSelected = thirdPicks.includes(tid);
                      const isDisabled = locked || (!isSelected && thirdPicks.length >= 8);
                      return (
                        <button
                          key={tid}
                          className={`third-place-team-btn ${isSelected ? "selected" : ""}`}
                          onClick={() => !locked && toggleThirdPick(tid)}
                          disabled={isDisabled}
                        >
                          {flag(code)} {t.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {!locked && (
            <div className="third-place-footer">
              {thirdPicks.length === 8 && thirdHasChanged && (
                <button
                  className="btn-submit"
                  onClick={handleSaveThird}
                  disabled={savingThird}
                >
                  {savingThird ? "Saving..." : savedThirdPicks.length > 0 ? "Update" : "Save"}
                </button>
              )}
              {thirdPicks.length === 8 && !thirdHasChanged && savedThirdPicks.length > 0 && (
                <span className="saved-label">Saved</span>
              )}
              {thirdPicks.length < 8 && (
                <span className="pick-hint">Pick {8 - thirdPicks.length} more</span>
              )}
            </div>
          )}
          {locked && savedThirdPicks.length > 0 && (
            <div className="third-place-footer">
              <span className="saved-label">Locked</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Matches;
