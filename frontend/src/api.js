const API = "/api";

export async function adminLogin(username, password) {
  const res = await fetch(`${API}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

export async function adminDeletePool(poolId, username, password) {
  const res = await fetch(`${API}/admin/pools/${poolId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

export async function createPool(name, sport, tournament, password) {
  const res = await fetch(`${API}/pools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, sport, tournament, password }),
  });
  return res.json();
}

export async function joinPool(name, password) {
  const res = await fetch(`${API}/pools/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  return res.json();
}

export async function fetchGroups() {
  const res = await fetch(`${API}/groups`);
  return res.json();
}

export async function fetchMatches() {
  const res = await fetch(`${API}/matches`);
  return res.json();
}

export async function fetchParticipants(poolId) {
  const url = poolId ? `${API}/participants?pool_id=${poolId}` : `${API}/participants`;
  const res = await fetch(url);
  return res.json();
}

export async function createParticipant(name, poolId) {
  const res = await fetch(`${API}/participants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, pool_id: poolId }),
  });
  return res.json();
}

export async function fetchGroupPredictions(participantId) {
  const res = await fetch(`${API}/group-predictions/${participantId}`);
  return res.json();
}

export async function submitGroupPrediction(participant_id, group_id, team1_id, team2_id) {
  const res = await fetch(`${API}/group-predictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id, group_id, team1_id, team2_id }),
  });
  return res.json();
}

export async function fetchStandings() {
  const res = await fetch(`${API}/standings`);
  return res.json();
}

export async function fetchLeaderboard(poolId) {
  const url = poolId ? `${API}/leaderboard?pool_id=${poolId}` : `${API}/leaderboard`;
  const res = await fetch(url);
  return res.json();
}
