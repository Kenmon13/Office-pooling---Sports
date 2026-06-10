const API = "/api";

function getToken() {
  return localStorage.getItem("auth_token");
}

function authHeaders() {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function fetchUserPools() {
  const res = await fetch(`${API}/user/pools`, { headers: authHeaders() });
  return res.json();
}

export async function signUp(username, password, display_name) {
  const res = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, display_name }),
  });
  const data = await res.json();
  if (data.token) localStorage.setItem("auth_token", data.token);
  return data;
}

export async function googleSignIn(token) {
  const res = await fetch(`${API}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await res.json();
  if (data.token) localStorage.setItem("auth_token", data.token);
  return data;
}

export async function signIn(username, password) {
  const res = await fetch(`${API}/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (data.token) localStorage.setItem("auth_token", data.token);
  return data;
}

// ── Profile & Password Reset ─────────────────────────────────────────────────

export async function fetchProfile() {
  const res = await fetch(`${API}/auth/profile`, { headers: authHeaders() });
  return res.json();
}

export async function fetchMyPools() {
  const res = await fetch(`${API}/auth/my-pools`, { headers: authHeaders() });
  return res.json();
}

export async function updateProfile(data) {
  const res = await fetch(`${API}/auth/profile`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function changePassword(current_password, new_password) {
  const res = await fetch(`${API}/auth/change-password`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ current_password, new_password }),
  });
  return res.json();
}

export async function forgotPassword(email) {
  const res = await fetch(`${API}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return res.json();
}

export async function resetPassword(token, password) {
  const res = await fetch(`${API}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  return res.json();
}

// ── Issues ───────────────────────────────────────────────────────────────────

export async function submitIssue(body) {
  const res = await fetch(`${API}/issues`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ body }),
  });
  return res.json();
}

export async function fetchMyIssues() {
  const res = await fetch(`${API}/issues/mine`, { headers: authHeaders() });
  return res.json();
}

export async function fetchIssueReplies(issueId) {
  const res = await fetch(`${API}/issues/${issueId}/replies`, { headers: authHeaders() });
  return res.json();
}

export async function postIssueReply(issueId, body) {
  const res = await fetch(`${API}/issues/${issueId}/replies`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ body }),
  });
  return res.json();
}

export async function adminDeleteReply(issueId, replyId) {
  const res = await fetch(`${API}/issues/${issueId}/replies/${replyId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.json();
}

export async function adminFetchIssues() {
  const res = await fetch(`${API}/admin/issues`, { headers: authHeaders() });
  return res.json();
}

export async function adminUpdateIssue(id, status) {
  const res = await fetch(`${API}/admin/issues/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ status }),
  });
  return res.json();
}

export async function adminDeleteIssue(id) {
  const res = await fetch(`${API}/admin/issues/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
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

export async function adminFetchUsers() {
  const res = await fetch(`${API}/admin/users`, { headers: authHeaders() });
  return res.json();
}

export async function adminFetchUserPools(userId) {
  const res = await fetch(`${API}/admin/users/${userId}/pools`, { headers: authHeaders() });
  return res.json();
}

export async function adminDeleteUser(targetId) {
  const res = await fetch(`${API}/admin/users/${targetId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.json();
}

export async function adminFetchPools() {
  const res = await fetch(`${API}/admin/pools`, { headers: authHeaders() });
  return res.json();
}

export async function adminDeletePool(poolId) {
  const res = await fetch(`${API}/admin/pools/${poolId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.json();
}

export async function createPool(name, sport, tournament, password, is_public) {
  const res = await fetch(`${API}/pools`, {
    method: "POST",
    headers: authHeaders(),
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

export async function fetchPoolPassword(poolId) {
  return (await fetch(`${API}/pools/${poolId}/password`, { headers: authHeaders() })).json();
}

export async function changePoolPassword(poolId, password) {
  const res = await fetch(`${API}/pools/${poolId}/password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ password }),
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

// --- Announcement ---

export async function fetchAnnouncement(tournament) {
  const params = tournament ? `?tournament=${encodeURIComponent(tournament)}` : "";
  const res = await fetch(`${API}/announcement${params}`);
  return res.json();
}

export async function updateAnnouncement(announcements, tournament) {
  const res = await fetch(`${API}/announcement`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ announcements, tournament }),
  });
  return res.json();
}

