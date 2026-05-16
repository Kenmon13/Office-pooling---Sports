const API = "/api";

export async function signUp(username, password, display_name) {
  const res = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, display_name }),
  });
  return res.json();
}

export async function signIn(username, password) {
  const res = await fetch(`${API}/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

export async function autoJoinPool(user_id, pool_id) {
  const res = await fetch(`${API}/participants/auto-join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id, pool_id }),
  });
  return res.json();
}

export async function adminFetchUsers(userId) {
  const res = await fetch(`${API}/admin/users?user_id=${userId}`);
  return res.json();
}

export async function adminDeleteUser(targetId, userId) {
  const res = await fetch(`${API}/admin/users/${targetId}?user_id=${userId}`, {
    method: "DELETE",
  });
  return res.json();
}

export async function adminFetchPools(userId) {
  const res = await fetch(`${API}/admin/pools?user_id=${userId}`);
  return res.json();
}

export async function adminDeletePool(poolId, userId) {
  const res = await fetch(`${API}/admin/pools/${poolId}?user_id=${userId}`, {
    method: "DELETE",
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

export async function fetchKnockoutMatches() {
  const res = await fetch(`${API}/knockout-matches`);
  return res.json();
}

export async function fetchKnockoutPredictions(participantId) {
  const res = await fetch(`${API}/knockout-predictions/${participantId}`);
  return res.json();
}

export async function submitKnockoutPrediction(participant_id, match_id, predicted_winner) {
  const res = await fetch(`${API}/knockout-predictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id, match_id, predicted_winner }),
  });
  return res.json();
}

export async function fetchPredictionDeadline() {
  const res = await fetch(`${API}/prediction-deadline`);
  return res.json();
}

export async function fetchKnockoutDeadline() {
  const res = await fetch(`${API}/knockout-deadline`);
  return res.json();
}

export async function fetchParticipantPoints(participantId, poolId) {
  const res = await fetch(`${API}/leaderboard?pool_id=${poolId}`);
  const data = await res.json();
  const me = data.find((p) => p.id === participantId);
  return me ? me.points : 0;
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
