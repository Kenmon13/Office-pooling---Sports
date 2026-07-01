import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { fetchLeaderboard, fetchWC2022Leaderboard, fetchEPL2627Leaderboard } from "../api";

// Renders one "where the points came from" row.
function BreakdownRow({ label, sub, value, tone }) {
  const cls = tone === "pos" ? "pts-champ-win" : tone === "neg" ? "pts-champ-loss" : "";
  return (
    <div className="bd-row">
      <div className="bd-row-label">
        <span className="bd-row-title">{label}</span>
        {sub && <span className="bd-row-sub">{sub}</span>}
      </div>
      <span className={`bd-row-val ${cls}`}>{value}</span>
    </div>
  );
}

function Breakdown({ currentUser, poolId, tournament = "wc2026", mockDate }) {
  const navigate = useNavigate();
  const isEPL = tournament === "epl2627";
  const [participants, setParticipants] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fetchFn = tournament === "wc2022" ? fetchWC2022Leaderboard : isEPL ? fetchEPL2627Leaderboard : fetchLeaderboard;
    fetchFn(poolId)
      .then((data) => setParticipants(Array.isArray(data) ? data : []))
      .catch(() => setParticipants([]))
      .finally(() => setLoaded(true));
  }, [poolId, tournament, isEPL, mockDate]);

  // Participants sorted by name for the picker (leaderboard comes back ranked by points).
  const sortedForPicker = useMemo(
    () => [...participants].sort((a, b) => a.name.localeCompare(b.name)),
    [participants]
  );

  // Default the filter to the current user (if they're in the pool), else the leader —
  // derived rather than stored, so we don't setState inside an effect.
  const defaultId = useMemo(() => {
    if (participants.length === 0) return null;
    const mine = currentUser && participants.find((p) => p.id === currentUser.id);
    return mine ? mine.id : participants[0].id;
  }, [participants, currentUser]);
  const effectiveId = selectedId ?? defaultId;

  const selected = participants.find((p) => p.id === effectiveId) || null;
  const rank = selected ? participants.findIndex((p) => p.id === selected.id) + 1 : null;

  if (loaded && participants.length === 0) {
    return (
      <div className="page">
        <h2>Breakdown</h2>
        <p className="notice">No participants yet. Join the pool to get started!</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="bd-title-row">
        <h2>Breakdown</h2>
        <label className="bd-filter">
          <span className="bd-filter-label">Player</span>
          <select
            className="bd-select"
            value={effectiveId ?? ""}
            onChange={(e) => setSelectedId(Number(e.target.value))}
          >
            {sortedForPicker.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>

      {!loaded && <p className="notice">Loading…</p>}

      {selected && (() => {
        const total = selected.points || 0;
        let rows;
        if (isEPL) {
          rows = [
            { label: "Matchday predictions", sub: "Weekly fixture picks", value: selected.match_points || 0 },
            { label: "Season predictions", sub: "Long-term forecasts", value: selected.season_points || 0 },
            {
              label: "Awards",
              sub: "End-of-season awards",
              value: (selected.award_points || 0) > 0 ? `+${selected.award_points}` : "—",
              tone: (selected.award_points || 0) > 0 ? "pos" : null,
            },
          ];
        } else {
          const bonus = selected.champion_bonus || 0;
          const cost = selected.champion_change_cost || 0;
          const champNet = bonus - cost;
          const champSub = cost > 0
            ? `Bonus +${bonus} · change fee −${cost}`
            : bonus > 0 ? "Champion pick won" : "No champion bonus yet";
          const awards = selected.player_awards_points || 0;
          // group_pts isn't returned by the API — derive it the same way the Leaderboard does.
          const groupPts = total - (selected.ko_points || 0) - champNet - awards;
          rows = [
            {
              label: "Group stage",
              sub: `${selected.groups_correct || 0} full · ${selected.groups_half || 0} partial of ${selected.groups_predicted || 0} predicted`,
              value: groupPts,
            },
            {
              label: "Knockouts",
              sub: `${selected.ko_correct || 0} winner${(selected.ko_correct || 0) === 1 ? "" : "s"} correct`,
              value: selected.ko_points || 0,
            },
            {
              label: "Champion",
              sub: champSub,
              value: champNet > 0 ? `+${champNet}` : champNet === 0 ? "—" : champNet,
              tone: champNet > 0 ? "pos" : champNet < 0 ? "neg" : null,
            },
            {
              label: "Player awards",
              sub: "Golden Ball, Boot, Glove, etc.",
              value: awards > 0 ? `+${awards}` : "—",
              tone: awards > 0 ? "pos" : null,
            },
          ];
        }
        return (
          <div className="bd-card">
            <div className="bd-card-head">
              <div>
                <span className="bd-card-name clickable" onClick={() => navigate(`/picks/${selected.id}`)}>{selected.name}</span>
                {rank && <span className="bd-card-rank">Rank #{rank}</span>}
              </div>
              <div className="bd-card-total">
                <span className="bd-card-total-val">{total}</span>
                <span className="bd-card-total-label">total pts</span>
              </div>
            </div>
            <div className="bd-rows">
              {rows.map((r) => (
                <BreakdownRow key={r.label} label={r.label} sub={r.sub} value={r.value} tone={r.tone} />
              ))}
            </div>
            <p className="bd-hint">Tap the name to view {selected.name}&apos;s full picks.</p>
          </div>
        );
      })()}
    </div>
  );
}

export default Breakdown;