export async function leavePool(poolId) {
  const res = await fetch(`${API}/pools/${poolId}/leave`, {
    method: "DELETE",
    headers: authHeaders(),
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

export async function submitGroupPredictions(participant_id, predictions) {
  const res = await fetch(`${API}/group-predictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id, predictions }),
  });
  return res.json();
}

// ── Third-Place Qualifier Predictions ─────────────────────────────────────────

export async function fetchThirdPlacePredictions(participantId) {
  const res = await fetch(`${API}/third-place-predictions/${participantId}`);
  return res.json();
}

export async function submitThirdPlacePredictions(participant_id, team_ids) {
  const res = await fetch(`${API}/third-place-predictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id, team_ids }),
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
  const data = await res.json();
  // API returns { groups, thirdQualifiers }
  return data;
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

// ── Player Award Picks ──────────────────────────────────────────────────────

export async function fetchWcPlayers() {
  return (await fetch(`${API}/wc-players`)).json();
}
export async function fetchPlayerAwardPicks(participantId, poolId) {
  return (await fetch(`${API}/player-award-picks/${participantId}?pool_id=${poolId}`)).json();
}
export async function submitPlayerAwardPick(participant_id, award_category, player_id, team_id) {
  const res = await fetch(`${API}/player-award-picks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id, award_category, player_id, team_id }),
  });
  return res.json();
}
export async function fetchPlayerAwardsLock(poolId) {
  return (await fetch(`${API}/pools/${poolId}/player-awards-lock`)).json();
}
export async function updatePlayerAwardsLock(poolId, locked) {
  const res = await fetch(`${API}/pools/${poolId}/player-awards-lock`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ locked }),
  });
  return res.json();
}

export async function fetchExactScoresSetting(poolId) {
  return (await fetch(`${API}/pools/${poolId}/exact-scores`)).json();
}
export async function updateExactScoresSetting(poolId, disabled) {
  const res = await fetch(`${API}/pools/${poolId}/exact-scores`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ disabled }),
  });
  return res.json();
}
export async function fetchGroupStageUnlock(poolId) {
  return (await fetch(`${API}/pools/${poolId}/group-stage-unlock`)).json();
}
export async function updateGroupStageUnlock(poolId, unlocked) {
  const res = await fetch(`${API}/pools/${poolId}/group-stage-unlock`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ unlocked }),
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

// ── Pool Chat ────────────────────────────────────────────────────────────────

export async function fetchMessages(poolId, afterId = 0) {
  const url = afterId ? `${API}/pools/${poolId}/messages?after=${afterId}` : `${API}/pools/${poolId}/messages`;
  return (await fetch(url)).json();
}

export async function sendMessage(poolId, body) {
  const res = await fetch(`${API}/pools/${poolId}/messages`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ body }),
  });
  return res.json();
}

// ── Pool Admin Management ────────────────────────────────────────────────────

export async function fetchPoolAdmins(poolId) {
  return (await fetch(`${API}/pools/${poolId}/admins`, { headers: authHeaders() })).json();
}

export async function addPoolAdmin(poolId, userId) {
  const res = await fetch(`${API}/pools/${poolId}/admins`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ user_id: userId }),
  });
  return res.json();
}

export async function kickPoolMember(poolId, userId) {
  const res = await fetch(`${API}/pools/${poolId}/kick/${userId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.json();
}

export async function updateChatStatus(poolId, closed) {
  const res = await fetch(`${API}/pools/${poolId}/chat-status`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ closed }),
  });
  return res.json();
}

export async function fetchChampionW2Lock(poolId) {
  return (await fetch(`${API}/pools/${poolId}/champion-w2-lock`)).json();
}

export async function updateChampionW2Lock(poolId, locked) {
  const res = await fetch(`${API}/pools/${poolId}/champion-w2-lock`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ locked }),
  });
  return res.json();
}

// ── Admin test pool ───────────────────────────────────────────────────────────

export async function adminFetchTestPools() {
  return (await fetch(`${API}/admin/test/pools`, { headers: authHeaders() })).json();
}
// ── Backup & Restore ─────────────────────────────────────────────────────────

export async function adminDownloadBackup() {
  const res = await fetch(`${API}/admin/backup`, { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Backup download failed");
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `sportspooling-backup-${new Date().toISOString().slice(0, 10)}.db`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function adminSaveBackup() {
  const res = await fetch(`${API}/admin/backup/save`, { method: "POST", headers: authHeaders() });
  return res.json();
}

export async function adminListBackups() {
  const res = await fetch(`${API}/admin/backup/list`, { headers: authHeaders() });
  return res.json();
}

export async function adminDeleteBackup(name) {
  const res = await fetch(`${API}/admin/backup/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.json();
}

export async function adminRestoreFromUpload(file) {
  const token = getToken();
  const res = await fetch(`${API}/admin/restore`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  return res.json();
}

export async function adminRestoreFromBackup(name) {
  const res = await fetch(`${API}/admin/restore/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: authHeaders(),
  });
  return res.json();
}

export async function adminCreateTestPool(name, password) {
  const res = await fetch(`${API}/admin/test/pool`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name, password }),
  });
  return res.json();
}
export async function adminAddTestParticipants(poolId, count) {
  const res = await fetch(`${API}/admin/test/pool/${poolId}/participants`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ count }),
  });
  return res.json();
}
export async function adminRandomizePicks(poolId) {
  const res = await fetch(`${API}/admin/test/pool/${poolId}/randomize-picks`, {
    method: "POST",
    headers: authHeaders(),
  });
  return res.json();
}
export async function adminSetMockDate(poolId, mock_date) {
  const res = await fetch(`${API}/admin/test/pool/${poolId}/mock-date`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ mock_date }),
  });
  return res.json();
}
export async function adminClearMockDate(poolId) {
  const res = await fetch(`${API}/admin/test/pool/${poolId}/mock-date`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.json();
}

export async function fetchGlobalStats(tournament) {
  const res = await fetch(`${API}/stats/global?tournament=${tournament}`, { headers: authHeaders() });
  return res.json();
}

export async function fetchGroupPickStats(poolId) {
  const res = await fetch(`${API}/stats/group-picks?pool_id=${poolId}`, { headers: authHeaders() });
  return res.json();
}

export async function fetchChampionPickStats(poolId) {
  const res = await fetch(`${API}/stats/champion-picks?pool_id=${poolId}`, { headers: authHeaders() });
  return res.json();
}

export async function fetchAwardPickStats(poolId) {
  const res = await fetch(`${API}/stats/award-picks?pool_id=${poolId}`, { headers: authHeaders() });
  return res.json();
}
