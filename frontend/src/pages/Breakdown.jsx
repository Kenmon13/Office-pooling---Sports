import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchLeaderboard, fetchWC2022Leaderboard, fetchEPL2627Leaderboard,
  fetchHistory, fetchWC2022History,
} from "../api";

// Maps a point-history event type to the summary category it belongs under.
const CATEGORY_OF_TYPE = {
  group: "group",
  ko: "ko",
  champion_pick: "champion",
  champion_change: "champion",
  champion_bonus: "champion",
  player_award: "awards",
};

// One itemized line (e.g. "Group A: Brazil & Argentina — Both correct").
function DetailLine({ description, pts }) {
  const cls = pts > 0 ? "pts-gain" : pts < 0 ? "pts-loss" : "pts-zero";
  return (
    <div className="bd-detail-line">
      <span className="bd-detail-desc">{description}</span>
      <span className={`bd-detail-pts ${cls}`}>
        {pts > 0 ? `+${pts}` : pts === 0 ? "—" : pts}
      </span>
    </div>
  );
}

// One collapsible category (Group stage / Knockouts / Champion / Awards).
function Category({ cat, expanded, onToggle }) {
  const cls = cat.tone === "pos" ? "pts-champ-win" : cat.tone === "neg" ? "pts-champ-loss" : "";
  const hasDetail = cat.events.length > 0;
  return (
    <div className="bd-cat">
      <button
        className={`bd-row bd-cat-head ${hasDetail ? "expandable" : ""}`}
        onClick={hasDetail ? onToggle : undefined}
        disabled={!hasDetail}
      >
        <div className="bd-row-label">
          <span className="bd-row-title">
            {hasDetail && <span className={`bd-caret ${expanded ? "open" : ""}`}>▸</span>}
            {cat.label}
          </span>
          <span className="bd-row-sub">{cat.sub}</span>
        </div>
        <span className={`bd-row-val ${cls}`}>{cat.value}</span>
      </button>
      {hasDetail && expanded && (
        <div className="bd-detail">
          {cat.events.map((e, i) => (
            <DetailLine key={i} description={e.description} pts={e.pts_change} />
          ))}
        </div>
      )}
    </div>
  );
}

