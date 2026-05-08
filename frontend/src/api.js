const API = "/api";

export async function fetchGroups() {
  const res = await fetch(`${API}/groups`);
  return res.json();
}

export async function fetchMatches() {
  const res = await fetch(`${API}/matches`);
  return res.json();
}

export async function fetchParticipants() {
  const res = await fetch(`${API}/participants`);
  return res.json();
}

export async function createParticipant(name) {
  const res = await fetch(`${API}/participants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function fetchPredictions(participantId) {
  const res = await fetch(`${API}/predictions/${participantId}`);
  return res.json();
}

export async function submitPrediction(participant_id, match_id, predicted_outcome) {
  const res = await fetch(`${API}/predictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id, match_id, predicted_outcome }),
  });
  return res.json();
}

export async function updateMatch(id, home_score, away_score, status) {
  const res = await fetch(`${API}/matches/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ home_score, away_score, status }),
  });
  return res.json();
}

export async function fetchLeaderboard() {
  const res = await fetch(`${API}/leaderboard`);
  return res.json();
}
