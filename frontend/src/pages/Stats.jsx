import { useState, useEffect } from "react";
import { fetchGroupPickStats, fetchChampionPickStats } from "../api";
import { flag } from "../flags";

function Stats({ poolId }) {
  const [groupStats, setGroupStats] = useState([]);
  const [championStats, setChampionStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchGroupPickStats(poolId),
      fetchChampionPickStats(poolId),
    ]).then(([groups, champions]) => {
      if (!groups.error) setGroupStats(groups);
      if (!champions.error) setChampionStats(champions);
      setLoading(false);
    });
  }, [poolId]);

  if (loading) return <p className="notice">Loading stats...</p>;

  return (
    <div className="page">
      <h2>Pool Stats</h2>

      <section className="stats-section">
        <h3>Predicted Winner</h3>
        <p className="stats-subtitle">Who does the pool think will win it all?</p>
        {championStats.length === 0 ? (
          <p className="notice">No champion picks yet.</p>
        ) : (
          <div className="stats-list">
            {championStats.map((t, i) => (
              <div key={t.team_id} className="stats-row">
                <span className="stats-rank">#{i + 1}</span>
                <span className="stats-team">
                  {flag(t.team_code)}
                  {t.team_name}
                </span>
                <div className="stats-bar-wrapper">
                  <div
                    className="stats-bar"
                    style={{ width: `${t.percentage}%` }}
                  />
                </div>
                <span className="stats-pct">{t.percentage}%</span>
                <span className="stats-count">({t.pick_count})</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="stats-section">
        <h3>Group Stage Picks</h3>
        <p className="stats-subtitle">Most popular teams to qualify from each group</p>
        {groupStats.length === 0 ? (
          <p className="notice">No group picks yet.</p>
        ) : (
          <div className="stats-groups-grid">
            {groupStats.map((g) => (
              <div key={g.group_id} className="stats-group-card">
                <h4>{g.group_name}</h4>
                {g.teams.map((t, i) => (
                  <div key={t.team_id} className="stats-row stats-row-compact">
                    <span className="stats-rank-sm">#{i + 1}</span>
                    <span className="stats-team">
                      {flag(t.team_code)}
                      {t.team_name}
                    </span>
                    <div className="stats-bar-wrapper">
                      <div
                        className="stats-bar stats-bar-group"
                        style={{ width: `${t.percentage}%` }}
                      />
                    </div>
                    <span className="stats-pct">{t.percentage}%</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default Stats;
