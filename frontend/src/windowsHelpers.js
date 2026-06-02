import {
  fetchUserPools,
  fetchGroupPredictions, fetchWC2022GroupPredictions,
  fetchGroups, fetchWC2022Groups,
  fetchThirdPlacePredictions,
  fetchPredictionDeadline, fetchWC2022PredictionDeadline,
  fetchKnockoutMatches, fetchWC2022KnockoutMatches,
  fetchKnockoutDeadline, fetchWC2022KnockoutDeadline,
  fetchKnockoutPredictions, fetchWC2022KnockoutPredictions,
  fetchChampionPick, fetchWC2022ChampionPick,
} from "./api";

export const ROUND_ORDER = {
  "Round of 32": 1, "Round of 16": 2,
  "Quarter-finals": 3, "Semi-finals": 4,
  "Third Place": 5, "Final": 6,
};

export function fmtDate(d) {
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function toDate(str) {
  if (!str) return null;
  return new Date(str.replace(" ", "T") + (str.includes("Z") ? "" : "Z"));
}

export function dismissWindowCards(cardIds, poolId) {
  if (!poolId || !cardIds || !cardIds.length) return;
  try {
    const key = `dismissed_window_cards_${poolId}`;
    const saved = localStorage.getItem(key);
    const existing = new Set(saved ? JSON.parse(saved) : []);
    cardIds.forEach((id) => existing.add(id));
    localStorage.setItem(key, JSON.stringify([...existing]));
  } catch { /* ignore */ }
}

export function applyDismissals(sections, poolId) {
  if (!poolId) return sections;
  try {
    const saved = localStorage.getItem(`dismissed_window_cards_${poolId}`);
    const dismissed = new Set(saved ? JSON.parse(saved) : []);
    if (dismissed.size === 0) return sections;
    const downgrade = (c) =>
      dismissed.has(c.id) && c.status === "orange" ? { ...c, status: "done" } : c;
    return {
      ...sections,
      group: sections.group.map(downgrade),
      winner: sections.winner.map(downgrade),
      ko: sections.ko.map(downgrade),
    };
  } catch { return sections; }
}

export function generateSections(now, { predDeadline, koMatches, groups, koDeadline, poolPicksData }) {
  const totalPools = poolPicksData.length;
  const isSingle = totalPools === 1;
  const groupStageComplete = koDeadline?.groupStageComplete ?? false;
  const dl = predDeadline?.deadline ? toDate(predDeadline.deadline) : null;
  const groupWindowPast = predDeadline?.locked ?? (dl ? now >= dl : false);

  const poolStatusNote = (pickedCount) => {
    if (isSingle || pickedCount === 0) return null;
    return pickedCount === totalPools ? `All ${totalPools} pools picked` : `${pickedCount}/${totalPools} pools picked`;
  };

  // ── Group Stage ─────────────────────────────────────────────────────────────

  const groupCards = [];
  if (dl || (groups && groups.length > 0)) {
    const poolMissing = poolPicksData.map((pp) => {
      const pickedIds = new Set((pp.groupPreds || []).map((g) => g.group_id));
      const missing = (groups || []).filter((g) => !pickedIds.has(g.id));
      return { pool: pp.pool, missing, pickedCount: pickedIds.size };
    });

    const poolsWithMissing = poolMissing.filter((x) => x.missing.length > 0);
    const allComplete = poolsWithMissing.length === 0;

    let status, missingMsg;
    if (allComplete) {
      status = "done";
      missingMsg = null;
    } else if (groupWindowPast) {
      status = "gray";
      missingMsg = null;
    } else {
      status = "red";
      if (isSingle) {
        const { missing, pickedCount } = poolMissing[0];
        missingMsg = pickedCount === 0
          ? "No picks made"
          : `Missing: ${missing.map((g) => g.name).join(", ")}`;
      } else {
        missingMsg = `Missing in: ${poolsWithMissing.map((x) => x.pool.name).join(", ")}`;
      }
    }

    const pickedPools = totalPools - poolsWithMissing.length;
    const statusNote = !isSingle && pickedPools > 0 ? `${pickedPools}/${totalPools} pools complete` : null;

    groupCards.push({
      id: "group-stage",
      icon: "⚽",
      status,
      title: "Group Stage Predictions",
      body: dl
        ? (groupWindowPast ? `Closed ${fmtDate(dl)}` : `Closes ${fmtDate(dl)}`)
        : "Group stage predictions",
      time: dl,
      missingMsg,
      statusNote,
    });

    // Third-place qualifier card (WC2026 only — null means WC2022 pool)
    const hasThirdPlace = poolPicksData.some((pp) => pp.thirdPlacePreds !== null);
    if (hasThirdPlace) {
      const poolsThirdInfo = poolPicksData
        .filter((pp) => pp.thirdPlacePreds !== null)
        .map((pp) => {
          const top2 = new Set((pp.groupPreds || []).flatMap((g) => [g.team1_id, g.team2_id]));
          const effective = pp.thirdPlacePreds.filter((t) => !top2.has(t.team_id));
          return { pool: pp.pool, effectiveCount: effective.length };
        });
      const poolsMissingThird = poolsThirdInfo.filter((x) => x.effectiveCount < 8);
      const allThirdComplete = poolsMissingThird.length === 0;

      let thirdStatus, thirdMissingMsg;
      if (allThirdComplete) {
        thirdStatus = "done";
        thirdMissingMsg = null;
      } else if (groupWindowPast) {
        thirdStatus = "gray";
        thirdMissingMsg = null;
      } else {
        thirdStatus = "red";
        if (isSingle) {
          const { effectiveCount } = poolsMissingThird[0];
          thirdMissingMsg = effectiveCount === 0
            ? "No picks made"
            : `${effectiveCount}/8 picks made — pick ${8 - effectiveCount} more`;
        } else {
          thirdMissingMsg = `Missing in: ${poolsMissingThird.map((x) => x.pool.name).join(", ")}`;
        }
      }

      const thirdPickedPools = totalPools - poolsMissingThird.length;
      const thirdStatusNote = !isSingle && thirdPickedPools > 0
        ? `${thirdPickedPools}/${totalPools} pools complete`
        : null;

      groupCards.push({
        id: "third-place",
        icon: "⚽",
        status: thirdStatus,
        title: "Third-Place Qualifiers",
        body: dl
          ? (groupWindowPast ? `Closed ${fmtDate(dl)}` : `Closes ${fmtDate(dl)}`)
          : "Pick 8 third-place qualifiers",
        time: dl,
        missingMsg: thirdMissingMsg,
        statusNote: thirdStatusNote,
      });
    }
  }

  // ── Winner Pick ─────────────────────────────────────────────────────────────

  const winnerCards = [];
  const champRef = poolPicksData[0]?.champStatus;
  if (champRef !== undefined && champRef !== null) {
    const notPicked = poolPicksData.filter((pp) => !pp.champStatus?.pick);
    const pickedCount = totalPools - notPicked.length;
    const statusNote = poolStatusNote(pickedCount);
    const anyMissing = notPicked.length > 0;
    const missingInPools = anyMissing
      ? (isSingle ? null : `Missing in: ${notPicked.map((pp) => pp.pool.name).join(", ")}`)
      : null;

    if (champRef.canInitialPick) {
      winnerCards.push({
        id: "champion-initial",
        icon: "🏆",
        status: anyMissing ? "red" : "done",
        title: "Winner Pick",
        body: dl ? `Window closes ${fmtDate(dl)}` : "Pick your tournament winner",
        time: dl || now,
        missingMsg: anyMissing ? (isSingle ? "No pick made yet" : missingInPools) : null,
        statusNote,
      });
    } else if (champRef.canChange && groupStageComplete) {
      winnerCards.push({
        id: "champion-change",
        icon: "🔄",
        status: "orange",
        title: "Winner Pick — Change Window Open",
        body: champRef.changeCost > 0 ? `First change costs −${champRef.changeCost} pts` : "Free to change your pick",
        time: now,
        missingMsg: null,
        statusNote,
        isChangeWindow: true,
      });
    } else if (champRef.canChange && !groupStageComplete) {
      winnerCards.push({
        id: "champion-initial-picked",
        icon: "🏆",
        status: "done",
        title: "Winner Pick",
        body: dl ? `Window closes ${fmtDate(dl)}` : "Pick submitted",
        time: dl || now,
        missingMsg: null,
        statusNote,
      });
    } else if (champRef.locked) {
      winnerCards.push({
        id: "champion-locked",
        icon: "🔒",
        status: "locked",
        title: "Winner Pick — Locked",
        body: "Group stage in progress — change window reopens after last group match",
        time: dl || now,
        missingMsg: null,
        statusNote: null,
      });
    } else {
      winnerCards.push({
        id: "champion-closed",
        icon: "🏆",
        status: anyMissing ? "gray" : "done",
        title: "Winner Pick",
        body: "All pick windows closed",
        time: dl || new Date(0),
        missingMsg: anyMissing ? (isSingle ? "No pick was made" : missingInPools) : null,
        statusNote,
      });
    }
  }

  // ── Knockout Stage ──────────────────────────────────────────────────────────

  const koCards = [];
  const openMatchIdSet = new Set(koDeadline?.openMatchIds || []);
  const hasKnownTeams = (koMatches || []).some((m) => m.home_team_name && m.away_team_name);
  const showKO = groupStageComplete || hasKnownTeams;

  if (showKO) {
    const sorted = [...(koMatches || [])].sort((a, b) => {
      const diff = (ROUND_ORDER[a.round] || 99) - (ROUND_ORDER[b.round] || 99);
      return diff !== 0 ? diff : (a.match_date || "").localeCompare(b.match_date || "");
    });

    for (const match of sorted) {
      // Skip matches where teams aren't decided yet — no notification until teams are known
      if (!match.home_team_name || !match.away_team_name) continue;

      const home = match.home_team_name;
      const away = match.away_team_name;
      const kickoff = toDate(match.match_date);
      // Use openMatchIds (server-computed, respects mock date) to determine open vs past
      const isOpen = openMatchIdSet.has(match.id);
      const past = !isOpen && (match.status === "finished" || match.status === "live" || (kickoff && now >= kickoff));
      const notPicked = poolPicksData.filter(
        (pp) => !(pp.koPreds || []).some((p) => p.match_id === match.id)
      );
      const noScore = poolPicksData.filter((pp) => {
        const pred = (pp.koPreds || []).find((p) => p.match_id === match.id);
        return pred && pred.predicted_home_score === null && pred.predicted_away_score === null;
      });
      const allPicked = notPicked.length === 0;
      const allComplete = allPicked && noScore.length === 0;
      const pickedCount = totalPools - notPicked.length;
      const statusNote = poolStatusNote(pickedCount);

      let status, missingMsg;
      if (allComplete) {
        status = "done";
        missingMsg = null;
      } else if (past) {
        status = "gray";
        if (isSingle) {
          missingMsg = !allPicked ? "No pick was made" : "Score not entered";
        } else {
          const missingPools = new Set([...notPicked.map((pp) => pp.pool.name), ...noScore.map((pp) => pp.pool.name)]);
          missingMsg = `Missing in: ${[...missingPools].join(", ")}`;
        }
      } else {
        status = "red";
        if (isSingle) {
          missingMsg = !allPicked ? "Pick and score not entered" : "Score not entered";
        } else {
          const parts = [];
          if (notPicked.length > 0) parts.push(`Pick missing in: ${notPicked.map((pp) => pp.pool.name).join(", ")}`);
          if (noScore.length > 0) parts.push(`Score missing in: ${noScore.map((pp) => pp.pool.name).join(", ")}`);
          missingMsg = parts.join(" · ");
        }
      }

      koCards.push({
        id: `ko-${match.id}`,
        icon: "🥊",
        status,
        title: `${match.round}: ${home} vs ${away}`,
        body: kickoff
          ? (past ? `Closed ${fmtDate(kickoff)}` : `Closes ${fmtDate(kickoff)}`)
          : "Window open",
        time: kickoff,
        missingMsg,
        statusNote,
      });
    }

    if (groupStageComplete && koCards.length === 0) {
      koCards.push({
        id: "ko-opening-soon",
        icon: "🥊",
        status: "upcoming",
        title: "Knockout Stage — Opening Soon",
        body: "Group stage complete — knockout matches are being determined",
        time: now,
        missingMsg: null,
        statusNote: null,
      });
    }
  }

  // Before group stage: single hint so users know KO predictions are coming
  if (!groupStageComplete && koCards.length === 0) {
    koCards.push({
      id: "ko-pending-group",
      icon: "🥊",
      status: "upcoming",
      title: "Knockout Stage — Opens After Group Stage",
      body: "Knockout predictions will open once all group matches are complete",
      time: null,
      missingMsg: null,
      statusNote: null,
    });
  }

  return { group: groupCards, winner: winnerCards, ko: koCards, showKO: showKO || koCards.length > 0 };
}

export function countUnread(sections) {
  const all = [
    ...(sections?.group || []),
    ...(sections?.winner || []),
    ...(sections?.ko || []),
  ];
  return all.filter((c) => c.status === "red" || c.status === "orange").length;
}

export async function fetchWindowsForPool(p) {
  const isWC22 = p.tournament === "wc2022";
  const fetchDeadline = isWC22 ? () => fetchWC2022PredictionDeadline(p.id) : fetchPredictionDeadline;
  const fetchKoMatchesFn = isWC22 ? () => fetchWC2022KnockoutMatches(p.id) : fetchKnockoutMatches;
  const fetchGroupsFn = isWC22 ? fetchWC2022Groups : fetchGroups;
  const fetchKoDeadlineFn = isWC22 ? () => fetchWC2022KnockoutDeadline(p.id) : fetchKnockoutDeadline;
  const fetchGroupPreds = isWC22
    ? () => fetchWC2022GroupPredictions(p.participant_id)
    : () => fetchGroupPredictions(p.participant_id);
  const fetchKoPreds = isWC22
    ? () => fetchWC2022KnockoutPredictions(p.participant_id)
    : () => fetchKnockoutPredictions(p.participant_id);
  const fetchChamp = isWC22
    ? () => fetchWC2022ChampionPick(p.participant_id, p.id)
    : () => fetchChampionPick(p.participant_id, p.id);
  const fetchThirdPreds = isWC22
    ? () => Promise.resolve(null)
    : () => fetchThirdPlacePredictions(p.participant_id);

  const [predDeadline, koMatches, groups, koDeadline, groupPreds, koPreds, champStatus, thirdPlacePreds] =
    await Promise.all([
      fetchDeadline(),
      fetchKoMatchesFn(),
      fetchGroupsFn().catch(() => []),
      fetchKoDeadlineFn().catch(() => ({})),
      fetchGroupPreds(),
      fetchKoPreds(),
      fetchChamp(),
      fetchThirdPreds().catch(() => null),
    ]);

  return {
    predDeadline,
    koMatches: Array.isArray(koMatches) ? koMatches : [],
    groups: Array.isArray(groups) ? groups : [],
    koDeadline: koDeadline || {},
    groupPreds: Array.isArray(groupPreds) ? groupPreds : [],
    koPreds: Array.isArray(koPreds) ? koPreds : [],
    champStatus,
    thirdPlacePreds: thirdPlacePreds === null ? null : (Array.isArray(thirdPlacePreds) ? thirdPlacePreds : []),
  };
}

export async function computeWindowsUnreadCount() {
  const pools = await fetchUserPools().catch(() => []);
  if (!Array.isArray(pools) || pools.length === 0) return 0;

  const byTournament = {};
  for (const p of pools) {
    if (!byTournament[p.tournament]) byTournament[p.tournament] = [];
    byTournament[p.tournament].push(p);
  }

  const now = new Date();
  const hasAlert = (c) => c.status === "red" || c.status === "orange";
  let total = 0;

  for (const tourId of Object.keys(byTournament)) {
    const tourPools = byTournament[tourId];
    const firstPool = tourPools[0];
    const shared = await fetchWindowsForPool(firstPool).catch(() => null);
    if (!shared) continue;

    const perPoolPicks = await Promise.all(
      tourPools.map(async (p) => {
        if (p.id === firstPool.id) {
          return { pool: p, groupPreds: shared.groupPreds, koPreds: shared.koPreds, champStatus: shared.champStatus, thirdPlacePreds: shared.thirdPlacePreds };
        }
        const data = await fetchWindowsForPool(p).catch(() => ({ groupPreds: [], koPreds: [], champStatus: null, thirdPlacePreds: null }));
        return { pool: p, groupPreds: data.groupPreds, koPreds: data.koPreds, champStatus: data.champStatus, thirdPlacePreds: data.thirdPlacePreds };
      })
    );

    for (const pp of perPoolPicks) {
      const ps = generateSections(now, {
        predDeadline: shared.predDeadline,
        koMatches: shared.koMatches,
        groups: shared.groups,
        koDeadline: shared.koDeadline,
        poolPicksData: [pp],
      });
      const dismissed = applyDismissals(ps, pp.pool.id);
      total += dismissed.group.filter(hasAlert).length;
      total += dismissed.winner.filter(hasAlert).length;
      if (dismissed.ko.some(hasAlert)) total += 1;
    }
  }

  return total;
}
