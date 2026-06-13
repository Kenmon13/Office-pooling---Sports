import { useState, useEffect } from "react";
import { fetchWC2022History, fetchHistory } from "../api";

const TYPE_ICON = {
  group: "⚽",
  ko: "🥊",
  champion_pick: "🏆",
  champion_change: "🔄",
  champion_bonus: "🥇",
  player_award: "🏅",
};

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr.replace(" ", "T") + "Z");
  const date = d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit" });
  return { date, time };
}

function History({ currentUser, tournament = "wc2026", poolId, mockDate }) {
  const isWC2022 = tournament === "wc2022";
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    const fetchFn = isWC2022 ? fetchWC2022History : fetchHistory;
    fetchFn(currentUser.id, poolId)
      .then((data) => { setEvents(Array.isArray(data) ? data : []); })
      .catch(() => setFetchError(true))
      .finally(() => setLoaded(true));
  }, [currentUser, isWC2022, poolId, mockDate]);

  if (!currentUser) {
    return (
      <div className="page">
        <h2>Point History</h2>
        <p className="notice">Join the pool to view your point history.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Point History</h2>

      {!loaded && <p className="notice">Loading…</p>}

      {loaded && fetchError && (
        <p className="notice" style={{ color: "#ef5350" }}>Failed to load history — please refresh the page.</p>
      )}

      {loaded && !fetchError && events.length === 0 && (
        <p className="notice">No point events yet — they&apos;ll appear here as results come in.</p>
      )}

      {loaded && !fetchError && events.length > 0 && (
        <table className="history-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Event</th>
              <th>Pts</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={i} className={`history-row history-${e.type}`}>
                <td className="history-date">
                  <span className="history-date-day">{formatDate(e.event_date).date}</span>
                  <span className="history-date-time">{formatDate(e.event_date).time}</span>
                </td>
                <td className="history-desc">
                  <span className="history-icon">{TYPE_ICON[e.type] || "•"}</span>
                  {e.description}
                </td>
                <td className={`history-pts ${e.pts_change > 0 ? "pts-gain" : e.pts_change < 0 ? "pts-loss" : "pts-zero"}`}>
                  {e.pts_change > 0 ? `+${e.pts_change}` : e.pts_change === 0 ? "—" : e.pts_change}
                </td>
                <td className="history-total">{e.running_total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default History;
