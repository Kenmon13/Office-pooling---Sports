import { useState, useEffect, useRef } from "react";
import {
  fetchEPL2627Teams,
  fetchEPL2627SeasonPredictions,
  submitEPL2627SeasonPredictions,
  fetchEPL2627SeasonDeadline,
} from "../api";
import { plCrest } from "../flags";

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

const ZONE_LABELS = {
  1: "Champion",
  2: "Champions League",
  5: "Europa League",
  6: "Conference League",
  18: "Relegation Zone",
};

function getZone(pos) {
  if (pos === 1) return "champion";
  if (pos >= 2 && pos <= 4) return "cl";
  if (pos === 5) return "europa";
  if (pos === 6) return "conference";
  if (pos >= 18) return "relegation";
  return "";
}

function SeasonPredictions({ currentUser, poolId }) {
  const [teams, setTeams] = useState([]);
  const [table, setTable] = useState([]); // array of team IDs in order (pos 1-20)
  const [savedTable, setSavedTable] = useState([]);
  const [deadline, setDeadline] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [selectingIdx, setSelectingIdx] = useState(null);

  const countdown = useCountdown(deadline);
  const isLocked = deadline ? new Date() >= new Date(deadline.replace(" ", "T") + "Z") : false;

  useEffect(() => {
    Promise.all([
      fetchEPL2627Teams(),
      fetchEPL2627SeasonDeadline(poolId),
    ]).then(([teamData, dlData]) => {
      setTeams(teamData);
      setDeadline(dlData.deadline || null);
      if (table.length === 0 && teamData.length > 0) {
        setTable(teamData.map((t) => t.id));
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentUser) {
      fetchEPL2627SeasonPredictions(currentUser.id).then((preds) => {
        if (preds.length === 20) {
          const ordered = preds.sort((a, b) => a.position - b.position).map((p) => p.team_id);
          setTable(ordered);
          setSavedTable(ordered);
        }
      });
    }
  }, [currentUser]);

  const teamMap = {};
  teams.forEach((t) => { teamMap[t.id] = t; });

  const hasChanges = table.length === 20 && JSON.stringify(table) !== JSON.stringify(savedTable);

  const moveTeam = (fromIdx, toIdx) => {
    if (isLocked) return;
    setTable((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const handleDragStart = (idx) => {
    if (isLocked) return;
    setDragIdx(idx);
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    moveTeam(dragIdx, idx);
    setDragIdx(idx);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
  };

  const handleSave = async () => {
    if (!currentUser || table.length !== 20) return;
    setSaving(true);
    setSaveError("");

    const predictions = table.map((teamId, idx) => ({
      position: idx + 1,
      team_id: teamId,
    }));

    const res = await submitEPL2627SeasonPredictions(currentUser.id, predictions);
    if (res.error) {
      setSaveError(res.error);
    } else {
      setSavedTable([...table]);
    }
    setSaving(false);
    window.dispatchEvent(new CustomEvent("picks-saved"));
  };

  return (
    <div className="page">
      <h2>Season Predictions</h2>

      <div className="ko-rules">
        <p className="ko-rules-title">How scoring works</p>
        <ul>
          <li>Champion correct: <strong>25 pts</strong></li>
          <li>Each correct team in top 4 (CL): <strong>5 pts</strong></li>
          <li>Correct Europa League spot (5th): <strong>2 pts</strong></li>
          <li>Correct Conference League spot (6th): <strong>2 pts</strong></li>
          <li>Each correct team in bottom 3 (relegation): <strong>5 pts</strong></li>
          <li>Each team in exact correct position: <strong>1 pt</strong></li>
        </ul>
      </div>

      {deadline && !isLocked && countdown && (
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
            <span className="deadline-label">Season predictions lock on</span>
            <span className="deadline-date">{formatDeadlineFull(deadline)}</span>
          </div>
        </div>
      )}

      {isLocked && (
        <div className="deadline-banner locked">
          <span className="deadline-locked-text">Season predictions are locked — the entry window has closed</span>
        </div>
      )}

      {teams.length === 0 ? (
        <p className="pick-hint">Loading teams...</p>
      ) : (
        <>
          <p className="pick-hint">Click a position to pick a team, or drag to reorder.</p>
          <div className="season-table">
            {table.map((teamId, idx) => {
              const team = teamMap[teamId];
              const pos = idx + 1;
              const zone = getZone(pos);
              const zoneLabel = ZONE_LABELS[pos];
              const isSelecting = selectingIdx === idx;

              return (
                <div key={teamId}>
                  {zoneLabel && (
                    <div className={`zone-divider ${zone}`}>
                      {zoneLabel}
                    </div>
                  )}
                  <div
                    className={`season-row ${zone} ${dragIdx === idx ? "dragging" : ""} ${isLocked ? "locked" : ""} ${isSelecting ? "selecting" : ""}`}
                    draggable={!isLocked && selectingIdx === null}
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    onClick={() => {
                      if (isLocked) return;
                      setSelectingIdx(isSelecting ? null : idx);
                    }}
                  >
                    <span className="season-pos">{pos}</span>
                    {team && plCrest(team.code)}
                    <span className="season-team-name">{team?.short_name || team?.name || "?"}</span>
                    {!isLocked && (
                      <span className="season-arrows">
                        <button
                          className="arrow-btn"
                          onClick={(e) => { e.stopPropagation(); if (pos > 1) moveTeam(idx, idx - 1); }}
                          disabled={pos <= 1}
                        >&#9650;</button>
                        <button
                          className="arrow-btn"
                          onClick={(e) => { e.stopPropagation(); if (pos < 20) moveTeam(idx, idx + 1); }}
                          disabled={pos >= 20}
                        >&#9660;</button>
                      </span>
                    )}
                  </div>
                  {isSelecting && (
                    <div className="season-team-picker">
                      {table.map((tid, tidx) => {
                        const t = teamMap[tid];
                        if (!t) return null;
                        const isCurrent = tidx === idx;
                        return (
                          <button
                            key={tid}
                            className={`picker-team ${isCurrent ? "current" : ""}`}
                            onClick={() => {
                              if (!isCurrent) {
                                setTable((prev) => {
                                  const next = [...prev];
                                  next[idx] = tid;
                                  next[tidx] = teamId;
                                  return next;
                                });
                              }
                              setSelectingIdx(null);
                            }}
                          >
                            {plCrest(t.code)}
                            <span className="picker-name">{t.short_name || t.name}</span>
                            {isCurrent && <span className="picker-current">current</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {currentUser && !isLocked && (
        <div className="save-all-footer">
          {saveError && <p className="error">{saveError}</p>}
          {hasChanges && (
            <button
              className="btn-submit btn-save-all"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : savedTable.length > 0 ? "Update Predictions" : "Save Predictions"}
            </button>
          )}
          {!hasChanges && savedTable.length > 0 && (
            <span className="saved-label">Predictions saved</span>
          )}
        </div>
      )}
    </div>
  );
}

export default SeasonPredictions;
