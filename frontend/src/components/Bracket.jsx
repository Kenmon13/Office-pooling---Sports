import { useState } from "react";
import { flag } from "../flags";

function formatKoTime(utcStr) {
  if (!utcStr) return null;
  const d = new Date(utcStr.replace(" ", "T") + "Z");
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const TBC_FLAG = "https://www.gstatic.com/onebox/sports/logos/crest_48dp.png";

function SlotLabel() {
  return <><img src={TBC_FLAG} className="team-flag tbc-flag" alt="" /> TBC</>;
}

function BracketMatch({ m, left, top, MATCH_H, ROUND_W, pred, status, isSaving, ko, matchOpen, meta, scoreData, onPick, onScore }) {
  const [h, setH] = useState(scoreData?.home ?? "");
  const [a, setA] = useState(scoreData?.away ?? "");
  // Track which pick the error was set for — only show it when pred still matches
  const [scoreError, setScoreError] = useState({ forPred: null, msg: "" });
  const visibleError = scoreError.forPred === pred ? scoreError.msg : "";

  // Re-mount via key at call site when server scores change

  const matchLocked = !matchOpen || (ko && ko.status !== "upcoming");
  const canPick = onPick && !matchLocked;
  const scoreDisabled = !onScore || matchLocked;
  const pickedNoScore = !!pred && !!ko?.home_team_name && !matchLocked && (h === "" || a === "");

  const handleBlur = () => {
    if (!onScore || scoreDisabled) return;
    const hv = h === "" ? null : parseInt(h, 10);
    const av = a === "" ? null : parseInt(a, 10);
    if (hv !== null && !isNaN(hv) && av !== null && !isNaN(av)) {
      if (pred === "home" && hv <= av) { setScoreError({ forPred: pred, msg: "Picked team's score must be higher" }); return; }
      if (pred === "away" && av <= hv) { setScoreError({ forPred: pred, msg: "Picked team's score must be higher" }); return; }
      setScoreError({ forPred: null, msg: "" });
      onScore(m.id, hv, av);
    }
  };

  const matchFinished = ko?.status === "finished";
  const actualHome = ko?.home_score ?? null;
  const actualAway = ko?.away_score ?? null;
  const hasPred = !!pred && !!ko?.home_team_name;
  const showInputs = hasPred && !matchFinished;
  const showActual = matchFinished && actualHome !== null;

  const pHi = h === "" ? null : parseInt(h, 10);
  const pAi = a === "" ? null : parseInt(a, 10);
  const scoreCorrect = showActual && hasPred && pHi !== null && pAi !== null && pHi === actualHome && pAi === actualAway;
  const scoreWrong = showActual && hasPred && pHi !== null && pAi !== null && !scoreCorrect;

  const homeLabel = ko?.home_team_name ? <>{flag(ko.home_team_code)} {ko.home_team_name}</> : <SlotLabel />;
  const awayLabel = ko?.away_team_name ? <>{flag(ko.away_team_code)} {ko.away_team_name}</> : <SlotLabel />;

  const timeLabel = matchOpen
    ? { text: "Closes: " + formatKoTime(meta.closesAt), red: true }
    : { text: "Opens after: " + formatKoTime(meta.opensAfter), red: false };

  return (
    <div
      className={`bracket-match ${status || ""} ${isSaving ? "saving" : ""} ${!matchOpen ? "not-open" : ""} ${matchOpen && !pred && ko?.home_team_name ? "unpicked" : ""} ${pickedNoScore ? "picked-no-score" : ""}`}
      style={{ position: "absolute", left, top, width: ROUND_W, height: MATCH_H }}
    >
      <div className={`bracket-team top ${canPick ? "clickable" : ""} ${pred === "home" ? "picked" : ""}`}
        onClick={canPick ? () => onPick(m.id, "home") : undefined}>
        <span className="team-label">{homeLabel}</span>
        <div className="team-score-area" onClick={(e) => e.stopPropagation()}>
          {showInputs && (
            <input type="number" min="0" max="20" value={h}
              onChange={(e) => { setH(e.target.value); setScoreError({ forPred: null, msg: "" }); }}
              onBlur={handleBlur}
              disabled={scoreDisabled} className="bracket-score-input" placeholder="?" />
          )}
          {showActual && <span className="score-actual">{actualHome}</span>}
        </div>
      </div>
      <div className={`bracket-team bottom ${canPick ? "clickable" : ""} ${pred === "away" ? "picked" : ""}`}
        onClick={canPick ? () => onPick(m.id, "away") : undefined}>
        <span className="team-label">{awayLabel}</span>
        <div className="team-score-area" onClick={(e) => e.stopPropagation()}>
          {showInputs && (
            <input type="number" min="0" max="20" value={a}
              onChange={(e) => { setA(e.target.value); setScoreError({ forPred: null, msg: "" }); }}
              onBlur={handleBlur}
              disabled={scoreDisabled} className="bracket-score-input" placeholder="?" />
          )}
          {showActual && <span className="score-actual">{actualAway}</span>}
        </div>
      </div>
      {visibleError && <div className="score-error">{visibleError}</div>}
      {(scoreCorrect || scoreWrong) && (
        <div className={`score-result ${scoreCorrect ? "correct" : "wrong"}`}>
          {scoreCorrect ? "✓ exact score" : `✗ was ${actualHome}–${actualAway}`}
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

function Bracket({ predictions = {}, scores = {}, onPick, onScore, saving, koMatches = [], pointsMap = {}, openMatchIds = new Set(), matchMeta = {} }) {
  const rounds = [
    {
      name: "Round of 32",
      matches: [
        { id: "R32-1", home: "2A", away: "2B" }, { id: "R32-3", home: "1F", away: "2C" },
        { id: "R32-2", home: "1E", away: "3A/B/C/D/F" }, { id: "R32-5", home: "1I", away: "3C/D/F/G/H" },
        { id: "R32-4", home: "1C", away: "2F" }, { id: "R32-6", home: "2E", away: "2I" },
        { id: "R32-7", home: "1A", away: "3C/E/F/H/I" }, { id: "R32-8", home: "1L", away: "3E/H/I/J/K" },
        { id: "R32-11", home: "2K", away: "2L" }, { id: "R32-12", home: "1H", away: "2J" },
        { id: "R32-9", home: "1D", away: "3B/E/F/I/J" }, { id: "R32-10", home: "1G", away: "3A/E/H/I/J" },
        { id: "R32-14", home: "1J", away: "2H" }, { id: "R32-16", home: "2D", away: "2G" },
        { id: "R32-13", home: "1B", away: "3E/F/G/I/J" }, { id: "R32-15", home: "1K", away: "3D/E/I/J/L" },
      ],
    },
    {
      name: "Round of 16",
      matches: [
        { id: "R16-2", home: "W R32-1", away: "W R32-3" }, { id: "R16-1", home: "W R32-2", away: "W R32-5" },
        { id: "R16-3", home: "W R32-4", away: "W R32-6" }, { id: "R16-4", home: "W R32-7", away: "W R32-8" },
        { id: "R16-5", home: "W R32-11", away: "W R32-12" }, { id: "R16-6", home: "W R32-9", away: "W R32-10" },
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
  const TOTAL_W = rounds.length * ROUND_W + (rounds.length - 1) * CONN_W;

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
        <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {lines.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#2a5a2a" strokeWidth="1" />
          ))}
        </svg>

        {rounds.map((round, ri) => (
          <div key={round.name}>
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