function Breakdown({ currentUser, poolId, tournament = "wc2026", mockDate }) {
  const navigate = useNavigate();
  const isEPL = tournament === "epl2627";
  const isWC2022 = tournament === "wc2022";
  const [participants, setParticipants] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  // Keyed by participant id so we never show one player's detail against another.
  const [eventsData, setEventsData] = useState({ id: null, events: [] });
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    const fetchFn = isWC2022 ? fetchWC2022Leaderboard : isEPL ? fetchEPL2627Leaderboard : fetchLeaderboard;
    fetchFn(poolId)
      .then((data) => setParticipants(Array.isArray(data) ? data : []))
      .catch(() => setParticipants([]))
      .finally(() => setLoaded(true));
  }, [poolId, tournament, isEPL, isWC2022, mockDate]);

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

  // Itemized point history for the selected player (EPL has no history endpoint).
  useEffect(() => {
    if (isEPL || effectiveId == null) return;
    const fetchFn = isWC2022 ? fetchWC2022History : fetchHistory;
    const id = effectiveId;
    fetchFn(id, poolId)
      .then((data) => setEventsData({ id, events: Array.isArray(data) ? data : [] }))
      .catch(() => setEventsData({ id, events: [] }));
  }, [effectiveId, poolId, isEPL, isWC2022, mockDate]);

  // Only trust the fetched events if they belong to the currently-selected player.
  const eventsLoading = !isEPL && effectiveId != null && eventsData.id !== effectiveId;

  // Bucket the history events by category for the itemized detail lists.
  const eventsByCategory = useMemo(() => {
    const buckets = { group: [], ko: [], champion: [], awards: [] };
    if (eventsData.id !== effectiveId) return buckets;
    for (const e of eventsData.events) {
      const cat = CATEGORY_OF_TYPE[e.type];
      if (cat) buckets[cat].push(e);
    }
    return buckets;
  }, [eventsData, effectiveId]);

  if (loaded && participants.length === 0) {
    return (
      <div className="page">
        <h2>Breakdown</h2>
        <p className="notice">No participants yet. Join the pool to get started!</p>
      </div>
    );
  }

  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const buildCategories = () => {
    if (!selected) return [];
    const total = selected.points || 0;
    if (isEPL) {
      // EPL leaderboard has a different shape and no itemized history.
      return [
        { key: "match", label: "Matchday predictions", sub: "Weekly fixture picks", value: selected.match_points || 0, events: [] },
        { key: "season", label: "Season predictions", sub: "Long-term forecasts", value: selected.season_points || 0, events: [] },
        {
          key: "awards", label: "Awards", sub: "End-of-season awards",
          value: (selected.award_points || 0) > 0 ? `+${selected.award_points}` : "—",
          tone: (selected.award_points || 0) > 0 ? "pos" : null, events: [],
        },
      ];
    }
    const bonus = selected.champion_bonus || 0;
    const cost = selected.champion_change_cost || 0;
    const champNet = bonus - cost;
    const champSub = cost > 0
      ? `Bonus +${bonus} · change fee −${cost}`
      : bonus > 0 ? "Champion pick won" : "No champion bonus yet";
    const awards = selected.player_awards_points || 0;
    const groupPts = total - (selected.ko_points || 0) - champNet - awards;
    return [
      {
        key: "group", label: "Group stage",
        sub: `${selected.groups_correct || 0} full · ${selected.groups_half || 0} partial of ${selected.groups_predicted || 0} predicted`,
        value: groupPts, events: eventsByCategory.group,
      },
      {
        key: "ko", label: "Knockouts",
        sub: `${selected.ko_correct || 0} winner${(selected.ko_correct || 0) === 1 ? "" : "s"} correct`,
        value: selected.ko_points || 0, events: eventsByCategory.ko,
      },
      {
        key: "champion", label: "Champion", sub: champSub,
        value: champNet > 0 ? `+${champNet}` : champNet === 0 ? "—" : champNet,
        tone: champNet > 0 ? "pos" : champNet < 0 ? "neg" : null,
        events: eventsByCategory.champion,
      },
      {
        key: "awards", label: "Player awards", sub: "Golden Ball, Boot, Glove, etc.",
        value: awards > 0 ? `+${awards}` : "—",
        tone: awards > 0 ? "pos" : null, events: eventsByCategory.awards,
      },
    ];
  };

  const categories = buildCategories();

  return (
    <div className="page">
      <div className="bd-title-row">
        <h2>Breakdown</h2>
        <label className="bd-filter">
          <span className="bd-filter-label">Player</span>
          <select
            className="bd-select"
            value={effectiveId ?? ""}
            onChange={(e) => { setSelectedId(Number(e.target.value)); setExpanded({}); }}
          >
            {sortedForPicker.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>

      {!loaded && <p className="notice">Loading…</p>}

      {selected && (
        <div className="bd-card">
          <div className="bd-card-head">
            <div>
              <span className="bd-card-name clickable" onClick={() => navigate(`/picks/${selected.id}`)}>{selected.name}</span>
              {rank && <span className="bd-card-rank">Rank #{rank}</span>}
            </div>
            <div className="bd-card-total">
              <span className="bd-card-total-val">{selected.points || 0}</span>
              <span className="bd-card-total-label">total pts</span>
            </div>
          </div>
          <div className="bd-rows">
            {categories.map((cat) => (
              <Category key={cat.key} cat={cat} expanded={!!expanded[cat.key]} onToggle={() => toggle(cat.key)} />
            ))}
          </div>
          {!isEPL && (
            <p className="bd-hint">
              {eventsLoading
                ? "Loading itemized detail…"
                : "Tap a category to see each pick and the points it earned."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default Breakdown;
