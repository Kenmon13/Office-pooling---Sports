import { useState, useEffect, useRef } from "react";
import { fetchLeaderboard, fetchWC2022Leaderboard } from "../api";

function Leaderboard({ poolId, tournament = "wc2026", mockDate }) {
  const [leaderboard, setLeaderboard] = useState([]);
  const prevRankRef = useRef({});

  useEffect(() => {
    const fetchFn = tournament === "wc2022" ? fetchWC2022Leaderboard : fetchLeaderboard;
    fetchFn(poolId).then((data) => {
      const withRanks = data.map((p, i) => {
        const currentRank = i + 1;
        const prevRank = prevRankRef.current[p.id] !== undefined ? prevRankRef.current[p.id] : currentRank;
        const champNet = (p.champion_bonus || 0) - (p.champion_change_cost || 0);
        return {
          ...p,
          group_pts: (p.points || 0) - (p.ko_points || 0) - champNet,
          currentRank,
          prevRank,
        };
      });
      prevRankRef.current = Object.fromEntries(data.map((p, i) => [p.id, i + 1]));
      setLeaderboard(withRanks);
    });
  }, [poolId, tournament, mockDate]);

  return (
    <div className="page">
      <h2>Leaderboard</h2>
      {leaderboard.length === 0 ? (
        <p className="notice">No participants yet. Join the pool to get started!</p>
      ) : (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th></th>
              <th>Name</th>
              <th>Group</th>
              <th>KO</th>
              <th>Champ</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((p, i) => {
              const delta = p.prevRank - p.currentRank;
              const champNet = (p.champion_bonus || 0) - (p.champion_change_cost || 0);
              return (
                <tr key={p.id} className={i < 3 ? `rank-${i + 1}` : ""}>
                  <td className="rank">{p.currentRank}</td>
                  <td className="rank-change">
                    {delta > 0 ? <span className="rank-up">↑</span> : delta < 0 ? <span className="rank-down">↓</span> : <span className="rank-static">–</span>}
                  </td>
                  <td className="name">{p.name}</td>
                  <td className="pts-sub">{p.group_pts}</td>
                  <td className="pts-sub">{p.ko_points || 0}</td>
                  <td className={`pts-sub ${champNet > 0 ? "pts-champ-win" : champNet < 0 ? "pts-champ-loss" : ""}`}>
                    {champNet > 0 ? `+${champNet}` : champNet === 0 ? "—" : champNet}
                  </td>
                  <td className="points">{p.points || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default Leaderboard;
