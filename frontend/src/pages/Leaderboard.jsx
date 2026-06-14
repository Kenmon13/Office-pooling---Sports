import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { fetchLeaderboard, fetchWC2022Leaderboard, fetchEPL2627Leaderboard } from "../api";

function Leaderboard({ poolId, tournament = "wc2026", mockDate }) {
  const navigate = useNavigate();
  const [leaderboard, setLeaderboard] = useState([]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const prevRankRef = useRef({});
  const isEPL = tournament === "epl2627";

  useEffect(() => {
    const fetchFn = tournament === "wc2022" ? fetchWC2022Leaderboard : isEPL ? fetchEPL2627Leaderboard : fetchLeaderboard;
    fetchFn(poolId).then((data) => {
      const withRanks = data.map((p, i) => {
        const currentRank = i + 1;
        const prevRank = prevRankRef.current[p.id] !== undefined ? prevRankRef.current[p.id] : currentRank;
        if (isEPL) {
          return { ...p, currentRank, prevRank };
        }
        const champNet = (p.champion_bonus || 0) - (p.champion_change_cost || 0);
        const playerAwards = p.player_awards_points || 0;
        return {
          ...p,
          group_pts: (p.points || 0) - (p.ko_points || 0) - champNet - playerAwards,
          currentRank,
          prevRank,
        };
      });
      prevRankRef.current = Object.fromEntries(data.map((p, i) => [p.id, i + 1]));
      setLeaderboard(withRanks);
    });
  }, [poolId, tournament, isEPL, mockDate]);

  return (
    <div className="page">
      <div className="lb-title-row">
        <h2>Leaderboard</h2>
        <button className="lb-breakdown-toggle" onClick={() => setShowBreakdown(v => !v)}>
          {showBreakdown ? "Hide breakdown" : "Show breakdown"}
        </button>
      </div>
      {leaderboard.length === 0 ? (
        <p className="notice">No participants yet. Join the pool to get started!</p>
      ) : (<>
        {/* Desktop table */}
        <div className={`leaderboard-scroll ${showBreakdown ? "lb-expanded" : ""}`}>
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>↑↓</th>
                <th>Name</th>
                {isEPL ? (<>
                  <th>Match</th>
                  <th>Season</th>
                </>) : (<>
                  <th>Group</th>
                  <th>KO</th>
                  <th>Champ</th>
                  <th>Awards</th>
                </>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((p, i) => {
                const delta = p.prevRank - p.currentRank;
                if (isEPL) {
                  return (
                    <tr key={p.id} className={i < 3 ? `rank-${i + 1}` : ""}>
                      <td className="rank">{p.currentRank}</td>
                      <td className="rank-change">
                        {delta > 0 ? <span className="rank-up">↑</span> : delta < 0 ? <span className="rank-down">↓</span> : <span className="rank-static">–</span>}
                      </td>
                      <td className="name clickable" onClick={() => navigate(`/picks/${p.id}`)}>{p.name}</td>
                      <td className="pts-sub">{p.match_points || 0}</td>
                      <td className="pts-sub">{p.season_points || 0}</td>
                      <td className="points">{p.points || 0}</td>
                    </tr>
                  );
                }
                const champNet = (p.champion_bonus || 0) - (p.champion_change_cost || 0);
                return (
                  <tr key={p.id} className={i < 3 ? `rank-${i + 1}` : ""}>
                    <td className="rank">{p.currentRank}</td>
                    <td className="rank-change">
                      {delta > 0 ? <span className="rank-up">↑</span> : delta < 0 ? <span className="rank-down">↓</span> : <span className="rank-static">–</span>}
                    </td>
                    <td className="name clickable" onClick={() => navigate(`/picks/${p.id}`)}>{p.name}</td>
                    <td className="pts-sub">{p.group_pts}</td>
                    <td className="pts-sub">{p.ko_points || 0}</td>
                    <td className={`pts-sub ${champNet > 0 ? "pts-champ-win" : champNet < 0 ? "pts-champ-loss" : ""}`}>
                      {champNet > 0 ? `+${champNet}` : champNet === 0 ? "—" : champNet}
                    </td>
                    <td className={`pts-sub ${(p.player_awards_points || 0) > 0 ? "pts-champ-win" : ""}`}>
                      {(p.player_awards_points || 0) > 0 ? `+${p.player_awards_points}` : "—"}
                    </td>
                    <td className="points">{p.points || 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="leaderboard-cards">
          {leaderboard.map((p, i) => {
            const delta = p.prevRank - p.currentRank;
            if (isEPL) {
              return (
                <div key={p.id} className={`leaderboard-card ${i < 3 ? `rank-${i + 1}` : ""}`}>
                  <div className="lb-card-top">
                    <div className="lb-card-left">
                      <span className="lb-card-rank">{p.currentRank}</span>
                      <span className="rank-change">
                        {delta > 0 ? <span className="rank-up">↑</span> : delta < 0 ? <span className="rank-down">↓</span> : <span className="rank-static">–</span>}
                      </span>
                      <span className="lb-card-name clickable" onClick={() => navigate(`/picks/${p.id}`)}>{p.name}</span>
                    </div>
                    <span className="lb-card-total">{p.points || 0} pts</span>
                  </div>
                  {showBreakdown && (
                    <div className="lb-card-breakdown">
                      <div className="lb-breakdown-row">
                        <span className="lb-breakdown-label">Match</span>
                        <span className="lb-breakdown-val">{p.match_points || 0}</span>
                      </div>
                      <div className="lb-breakdown-row">
                        <span className="lb-breakdown-label">Season</span>
                        <span className="lb-breakdown-val">{p.season_points || 0}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            }
            const champNet = (p.champion_bonus || 0) - (p.champion_change_cost || 0);
            const awards = p.player_awards_points || 0;
            return (
              <div key={p.id} className={`leaderboard-card ${i < 3 ? `rank-${i + 1}` : ""}`}>
                <div className="lb-card-top">
                  <div className="lb-card-left">
                    <span className="lb-card-rank">{p.currentRank}</span>
                    <span className="rank-change">
                      {delta > 0 ? <span className="rank-up">↑</span> : delta < 0 ? <span className="rank-down">↓</span> : <span className="rank-static">–</span>}
                    </span>
                    <span className="lb-card-name clickable" onClick={() => navigate(`/picks/${p.id}`)}>{p.name}</span>
                  </div>
                  <span className="lb-card-total">{p.points || 0} pts</span>
                </div>
                {showBreakdown && (
                  <div className="lb-card-breakdown">
                    <div className="lb-breakdown-row">
                      <span className="lb-breakdown-label">Group</span>
                      <span className="lb-breakdown-val">{p.group_pts}</span>
                    </div>
                    <div className="lb-breakdown-row">
                      <span className="lb-breakdown-label">KO</span>
                      <span className="lb-breakdown-val">{p.ko_points || 0}</span>
                    </div>
                    <div className="lb-breakdown-row">
                      <span className="lb-breakdown-label">Champ</span>
                      <span className={`lb-breakdown-val ${champNet > 0 ? "pts-champ-win" : champNet < 0 ? "pts-champ-loss" : ""}`}>
                        {champNet > 0 ? `+${champNet}` : champNet === 0 ? "—" : champNet}
                      </span>
                    </div>
                    <div className="lb-breakdown-row">
                      <span className="lb-breakdown-label">Awards</span>
                      <span className={`lb-breakdown-val ${awards > 0 ? "pts-champ-win" : ""}`}>
                        {awards > 0 ? `+${awards}` : "—"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>)}
    </div>
  );
}

export default Leaderboard;
