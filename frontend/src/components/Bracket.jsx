import { useState } from "react";
import { flag } from "../flags";

function formatKoTime(utcStr, tzOffset) {
  if (!utcStr) return null;
  const offset = tzOffset !== undefined ? tzOffset : (-new Date().getTimezoneOffset() / 60);
  const ms = new Date(utcStr.replace(" ", "T") + "Z").getTime() + offset * 3600000;
  const d = new Date(ms);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${h % 12 || 12}:${m} ${ampm}`;
}

const TBC_FLAG = "https://www.gstatic.com/onebox/sports/logos/crest_48dp.png";

function SlotLabel() {
  return <><img src={TBC_FLAG} className="team-flag tbc-flag" alt="" /> TBC</>;
}

function evalPickError(pred, h, a) {
  if (h === "" || a === "") return "";
  const hv = parseInt(h, 10);
  const av = parseInt(a, 10);
  if (isNaN(hv) || isNaN(av)) return "";
  if ((pred === "home" && hv < av) || (pred === "away" && av < hv))
    return "Picked team's score can't be lower";
  return "";
}

function BracketMatch({ m, left, top, MATCH_H, ROUND_W, pred, status, isSaving, ko, matchOpen, meta, scoreData, onPick, onScore, displayTzOffset, exactScoresDisabled }) {
  const [h, setH] = useState(scoreData?.home != null ? String(scoreData.home) : "");
  const [a, setA] = useState(scoreData?.away != null ? String(scoreData.away) : "");
  const [scoreError, setScoreError] = useState(() => {
    const h0 = scoreData?.home != null ? String(scoreData.home) : "";
    const a0 = scoreData?.away != null ? String(scoreData.away) : "";
    return { forPred: pred, msg: evalPickError(pred, h0, a0) };
  });

  // Event 1: pick changed — re-evaluate current scores for the new pick immediately
  if (scoreError.forPred !== pred) {
    setScoreError({ forPred: pred, msg: exactScoresDisabled ? "" : evalPickError(pred, h, a) });
  }
  const visibleError = exactScoresDisabled ? "" : scoreError.msg;
  // True when the *saved* score (not just a freshly-typed one) contradicts the pick —
  // lets us word the cue as "doesn't match" rather than "not saved".
  const savedConflict = !exactScoresDisabled && scoreData && scoreData.home != null && scoreData.away != null &&
    !!evalPickError(pred, String(scoreData.home), String(scoreData.away));

  const matchLocked = !matchOpen || (ko && ko.status !== "upcoming");
  const canPick = onPick && !matchLocked;
  const scoreDisabled = !onScore || matchLocked;
  const pickedNoScore = !exactScoresDisabled && !!pred && !!ko?.home_team_name && !matchLocked && (h === "" || a === "");

  // Event 2: score blur — validate and save
  const handleBlur = () => {
    if (!onScore || scoreDisabled) return;
    const hv = h === "" ? null : parseInt(h, 10);
    const av = a === "" ? null : parseInt(a, 10);
    if (hv !== null && !isNaN(hv) && av !== null && !isNaN(av)) {
      const err = evalPickError(pred, h, a);
      setScoreError({ forPred: pred, msg: err });
      if (err) return; // score contradicts the winner pick — block the save (ties are allowed)
      onScore(m.id, hv, av);
    }
  };

  const matchFinished = ko?.status === "finished";
  const matchLive = ko?.status === "live";
  const actualHome = ko?.home_score ?? null;
  const actualAway = ko?.away_score ?? null;
  const hasPred = !!pred && !!ko?.home_team_name;
  const showInputs = !exactScoresDisabled && hasPred && !matchFinished;
  const showActual = matchFinished && actualHome !== null;

  const pHi = h === "" ? null : parseInt(h, 10);
  const pAi = a === "" ? null : parseInt(a, 10);
  const scoreCorrect = !exactScoresDisabled && showActual && hasPred && pHi !== null && pAi !== null && pHi === actualHome && pAi === actualAway;
  const scoreWrong = !exactScoresDisabled && showActual && hasPred && pHi !== null && pAi !== null && !scoreCorrect;

  // Single inline bracket per team row: (Pn) for shootouts (always shown when there was
  // a shootout), or (En) for ET-decided matches (only when ET goals were actually scored).
  // Pens take precedence — for matches that went to pens, the shootout is the decisive bit.
  function scoreSuffix(side) {
    if (!showActual) return null;
    if (ko?.duration === "PENALTY_SHOOTOUT") {
      const v = side === "home" ? ko?.home_pens : ko?.away_pens;
      if (v == null) return null;
      return `(P${v})`;
    }
    if (ko?.duration === "EXTRA_TIME") {
      const hEt = ko?.home_et ?? 0;
      const aEt = ko?.away_et ?? 0;
      if (hEt === 0 && aEt === 0) return null;
      return `(E${side === "home" ? hEt : aEt})`;
    }
    return null;
  }

  // Live-only badge text — shown below the cell when the match is mid-ET or mid-shootout.
  const liveBadge = matchLive
    ? (ko?.duration === "EXTRA_TIME" ? "in extra time"
        : ko?.duration === "PENALTY_SHOOTOUT" ? "in penalties"
        : null)
    : null;

  const homeLabel = ko?.home_team_name ? <>{flag(ko.home_team_code)} {ko.home_team_name}</> : <SlotLabel />;
  const awayLabel = ko?.away_team_name ? <>{flag(ko.away_team_code)} {ko.away_team_name}</> : <SlotLabel />;

  const timeLabel = matchOpen
    ? { text: "Closes " + formatKoTime(meta.closesAt, displayTzOffset), red: true }
    : { text: "Opens " + formatKoTime(meta.opensAfter, displayTzOffset), red: false };

  return (
    <div
      className={`bracket-match ${status || ""} ${isSaving ? "saving" : ""} ${!matchOpen ? "not-open" : ""} ${matchOpen && !pred && ko?.home_team_name ? "unpicked" : ""} ${pickedNoScore ? "picked-no-score" : ""} ${visibleError ? "score-conflict" : ""}`}
      style={{ position: "absolute", left, top, width: ROUND_W, height: MATCH_H }}
    >
      <div className={`bracket-team top ${canPick ? "clickable" : ""} ${pred === "home" ? "picked" : ""}`}
        onClick={canPick ? () => onPick(m.id, "home", h, a) : undefined}>
        <span className="team-label">{homeLabel}</span>
        <div className="team-score-area" onClick={(e) => e.stopPropagation()}>
          {showInputs && (
            <input type="number" min="0" max="20" value={h}
              onChange={(e) => { setH(e.target.value); setScoreError({ forPred: pred, msg: "" }); }}
              onBlur={handleBlur}
              disabled={scoreDisabled} className="bracket-score-input" placeholder="?" />
          )}
          {showActual && <span className="score-actual">{actualHome}</span>}
          {scoreSuffix("home") && <span className="score-suffix">{scoreSuffix("home")}</span>}
        </div>
      </div>
      <div className={`bracket-team bottom ${canPick ? "clickable" : ""} ${pred === "away" ? "picked" : ""}`}
        onClick={canPick ? () => onPick(m.id, "away", h, a) : undefined}>
        <span className="team-label">{awayLabel}</span>
        <div className="team-score-area" onClick={(e) => e.stopPropagation()}>
          {showInputs && (
            <input type="number" min="0" max="20" value={a}
              onChange={(e) => { setA(e.target.value); setScoreError({ forPred: pred, msg: "" }); }}
              onBlur={handleBlur}
              disabled={scoreDisabled} className="bracket-score-input" placeholder="?" />
          )}
          {showActual && <span className="score-actual">{actualAway}</span>}
          {scoreSuffix("away") && <span className="score-suffix">{scoreSuffix("away")}</span>}
        </div>
      </div>
      {!exactScoresDisabled && visibleError && (
        <div className="score-error score-error-blocked">
          {savedConflict
            ? "⚠ Pick doesn’t match your score — update before kickoff"
            : "⚠ Score not saved — winner can’t score fewer goals"}
        </div>
      )}
      {!exactScoresDisabled && !visibleError && pickedNoScore && (
        <div className="score-hint">Winner picked — no score saved. Add a score for the exact-score bonus.</div>
      )}
      {liveBadge && (
        <div className="ko-live-badge">· {liveBadge} ·</div>
      )}
      {(scoreCorrect || scoreWrong) && (
        <div className={`score-result ${scoreCorrect ? "correct" : "wrong"}`}>
          {scoreCorrect ? "✓ exact score" : `✗ you picked ${pHi}-${pAi}`}
        </div>
      )}
      {timeLabel.text && (
        <div className="bracket-match-time" style={{ color: timeLabel.red ? "#ff6b6b" : undefined }}>
          {timeLabel.text}
        </div>
      )}
    </div>
  );
}

function Bracket({ predictions = {}, scores = {}, onPick, onScore, saving, koMatches = [], pointsMap = {}, openMatchIds = new Set(), matchMeta = {}, displayTzOffset, exactScoresDisabled = false }) {
  const rounds = [
    {
      name: "Round of 32",
      matches: [
        { id: "R32-1", home: "2A", away: "2B" }, { id: "R32-3", home: "1F", away: "2C" },
        { id: "R32-2", home: "1E", away: "3A/B/C/D/F" }, { id: "R32-5", home: "1I", away: "3C/D/F/G/H" },
        { id: "R32-11", home: "2K", away: "2L" }, { id: "R32-12", home: "1H", away: "2J" },
        { id: "R32-9", home: "1D", away: "3B/E/F/I/J" }, { id: "R32-10", home: "1G", away: "3A/E/H/I/J" },
        { id: "R32-4", home: "1C", away: "2F" }, { id: "R32-6", home: "2E", away: "2I" },
        { id: "R32-7", home: "1A", away: "3C/E/F/H/I" }, { id: "R32-8", home: "1L", away: "3E/H/I/J/K" },
        { id: "R32-14", home: "1J", away: "2H" }, { id: "R32-16", home: "2D", away: "2G" },
        { id: "R32-13", home: "1B", away: "3E/F/G/I/J" }, { id: "R32-15", home: "1K", away: "3D/E/I/J/L" },
      ],
    },
    {
      name: "Round of 16",
      matches: [
        { id: "R16-2", home: "W R32-1", away: "W R32-3" }, { id: "R16-1", home: "W R32-2", away: "W R32-5" },
        { id: "R16-5", home: "W R32-11", away: "W R32-12" }, { id: "R16-6", home: "W R32-9", away: "W R32-10" },
        { id: "R16-3", home: "W R32-4", away: "W R32-6" }, { id: "R16-4", home: "W R32-7", away: "W R32-8" },
        { id: "R16-7", home: "W R32-14", away: "W R32-16" }, { id: "R16-8", home: "W R32-13", away: "W R32-15" },
      ],
    },
    {
      name: "Quarter-Finals",
      matches: [
        { id: "QF-1", home: "W R16-1", away: "W R16-2" }, { id: "QF-2", home: "W R16-5", away: "W R16-6" },
        { id: "QF-3", home: "W R16-3", away: "W R16-4" }, { id: "QF-4", home: "W R16-7", away: "W R16-8" },
      ],
    },
    {
      name: "Semi-Finals",
      matches: [
        { id: "SF-1", home: "W QF-1", away: "W QF-2" }, { id: "SF-2", home: "W QF-3", away: "W QF-4" },
      ],
    },
    { name: "Final", matches: [{ id: "F", home: "W SF-1", away: "W SF-2" }] },
  ];

  const MATCH_H = 88;
  const BASE_GAP = 10;
  const SLOT = MATCH_H + BASE_GAP;
  const ROUND_W = 170;
  const CONN_W = 30;
  const TITLE_H = 28;
  const TOTAL_H = 16 * SLOT - BASE_GAP + TITLE_H;
  const TOTAL_W = rounds.length * ROUND_W + (rounds.length - 1) * CONN_W + 80;

  const matchCenterY = (r, m) => TITLE_H + (Math.pow(2, r) - 1) * SLOT / 2 + m * Math.pow(2, r) * SLOT + MATCH_H / 2;
  const roundLeft = (r) => r * (ROUND_W + CONN_W);

  const lines = [];
  for (let r = 0; r < rounds.length - 1; r++) {
    const numPairs = rounds[r].matches.length / 2;
    const matchRight = roundLeft(r) + ROUND_W;
    const connX = matchRight + CONN_W / 2;
    const nextLeft = roundLeft(r + 1);
    for (let j = 0; j < numPairs; j++) {
      const topY = matchCenterY(r, 2 * j);
      const botY = matchCenterY(r, 2 * j + 1);
      const midY = (topY + botY) / 2;
      lines.push(
        { x1: matchRight, y1: topY, x2: connX, y2: topY },
        { x1: matchRight, y1: botY, x2: connX, y2: botY },
        { x1: connX, y1: topY, x2: connX, y2: botY },
        { x1: connX, y1: midY, x2: nextLeft, y2: midY },
      );
    }
  }

  const getKoMatch = (matchId) => koMatches.find((m) => m.id === matchId);

  const getMatchStatus = (matchId) => {
    const ko = getKoMatch(matchId);
    if (!ko || ko.status !== "finished" || !ko.winner_team_id) return null;
    const pred = predictions[matchId];
    if (!pred) return null;
    const predictedTeamId = pred === "home" ? ko.home_team_id : pred === "away" ? ko.away_team_id : Number(pred);
    return String(predictedTeamId) === String(ko.winner_team_id) ? "correct" : "wrong";
  };

  return (
    <div className="bracket">
      <div className="bracket-canvas" style={{ position: "relative", width: TOTAL_W, height: TOTAL_H }}>
        <svg className="bracket-lines" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {lines.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#2a5a2a" strokeWidth="1" />
          ))}
        </svg>

        {rounds.map((round, ri) => (
          <div key={round.name} className="bracket-round">
            <div className="bracket-round-title" style={{ position: "absolute", left: roundLeft(ri), top: 0, width: ROUND_W }}>
              {round.name}
              {pointsMap[round.name] && <span className="bracket-pts-label"> ({pointsMap[round.name]} pts)</span>}
            </div>
            {round.matches.map((m, mi) => {
              const pred = predictions[m.id];
              const status = getMatchStatus(m.id);
              const ko = getKoMatch(m.id);
              const matchOpen = openMatchIds.has(m.id);
              const scoreData = scores[m.id];
              return (
                <BracketMatch
                  key={`${m.id}-${scoreData?.home ?? ""}-${scoreData?.away ?? ""}`}
                  m={m}
                  left={roundLeft(ri)}
                  top={matchCenterY(ri, mi) - MATCH_H / 2}
                  MATCH_H={MATCH_H}
                  ROUND_W={ROUND_W}
                  pred={pred}
                  status={status}
                  isSaving={saving === m.id}
                  ko={ko}
                  matchOpen={matchOpen}
                  meta={matchMeta[m.id] || {}}
                  scoreData={scoreData}
                  onPick={onPick}
                  onScore={onScore}
                  displayTzOffset={displayTzOffset}
                  exactScoresDisabled={exactScoresDisabled}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Bracket;
