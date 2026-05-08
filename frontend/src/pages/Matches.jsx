import { useState, useEffect } from "react";
import { fetchMatches, fetchGroups } from "../api";

function Matches() {
  const [matches, setMatches] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState("all");

  useEffect(() => {
    fetchMatches().then(setMatches);
    fetchGroups().then(setGroups);
  }, []);

  const filtered =
    selectedGroup === "all"
      ? matches
      : matches.filter((m) => m.group_name === selectedGroup);

  const groupedByGroup = filtered.reduce((acc, m) => {
    if (!acc[m.group_name]) acc[m.group_name] = [];
    acc[m.group_name].push(m);
    return acc;
  }, {});

  return (
    <div className="page">
      <h2>Group Stage Matches</h2>

      <div className="filter-bar">
        <label>Filter by group: </label>
        <select
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}
        >
          <option value="all">All Groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.name}>
              Group {g.name}
            </option>
          ))}
        </select>
      </div>

      {Object.entries(groupedByGroup).map(([groupName, groupMatches]) => (
        <div key={groupName} className="group-section">
          <h3>Group {groupName}</h3>

          <div className="standings-table">
            <table>
              <thead>
                <tr>
                  <th>Team</th>
                </tr>
              </thead>
              <tbody>
                {groups
                  .find((g) => g.name === groupName)
                  ?.teams.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {t.name} ({t.code})
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="match-list">
            {groupMatches.map((m) => (
              <div key={m.id} className={`match-card ${m.status}`}>
                <div className="match-date">{m.match_date}</div>
                <div className="match-teams">
                  <span className="team home">{m.home_team}</span>
                  <span className="vs">
                    {m.status === "finished"
                      ? `${m.home_score} - ${m.away_score}`
                      : "vs"}
                  </span>
                  <span className="team away">{m.away_team}</span>
                </div>
                <div className={`match-status ${m.status}`}>{m.status}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default Matches;
