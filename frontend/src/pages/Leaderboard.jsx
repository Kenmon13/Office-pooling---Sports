import { useState, useEffect } from "react";
import { fetchLeaderboard, fetchWC2022Leaderboard } from "../api";

function Leaderboard({ poolId, tournament = "wc2026" }) {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    const fetchFn = tournament === "wc2022" ? fetchWC2022Leaderboard : fetchLeaderboard;
    fetchFn(poolId).then(setLeaderboard);
  }, [poolId, tournament]);

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
              <th>Name</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((p, i) => (
              <tr key={p.id} className={i < 3 ? `rank-${i + 1}` : ""}>
                <td className="rank">{i + 1}</td>
                <td className="name">{p.name}</td>
                <td className="points">{p.points || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default Leaderboard;
