import { useState, useEffect, useRef } from "react";
import {
  fetchMatches, fetchGroups, fetchGroupPredictions, submitGroupPredictions, fetchStandings, fetchPredictionDeadline,
  fetchWC2022Matches, fetchWC2022Groups, fetchWC2022GroupPredictions, submitWC2022GroupPrediction, fetchWC2022Standings, fetchWC2022PredictionDeadline,
} from "../api";
import { flag } from "../flags";

function applyTzOffset(dateStr, tzOffset) {
  const offset = tzOffset !== undefined ? tzOffset : (-new Date().getTimezoneOffset() / 60);
  const ms = new Date(dateStr.replace(" ", "T") + "Z").getTime() + offset * 3600000;
  return new Date(ms);
}

function formatMatchDate(dateStr, tzOffset) {
  if (!dateStr) return "";
  const d = applyTzOffset(dateStr, tzOffset);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${h % 12 || 12}:${m} ${ampm}`;
}

function formatDeadlineFull(dateStr, tzOffset) {
  if (!dateStr) return "";
  const d = applyTzOffset(dateStr, tzOffset);
  const weekdays = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${weekdays[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} at ${h % 12 || 12}:${m} ${ampm}`;
}

function useCountdown(deadline) {
  const [remaining, setRemaining] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!deadline) return;
    const target = new Date(deadline.replace(" ", "T") + (deadline.includes("Z") ? "" : "Z")).getTime();

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

const MAX_THIRD_PICKS = 8;

