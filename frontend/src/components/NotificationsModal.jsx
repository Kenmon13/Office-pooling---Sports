import { useState, useEffect } from "react";
import { PATCH_NOTES } from "../patchNotes";
import { fetchUserPools, fetchHistory, fetchWC2022History } from "../api";
import {
  generateSections, countUnread, fetchWindowsForPool, dismissWindowCards, applyDismissals,
} from "../windowsHelpers";

// ── helpers ────────────────────────────────────────────────────────────────────

const POINT_ICON = {
  group: "⚽", ko: "🥊", champion_pick: "🏆",
  champion_change: "🔄", champion_bonus: "🥇",
};


// ── sub-components ─────────────────────────────────────────────────────────────

function SeeMoreButton({ hidden, onShow }) {
  if (hidden <= 0) return null;
  return (
    <button className="see-more-btn" onClick={onShow}>
      See {hidden} older
    </button>
  );
}

function UpdatesTab({ unreadIds }) {
  const [showAll, setShowAll] = useState(false);
  const newNotes = PATCH_NOTES.filter((n) => unreadIds.has(n.id));
  const oldNotes = PATCH_NOTES.filter((n) => !unreadIds.has(n.id));
  const visible = showAll ? oldNotes : [];

  const renderNote = (note) => {
    const userItems = note.items.filter((item) => !item.adminOnly);
    if (userItems.length === 0) return null;
    return (
      <div key={note.id} className="patch-note-entry">
        <div className="patch-note-title">
          <span className="patch-note-version">{note.version}</span>
          <span className="patch-note-name">{note.title}</span>
          <span className="patch-note-date">{note.date}</span>
        </div>
        <ul className="patch-note-items">
          {userItems.map((item, i) => (
            <li key={i}>{typeof item === "string" ? item : item.text}</li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="notif-tab-content">
      {newNotes.map(renderNote)}
      {visible.map(renderNote)}
      {!showAll && (
        <SeeMoreButton hidden={oldNotes.length} onShow={() => setShowAll(true)} />
      )}
    </div>
  );
}

function PointsTab({ events, loaded, hasParticipant, isGlobal, allPools }) {
  const [showAll, setShowAll] = useState(false);

  if (!hasParticipant) {
    return <p className="notif-empty">Join a pool to see your points history.</p>;
  }
  if (!loaded) return <p className="notif-empty">Loading…</p>;
  if (events.length === 0) {
    return <p className="notif-empty">No points events yet — check back after matches are scored.</p>;
  }

  // Global mode: per-pool summary rows (always show all pools, even those with no events yet)
  if (isGlobal) {
    const displayPools = allPools.length > 0
      ? allPools
      : [...new Set(events.map((e) => e.poolId).filter(Boolean))].map((pid) => {
          const first = events.find((e) => e.poolId === pid);
          return { id: pid, name: first?.poolName || `Pool ${pid}` };
        });
    if (displayPools.length > 0) {
      return (
        <div className="notif-tab-content">
          {displayPools.map((pool) => {
            const pid = pool.id;
            const poolEvts = events.filter((e) => e.poolId === pid);
            const unreadEvts = poolEvts.filter((e) => e.isUnread);
            const unreadPts = unreadEvts.reduce((s, e) => s + (e.pts_change || 0), 0);
            return (
              <div key={pid} className="notif-pool-pts-row">
                <div className="summary-pool-header">
                  <span className="summary-pool-name">{pool.name}</span>
                  <span className={`notif-points-change ${unreadPts > 0 ? "pts-gain" : "pts-zero"}`}>
                    {unreadPts > 0 ? `+${unreadPts} pts` : "+0 pts"}
                  </span>
                </div>
                <div className="summary-pts-detail">
                  {unreadEvts.length === 0
                    ? "0 new results"
                    : `${unreadEvts.length} new result${unreadEvts.length !== 1 ? "s" : ""}`
                  }
                </div>
              </div>
            );
          })}
        </div>
      );
    }
  }

  // Single-pool mode: unchanged
  const unread = events.filter((e) => e.isUnread);
  const read = events.filter((e) => !e.isUnread);
  const shown = showAll ? read : [];

  const renderEvent = (e, i) => (
    <div key={i} className="notif-points-card">
      <span className="notif-points-icon">{POINT_ICON[e.type] || "•"}</span>
      <div className="notif-points-info">
        <span className="notif-points-desc">{e.description}</span>
        {e.poolName && <span className="notif-points-pool">{e.poolName}</span>}
      </div>
      <span className={`notif-points-change ${e.pts_change > 0 ? "pts-gain" : e.pts_change < 0 ? "pts-loss" : "pts-zero"}`}>
        {e.pts_change > 0 ? `+${e.pts_change}` : e.pts_change === 0 ? "—" : e.pts_change}
      </span>
    </div>
  );

  return (
    <div className="notif-tab-content">
      {unread.length === 0 && read.length > 0 && (
        <p className="notif-all-read">All caught up — no new points events.</p>
      )}
      {unread.map(renderEvent)}
      {shown.map(renderEvent)}
      {!showAll && <SeeMoreButton hidden={read.length} onShow={() => setShowAll(true)} />}
    </div>
  );
}

const CARD_CLASS = {
  red: "notif-window-card win-urgent",
  orange: "notif-window-card win-change",
  gray: "notif-window-card win-closed",
  upcoming: "notif-window-card win-upcoming",
  done: "notif-window-card win-closed",
  locked: "notif-window-card win-locked",
};

const BADGE_LABEL = { red: "Open", orange: "Optional", gray: "Closed", upcoming: "Coming", done: "Done", locked: "Locked" };

const BADGE_CLASS = {
  red: "win-badge win-badge-open",
  orange: "win-badge win-badge-change",
  gray: "win-badge win-badge-closed",
  upcoming: "win-badge win-badge-upcoming",
  done: "win-badge win-badge-closed",
  locked: "win-badge win-badge-locked",
};

function makeKoSummaryCard(koCards) {
  const open = koCards.filter((c) => ["red", "orange"].includes(c.status));
  if (open.length === 0) return null;
  const needsPick = open.filter((c) => c.missingMsg?.toLowerCase().includes("pick")).length;
  const needsScore = open.filter((c) =>
    c.missingMsg?.toLowerCase().includes("score") && !c.missingMsg?.toLowerCase().includes("pick")
  ).length;
  const parts = [];
  if (needsPick > 0) parts.push(`${needsPick} ${needsPick === 1 ? "match" : "matches"} need picks`);
  if (needsScore > 0) parts.push(`${needsScore} ${needsScore === 1 ? "match" : "matches"} need scores`);
  return {
    id: "ko-summary",
    icon: "🥊",
    status: open.some((c) => c.status === "red") ? "red" : "orange",
    title: "Knockout Stage",
    body: parts.join(", ") || `${open.length} open ${open.length === 1 ? "match" : "matches"}`,
    missingMsg: null,
    statusNote: null,
  };
}

function PickRemindersTab({ sections, loaded, hasParticipant, isGlobal, poolSections }) {
  const [expanded, setExpanded] = useState(false);

  if (!hasParticipant) {
    return <p className="notif-empty">Join a pool to see pick reminders.</p>;
  }
  if (!loaded) return <p className="notif-empty">Loading…</p>;

  const renderCard = (c) => (
    <div key={c.id} className={CARD_CLASS[c.status] || "notif-window-card"}>
      <div className="win-card-top">
        <span className="win-icon">{c.icon}</span>
        <span className="win-title">{c.title}</span>
        <span className={BADGE_CLASS[c.status] || "win-badge"}>{BADGE_LABEL[c.status]}</span>
      </div>
      <div className="win-card-body">{c.body}</div>
      {c.statusNote && <div className="win-status-note">{c.statusNote}</div>}
      {c.missingMsg && <div className="win-missed">⚠️ {c.missingMsg}</div>}
      {c.isChangeWindow && (
        <div className="win-change-note">💡 Optional — not everyone needs to change</div>
      )}
    </div>
  );

  // Global mode: one group of cards per pool, only pools with active alerts
  if (isGlobal && poolSections) {
    const hasAlert = (c) => ["red", "orange"].includes(c.status);
    const alertPools = poolSections.filter((ps) =>
      ps.group.some(hasAlert) || ps.winner.some(hasAlert) || (ps.koSummary && hasAlert(ps.koSummary))
    );
    if (alertPools.length === 0) {
      return (
        <div className="notif-tab-content">
          <p className="notif-all-read">All picks made — nothing pending.</p>
        </div>
      );
    }
    return (
      <div className="notif-tab-content">
        {alertPools.map((ps) => (
          <div key={ps.pool.id} className="notif-pool-section">
            <div className="notif-pool-label">{ps.pool.name}</div>
            {ps.group.filter(hasAlert).map(renderCard)}
            {ps.winner.filter(hasAlert).map(renderCard)}
            {ps.koSummary && hasAlert(ps.koSummary) && renderCard(ps.koSummary)}
          </div>
        ))}
      </div>
    );
  }

  // Single-pool mode: unchanged
  const { group = [], winner = [], ko = [], showKO = false } = sections || {};
  const allCards = [...group, ...winner, ...(showKO ? ko : [])];
  if (allCards.length === 0) {
    return <p className="notif-empty">No pick windows active yet.</p>;
  }

  const isActive = (c) => ["red", "orange", "locked"].includes(c.status);
  const active = allCards.filter(isActive);
  const archived = allCards.filter((c) => !isActive(c));

  return (
    <div className="notif-tab-content">
      {active.length === 0 && <p className="notif-all-read">All picks made — nothing pending.</p>}
      {active.map(renderCard)}
      {expanded && archived.map(renderCard)}
      {archived.length > 0 && (
        <button className="see-more-btn" onClick={() => setExpanded((x) => !x)}>
          {expanded ? "See less" : `See ${archived.length} archived`}
        </button>
      )}
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────────

function NotificationsModal({ onClose, participant, poolId, tournament, onReadUpdates, onReadPoints, onUnreadWindows }) {
  const isGlobal = !participant;
  const isWC2022 = tournament === "wc2022";

  const [activeTab, setActiveTab] = useState("updates");

  // Patch notes unread
  const [unreadPatchIds] = useState(() => {
    const lastSeen = parseInt(localStorage.getItem("patch_notes_last_seen") ?? "-1");
    return new Set(PATCH_NOTES.filter((n) => n.id > lastSeen).map((n) => n.id));
  });

  // Points
  const [pointsEvents, setPointsEvents] = useState([]);
  const [pointsLoaded, setPointsLoaded] = useState(false);
  const [unreadPoints, setUnreadPoints] = useState(0);

  // Windows/sections
  const [windowSections, setWindowSections] = useState(null);
  const [windowsLoaded, setWindowsLoaded] = useState(false);
  const [unreadWindows, setUnreadWindows] = useState(0);
  const [windowTournaments, setWindowTournaments] = useState([]);
  const [poolSections, setPoolSections] = useState(null); // global mode per-pool display
  const [allPools, setAllPools] = useState([]); // global mode pool list (includes pools with no events)

  // ── Pool mode: fetch single pool data ────────────────────────────────────────

  useEffect(() => {
    if (isGlobal || !participant) return;

    // Points
    const pointsLastSeen = localStorage.getItem(`points_last_seen_ts_${poolId}`) || "";
    const histFn = isWC2022 ? fetchWC2022History : fetchHistory;
    histFn(participant.id, poolId)
      .then((data) => {
        const evts = Array.isArray(data) ? data : [];
        setPointsEvents(
          evts.map((e) => ({ ...e, isUnread: !pointsLastSeen || e.event_date > pointsLastSeen }))
        );
        setUnreadPoints(evts.filter((e) => !pointsLastSeen || e.event_date > pointsLastSeen).length);
      })
      .catch(() => {})
      .finally(() => setPointsLoaded(true));

    // Windows
    const p = { id: poolId, tournament, participant_id: participant.id };
    fetchWindowsForPool(p)
      .then(({ predDeadline, koMatches, groups, koDeadline, groupPreds, koPreds, champStatus, thirdPlacePreds }) => {
        const raw = generateSections(new Date(), {
          predDeadline,
          koMatches,
          groups,
          koDeadline,
          poolPicksData: [{ pool: { id: poolId, name: "" }, groupPreds, koPreds, champStatus, thirdPlacePreds }],
        });
        const sections = applyDismissals(raw, poolId);
        const wCount = countUnread(sections);
        setWindowSections(sections);
        setWindowTournaments([tournament]);
        setUnreadWindows(wCount);
        onUnreadWindows?.(wCount);
      })
      .catch(() => {})
      .finally(() => setWindowsLoaded(true));
  }, [isGlobal, participant, poolId, isWC2022, tournament, onUnreadWindows]);

  // ── Global mode: fetch all pools then aggregate ───────────────────────────────

  useEffect(() => {
    if (!isGlobal) return;

    fetchUserPools()
      .then(async (pools) => {
        if (!Array.isArray(pools) || pools.length === 0) {
          setPointsLoaded(true);
          setWindowsLoaded(true);
          return;
        }
        setAllPools(pools);

        // Points: fetch per pool, combine and tag with pool name + unread state
        const pointsFetches = pools.map(async (p) => {
          const lastSeen = localStorage.getItem(`points_last_seen_ts_${p.id}`) || "";
          const fn = p.tournament === "wc2022" ? fetchWC2022History : fetchHistory;
          const data = await fn(p.participant_id, p.id).catch(() => []);
          return (Array.isArray(data) ? data : []).map((e) => ({
            ...e,
            poolId: p.id,
            poolName: p.name,
            isUnread: !lastSeen || e.event_date > lastSeen,
          }));
        });

        Promise.all(pointsFetches).then((results) => {
          const combined = results.flat().sort((a, b) => b.event_date.localeCompare(a.event_date));
          setPointsEvents(combined);
          setUnreadPoints(combined.filter((e) => e.isUnread).length);
          setPointsLoaded(true);
        });

        // Windows: group by tournament, fetch once per tournament, aggregate picks
        const byTournament = {};
        for (const p of pools) {
          if (!byTournament[p.tournament]) byTournament[p.tournament] = [];
          byTournament[p.tournament].push(p);
        }

        const now = new Date();
        const tourIds = Object.keys(byTournament);
        setWindowTournaments(tourIds);

        const combined = { group: [], winner: [], ko: [], showKO: false };
        const allPoolSections = [];

        for (const tourId of tourIds) {
          const tourPools = byTournament[tourId];
          const firstPool = tourPools[0];
          const shared = await fetchWindowsForPool(firstPool).catch(() => null);
          if (!shared) continue;

          const perPoolPicks = await Promise.all(
            tourPools.map(async (p) => {
              if (p.id === firstPool.id) {
                return {
                  pool: p,
                  groupPreds: shared.groupPreds,
                  koPreds: shared.koPreds,
                  champStatus: shared.champStatus,
                  thirdPlacePreds: shared.thirdPlacePreds,
                };
              }
              const data = await fetchWindowsForPool(p).catch(() => ({
                groupPreds: [], koPreds: [], champStatus: null, thirdPlacePreds: null,
              }));
              return {
                pool: p,
                groupPreds: data.groupPreds,
                koPreds: data.koPreds,
                champStatus: data.champStatus,
                thirdPlacePreds: data.thirdPlacePreds,
              };
            })
          );

          // Aggregate for unread count (existing behaviour)
          const sections = generateSections(now, {
            predDeadline: shared.predDeadline,
            koMatches: shared.koMatches,
            groups: shared.groups,
            koDeadline: shared.koDeadline,
            poolPicksData: perPoolPicks,
          });

          const tag = (c) => ({ ...c, tournament: tourId });
          combined.group.push(...sections.group.map(tag));
          combined.winner.push(...sections.winner.map(tag));
          combined.ko.push(...sections.ko.map(tag));
          if (sections.showKO) combined.showKO = true;

          // Per-pool sections for display (3 cards per pool)
          for (const pp of perPoolPicks) {
            const ps = generateSections(now, {
              predDeadline: shared.predDeadline,
              koMatches: shared.koMatches,
              groups: shared.groups,
              koDeadline: shared.koDeadline,
              poolPicksData: [pp],
            });
            const dismissed = applyDismissals(ps, pp.pool.id);
            allPoolSections.push({
              pool: pp.pool,
              group: dismissed.group,
              winner: dismissed.winner,
              koSummary: makeKoSummaryCard(dismissed.ko),
            });
          }
        }

        const hasAlert = (c) => ["red", "orange"].includes(c.status);
        let wCount = 0;
        for (const ps of allPoolSections) {
          wCount += ps.group.filter(hasAlert).length;
          wCount += ps.winner.filter(hasAlert).length;
          if (ps.koSummary && hasAlert(ps.koSummary)) wCount += 1;
        }
        setWindowSections(combined);
        setPoolSections(allPoolSections);
        setUnreadWindows(wCount);
        onUnreadWindows?.(wCount);
        setWindowsLoaded(true);
      })
      .catch(() => {
        setPointsLoaded(true);
        setWindowsLoaded(true);
      });
  }, [isGlobal, onUnreadWindows]);

  // ── Tab switching ──────────────────────────────────────────────────────────

  const handleTabClick = (tab) => {
    setActiveTab(tab);

    if (tab === "updates") {
      localStorage.setItem("patch_notes_last_seen", PATCH_NOTES[0].id);
      onReadUpdates?.();
    } else if (tab === "points") {
      if (!isGlobal) {
        const pools = [...new Set(pointsEvents.map((e) => e.poolId).filter(Boolean))];
        if (pools.length > 0) {
          pools.forEach((pid) => {
            const latest = pointsEvents.find((e) => e.poolId === pid)?.event_date;
            if (latest) localStorage.setItem(`points_last_seen_ts_${pid}`, latest);
          });
        } else if (poolId) {
          const latest = pointsEvents.reduce((max, e) => (e.event_date > max ? e.event_date : max), "");
          if (latest) localStorage.setItem(`points_last_seen_ts_${poolId}`, latest);
        }
        setUnreadPoints(0);
        onReadPoints?.();
      }
    } else if (tab === "windows") {
      if (windowSections) {
        const allWinCards = [
          ...(windowSections.group || []),
          ...(windowSections.winner || []),
          ...(windowSections.ko || []),
        ];
        const orangeIds = allWinCards.filter((c) => c.status === "orange").map((c) => c.id);
        if (orangeIds.length > 0) {
          dismissWindowCards(orangeIds, poolId || null);
          const downgrade = (c) => orangeIds.includes(c.id) ? { ...c, status: "done" } : c;
          const updated = {
            ...windowSections,
            group: windowSections.group.map(downgrade),
            winner: windowSections.winner.map(downgrade),
            ko: windowSections.ko.map(downgrade),
          };
          setWindowSections(updated);
          const newCount = countUnread(updated);
          setUnreadWindows(newCount);
          onUnreadWindows?.(newCount);
        }
      }
    }
  };

  const tabs = [
    { id: "updates", label: "Updates", unread: unreadPatchIds.size },
    { id: "points", label: "Points", unread: unreadPoints },
    { id: "windows", label: "Pick Reminders", unread: unreadWindows },
  ];

  return (
    <div className="patch-notes-overlay" onClick={onClose}>
      <div className="patch-notes-modal notif-modal" onClick={(e) => e.stopPropagation()}>
        <div className="patch-notes-header">
          <h2>🔔 Notifications</h2>
          <button className="patch-notes-close" onClick={onClose}>✕</button>
        </div>

        <div className="notif-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`notif-tab${activeTab === tab.id ? " notif-tab-active" : ""}`}
              onClick={() => handleTabClick(tab.id)}
            >
              {tab.label}
              {tab.unread > 0 && <span className="notif-tab-badge">{tab.unread}</span>}
            </button>
          ))}
        </div>

        <div className="patch-notes-body">
          {activeTab === "updates" && <UpdatesTab unreadIds={unreadPatchIds} />}
          {activeTab === "points" && (
            <PointsTab
              events={pointsEvents}
              loaded={pointsLoaded}
              hasParticipant={isGlobal ? true : !!participant}
              isGlobal={isGlobal}
              allPools={allPools}
            />
          )}
          {activeTab === "windows" && (
            <PickRemindersTab
              sections={windowSections}
              loaded={windowsLoaded}
              hasParticipant={isGlobal ? true : !!participant}
              isGlobal={isGlobal}
              tournaments={windowTournaments}
              poolSections={poolSections}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default NotificationsModal;
