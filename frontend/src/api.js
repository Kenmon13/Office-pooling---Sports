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

export async function createPool(name, sport, tournament, password, is_public) {
  const res = await fetch(`${API}/pools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, sport, tournament, password, is_public }),
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

export async function fetchPoolById(poolId) {
  const res = await fetch(`${API}/pools/${poolId}`);
  return res.json();
}

export async function joinPoolById(pool_id, password) {
  const res = await fetch(`${API}/pools/join-by-id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pool_id, password }),
  });
  return res.json();
}

export async function fetchPublicPools(sport, tournament) {
  const params = new URLSearchParams();
  if (sport) params.set("sport", sport);
  if (tournament) params.set("tournament", tournament);
  const res = await fetch(`${API}/pools/public?${params}`);
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

export async function submitKnockoutPrediction(participant_id, match_id, predicted_winner, predicted_home_score, predicted_away_score) {
  const res = await fetch(`${API}/knockout-predictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id, match_id, predicted_winner, predicted_home_score: predicted_home_score ?? null, predicted_away_score: predicted_away_score ?? null }),
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

// ── WC2022 ────────────────────────────────────────────────────────────────────

export async function fetchWC2022Groups() {
  return (await fetch(`${API}/wc2022/groups`)).json();
}
export async function fetchWC2022Matches(poolId) {
  return (await fetch(`${API}/wc2022/matches?pool_id=${poolId}`)).json();
}
export async function fetchWC2022Standings(poolId) {
  return (await fetch(`${API}/wc2022/standings?pool_id=${poolId}`)).json();
}
export async function fetchWC2022KnockoutMatches(poolId) {
  return (await fetch(`${API}/wc2022/knockout-matches?pool_id=${poolId}`)).json();
}
export async function fetchWC2022KnockoutDeadline(poolId) {
  return (await fetch(`${API}/wc2022/knockout-deadline?pool_id=${poolId}`)).json();
}
export async function fetchWC2022GroupPredictions(participantId) {
  return (await fetch(`${API}/wc2022/group-predictions/${participantId}`)).json();
}
export async function submitWC2022GroupPrediction(participant_id, group_id, team1_id, team2_id) {
  const res = await fetch(`${API}/wc2022/group-predictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id, group_id, team1_id, team2_id }),
  });
  return res.json();
}
export async function fetchWC2022KnockoutPredictions(participantId) {
  return (await fetch(`${API}/wc2022/knockout-predictions/${participantId}`)).json();
}
export async function submitWC2022KnockoutPrediction(participant_id, match_id, predicted_winner, predicted_home_score, predicted_away_score) {
  const res = await fetch(`${API}/wc2022/knockout-predictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id, match_id, predicted_winner, predicted_home_score: predicted_home_score ?? null, predicted_away_score: predicted_away_score ?? null }),
  });
  return res.json();
}
export async function fetchWC2022Leaderboard(poolId) {
  return (await fetch(`${API}/wc2022/leaderboard?pool_id=${poolId}`)).json();
}
export async function fetchWC2022PredictionDeadline(poolId) {
  return (await fetch(`${API}/wc2022/prediction-deadline?pool_id=${poolId}`)).json();
}

// ── Champion Picks ────────────────────────────────────────────────────────────

export async function fetchWC2022ChampionPick(participantId, poolId) {
  return (await fetch(`${API}/wc2022/champion-pick/${participantId}?pool_id=${poolId}`)).json();
}
export async function submitWC2022ChampionPick(participant_id, team_id, pool_id) {
  const res = await fetch(`${API}/wc2022/champion-pick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id, team_id, pool_id }),
  });
  return res.json();
}
export async function fetchChampionPick(participantId, poolId) {
  return (await fetch(`${API}/champion-pick/${participantId}?pool_id=${poolId}`)).json();
}
export async function submitChampionPick(participant_id, team_id) {
  const res = await fetch(`${API}/champion-pick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id, team_id }),
  });
  return res.json();
}

// ── History ───────────────────────────────────────────────────────────────────

export async function fetchWC2022History(participantId, poolId) {
  return (await fetch(`${API}/wc2022/history/${participantId}?pool_id=${poolId}`)).json();
}
export async function fetchHistory(participantId, poolId) {
  const url = poolId ? `${API}/history/${participantId}?pool_id=${poolId}` : `${API}/history/${participantId}`;
  return (await fetch(url)).json();
}

// ── Admin test pool ───────────────────────────────────────────────────────────

export async function adminFetchTestPools(userId) {
  return (await fetch(`${API}/admin/test/pools?user_id=${userId}`)).json();
}
export async function adminCreateTestPool(userId, name, password) {
  const res = await fetch(`${API}/admin/test/pool?user_id=${userId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  return res.json();
}
export async function adminAddTestParticipants(userId, poolId, count) {
  const res = await fetch(`${API}/admin/test/pool/${poolId}/participants?user_id=${userId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count }),
  });
  return res.json();
}
export async function adminRandomizePicks(userId, poolId) {
  const res = await fetch(`${API}/admin/test/pool/${poolId}/randomize-picks?user_id=${userId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return res.json();
}
export async function adminSetMockDate(userId, poolId, mock_date) {
  const res = await fetch(`${API}/admin/test/pool/${poolId}/mock-date?user_id=${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mock_date }),
  });
  return res.json();
}
export async function adminClearMockDate(userId, poolId) {
  const res = await fetch(`${API}/admin/test/pool/${poolId}/mock-date?user_id=${userId}`, {
    method: "DELETE",
  });
  return res.json();
}
