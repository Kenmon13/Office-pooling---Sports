import { useState, useEffect } from "react";
import { fetchWC2022ChampionPick, submitWC2022ChampionPick, fetchChampionPick, submitChampionPick } from "../api";
import { fetchWC2022Groups, fetchGroups } from "../api";
import { flag } from "../flags";

function Champion({ currentUser, tournament = "wc2026", poolId, mockDate }) {
  const isWC2022 = tournament === "wc2022";
  const [status, setStatus] = useState(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [groups, setGroups] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const fetchGroups2 = isWC2022 ? fetchWC2022Groups : fetchGroups;
    fetchGroups2().then(setGroups);
  }, [isWC2022]);

  useEffect(() => {
    if (!currentUser) return;
    const fetchFn = isWC2022 ? fetchWC2022ChampionPick : fetchChampionPick;
    fetchFn(currentUser.id, poolId)
      .then((data) => { setStatus(data); setStatusLoaded(true); })
      .catch(() => setStatusLoaded(true));
  }, [currentUser, isWC2022, poolId, mockDate]);

  const canPick = !!status?.canInitialPick;
  const canChange = !!status?.canChange;
  const canInteract = (canPick || canChange) && !!currentUser;
  const hasPick = !!status?.pick;
  const isLocked = !!status?.locked;
  const pickCorrect = !!status?.pickCorrect;
  const changeCost = status?.changeCost || 0;

  const handleTeamClick = (team) => {
    if (!canInteract) return;
    if (hasPick && String(team.id) === String(status.pick.team_id)) return;
    setSelectedTeam(team);
    setConfirming(false);
  };

  const handleConfirmClick = () => {
    if (changeCost > 0) {
      setConfirming(true);
    } else {
      doSave();
    }
  };

  const doSave = async () => {
    if (!selectedTeam || !currentUser) return;
    setSaving(true);
    setMsg("");
    setConfirming(false);
    const submitFn = isWC2022 ? submitWC2022ChampionPick : submitChampionPick;
    const result = await (isWC2022
      ? submitFn(currentUser.id, selectedTeam.id, poolId)
      : submitFn(currentUser.id, selectedTeam.id));
    if (result.error) {
      setMsg(result.error);
    } else {
      const fetchFn = isWC2022 ? fetchWC2022ChampionPick : fetchChampionPick;
      const newStatus = await fetchFn(currentUser.id, poolId);
      setStatus(newStatus);
      setSelectedTeam(null);
      setMsg("Winner pick saved!");
      setTimeout(() => setMsg(""), 3000);
      window.dispatchEvent(new CustomEvent("picks-saved"));
    }
    setSaving(false);
  };

  const renderPick = () => {
    if (!hasPick) return null;
    const pick = status.pick;
    return (
      <div className={`champion-current-pick ${pickCorrect ? "champion-won" : ""}`}>
        <span className="champion-pick-label">Your pick</span>
        <span className="champion-pick-team">
          {flag(pick.team_code)} {pick.team_name}
        </span>
        {pickCorrect && <span className="champion-win-badge">+20 pts bonus</span>}
      </div>
    );
  };

  if (!currentUser) {
    return (
      <div className="page">
        <h2>Winner Pick</h2>
        <WinnerRules />
        <p className="notice">Join the pool to make your winner pick.</p>
      </div>
    );
  }

  const noTeams = groups.length === 0 || groups.every((g) => (g.teams || []).length === 0);

  return (
    <div className="page">
      <h2>Winner Pick</h2>
      <WinnerRules />

      {statusLoaded && canPick && !hasPick && (
        <div className="page-alerts">
          <div className="notif-window-card win-urgent">
            <div className="win-card-top">
              <span className="win-icon">🏆</span>
              <span className="win-title">Winner Pick</span>
              <span className="win-badge win-badge-open">Open</span>
            </div>
            <div className="win-missed">⚠️ No pick made yet</div>
          </div>
        </div>
      )}

      {renderPick()}

      {statusLoaded && isLocked && (
        <div className="deadline-banner locked" style={{ marginBottom: 16 }}>
          <span className="deadline-locked-text">Winner pick locked during group stage — change window reopens after the final group match</span>
        </div>
      )}

      {statusLoaded && !canInteract && !isLocked && !hasPick && (
        <div className="deadline-banner locked" style={{ marginBottom: 16 }}>
          <span className="deadline-locked-text">Winner pick window is closed</span>
        </div>
      )}

      {canChange && changeCost === 0 && (
        <div className="champion-change-banner">
          <strong>Change window is open</strong> — you may change your pick freely before the first knockout match.
        </div>
      )}

      {canChange && changeCost > 0 && (
        <div className="champion-change-banner champion-change-cost-banner">
          <strong>Post-group change window is open</strong> — changing your pick now costs <strong>−{changeCost} pts</strong> (one-time fee; all further changes this window are free).
        </div>
      )}

      {noTeams && (
        <p className="notice">Teams will be available once the tournament schedule is confirmed.</p>
      )}

      {!noTeams && canInteract && (
        <>
          <p className="champion-instructions">
            {canChange ? "Select a new team to change your pick:" : "Select the team you think will win the tournament:"}
          </p>
          <div className="champion-groups">
            {groups.map((g) => (
              <div key={g.id} className="champion-group">
                <div className="champion-group-title">Group {g.name}</div>
                <div className="champion-group-teams">
                  {(g.teams || []).map((t) => {
                    const isCurrent = hasPick && String(t.id) === String(status.pick?.team_id);
                    const isSelected = selectedTeam && String(t.id) === String(selectedTeam.id);
                    return (
                      <button
                        key={t.id}
                        className={`champion-team-btn ${isCurrent ? "current" : ""} ${isSelected ? "selected" : ""}`}
                        onClick={() => handleTeamClick(t)}
                        disabled={isCurrent}
                      >
                        {flag(t.code)} {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {selectedTeam && !confirming && (
            <div className="champion-confirm-row">
              <span>Selected: <strong>{flag(selectedTeam.code)} {selectedTeam.name}</strong></span>
              <button className="btn-submit" onClick={handleConfirmClick} disabled={saving}>
                {saving ? "Saving…" : canChange
                  ? changeCost > 0 ? `Change pick (costs ${changeCost} pts)` : "Change pick (free)"
                  : "Save pick"}
              </button>
              <button className="btn-small" onClick={() => setSelectedTeam(null)}>Cancel</button>
            </div>
          )}

          {selectedTeam && confirming && (
            <div className="champion-confirm-row champion-cost-confirm">
              <span>Changing to <strong>{flag(selectedTeam.code)} {selectedTeam.name}</strong> will deduct <strong>{changeCost} pts</strong>. Confirm?</span>
              <button className="btn-submit" onClick={doSave} disabled={saving}>
                {saving ? "Saving…" : "Yes, change pick"}
              </button>
              <button className="btn-small" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          )}
        </>
      )}

      {!noTeams && !canInteract && hasPick && !isLocked && (
        <div className="champion-groups locked-view">
          {groups.map((g) => (
            <div key={g.id} className="champion-group">
              <div className="champion-group-title">Group {g.name}</div>
              <div className="champion-group-teams">
                {(g.teams || []).map((t) => {
                  const isCurrent = String(t.id) === String(status.pick?.team_id);
                  return (
                    <div key={t.id} className={`champion-team-btn ${isCurrent ? "current" : ""}`}>
                      {flag(t.code)} {t.name}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {msg && <p className="champion-msg">{msg}</p>}
    </div>
  );
}

function WinnerRules() {
  return (
    <div className="ko-rules">
      <p className="ko-rules-title">How the winner pick works</p>
      <ul>
        <li>Pick the team you think will win the tournament.</li>
        <li>If your team wins the Final, you earn <strong>+20 bonus pts</strong> added to your total.</li>
        <li>
          <strong>Two change windows:</strong>
          <ul>
            <li><strong>Before the group stage kicks off</strong> — change as many times as you like, completely free.</li>
            <li><strong>After the final group match, before the first knockout match</strong> — your first change costs <strong>−5 pts</strong>; all further changes in this window are free.</li>
          </ul>
        </li>
        <li>Pick is <strong>locked</strong> during the group stage and permanently once the knockouts begin.</li>
      </ul>
    </div>
  );
}

export default Champion;
