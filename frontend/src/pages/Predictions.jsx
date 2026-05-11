import { useState, useEffect } from "react";
import { fetchGroups, fetchGroupPredictions, submitGroupPrediction, fetchStandings } from "../api";
import { flag } from "../flags";
import Bracket from "../components/Bracket";

function Predictions({ currentUser }) {
  const [groups, setGroups] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [selections, setSelections] = useState({});
  const [standings, setStandings] = useState({});
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    fetchGroups().then(setGroups);
    fetchStandings().then((data) => {
      const map = {};
      data.forEach((g) => { map[g.id] = g; });
      setStandings(map);
    });
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchGroupPredictions(currentUser.id).then((preds) => {
        const map = {};
        const sel = {};
        preds.forEach((p) => {
          map[p.group_id] = p;
          sel[p.group_id] = [p.team1_id, p.team2_id];
        });
        setPredictions(map);
        setSelections(sel);
      });
    }
  }, [currentUser]);

  if (!currentUser) {
    return (
      <div className="page">
        <h2>My Predictions</h2>
        <p className="notice">Join the pool first to make predictions.</p>
      </div>
    );
  }

  const toggleTeam = (groupId, teamId) => {
    setSelections((prev) => {
      const current = prev[groupId] || [];
      if (current.includes(teamId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== teamId) };
      }
      if (current.length >= 2) {
        return { ...prev, [groupId]: [current[1], teamId] };
      }
      return { ...prev, [groupId]: [...current, teamId] };
    });
  };

  const handleSave = async (groupId) => {
    const picked = selections[groupId] || [];
    if (picked.length !== 2) return;
    setSaving(groupId);
    await submitGroupPrediction(currentUser.id, groupId, picked[0], picked[1]);
    // Refresh predictions
    const preds = await fetchGroupPredictions(currentUser.id);
    const map = {};
    preds.forEach((p) => { map[p.group_id] = p; });
    setPredictions(map);
    setSaving(null);
  };

  const getScore = (groupId) => {
    const pred = predictions[groupId];
    const standing = standings[groupId];
    if (!pred || !standing || standing.qualified.length === 0) return null;
    const picked = [pred.team1_id, pred.team2_id];
    const correct = picked.filter((t) => standing.qualified.includes(t)).length;
    if (correct === 2) return { points: 5, label: "Both correct", cls: "correct" };
    if (correct === 1) return { points: 2, label: "1 correct", cls: "half" };
    return { points: 0, label: "0 correct", cls: "wrong" };
  };

  return (
    <div className="page">
      <h2>My Predictions</h2>
      <p className="select-subtitle" style={{ marginBottom: 24 }}>
        Pick 2 teams to advance from each group. Both correct = 5 pts, one correct = 2 pts.
      </p>

      <div className="group-pred-list">
        {groups.map((g) => {
          const picked = selections[g.id] || [];
          const saved = predictions[g.id];
          const score = getScore(g.id);
          const hasChanged = saved
            ? !(picked.length === 2 && [saved.team1_id, saved.team2_id].sort().join() === [...picked].sort().join())
            : picked.length === 2;

          return (
            <div key={g.id} className={`group-pred-card ${score ? score.cls : ""}`}>
              <div className="group-pred-header">
                <span className="group-badge">Group {g.name}</span>
                {score && (
                  <span className={`result-badge ${score.cls}`}>
                    {score.label} &middot; +{score.points} pts
                  </span>
                )}
              </div>
              <div className="group-pred-teams">
                {g.teams.map((t) => (
                  <button
                    key={t.id}
                    className={`group-team-btn ${picked.includes(t.id) ? "selected" : ""}`}
                    onClick={() => toggleTeam(g.id, t.id)}
                  >
                    {flag(t.code)} {t.name}
                  </button>
                ))}
              </div>
              <div className="group-pred-footer">
                {saved && !hasChanged && (
                  <span className="saved-label">Saved</span>
                )}
                {picked.length === 2 && hasChanged && (
                  <button
                    className="btn-submit"
                    onClick={() => handleSave(g.id)}
                    disabled={saving === g.id}
                  >
                    {saving === g.id ? "Saving..." : saved ? "Update" : "Save"}
                  </button>
                )}
                {picked.length < 2 && (
                  <span className="pick-hint">Pick {2 - picked.length} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <h3 style={{ marginTop: 40 }}>Knockout Bracket</h3>
      <Bracket />
    </div>
  );
}

export default Predictions;
