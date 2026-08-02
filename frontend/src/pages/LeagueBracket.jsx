import { useState, useEffect } from "react";
import { fetchLeagueBracket, submitLeagueKoPredictions } from "../api";
import { plCrest, registerCrests } from "../flags";
import { getLeague } from "../leagues";

// The Champions League knockout bracket. You pick who goes through in each tie rather than
// scorelines — the legs themselves are still predicted on the Matches page like any other fixture.
//
// Ties appear round by round as each draw publishes, so a round with no ties yet is shown as
// pending rather than hidden: it tells you what's still to come and what it will be worth.
// A tie locks at its first leg's kickoff, matching how individual matches lock.
function LeagueBracket({ currentUser, league = "ucl2627" }) {
  const L = getLeague(league);
  const [rounds, setRounds] = useState([]);
  const [picks, setPicks] = useState({});     // { [tie_id]: team_id }
  const [savedPicks, setSavedPicks] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!currentUser) return;
    fetchLeagueBracket(league, currentUser.id).then((data) => {
      const rs = data.rounds || [];
      for (const r of rs) {
        registerCrests(r.ties.flatMap((t) => [
          { code: t.home_code, crest_url: t.home_crest },
          { code: t.away_code, crest_url: t.away_crest },
        ]));
      }
      const existing = {};
      for (const r of rs) for (const t of r.ties) if (t.picked_team_id) existing[t.id] = t.picked_team_id;
      setRounds(rs);
      setPicks(existing);
      setSavedPicks(existing);
      setLoading(false);
    });
  }, [league, currentUser]);

  const openTies = rounds.flatMap((r) => r.ties.filter((t) => !t.locked && t.home_team_id && t.away_team_id));
  const changed = openTies.filter((t) => picks[t.id] && picks[t.id] !== savedPicks[t.id]);

  const handleSave = async () => {
    if (!currentUser || changed.length === 0) return;
    setSaving(true);
    setSaveError("");
    const res = await submitLeagueKoPredictions(
      league, currentUser.id,
      changed.map((t) => ({ tie_id: t.id, team_id: picks[t.id] })),
    );
    if (res.error) setSaveError(res.error);
    else if (res.errors?.length) setSaveError(res.errors[0]);
    else setSavedPicks({ ...savedPicks, ...Object.fromEntries(changed.map((t) => [t.id, picks[t.id]])) });
    setSaving(false);
  };

  if (loading) return <p className="pick-hint">Loading bracket...</p>;

  const drawn = rounds.some((r) => r.ties.length > 0);

  return (
    <div className="league-bracket">
      <h2 className="page-title">{L?.shortName} Bracket</h2>

      {!drawn ? (
        <p className="pick-hint">
          The knockout bracket opens once the league phase is done and the playoff draw is made.
          Until then, your league-phase predictions are on the Season Predictions page.
        </p>
      ) : (
        <p className="pick-hint">
          Pick who goes through in each tie. Ties lock at the first leg&apos;s kickoff, and later
          rounds appear as each draw is made.
        </p>
      )}

      {rounds.map((round) => (
        <div key={round.key} className="ko-round">
          <div className="ko-round-head">
            <h3 className="ko-round-title">{round.label}</h3>
            <span className="ko-round-pts">{round.pts} pts per tie</span>
          </div>

          {round.ties.length === 0 ? (
            <p className="ko-round-pending">Not drawn yet</p>
          ) : (
            <div className="ko-ties">
              {round.ties.map((tie) => (
                <TieCard
                  key={tie.id}
                  tie={tie}
                  legs={round.legs}
                  picked={picks[tie.id]}
                  onPick={(teamId) => setPicks((prev) => ({ ...prev, [tie.id]: teamId }))}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      {drawn && (
        <div className="ko-save-bar">
          {saveError && <span className="save-error">{saveError}</span>}
          <button className="save-btn" disabled={saving || changed.length === 0} onClick={handleSave}>
            {saving ? "Saving..." : changed.length > 0 ? `Save ${changed.length} pick${changed.length > 1 ? "s" : ""}` : "Saved"}
          </button>
        </div>
      )}
    </div>
  );
}

// One tie: both clubs as pick buttons, plus whatever is known of the legs. Once a winner is
// resolved the card becomes a result rather than a picker.
function TieCard({ tie, legs, picked, onPick }) {
  const decided = tie.winner_team_id != null;
  const sides = [
    { id: tie.home_team_id, name: tie.home_short || tie.home_name, code: tie.home_code, crest: tie.home_crest },
    { id: tie.away_team_id, name: tie.away_short || tie.away_name, code: tie.away_code, crest: tie.away_crest },
  ];
  // Aggregate is only meaningful once every leg is in.
  const legsDone = tie.leg1_status === "finished" && (legs === 1 || tie.leg2_status === "finished");
  const agg = legsDone && legs === 2
    ? [(tie.leg1_home ?? 0) + (tie.leg2_away ?? 0), (tie.leg1_away ?? 0) + (tie.leg2_home ?? 0)]
    : null;

  return (
    <div className={`ko-tie ${tie.locked ? "locked" : ""} ${decided ? "decided" : ""}`}>
      {sides.map((s) => {
        if (!s.id) return <div key="tbd" className="ko-side tbd">To be decided</div>;
        const isPick = picked === s.id;
        const isWinner = tie.winner_team_id === s.id;
        return (
          <button
            key={s.id}
            className={`ko-side ${isPick ? "picked" : ""} ${isWinner ? "winner" : ""} ${decided && !isWinner ? "out" : ""}`}
            disabled={tie.locked}
            onClick={() => onPick(s.id)}
          >
            {plCrest(s.code, s.crest)}
            <span className="ko-side-name">{s.name}</span>
            {isWinner && <span className="ko-side-mark">✓</span>}
          </button>
        );
      })}

      <div className="ko-tie-meta">
        {agg && <span className="ko-agg">agg {agg[0]}–{agg[1]}</span>}
        {!legsDone && tie.leg1_date && (
          <span className="ko-date">{new Date(tie.leg1_date.replace(" ", "T") + "Z").toLocaleDateString()}</span>
        )}
        {tie.locked && !decided && <span className="ko-locked-tag">locked</span>}
      </div>
    </div>
  );
}

export default LeagueBracket;
