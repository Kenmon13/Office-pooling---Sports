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

function Matches({ currentUser, tournament = "wc2026", poolId, mockDate, displayTzOffset, groupStageUnlocked = false }) {
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
  const [groupDeadlines, setGroupDeadlines] = useState({});

  // Per-group lock check
  const isGroupLocked = (groupId) => {
    // For WC2022, always use mock_date as effective time (real time is 2026 — everything would appear locked)
    const effectiveNow = isWC2022 && mockDate ? new Date(mockDate.replace(" ", "T") + "Z") : new Date();
    if (groupStageUnlocked) {
      const groupMatches = matches.filter((m) => m.group_id === groupId);
      if (isWC2022) {
        return groupMatches.length > 0 && groupMatches.every(
          (m) => effectiveNow >= new Date(m.match_date.replace(" ", "T") + "Z")
        );
      }
      return groupMatches.length > 0 && groupMatches.every((m) => m.status === "finished");
    }
    const dl = groupDeadlines[groupId];
    if (!dl) return false;
    return effectiveNow >= new Date(dl.replace(" ", "T") + "Z");
  };

  // All groups locked = fully locked
  const allLocked = groups.length > 0 && groups.every((g) => isGroupLocked(g.id));
  const anyLocked = groups.some((g) => isGroupLocked(g.id));
  const lockedGroupNames = groups.filter((g) => isGroupLocked(g.id)).map((g) => g.name);

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
        }
        if (data.groupDeadlines) {
          setGroupDeadlines(data.groupDeadlines);
        }
      });
    } else {
      fetchMatches().then(setMatches);
      fetchGroups().then(setGroups);
      fetchStandings().then((data) => {
        const map = {};
        (data.groups || data).forEach((g) => { map[g.id] = g; });
        setStandings(map);
      });
      fetchPredictionDeadline().then((data) => {
        if (data.deadline) {
          setDeadline(data.deadline);
        }
        if (data.groupDeadlines) {
          setGroupDeadlines(data.groupDeadlines);
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
    if (isGroupLocked(groupId)) return;
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

  // Check if any unlocked group selections have changed from saved predictions
  const hasAnyChanges = (() => {
    for (const g of groups) {
      if (isGroupLocked(g.id)) continue;
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

  // Check if any unlocked group has at least 2 picks (ready to save)
  const anyGroupReady = groups.some((g) => !isGroupLocked(g.id) && (selections[g.id] || []).length >= 2);

  const handleSaveAll = async () => {
    if (!anyGroupReady) return;
    setSaving(true);
    setSaveError("");

    if (isWC2022) {
      const errors = [];
      for (const g of groups) {
        if (isGroupLocked(g.id)) continue;
        const picked = selections[g.id] || [];
        if (picked.length >= 2) {
          const res = await submitWC2022GroupPrediction(currentUser.id, g.id, picked[0], picked[1]);
          if (res.error) errors.push(`Group ${g.name}: ${res.error}`);
        }
      }
      if (errors.length > 0) {
        setSaveError(errors.join(" · "));
        setSaving(false);
        return;
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
      if (res.warning) {
        setSaveError(res.warning);
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

  // Find the next upcoming group deadline (earliest unlocked group's first match)
  const nextGroupInfo = (() => {
    if (isWC2022 || Object.keys(groupDeadlines).length === 0) return { deadline, groupName: null };
    const now = new Date();
    const upcoming = Object.entries(groupDeadlines)
      .filter(([, dl]) => new Date(dl.replace(" ", "T") + "Z") > now)
      .sort(([, a], [, b]) => a.localeCompare(b));
    if (upcoming.length === 0) return { deadline: null, groupName: null };
    const [groupId, dl] = upcoming[0];
    const group = groups.find((g) => String(g.id) === String(groupId));
    return { deadline: dl, groupName: group ? group.name : null };
  })();
  const nextGroupDeadline = nextGroupInfo.deadline;

  const countdown = useCountdown(nextGroupDeadline || deadline);

  const groupMissing = groups.filter((g) => !predictions[g.id] && !isGroupLocked(g.id));
  const groupAlertDone = groupMissing.length === 0;
  const groupAlertRed = !groupAlertDone && !allLocked;
  const groupAlertMsg = !groupAlertDone
    ? (groupMissing.length === groups.length ? "No picks made" : `Missing: ${groupMissing.map((g) => `Group ${g.name}`).join(", ")}`)
    : null;

  // Third-place alert: count saved 3rd picks
  const savedThirdCount = Object.values(predictions).filter((p) => p.team3_id).length;
  const thirdAlertDone = isWC2022 || savedThirdCount >= MAX_THIRD_PICKS;
  const thirdAlertRed = !isWC2022 && !thirdAlertDone && !allLocked;
  const thirdAlertMsg = !thirdAlertDone
    ? (savedThirdCount === 0 ? "No 3rd-place picks made" : `${savedThirdCount}/${MAX_THIRD_PICKS} saved`)
    : null;

  return (
    <div className="page">
      <h2>Group Stages</h2>

      <div className="ko-rules">
        <p className="ko-rules-title">How predictions work</p>
        <ul>
          <li>Pick the 2 teams you think will qualify from each group (order does not matter).{!isWC2022 && <> You can also pick a 3rd-place team in up to {MAX_THIRD_PICKS} groups that you think will qualify for the knockouts. All 3 correct = 10 pts &middot; 2 correct = 5 pts &middot; 1 correct = 2 pts.</>}</li>
          {groupStageUnlocked
            ? <li>The pool admin has re-opened group predictions — you can update picks for any group until <strong>all</strong> of that group's matches are finished.</li>
            : <li>Each group locks when its first match kicks off — you can update picks for other groups until their matches start. <em>Pool admins can re-open predictions for all groups in Pool Settings{isWC2022 ? ", useful for backtesting with time simulation" : " as long as not all of a group's matches are finished"}.</em></li>
          }
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
              {deadline && !groupStageUnlocked && (
                <div className="win-card-body">Closes {formatMatchDate(deadline, displayTzOffset)}</div>
              )}
              {groupStageUnlocked && (
                <div className="win-card-body">Closes when all matches in the group finish</div>
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
              {deadline && !groupStageUnlocked && (
                <div className="win-card-body">Closes {formatMatchDate(deadline, displayTzOffset)}</div>
              )}
              {thirdAlertMsg && <div className="win-missed">{thirdAlertMsg}</div>}
            </div>
          )}
        </div>
      )}

      {nextGroupDeadline && !allLocked && countdown && !groupStageUnlocked && (
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
            <span className="deadline-label">{nextGroupInfo.groupName ? `Group ${nextGroupInfo.groupName} locks on` : "Next group locks on"}</span>
            <span className="deadline-date">{formatDeadlineFull(nextGroupDeadline, displayTzOffset)}</span>
          </div>
        </div>
      )}
      {anyLocked && (
        <div className="deadline-banner locked">
          <span className="deadline-locked-text">
            {allLocked
              ? (groupStageUnlocked
                  ? "Predictions are locked — all group matches are finished"
                  : "Predictions are locked — all group matches have started")
              : (groupStageUnlocked
                  ? `Groups ${lockedGroupNames.join(", ")} locked — all matches finished`
                  : `Groups ${lockedGroupNames.join(", ")} locked — matches have started`)}
          </span>
        </div>
      )}
      <button className="btn-toggle-all" onClick={toggleAll}>
        {allExpanded ? "Hide All Matches" : "Show All Matches"}
      </button>

      {currentUser && !allLocked && (
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

      {!isWC2022 && currentUser && !allLocked && (
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
          const gLocked = isGroupLocked(g.id);

          return (
            <div key={g.id} className={`group-card ${score ? score.cls : !saved && !gLocked ? "unpicked" : ""} ${isExpanded ? "expanded" : ""}`}>
              <div className="group-card-header" onClick={() => toggleGroup(g.name)}>
                <span className="group-badge">Group {g.name}</span>
                {score && (
                  <span className={`result-badge ${score.cls}`}>
                    {score.label} &middot; +{score.points} pts
                  </span>
                )}
                {!score && saved && <span className="saved-label">Saved</span>}
                {gLocked && !saved && !score && <span className="saved-label">Locked</span>}
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
                      className={`group-card-team-row ${currentUser && !gLocked ? "clickable" : ""} ${isTop2 || isThird ? "selected" : ""}`}
                      onClick={currentUser && !gLocked ? (e) => { e.stopPropagation(); toggleTeam(g.id, teamId); } : undefined}
                    >
                      <span className="standings-team-col">
                        {flag(code)} {t.name}
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

              {currentUser && !gLocked && (
                <div className="group-card-footer">
                  {picked.length < 2 && (
                    <span className="pick-hint">Pick {2 - picked.length} more</span>
                  )}
                  {picked.length === 2 && !isWC2022 && thirdPickCount < MAX_THIRD_PICKS && (
                    <span className="pick-hint">Pick a 3rd-place team (optional)</span>
                  )}
                </div>
              )}
              {gLocked && !allLocked && (
                <div className="group-card-footer">
                  <span className="saved-label">
                    {groupStageUnlocked ? "Locked — all matches finished" : "Locked — match started"}
                  </span>
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
