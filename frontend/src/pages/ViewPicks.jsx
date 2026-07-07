import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  fetchGroupPredictions, fetchKnockoutPredictions, fetchChampionPick,
  fetchGroups, fetchKnockoutMatches,
  fetchLeaderboard, fetchPlayerAwardPicks,
} from "../api";
import { flag } from "../flags";

const AWARDS = [
  { key: "golden_ball",  label: "Golden Ball",           emoji: "🥇" },
  { key: "golden_boot",  label: "Golden Boot",           emoji: "👟" },
  { key: "golden_glove", label: "Golden Glove",          emoji: "🧤" },
  { key: "young_player", label: "FIFA Young Player",     emoji: "🌟" },
  { key: "fair_play",    label: "FIFA Fair Play Trophy",  emoji: "🤝" },
];

function ViewPicks({ poolId, currentUser }) {
  const { participantId } = useParams();
  const navigate = useNavigate();
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
    fetchLeaderboard(poolId).then((data) => {
      const p = data.find((entry) => String(entry.id) === String(participantId));
      if (p) setParticipantName(p.name);
    });
  }, [participantId, poolId]);

  useEffect(() => {
    const promises = [
      fetchGroups(),
      fetchGroupPredictions(participantId),
      fetchKnockoutPredictions(participantId),
      fetchKnockoutMatches(),
      fetchChampionPick(participantId, poolId),
      fetchPlayerAwardPicks(participantId, poolId),
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
  }, [participantId, poolId]);

  // Fetch my picks when compare mode is toggled on
  useEffect(() => {
    if (!comparing || !currentUser || myLoaded) return;
    Promise.all([
      fetchGroupPredictions(currentUser.id),
      fetchKnockoutPredictions(currentUser.id),
      fetchChampionPick(currentUser.id, poolId),
      fetchPlayerAwardPicks(currentUser.id, poolId),
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
  }, [comparing, currentUser, poolId, myLoaded]);

  if (!loaded) {
    return (
      <div className="page">
        <p className="notice">Loading...</p>
      </div>
    );
  }

  const roundOrder = ["R32", "R16", "QF", "SF", "F"];
  const roundLabels = { R32: "Round of 32", R16: "Round of 16", QF: "Quarter-Finals", SF: "Semi-Finals", F: "Final" };
  const koByRound = {};
  koMatches.forEach((m) => {
    const round = m.round || "Unknown";
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
                <h4>{roundLabels[round] || round}</h4>
                <div className="view-picks-ko-matches">
                  {koByRound[round].map((m) => {
                    const theirPick = koPreds[m.id];
                    const myPickVal = showCompare ? myKoPreds[m.id] : undefined;
                    const theirScore = koScores[m.id];
                    const myScore = showCompare ? myKoScores[m.id] : undefined;
                    if (!theirPick && !myPickVal) return null;
                    const homeName = m.home_team_name || m.home_slot || "TBD";
                    const awayName = m.away_team_name || m.away_slot || "TBD";
                    const teamCls = (side) => {
                      const theirs = theirPick === side;
                      const mine = myPickVal === side;
                      if (showCompare) {
                        if (theirs && mine) return "picked compare-match";
                        if (theirs) return "picked";
                        if (mine) return "compare-mine-only";
                        return "";
                      }
                      return theirs ? "picked" : "";
                    };
                    const indicators = (side) => showCompare ? (
                      <span className="compare-indicators">
                        <span className={`compare-indicator ${theirPick === side ? "compare-ind-theirs" : ""}`} />
                        <span className={`compare-indicator ${myPickVal === side ? "compare-ind-mine" : ""}`} />
                      </span>
                    ) : null;
                    const scoreArea = (side) => {
                      if (showCompare) {
                        const t = theirScore ? theirScore[side] : null;
                        const mine = myScore ? myScore[side] : null;
                        if (t == null && mine == null) return null;
                        const same = t != null && mine != null && t === mine;
                        return (
                          <span className="view-picks-ko-team-score">
                            {same ? (
                              <span className="vpko-sl vpko-sl-match">{t}</span>
                            ) : (
                              <>
                                {t != null && <span className="vpko-sl vpko-sl-theirs">{t}</span>}
                                {mine != null && <span className="vpko-sl vpko-sl-mine">{mine}</span>}
                              </>
                            )}
                          </span>
                        );
                      }
                      return theirScore ? <span className="view-picks-ko-team-score">{theirScore[side]}</span> : null;
                    };
                    return (
                      <div key={m.id} className="view-picks-ko-match">
                        <div className="view-picks-ko-cell">
                          <span className={`view-picks-ko-team top ${teamCls("home")}`}>
                            <span className="view-picks-ko-team-label">{indicators("home")}{flag(m.home_team_code)} {homeName}</span>
                            {scoreArea("home")}
                          </span>
                          <span className={`view-picks-ko-team ${teamCls("away")}`}>
                            <span className="view-picks-ko-team-label">{indicators("away")}{flag(m.away_team_code)} {awayName}</span>
                            {scoreArea("away")}
                          </span>
                        </div>
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
    </div>
  );
}

export default ViewPicks;
