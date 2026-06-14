import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  fetchEPL2627Leaderboard, fetchEPL2627Matches, fetchEPL2627MatchPredictions,
  fetchEPL2627SeasonPredictions, fetchEPL2627PlayerAwardPicks,
} from "../api";
import { plCrest } from "../flags";

const EPL_AWARDS = [
  { key: "golden_boot",   label: "Golden Boot",              emoji: "\u{1F45F}" },
  { key: "golden_glove",  label: "Golden Glove",             emoji: "\u{1F9E4}" },
  { key: "pots",          label: "Player of the Season",     emoji: "\u{1F947}" },
  { key: "ypots",         label: "Young Player of the Season", emoji: "\u{1F31F}" },
  { key: "mots",          label: "Manager of the Season",    emoji: "\u{1F9D1}\u200D\u{1F4BC}" },
];

function getZone(pos) {
  if (pos === 1) return "champion";
  if (pos >= 2 && pos <= 4) return "cl";
  if (pos === 5) return "europa";
  if (pos === 6) return "conference";
  if (pos >= 18) return "relegation";
  return "";
}

function ViewEPLPicks({ poolId, currentUser }) {
  const { participantId } = useParams();
  const navigate = useNavigate();
  const isViewingSelf = currentUser && String(currentUser.id) === String(participantId);

  const [participantName, setParticipantName] = useState("");
  const [matches, setMatches] = useState([]);
  const [matchPreds, setMatchPreds] = useState({});
  const [seasonPreds, setSeasonPreds] = useState([]);
  const [awardPicks, setAwardPicks] = useState({});
  const [loaded, setLoaded] = useState(false);

  // Compare mode
  const [comparing, setComparing] = useState(false);
  const [myMatchPreds, setMyMatchPreds] = useState({});
  const [mySeasonPreds, setMySeasonPreds] = useState([]);
  const [myAwardPicks, setMyAwardPicks] = useState({});
  const [myLoaded, setMyLoaded] = useState(false);

  // Fetch participant name
  useEffect(() => {
    fetchEPL2627Leaderboard(poolId).then((data) => {
      const p = data.find((entry) => String(entry.id) === String(participantId));
      if (p) setParticipantName(p.name);
    });
  }, [participantId, poolId]);

  // Fetch their picks
  useEffect(() => {
    Promise.all([
      fetchEPL2627Matches(),
      fetchEPL2627MatchPredictions(participantId),
      fetchEPL2627SeasonPredictions(participantId),
      fetchEPL2627PlayerAwardPicks(participantId, poolId),
    ]).then(([matchData, mPreds, sPreds, awardsData]) => {
      setMatches(matchData);

      const mMap = {};
      mPreds.forEach((p) => {
        mMap[p.match_id] = {
          outcome: p.predicted_outcome,
          home_score: p.predicted_home_score,
          away_score: p.predicted_away_score,
        };
      });
      setMatchPreds(mMap);
      setSeasonPreds(sPreds);

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
      fetchEPL2627MatchPredictions(currentUser.id),
      fetchEPL2627SeasonPredictions(currentUser.id),
      fetchEPL2627PlayerAwardPicks(currentUser.id, poolId),
    ]).then(([mPreds, sPreds, awardsData]) => {
      const mMap = {};
      mPreds.forEach((p) => {
        mMap[p.match_id] = {
          outcome: p.predicted_outcome,
          home_score: p.predicted_home_score,
          away_score: p.predicted_away_score,
        };
      });
      setMyMatchPreds(mMap);
      setMySeasonPreds(sPreds);

      const aMap = {};
      (awardsData?.picks || []).forEach((p) => { aMap[p.award_category] = p; });
      setMyAwardPicks(aMap);

      setMyLoaded(true);
    });
  }, [comparing, currentUser, poolId, myLoaded]);

  if (!loaded) {
    return <div className="page"><p className="notice">Loading...</p></div>;
  }

  const showCompare = comparing && myLoaded;

  // Group matches by matchday
  const matchesByDay = {};
  matches.forEach((m) => {
    const md = m.matchday || 0;
    if (!matchesByDay[md]) matchesByDay[md] = [];
    matchesByDay[md].push(m);
  });
  const matchdays = Object.keys(matchesByDay).map(Number).sort((a, b) => a - b);

  // Only show matchdays where at least one person has predictions
  const activeDays = matchdays.filter((md) =>
    matchesByDay[md].some((m) => matchPreds[m.id] || (showCompare && myMatchPreds[m.id]))
  );

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

      {/* Match Predictions */}
      <section className="view-picks-section">
        <h3>Match Predictions</h3>
        {activeDays.length === 0 && <p className="notice">No match predictions yet.</p>}
        {activeDays.map((md) => (
          <div key={md} className="view-picks-ko-round">
            <h4>Matchday {md}</h4>
            <div className="view-picks-ko-matches">
              {matchesByDay[md].map((m) => {
                const their = matchPreds[m.id];
                const mine = showCompare ? myMatchPreds[m.id] : undefined;
                if (!their && !mine) return null;

                const outcomeLabel = (pred) => {
                  if (!pred) return null;
                  if (pred.outcome === "home") return m.home_team || m.home_short;
                  if (pred.outcome === "away") return m.away_team || m.away_short;
                  return "Draw";
                };
                const scoreLabel = (pred) => {
                  if (!pred || pred.home_score == null || pred.away_score == null) return "";
                  return ` (${pred.home_score}-${pred.away_score})`;
                };
                const sameOutcome = their && mine && their.outcome === mine.outcome;

                return (
                  <div key={m.id} className={`view-picks-ko-match ${showCompare ? "compare-ko-match" : ""}`}>
                    <div className="view-picks-ko-matchup">
                      <span className={`view-picks-ko-team ${their?.outcome === "home" ? "picked" : ""}`}>
                        {plCrest(m.home_code)} {m.home_team || m.home_short || "TBD"}
                      </span>
                      <span className="view-picks-ko-vs">vs</span>
                      <span className={`view-picks-ko-team ${their?.outcome === "away" ? "picked" : ""}`}>
                        {m.away_team || m.away_short || "TBD"} {plCrest(m.away_code)}
                      </span>
                      {their && (
                        <span className="view-picks-ko-score">
                          {their.outcome === "draw" && " Draw"}
                          {scoreLabel(their)}
                        </span>
                      )}
                    </div>
                    {showCompare && (
                      <div className="compare-ko-my-pick">
                        {mine ? (
                          <span className={`compare-ko-label ${sameOutcome ? "compare-match" : "compare-differ"}`}>
                            You: {outcomeLabel(mine)}{scoreLabel(mine)}
                            {sameOutcome && " \u2713"}
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
      </section>

      {/* Season Predictions */}
      <section className="view-picks-section">
        <h3>Season Predictions</h3>
        {seasonPreds.length === 0 && !showCompare ? (
          <p className="notice">No season predictions yet.</p>
        ) : (
          <div className="view-picks-epl-season">
            {showCompare ? (
              <div className="compare-champion">
                <div className="compare-champion-col" style={{ flex: 1 }}>
                  <div className="compare-champion-label">{participantName}</div>
                  {seasonPreds.length > 0 ? (
                    <div className="season-table">
                      {seasonPreds.map((s) => (
                        <div key={s.position} className={`season-row ${getZone(s.position)}`}>
                          <span className="season-pos">{s.position}</span>
                          <span className="season-team-name">{plCrest(s.team_code)} {s.short_name || s.team_name}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="notice">No pick</p>}
                </div>
                <div className="compare-champion-col" style={{ flex: 1 }}>
                  <div className="compare-champion-label">You</div>
                  {mySeasonPreds.length > 0 ? (
                    <div className="season-table">
                      {mySeasonPreds.map((s) => {
                        const theirSame = seasonPreds.find((t) => t.position === s.position && t.team_id === s.team_id);
                        return (
                          <div key={s.position} className={`season-row ${getZone(s.position)} ${theirSame ? "compare-match" : ""}`}>
                            <span className="season-pos">{s.position}</span>
                            <span className="season-team-name">{plCrest(s.team_code)} {s.short_name || s.team_name}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="notice">No pick</p>}
                </div>
              </div>
            ) : (
              <div className="season-table">
                {seasonPreds.map((s) => (
                  <div key={s.position} className={`season-row ${getZone(s.position)}`}>
                    <span className="season-pos">{s.position}</span>
                    <span className="season-team-name">{plCrest(s.team_code)} {s.short_name || s.team_name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
            {EPL_AWARDS.map((award) => {
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
                      <>{plCrest(their.team_code)} {theirLabel}</>
                    ) : (
                      <span className="notice" style={{ margin: 0 }}>No pick</span>
                    )}
                  </span>
                  {showCompare && (
                    <span className={`view-picks-award-compare ${samePick ? "compare-match" : mine ? "compare-differ" : ""}`}>
                      {mine ? (
                        <>You: {plCrest(mine.team_code)} {mineLabel}{samePick && " \u2713"}</>
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

export default ViewEPLPicks;
