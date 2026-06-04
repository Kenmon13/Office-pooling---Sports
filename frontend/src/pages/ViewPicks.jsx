import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  fetchGroupPredictions, fetchKnockoutPredictions, fetchChampionPick,
  fetchWC2022GroupPredictions, fetchWC2022KnockoutPredictions, fetchWC2022ChampionPick,
  fetchGroups, fetchWC2022Groups, fetchKnockoutMatches, fetchWC2022KnockoutMatches,
  fetchLeaderboard, fetchWC2022Leaderboard,
} from "../api";
import { flag } from "../flags";

function ViewPicks({ poolId, tournament = "wc2026" }) {
  const { participantId } = useParams();
  const navigate = useNavigate();
  const isWC2022 = tournament === "wc2022";

  const [participantName, setParticipantName] = useState("");
  const [groups, setGroups] = useState([]);
  const [groupPreds, setGroupPreds] = useState({});
  const [koPreds, setKoPreds] = useState({});
  const [koScores, setKoScores] = useState({});
  const [koMatches, setKoMatches] = useState([]);
  const [championPick, setChampionPick] = useState(null);
  const [loaded, setLoaded] = useState(false);

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
    ];

    Promise.all(promises).then(([groupsData, gPreds, kPreds, koData, champData]) => {
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
      setLoaded(true);
    });
  }, [participantId, poolId, isWC2022]);

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

  return (
    <div className="page view-picks-page">
      <div className="view-picks-header">
        <button className="btn-small" onClick={() => navigate("/leaderboard")}>&larr; Back</button>
        <h2>{participantName ? `${participantName}'s Picks` : "Picks"}</h2>
      </div>

      {/* Group Stage Picks */}
      <section className="view-picks-section">
        <h3>Group Stage</h3>
        {groups.length === 0 && <p className="notice">No groups available.</p>}
        <div className="view-picks-groups">
          {groups.map((g) => {
            const picked = groupPreds[g.id] || [];
            const hasPick = picked.length > 0;
            return (
              <div key={g.id} className={`view-picks-group-card ${hasPick ? "" : "no-pick"}`}>
                <div className="view-picks-group-title">Group {g.name}</div>
                <div className="view-picks-group-teams">
                  {(g.teams || []).map((t) => {
                    const teamId = t.id;
                    const pickIndex = picked.indexOf(teamId);
                    const isTop2 = pickIndex === 0 || pickIndex === 1;
                    const isThird = pickIndex === 2;
                    return (
                      <div key={teamId} className={`view-picks-team ${isTop2 || isThird ? "picked" : ""}`}>
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
        {Object.keys(koPreds).length === 0 && <p className="notice">No knockout picks yet.</p>}
        {Object.keys(koPreds).length > 0 && (
          <div className="view-picks-ko">
            {roundOrder.filter((r) => koByRound[r]).map((round) => (
              <div key={round} className="view-picks-ko-round">
                <h4>{round}</h4>
                <div className="view-picks-ko-matches">
                  {koByRound[round].map((m) => {
                    const pick = koPreds[m.id];
                    const score = koScores[m.id];
                    if (!pick) return null;
                    const homeWin = pick === m.home_team_id;
                    const awayWin = pick === m.away_team_id;
                    return (
                      <div key={m.id} className="view-picks-ko-match">
                        <span className={`view-picks-ko-team ${homeWin ? "picked" : ""}`}>
                          {flag(m.home_code)} {m.home_team || m.home_placeholder || "TBD"}
                        </span>
                        <span className="view-picks-ko-vs">vs</span>
                        <span className={`view-picks-ko-team ${awayWin ? "picked" : ""}`}>
                          {m.away_team || m.away_placeholder || "TBD"} {flag(m.away_code)}
                        </span>
                        {score && (
                          <span className="view-picks-ko-score">
                            ({score.home} - {score.away})
                          </span>
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
        {championPick ? (
          <div className="view-picks-champion">
            <span className="view-picks-champion-team">
              {flag(championPick.team_code)} {championPick.team_name}
            </span>
          </div>
        ) : (
          <p className="notice">No winner pick yet.</p>
        )}
      </section>
    </div>
  );
}

export default ViewPicks;
