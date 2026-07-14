import { useState, useEffect, useRef } from "react";
import {
  fetchLeagueTeams,
  fetchLeagueSeasonPredictions,
  submitLeagueSeasonPredictions,
  fetchLeagueSeasonDeadline,
  fetchLeagueStandings,
} from "../api";
import { plCrest, registerCrests } from "../flags";
import { getLeague, zoneForPosition, isNFL } from "../leagues";

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
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

// Divider labels shown above the first row of each table zone, derived from the league's zone
// config so an 18-team league relegates from a different position without code changes.
function zoneDividerLabels(league) {
  const z = getLeague(league)?.zones;
  if (!z) return {};
  return {
    [z.champion]: "Champion",
    [z.champion + 1]: "Champions League", // CL block starts right after the champion row
    [z.europa]: "Europa League",
    [z.conference]: "Conference League",
    [z.relegation[0]]: "Relegation Zone",
  };
}

function SeasonPredictions({ currentUser, poolId, league = "epl2627" }) {
  const L = getLeague(league);
  const nfl = isNFL(league);
  const teamCount = L?.teamCount || 20;
  const slots = L?.seasonSlots || [];
  const ZONE_LABELS = zoneDividerLabels(league);
  const [teams, setTeams] = useState([]);
  const [table, setTable] = useState([]); // soccer: array of team IDs in order (pos 1-20)
  const [savedTable, setSavedTable] = useState([]);
  const [picks, setPicks] = useState({}); // nfl: { [slot.pos]: team_id }
  const [savedPicks, setSavedPicks] = useState({});
  const [standings, setStandings] = useState([]); // live table, sorted (index+1 = position)
  const [deadline, setDeadline] = useState(null);
  const [serverLocked, setServerLocked] = useState(null); // admin-override-aware lock from the server
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [selectingIdx, setSelectingIdx] = useState(null);

  const countdown = useCountdown(deadline);
  // Prefer the server's effective lock (which honours a pool admin's manual override);
  // fall back to the raw deadline for older responses.
  const isLocked = serverLocked !== null
    ? serverLocked
    : (deadline ? new Date() >= new Date(deadline.replace(" ", "T") + "Z") : false);

  useEffect(() => {
    Promise.all([
      fetchLeagueTeams(league),
      fetchLeagueSeasonDeadline(league, poolId),
      fetchLeagueStandings(league),
    ]).then(([teamData, dlData, standingsData]) => {
      registerCrests(teamData);
      registerCrests(standingsData);
      setTeams(teamData);
      setDeadline(dlData.deadline || null);
      setServerLocked(typeof dlData.locked === "boolean" ? dlData.locked : null);
      setStandings(Array.isArray(standingsData) ? standingsData : []);
      // Soccer starts from the team list as a default running order; NFL starts empty (every slot
      // is an explicit choice, and pre-filling one would silently become a real pick on save).
      if (!nfl && table.length === 0 && teamData.length > 0) {
        setTable(teamData.map((t) => t.id));
      }
    });
  }, [league]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!currentUser) return;
    fetchLeagueSeasonPredictions(league, currentUser.id).then((preds) => {
      if (nfl) {
        if (preds.length === 0) return;
        const byPos = {};
        for (const p of preds) byPos[p.position] = p.team_id;
        setPicks(byPos);
        setSavedPicks(byPos);
      } else if (preds.length === teamCount) {
        const ordered = preds.sort((a, b) => a.position - b.position).map((p) => p.team_id);
        setTable(ordered);
        setSavedTable(ordered);
      }
    });
  }, [league, currentUser, teamCount, nfl]);

  const teamMap = {};
  teams.forEach((t) => { teamMap[t.id] = t; });

  // Live league position per team (standings come back sorted, so index+1 = position).
  const currentPos = {};
  standings.forEach((t, i) => { currentPos[t.team_id] = i + 1; });
  // The season has kicked off once at least one match has been played.
  const hasStarted = standings.some((t) => t.played > 0);

  // Who currently tops each division (standings are pre-sorted, so first seen wins).
  const divisionLeader = {};
  if (nfl) {
    for (const t of standings) {
      if (t.division && !divisionLeader[t.division]) divisionLeader[t.division] = t;
    }
  }

  const allSlotsFilled = slots.every((s) => picks[s.pos]);
  const hasChanges = nfl
    ? allSlotsFilled && JSON.stringify(picks) !== JSON.stringify(savedPicks)
    : table.length === teamCount && JSON.stringify(table) !== JSON.stringify(savedTable);

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
    if (!currentUser) return;
    if (nfl ? !allSlotsFilled : table.length !== teamCount) return;
    setSaving(true);
    setSaveError("");

    const predictions = nfl
      ? slots.map((s) => ({ position: s.pos, team_id: picks[s.pos] }))
      : table.map((teamId, idx) => ({ position: idx + 1, team_id: teamId }));

    const res = await submitLeagueSeasonPredictions(league, currentUser.id, predictions);
    if (res.error) {
      setSaveError(res.error);
    } else if (nfl) {
      setSavedPicks({ ...picks });
    } else {
      setSavedTable([...table]);
    }
    setSaving(false);
    window.dispatchEvent(new CustomEvent("picks-saved"));
  };

  const savedAny = nfl ? Object.keys(savedPicks).length > 0 : savedTable.length > 0;

  return (
    <div className="page">
      <h2>Season Predictions</h2>

      <div className="ko-rules">
        <p className="ko-rules-title">How scoring works</p>
        {nfl ? (
          <ul>
            <li>Each correct division winner (×8): <strong>5 pts</strong></li>
            <li>Each correct conference champion (×2): <strong>10 pts</strong></li>
            <li>Correct Super Bowl winner: <strong>25 pts</strong></li>
            <li className="rules-note">
              Division winners score once the regular season ends; the conference and Super Bowl
              picks score after those games are played.
            </li>
          </ul>
        ) : (
          <ul>
            <li>Champion correct: <strong>25 pts</strong></li>
            <li>Each correct team in top 4 (CL): <strong>5 pts</strong></li>
            <li>Correct Europa League spot (5th): <strong>2 pts</strong></li>
            <li>Correct Conference League spot (6th): <strong>2 pts</strong></li>
            <li>Each correct team in bottom 3 (relegation): <strong>5 pts</strong></li>
            <li>Each team in exact correct position: <strong>1 pt</strong></li>
          </ul>
        )}
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
      ) : nfl ? (
        <NFLSlotPicks
          slots={slots}
          teams={teams}
          picks={picks}
          setPicks={setPicks}
          isLocked={isLocked}
          hasStarted={hasStarted}
          divisionLeader={divisionLeader}
          standings={standings}
        />
      ) : (
        <>
          <p className="pick-hint">
            {hasStarted
              ? "The season is underway — each row shows the team's current league position and how it compares to your prediction (▲ ahead of / ▼ behind where you placed it)."
              : "Click a position to pick a team, or drag to reorder."}
          </p>
          <div className="season-table">
            {table.map((teamId, idx) => {
              const team = teamMap[teamId];
              const pos = idx + 1;
              const zone = zoneForPosition(league, pos) || "";
              const zoneLabel = ZONE_LABELS[pos];
              const isSelecting = selectingIdx === idx;
              // How the team is actually doing vs where it was predicted.
              const curPos = hasStarted ? currentPos[teamId] : null;
              const posDiff = curPos ? pos - curPos : null; // >0 = higher (better) than predicted

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
                    {team && plCrest(team.code, team.crest_url)}
                    <span className="season-team-name">{team?.short_name || team?.name || "?"}</span>
                    {curPos && (
                      <span
                        className="season-actual"
                        title={`Currently ${ordinal(curPos)} · you predicted ${ordinal(pos)}`}
                      >
                        <span className="season-actual-pos">Now {ordinal(curPos)}</span>
                        <span className={`season-actual-delta ${posDiff > 0 ? "up" : posDiff < 0 ? "down" : "same"}`}>
                          {posDiff > 0 ? `▲${posDiff}` : posDiff < 0 ? `▼${Math.abs(posDiff)}` : "on track"}
                        </span>
                      </span>
                    )}
                    {!isLocked && (
                      <span className="season-arrows">
                        <button
                          className="arrow-btn"
                          onClick={(e) => { e.stopPropagation(); if (pos > 1) moveTeam(idx, idx - 1); }}
                          disabled={pos <= 1}
                        >&#9650;</button>
                        <button
                          className="arrow-btn"
                          onClick={(e) => { e.stopPropagation(); if (pos < teamCount) moveTeam(idx, idx + 1); }}
                          disabled={pos >= teamCount}
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
                            {plCrest(t.code, t.crest_url)}
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
          {nfl && !allSlotsFilled && (
            <span className="saved-label">
              Fill all {slots.length} picks to save ({slots.filter((s) => picks[s.pos]).length}/{slots.length} done)
            </span>
          )}
          {hasChanges && (
            <button
              className="btn-submit btn-save-all"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : savedAny ? "Update Predictions" : "Save Predictions"}
            </button>
          )}
          {!hasChanges && savedAny && (
            <span className="saved-label">Predictions saved</span>
          )}
        </div>
      )}
    </div>
  );
}

// NFL picks: a team per named slot rather than a full 1..N ordering. Each slot only offers the
// teams that could actually fill it (a division slot lists that division's four), which mirrors
// the same rule the backend enforces on save.
function NFLSlotPicks({ slots, teams, picks, setPicks, isLocked, hasStarted, divisionLeader, standings }) {
  const eligibleFor = (slot) => {
    if (slot.scope === "division") return teams.filter((t) => t.division === slot.division);
    if (slot.scope === "conference") return teams.filter((t) => t.conference === slot.conference);
    return teams;
  };

  const bySlotScope = (scope) => slots.filter((s) => s.scope === scope);
  const standingFor = (teamId) => standings.find((s) => s.team_id === teamId);

  const renderSlot = (slot) => {
    const eligible = eligibleFor(slot).slice().sort((a, b) => a.name.localeCompare(b.name));
    const pickedId = picks[slot.pos];
    const picked = teams.find((t) => t.id === pickedId);
    const leader = slot.scope === "division" ? divisionLeader[slot.division] : null;
    const pickedStanding = pickedId ? standingFor(pickedId) : null;

    return (
      <div key={slot.key} className={`nfl-slot ${slot.scope}`}>
        <div className="nfl-slot-head">
          <span className="nfl-slot-label">
            <span className="nfl-slot-emoji">{slot.emoji}</span>
            {slot.label}
          </span>
          <span className="nfl-slot-pts">{slot.pts} pts</span>
        </div>

        <div className="nfl-slot-pick">
          {picked && plCrest(picked.code, picked.crest_url)}
          <select
            className="nfl-slot-select"
            value={pickedId || ""}
            disabled={isLocked}
            onChange={(e) => {
              const v = e.target.value;
              setPicks((prev) => ({ ...prev, [slot.pos]: v ? Number(v) : undefined }));
            }}
          >
            <option value="">— pick a team —</option>
            {eligible.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {hasStarted && (
          <div className="nfl-slot-live">
            {slot.scope === "division" && leader && (
              <span className={leader.team_id === pickedId ? "nfl-live-ok" : "nfl-live-off"}>
                {leader.team_id === pickedId ? "✓ your pick leads" : `Leading: ${leader.short_name || leader.name}`}
              </span>
            )}
            {slot.scope !== "division" && pickedStanding && (
              <span className="nfl-live-off">
                {pickedStanding.short_name || pickedStanding.name}: {pickedStanding.won}-{pickedStanding.lost}
                {pickedStanding.tied > 0 ? `-${pickedStanding.tied}` : ""}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <p className="pick-hint">
        {hasStarted
          ? "The season is underway — each division shows who's currently leading it, so you can see how your picks are holding up."
          : "Pick a winner for each of the eight divisions, then each conference champion and the Super Bowl winner."}
      </p>

      <div className="nfl-slots">
        {["AFC", "NFC"].map((conf) => (
          <div key={conf} className="nfl-conf-block">
            <h3 className="nfl-conf-title">{conf}</h3>
            {bySlotScope("division").filter((s) => s.conference === conf).map(renderSlot)}
            {bySlotScope("conference").filter((s) => s.conference === conf).map(renderSlot)}
          </div>
        ))}
      </div>

      <div className="nfl-slots-final">
        {bySlotScope("champion").map(renderSlot)}
      </div>

      {hasStarted && <NFLStandings standings={standings} />}
    </>
  );
}

// Live W-L-T table, grouped the way the NFL is actually read: by division, within each conference.
function NFLStandings({ standings }) {
  const divisions = [...new Set(standings.map((t) => t.division).filter(Boolean))].sort();
  if (divisions.length === 0) return null;

  return (
    <div className="nfl-standings">
      <h3 className="nfl-standings-title">Current Standings</h3>
      <div className="nfl-standings-grid">
        {divisions.map((div) => (
          <div key={div} className="nfl-division">
            <div className="nfl-division-head">
              <span className="nfl-division-name">{div}</span>
              <span className="nfl-division-cols">
                <span className="nfl-stat">W</span>
                <span className="nfl-stat">L</span>
                <span className="nfl-stat">T</span>
                <span className="nfl-stat pct">PCT</span>
              </span>
            </div>
            {standings.filter((t) => t.division === div).map((t, i) => (
              <div key={t.team_id} className={`nfl-division-row ${i === 0 ? "leader" : ""}`}>
                {plCrest(t.code, t.crest_url)}
                <span className="nfl-division-team">{t.short_name || t.name}</span>
                <span className="nfl-division-cols">
                  <span className="nfl-stat">{t.won}</span>
                  <span className="nfl-stat">{t.lost}</span>
                  <span className="nfl-stat">{t.tied}</span>
                  <span className="nfl-stat pct">{t.played > 0 ? t.pct.toFixed(3).replace(/^0/, "") : "—"}</span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default SeasonPredictions;
