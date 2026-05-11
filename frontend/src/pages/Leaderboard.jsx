import { useState, useEffect } from "react";
import { fetchLeaderboard } from "../api";

function Leaderboard({ poolId }) {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    fetchLeaderboard(poolId).then(setLeaderboard);
  }, [poolId]);

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
              <th>Groups</th>
              <th>Exact</th>
              <th>Half</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((p, i) => (
              <tr key={p.id} className={i < 3 ? `rank-${i + 1}` : ""}>
                <td className="rank">{i + 1}</td>
                <td className="name">{p.name}</td>
                <td>{p.groups_predicted || 0}</td>
                <td>{p.groups_correct || 0}</td>
                <td>{p.groups_half || 0}</td>
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