function Matches({ currentUser, tournament = "wc2026", poolId, mockDate, displayTzOffset }) {
  const isWC2022 = tournament === "wc2022";
  const [matches, setMatches] = useState([]);
  const [groups, setGroups] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [predictions, setPredictions] = useState({});
  const [selections, setSelections] = useState({});
  const [standings, setStandings] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deadline, setDeadline] = useState(null);
  const [locked, setLocked] = useState(false);

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
          const dl = new Date(data.deadline.replace(" ", "T") + "Z");
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
          const picks = [p.team1_id, p.team2_id];
          if (p.team3_id) picks.push(p.team3_id);
          sel[p.group_id] = picks;
        });
        setPredictions(map);
        setSelections(sel);
      });
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

  // Count how many groups currently have a 3rd pick selected
  const thirdPickCount = Object.values(selections).filter((picks) => picks.length >= 3).length;

  const toggleTeam = (groupId, teamId) => {
    setSelections((prev) => {
      const current = prev[groupId] || [];
      if (current.includes(teamId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== teamId) };
      }
      // For WC2022: max 2 picks per group
      if (isWC2022) {
        if (current.length >= 2) {
          return { ...prev, [groupId]: [current[1], teamId] };
        }
        return { ...prev, [groupId]: [...current, teamId] };
      }
      // For WC2026: allow up to 3 picks per group
      if (current.length < 2) {
        return { ...prev, [groupId]: [...current, teamId] };
      }
      if (current.length === 2) {
        // Adding a 3rd pick — check if we've reached the max of 8 groups with 3rd picks
        const otherThirdCount = Object.entries(prev).filter(([gId, picks]) => String(gId) !== String(groupId) && picks.length >= 3).length;
        if (otherThirdCount >= MAX_THIRD_PICKS) return prev;
        return { ...prev, [groupId]: [...current, teamId] };
      }
      // Already have 3, replace the 3rd pick
      return { ...prev, [groupId]: [current[0], current[1], teamId] };
    });
  };

  // Check if any group selections have changed from saved predictions
  const hasAnyChanges = (() => {
    for (const g of groups) {
      const picked = selections[g.id] || [];
      const saved = predictions[g.id];
      if (!saved && picked.length >= 2) return true;
      if (saved) {
        const savedPicks = [saved.team1_id, saved.team2_id];
        if (saved.team3_id) savedPicks.push(saved.team3_id);
        if (picked.length !== savedPicks.length) return true;
        if ([...picked].sort().join() !== [...savedPicks].sort().join()) return true;
      }
    }
    return false;
  })();

  // Check if any group has at least 2 picks (ready to save)
  const anyGroupReady = groups.some((g) => (selections[g.id] || []).length >= 2);

  const handleSaveAll = async () => {
    if (!anyGroupReady) return;
    setSaving(true);
    setSaveError("");

    if (isWC2022) {
      // WC2022 still uses individual saves
      for (const g of groups) {
        const picked = selections[g.id] || [];
        if (picked.length >= 2) {
          await submitWC2022GroupPrediction(currentUser.id, g.id, picked[0], picked[1]);
        }
      }
    } else {
      const preds = groups
        .filter((g) => (selections[g.id] || []).length >= 2)
        .map((g) => {
          const picked = selections[g.id];
          return {
            group_id: g.id,
            team1_id: picked[0],
            team2_id: picked[1],
            team3_id: picked[2] || null,
          };
        });
      const res = await submitGroupPredictions(currentUser.id, preds);
      if (res.error) {
        setSaveError(res.error);
        setSaving(false);
        return;
      }
    }

    // Refresh predictions from server
    const fetchFn = isWC2022 ? fetchWC2022GroupPredictions : fetchGroupPredictions;
    const preds = await fetchFn(currentUser.id);
    const map = {};
    const sel = {};
    preds.forEach((p) => {
      map[p.group_id] = p;
      const picks = [p.team1_id, p.team2_id];
      if (p.team3_id) picks.push(p.team3_id);
      sel[p.group_id] = picks;
    });
    setPredictions(map);
    setSelections((prev) => ({ ...prev, ...sel }));
    setSaving(false);
    window.dispatchEvent(new CustomEvent("picks-saved"));
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

  const groupMissing = groups.filter((g) => !predictions[g.id]);
  const groupAlertDone = groupMissing.length === 0;
  const groupAlertRed = !groupAlertDone && !locked;
  const groupAlertMsg = !groupAlertDone
    ? (groupMissing.length === groups.length ? "No picks made" : `Missing: ${groupMissing.map((g) => `Group ${g.name}`).join(", ")}`)
    : null;

  // Third-place alert: count saved 3rd picks
  const savedThirdCount = Object.values(predictions).filter((p) => p.team3_id).length;
  const thirdAlertDone = isWC2022 || savedThirdCount >= MAX_THIRD_PICKS;
  const thirdAlertRed = !isWC2022 && !thirdAlertDone && !locked;
  const thirdAlertMsg = !thirdAlertDone
    ? (savedThirdCount === 0 ? "No 3rd-place picks made" : `${savedThirdCount}/${MAX_THIRD_PICKS} saved`)
    : null;

  return (
    <div className="page">
      <h2>Group Stages</h2>

      <div className="ko-rules">
        <p className="ko-rules-title">How predictions work</p>
        <ul>
          <li>Pick the 2 teams you think will qualify from each group. Both correct = 5 pts &middot; One correct = 2 pts.</li>
          {!isWC2022 && <li>Optionally pick a 3rd-place team in up to {MAX_THIRD_PICKS} groups that you think will still qualify for the knockouts. Each correct pick = 1 pt.</li>}
          <li>Predictions lock once the first match of the group stage kicks off — you can update your picks until that time.</li>
        </ul>
      </div>

      {currentUser && (groupAlertRed || thirdAlertRed) && (
        <div className="page-alerts">
          {groupAlertRed && (
            <div className="notif-window-card win-urgent">
              <div className="win-card-top">
                <span className="win-icon">&#9917;</span>
                <span className="win-title">Group Stage Predictions</span>
                <span className="win-badge win-badge-open">Open</span>
              </div>
              {deadline && (
                <div className="win-card-body">Closes {formatMatchDate(deadline, displayTzOffset)}</div>
              )}
              {groupAlertMsg && <div className="win-missed">{groupAlertMsg}</div>}
            </div>
          )}
          {thirdAlertRed && (
            <div className="notif-window-card win-urgent">
              <div className="win-card-top">
                <span className="win-icon">&#9917;</span>
                <span className="win-title">Third-Place Qualifiers</span>
                <span className="win-badge win-badge-open">Open</span>
              </div>
              {deadline && (
                <div className="win-card-body">Closes {formatMatchDate(deadline, displayTzOffset)}</div>
              )}
              {thirdAlertMsg && <div className="win-missed">{thirdAlertMsg}</div>}
            </div>
          )}
        </div>
      )}

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
            <span className="deadline-date">{formatDeadlineFull(deadline, displayTzOffset)}</span>
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

      {currentUser && !locked && (
        <div className="save-all-footer">
          {saveError && <p className="error">{saveError}</p>}
          {hasAnyChanges && anyGroupReady && (
            <button
              className="btn-submit btn-save-all"
              onClick={handleSaveAll}
              disabled={saving}
            >
              {saving ? "Saving..." : Object.keys(predictions).length > 0 ? "Update Picks" : "Save Picks"}
            </button>
          )}
          {!hasAnyChanges && Object.keys(predictions).length > 0 && (
            <span className="saved-label">All picks saved</span>
          )}
        </div>
      )}

      {!isWC2022 && currentUser && !locked && (
        <div className="third-place-counter">
          3rd-place picks: {thirdPickCount}/{MAX_THIRD_PICKS} groups
        </div>
      )}

      <div className="group-grid">
        {groups.map((g) => {
          const isExpanded = expandedGroups.has(g.name);
          const picked = selections[g.id] || [];
          const saved = predictions[g.id];
          const score = getScore(g.id);
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
                  const pickIndex = picked.indexOf(teamId);
                  const isTop2 = pickIndex === 0 || pickIndex === 1;
                  const isThird = pickIndex === 2;
                  return (
                    <div
                      key={teamId}
                      className={`group-card-team-row ${currentUser && !locked ? "clickable" : ""} ${isTop2 ? "selected" : ""} ${isThird ? "selected third-pick" : ""}`}
                      onClick={currentUser && !locked ? (e) => { e.stopPropagation(); toggleTeam(g.id, teamId); } : undefined}
                    >
                      <span className="standings-team-col">
                        {flag(code)} {t.name}
                        {isThird && <span className="third-pick-badge">3rd</span>}
                      </span>
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
                  {picked.length === 2 && !isWC2022 && thirdPickCount < MAX_THIRD_PICKS && (
                    <span className="pick-hint">Pick a 3rd-place team (optional)</span>
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
                      <div className="match-date">{formatMatchDate(m.match_date, displayTzOffset)}</div>
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
