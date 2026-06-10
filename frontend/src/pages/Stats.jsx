import { useState, useEffect } from "react";
import { fetchGroupPickStats, fetchChampionPickStats, fetchAwardPickStats } from "../api";
import { flag } from "../flags";

const SHORT_NAMES = {
  "Bosnia and Herzegovina": "Bosnia",
};

const AWARDS = [
  { key: "golden_ball",  label: "Golden Ball",           emoji: "🥇" },
  { key: "golden_boot",  label: "Golden Boot",           emoji: "👟" },
  { key: "golden_glove", label: "Golden Glove",          emoji: "🧤" },
  { key: "young_player", label: "FIFA Young Player",     emoji: "🌟" },
  { key: "fair_play",    label: "FIFA Fair Play Trophy",  emoji: "🤝" },
];

function Stats({ poolId }) {
  const [groupStats, setGroupStats] = useState([]);
  const [championStats, setChampionStats] = useState([]);
  const [awardStats, setAwardStats] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchGroupPickStats(poolId),
      fetchChampionPickStats(poolId),
      fetchAwardPickStats(poolId),
    ]).then(([groups, champions, awards]) => {
      if (!groups.error) setGroupStats(groups);
      if (!champions.error) setChampionStats(champions);
      if (!awards.error) setAwardStats(awards);
      setLoading(false);
    });
  }, [poolId]);

  if (loading) return <p className="notice">Loading stats...</p>;

  const hasAnyAwardPicks = AWARDS.some((a) => (awardStats[a.key] || []).length > 0);

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
                  {SHORT_NAMES[t.team_name] || t.team_name}
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
                      {SHORT_NAMES[t.team_name] || t.team_name}
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

      <section className="stats-section">
        <h3>Award Picks</h3>
        <p className="stats-subtitle">Top 5 picks per award across the pool</p>
        {!hasAnyAwardPicks ? (
          <p className="notice">No award picks yet.</p>
        ) : (
          <div className="stats-groups-grid">
            {AWARDS.map((award) => {
              const picks = awardStats[award.key] || [];
              if (picks.length === 0) return null;
              return (
                <div key={award.key} className="stats-group-card">
                  <h4>{award.emoji} {award.label}</h4>
                  {picks.map((p, i) => (
                    <div key={i} className="stats-row stats-row-compact">
                      <span className="stats-rank-sm">#{i + 1}</span>
                      <span className="stats-team stats-team-award">
                        {flag(p.team_code)}
                        <span className="stats-award-name">
                          {p.player_name || SHORT_NAMES[p.team_name] || p.team_name}
                          {p.player_name && (
                            <span className="stats-award-team">{SHORT_NAMES[p.team_name] || p.team_name}</span>
                          )}
                        </span>
                      </span>
                      <div className="stats-bar-wrapper">
                        <div
                          className="stats-bar stats-bar-group"
                          style={{ width: `${p.percentage}%` }}
                        />
                      </div>
                      <span className="stats-pct">{p.percentage}%</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default Stats;
