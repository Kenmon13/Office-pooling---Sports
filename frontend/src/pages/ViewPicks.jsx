import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  fetchGroupPredictions, fetchKnockoutPredictions, fetchChampionPick,
  fetchWC2022GroupPredictions, fetchWC2022KnockoutPredictions, fetchWC2022ChampionPick,
  fetchGroups, fetchWC2022Groups, fetchKnockoutMatches, fetchWC2022KnockoutMatches,
  fetchLeaderboard, fetchWC2022Leaderboard, fetchPlayerAwardPicks,
} from "../api";
import { flag } from "../flags";

const AWARDS = [
  { key: "golden_ball",  label: "Golden Ball",           emoji: "🥇" },
  { key: "golden_boot",  label: "Golden Boot",           emoji: "👟" },
  { key: "golden_glove", label: "Golden Glove",          emoji: "🧤" },
  { key: "young_player", label: "FIFA Young Player",     emoji: "🌟" },
  { key: "fair_play",    label: "FIFA Fair Play Trophy",  emoji: "🤝" },
];

function ViewPicks({ poolId, tournament = "wc2026", currentUser }) {
  const { participantId } = useParams();
  const navigate = useNavigate();
  const isWC2022 = tournament === "wc2022";
  const isViewingSelf = currentUser && String(currentUser.id) === String(participantId);

  const [participantName, setParticipantName] = useState("");
  const [groups, setGroups] = useState([]);
  const [groupPreds, setGroupPreds] = useState({});
  const [koPreds, setKoPreds] = useState({});
  const [koScores, setKoScores] = useState({});
  const [koMatches, setKoMatches] = useState([]);
  const [championPick, setChampionPick] = useState(null);
  const [awardPicks, setAwardPicks] = useState({});
  const [loaded, setLoaded] = useState(false);

  // Compare mode
  const [comparing, setComparing] = useState(false);
  const [myGroupPreds, setMyGroupPreds] = useState({});
  const [myKoPreds, setMyKoPreds] = useState({});
  const [myKoScores, setMyKoScores] = useState({});
  const [myChampionPick, setMyChampionPick] = useState(null);
  const [myAwardPicks, setMyAwardPicks] = useState({});
  const [myLoaded, setMyLoaded] = useState(false);

  useEffect(() => {
    const fetchFn = isWC2022 ? fetchWC2022Leaderboard : fetchLeaderboard;
    fetchFn(poolId).then((data) => {
      const p = data.find((entry) => String(entry.id) === String(participantId));
      if (p) setParticipantName(p.name);
    });
  }, [participantId, poolId, isWC2022]);

  useEffect(() => {
    const groupsFn = isWC2022 ? fetchWC2022Groups : fetchGroups;
    const groupPredsFn = isWC2022 ? fetchWC2022GroupPredictions : fetchGroupPredictions;
    const koPredsFn = isWC2022 ? fetchWC2022KnockoutPredictions : fetchKnockoutPredictions;
    const koMatchesFn = isWC2022 ? fetchWC2022KnockoutMatches : fetchKnockoutMatches;
    const champFn = isWC2022 ? fetchWC2022ChampionPick : fetchChampionPick;

    const promises = [
      groupsFn(),
      groupPredsFn(participantId),
      koPredsFn(participantId),
      isWC2022 ? koMatchesFn(poolId) : koMatchesFn(),
      champFn(participantId, poolId),
      !isWC2022 ? fetchPlayerAwardPicks(participantId, poolId) : Promise.resolve({ picks: [] }),
    ];

    Promise.all(promises).then(([groupsData, gPreds, kPreds, koData, champData, awardsData]) => {
      setGroups(groupsData);

      const gMap = {};
      gPreds.forEach((p) => {
        const picks = [p.team1_id, p.team2_id];
        if (p.team3_id) picks.push(p.team3_id);
        gMap[p.group_id] = picks;
      });
      setGroupPreds(gMap);

      const kMap = {};
      const sMap = {};
      kPreds.forEach((p) => {
        kMap[p.match_id] = p.predicted_winner;
        if (p.predicted_home_score !== null || p.predicted_away_score !== null) {
          sMap[p.match_id] = { home: p.predicted_home_score, away: p.predicted_away_score };
        }
      });
      setKoPreds(kMap);
      setKoScores(sMap);
      setKoMatches(koData);
      setChampionPick(champData?.pick || null);

      const aMap = {};
      (awardsData?.picks || []).forEach((p) => { aMap[p.award_category] = p; });
      setAwardPicks(aMap);

      setLoaded(true);
    });
  }, [participantId, poolId, isWC2022]);

  // Fetch my picks when compare mode is toggled on
  useEffect(() => {
    if (!comparing || !currentUser || myLoaded) return;
    const groupPredsFn = isWC2022 ? fetchWC2022GroupPredictions : fetchGroupPredictions;
    const koPredsFn = isWC2022 ? fetchWC2022KnockoutPredictions : fetchKnockoutPredictions;
    const champFn = isWC2022 ? fetchWC2022ChampionPick : fetchChampionPick;

    Promise.all([
      groupPredsFn(currentUser.id),
      koPredsFn(currentUser.id),
      champFn(currentUser.id, poolId),
      !isWC2022 ? fetchPlayerAwardPicks(currentUser.id, poolId) : Promise.resolve({ picks: [] }),
    ]).then(([gPreds, kPreds, champData, awardsData]) => {
      const gMap = {};
      gPreds.forEach((p) => {
        const picks = [p.team1_id, p.team2_id];
        if (p.team3_id) picks.push(p.team3_id);
        gMap[p.group_id] = picks;
      });
      setMyGroupPreds(gMap);

      const kMap = {};
      const sMap = {};
      kPreds.forEach((p) => {
        kMap[p.match_id] = p.predicted_winner;
        if (p.predicted_home_score !== null || p.predicted_away_score !== null) {
          sMap[p.match_id] = { home: p.predicted_home_score, away: p.predicted_away_score };
        }
      });
      setMyKoPreds(kMap);
      setMyKoScores(sMap);
      setMyChampionPick(champData?.pick || null);

      const aMap = {};
      (awardsData?.picks || []).forEach((p) => { aMap[p.award_category] = p; });
      setMyAwardPicks(aMap);

      setMyLoaded(true);
    });
  }, [comparing, currentUser, poolId, isWC2022, myLoaded]);

  if (!loaded) {
    return (
      <div className="page">
        <p className="notice">Loading...</p>
      </div>
    );
  }

  const roundOrder = ["Round of 32", "Round of 16", "Quarter-Finals", "Semi-Finals", "Final"];
  const koByRound = {};
  koMatches.forEach((m) => {
    const round = m.round || m.stage || "Unknown";
    if (!koByRound[round]) koByRound[round] = [];
    koByRound[round].push(m);
  });

  const showCompare = comparing && myLoaded;

  return (
    <div className="page view-picks-page">
      <div className="view-picks-header">
        <button className="btn-small" onClick={() => navigate("/leaderboard")}>&larr; Back</button>
        <h2>{participantName ? `${participantName}'s Picks` : "Picks"}</h2>
        {currentUser && !isViewingSelf && (
          <button
            className={`btn-small ${comparing ? "btn-compare-active" : ""}`}
            onClick={() => setComparing((v) => !v)}
          >
            {comparing ? "Hide Compare" : "Compare with Mine"}
          </button>
        )}
      </div>

      {showCompare && (
        <div className="compare-legend">
          <span className="compare-legend-item"><span className="compare-dot compare-dot-theirs" /> {participantName}</span>
          <span className="compare-legend-item"><span className="compare-dot compare-dot-mine" /> You</span>
          <span className="compare-legend-item"><span className="compare-dot compare-dot-match" /> Same pick</span>
        </div>
      )}

      {/* Group Stage Picks */}
      <section className="view-picks-section">
        <h3>Group Stage</h3>
        {groups.length === 0 && <p className="notice">No groups available.</p>}
        <div className="view-picks-groups">
          {groups.map((g) => {
            const picked = groupPreds[g.id] || [];
            const myPicked = myGroupPreds[g.id] || [];
            const hasPick = picked.length > 0;
            return (
              <div key={g.id} className={`view-picks-group-card ${hasPick ? "" : "no-pick"}`}>
                <div className="view-picks-group-title">Group {g.name}</div>
                <div className="view-picks-group-teams">
                  {(g.teams || []).map((t) => {
                    const teamId = t.id;
                    const theirPick = picked.indexOf(teamId);
                    const isTheirPick = theirPick === 0 || theirPick === 1 || theirPick === 2;
                    const myPick = myPicked.indexOf(teamId);
                    const isMyPick = showCompare && (myPick === 0 || myPick === 1 || myPick === 2);
                    const bothPicked = isTheirPick && isMyPick;
                    let cls = "view-picks-team";
                    if (bothPicked) cls += " picked compare-match";
                    else if (isTheirPick) cls += " picked";
                    else if (isMyPick) cls += " compare-mine-only";
                    return (
                      <div key={teamId} className={cls}>
                        {showCompare && (
                          <span className="compare-indicators">
                            <span className={`compare-indicator ${isTheirPick ? "compare-ind-theirs" : ""}`} />
                            <span className={`compare-indicator ${isMyPick ? "compare-ind-mine" : ""}`} />
                          </span>
                        )}
                        {flag(t.code)} {t.name}
                      </div>
                    );
                  })}
                </div>
                {!hasPick && <div className="view-picks-no-pick">No pick</div>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Knockout Picks */}
      <section className="view-picks-section">
        <h3>Knockout Stage</h3>
        {Object.keys(koPreds).length === 0 && !showCompare && <p className="notice">No knockout picks yet.</p>}
        {(Object.keys(koPreds).length > 0 || showCompare) && (
          <div className="view-picks-ko">
            {roundOrder.filter((r) => koByRound[r]).map((round) => (
              <div key={round} className="view-picks-ko-round">
                <h4>{round}</h4>
                <div className="view-picks-ko-matches">
                  {koByRound[round].map((m) => {
                    const theirPick = koPreds[m.id];
                    const myPickVal = showCompare ? myKoPreds[m.id] : undefined;
                    const theirScore = koScores[m.id];
                    const myScore = showCompare ? myKoScores[m.id] : undefined;
                    if (!theirPick && !myPickVal) return null;
                    const homeWin = theirPick === m.home_team_id;
                    const awayWin = theirPick === m.away_team_id;
                    const myHomeWin = myPickVal === m.home_team_id;
                    const myAwayWin = myPickVal === m.away_team_id;
                    const sameWinner = theirPick && myPickVal && theirPick === myPickVal;
                    return (
                      <div key={m.id} className={`view-picks-ko-match ${showCompare ? "compare-ko-match" : ""}`}>
                        <div className="view-picks-ko-matchup">
                          <span className={`view-picks-ko-team ${homeWin ? "picked" : ""}`}>
                            {flag(m.home_code)} {m.home_team || m.home_placeholder || "TBD"}
                          </span>
                          <span className="view-picks-ko-vs">vs</span>
                          <span className={`view-picks-ko-team ${awayWin ? "picked" : ""}`}>
                            {m.away_team || m.away_placeholder || "TBD"} {flag(m.away_code)}
                          </span>
                          {theirScore && (
                            <span className="view-picks-ko-score">
                              ({theirScore.home} - {theirScore.away})
                            </span>
                          )}
                        </div>
                        {showCompare && (
                          <div className="compare-ko-my-pick">
                            {myPickVal ? (
                              <span className={`compare-ko-label ${sameWinner ? "compare-match" : "compare-differ"}`}>
                                You: {myHomeWin ? (m.home_team || "TBD") : myAwayWin ? (m.away_team || "TBD") : "?"}
                                {myScore ? ` (${myScore.home} - ${myScore.away})` : ""}
                                {sameWinner && " ✓"}
                              </span>
                            ) : (
                              <span className="compare-ko-label compare-no-pick">You: No pick</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Champion Pick */}
      <section className="view-picks-section">
        <h3>Winner Pick</h3>
        {showCompare ? (
          <div className="compare-champion">
            <div className="compare-champion-col">
              <div className="compare-champion-label">{participantName}</div>
              {championPick ? (
                <div className="view-picks-champion">
                  <span className="view-picks-champion-team">
                    {flag(championPick.team_code)} {championPick.team_name}
                  </span>
                </div>
              ) : (
                <p className="notice">No pick</p>
              )}
            </div>
            <div className="compare-champion-col">
              <div className="compare-champion-label">You</div>
              {myChampionPick ? (
                <div className={`view-picks-champion ${championPick && myChampionPick.team_id === championPick.team_id ? "compare-match" : ""}`}>
                  <span className="view-picks-champion-team">
                    {flag(myChampionPick.team_code)} {myChampionPick.team_name}
                  </span>
                </div>
              ) : (
                <p className="notice">No pick</p>
              )}
            </div>
          </div>
        ) : (
          championPick ? (
            <div className="view-picks-champion">
              <span className="view-picks-champion-team">
                {flag(championPick.team_code)} {championPick.team_name}
              </span>
            </div>
          ) : (
            <p className="notice">No winner pick yet.</p>
          )
        )}
      </section>

      {/* Award Picks */}
      {!isWC2022 && (
        <section className="view-picks-section">
          <h3>Award Picks</h3>
          {Object.keys(awardPicks).length === 0 && !showCompare && (
            <p className="notice">No award picks yet.</p>
          )}
          {(Object.keys(awardPicks).length > 0 || showCompare) && (
            <div className="view-picks-awards">
              {AWARDS.map((award) => {
                const their = awardPicks[award.key];
                const mine = showCompare ? myAwardPicks[award.key] : null;
                if (!their && !mine) return null;
                const theirLabel = their ? (their.player_name || their.team_name) : null;
                const mineLabel = mine ? (mine.player_name || mine.team_name) : null;
                const samePick = their && mine && (
                  (their.player_id && their.player_id === mine.player_id) ||
                  (!their.player_id && their.team_id === mine.team_id)
                );
                return (
                  <div key={award.key} className="view-picks-award-row">
                    <span className="view-picks-award-label">{award.emoji} {award.label}</span>
                    <span className="view-picks-award-pick">
                      {their ? (
                        <>
                          {flag(their.team_code)} {theirLabel}
                        </>
                      ) : (
                        <span className="notice" style={{ margin: 0 }}>No pick</span>
                      )}
                    </span>
                    {showCompare && (
                      <span className={`view-picks-award-compare ${samePick ? "compare-match" : mine ? "compare-differ" : ""}`}>
                        {mine ? (
                          <>
                            You: {flag(mine.team_code)} {mineLabel}
                            {samePick && " ✓"}
                          </>
                        ) : (
                          <span className="compare-no-pick">You: No pick</span>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default ViewPicks;
