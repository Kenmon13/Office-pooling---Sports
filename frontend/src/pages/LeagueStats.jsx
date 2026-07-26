import { useState, useEffect } from "react";
import { fetchLeaguePickStats, fetchLeagueTeams } from "../api";
import { plCrest, registerCrests } from "../flags";

// League analog of Stats.jsx (which is World Cup only). Shows pool-wide pick distributions for a
// domestic league / NFL: who the pool backs to win, zone/slot popularity, and award picks.
function LeagueStats({ league, poolId }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Register crests first so plCrest() can resolve logos for La Liga / Serie A etc.
    fetchLeagueTeams(league).then((teams) => registerCrests(teams)).catch(() => {});
    fetchLeaguePickStats(league, poolId)
      .then((d) => setStats(d && !d.error ? d : null))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [league, poolId]);

  if (loading) return <p className="notice">Loading stats...</p>;
  if (!stats) return <p className="notice">Stats aren't available for this pool yet.</p>;

  const { winner, groups = [], awards = [] } = stats;
  const hasAnyAwardPicks = awards.some((a) => (a.picks || []).length > 0);

  const teamRow = (t, i, showRank) => (
    <div key={t.team_id} className="stats-row stats-row-compact">
      {showRank && <span className="stats-rank-sm">#{i + 1}</span>}
      <span className="stats-team">
        {plCrest(t.team_code, t.crest_url)}
        {t.short_name || t.team_name}
      </span>
      <div className="stats-bar-wrapper">
        <div className="stats-bar stats-bar-group" style={{ width: `${t.percentage}%` }} />
      </div>
      <span className="stats-pct">{t.percentage}%</span>
      <span className="stats-count">({t.pick_count})</span>
    </div>
  );

  return (
    <div className="page">
      <h2>Pool Stats</h2>

      <section className="stats-section">
        <h3>{winner?.label || "Predicted Winner"}</h3>
        <p className="stats-subtitle">Who does the pool think will win it all?</p>
        {!winner || winner.teams.length === 0 ? (
          <p className="notice">No winner picks yet.</p>
        ) : (
          <div className="stats-list">
            {winner.teams.map((t, i) => (
              <div key={t.team_id} className="stats-row">
                <span className="stats-rank">#{i + 1}</span>
                <span className="stats-team">
                  {plCrest(t.team_code, t.crest_url)}
                  {t.short_name || t.team_name}
                </span>
                <div className="stats-bar-wrapper">
                  <div className="stats-bar" style={{ width: `${t.percentage}%` }} />
                </div>
                <span className="stats-pct">{t.percentage}%</span>
                <span className="stats-count">({t.pick_count})</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {groups.length > 0 && (
        <section className="stats-section">
          <h3>Season Predictions</h3>
          <p className="stats-subtitle">How the pool sees the table shaking out</p>
          <div className="stats-groups-grid">
            {groups.map((g) => (
              <div key={g.key} className="stats-group-card">
                <h4>{g.label}</h4>
                {g.teams.length === 0 ? (
                  <p className="notice" style={{ fontSize: 13 }}>No picks yet.</p>
                ) : (
                  g.teams.map((t, i) => teamRow(t, i, true))
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stats-section">
        <h3>Award Picks</h3>
        <p className="stats-subtitle">Top 5 picks per award across the pool</p>
        {!hasAnyAwardPicks ? (
          <p className="notice">No award picks yet.</p>
        ) : (
          <div className="stats-groups-grid">
            {awards.map((award) => {
              const picks = award.picks || [];
              if (picks.length === 0) return null;
              return (
                <div key={award.key} className="stats-group-card">
                  <h4>{award.label}</h4>
                  {picks.map((p, i) => (
                    <div key={i} className="stats-row stats-row-compact">
                      <span className="stats-rank-sm">#{i + 1}</span>
                      <span className="stats-team stats-team-award">
                        {plCrest(p.team_code, p.crest_url)}
                        <span className="stats-award-name">
                          {p.player_name || p.team_name}
                          {p.player_name && <span className="stats-award-team">{p.team_name}</span>}
                        </span>
                      </span>
                      <div className="stats-bar-wrapper">
                        <div className="stats-bar stats-bar-group" style={{ width: `${p.percentage}%` }} />
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

export default LeagueStats;
