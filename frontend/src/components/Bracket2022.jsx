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

// R16 order interleaves feeders so connector lines match actual bracket paths:
//   R16-1 + R16-2 → QF-1 → SF-1   (NED/USA + ARG/AUS → NED/ARG)
//   R16-5 + R16-6 → QF-3 → SF-1   (JPN/CRO + BRA/KOR → CRO/BRA)
//   R16-3 + R16-4 → QF-2 → SF-2   (FRA/POL + ENG/SEN → FRA/ENG)
//   R16-7 + R16-8 → QF-4 → SF-2   (MAR/ESP + POR/SUI → MAR/POR)
const ROUNDS = [
  { name: "Round of 16",   ids: ["22-R16-1","22-R16-2","22-R16-5","22-R16-6","22-R16-3","22-R16-4","22-R16-7","22-R16-8"] },
  { name: "Quarter-Finals", ids: ["22-QF-1","22-QF-3","22-QF-2","22-QF-4"] },
  { name: "Semi-Finals",   ids: ["22-SF-1","22-SF-2"] },
  { name: "Final",         ids: ["22-F"] },
];

const MATCH_H = 88;
const BASE_GAP = 10;
const SLOT = MATCH_H + BASE_GAP;
const ROUND_W = 150;
const CONN_W = 36;
const TITLE_H = 28;
const TOTAL_H = 8 * SLOT - BASE_GAP + TITLE_H;
const TOTAL_W = ROUNDS.length * ROUND_W + (ROUNDS.length - 1) * CONN_W;

const matchCenterY = (r, m) =>
  TITLE_H + (Math.pow(2, r) - 1) * SLOT / 2 + m * Math.pow(2, r) * SLOT + MATCH_H / 2;

const roundLeft = (r) => r * (ROUND_W + CONN_W);

function buildLines() {
  const lines = [];
  for (let r = 0; r < ROUNDS.length - 1; r++) {
    const numPairs = ROUNDS[r].ids.length / 2;
    const matchRight = roundLeft(r) + ROUND_W;
    const connX = matchRight + CONN_W / 2;
    const nextLeft = roundLeft(r + 1);
    for (let j = 0; j < numPairs; j++) {
      const topY = matchCenterY(r, 2 * j);
      const botY = matchCenterY(r, 2 * j + 1);
      const midY = (topY + botY) / 2;
      lines.push(
        { x1: matchRight, y1: topY,  x2: connX,    y2: topY },
        { x1: matchRight, y1: botY,  x2: connX,    y2: botY },
        { x1: connX,      y1: topY,  x2: connX,    y2: botY },
        { x1: connX,      y1: midY,  x2: nextLeft, y2: midY },
      );
    }
  }
  return lines;
}

const LINES = buildLines();

function evalPickError2022(homePicked, awayPicked, h, a) {
  if (h === "" || a === "") return "";
  const hv = parseInt(h, 10);
  const av = parseInt(a, 10);
  if (isNaN(hv) || isNaN(av)) return "";
  if ((homePicked && hv <= av) || (awayPicked && av <= hv))
    return "Picked team's score must be higher";
  return "";
}

function BracketMatch2022({ matchId, left, top, pred, status, isSaving, ko, matchOpen, meta, scoreData, onPick, onScore, displayTzOffset, exactScoresDisabled }) {
  const [h, setH] = useState(scoreData?.home != null ? String(scoreData.home) : "");
  const [a, setA] = useState(scoreData?.away != null ? String(scoreData.away) : "");
  const [scoreError, setScoreError] = useState(() => {
    const h0 = scoreData?.home != null ? String(scoreData.home) : "";
    const a0 = scoreData?.away != null ? String(scoreData.away) : "";
    const hp = pred && ko?.home_team_id && String(pred) === String(ko.home_team_id);
    const ap = pred && ko?.away_team_id && String(pred) === String(ko.away_team_id);
    return { forPred: pred, msg: evalPickError2022(hp, ap, h0, a0) };
  });

  // For WC2022 the DB status is always 'finished' (tournament is over), so we
  // drive locked/finished state entirely from the mock-date-aware matchOpen flag.
  const matchLocked = !matchOpen;
  const canPick = onPick && !matchLocked;
  const scoreDisabled = !onScore || matchLocked;
  const matchFinished = !matchOpen && ko?.winner_team_id != null;
  const pickedNoScore = !exactScoresDisabled && !!pred && !!ko?.home_team_name && !matchLocked && (h === "" || a === "");

  const homeId = ko?.home_team_id;
  const awayId = ko?.away_team_id;
  const homePicked = pred && String(pred) === String(homeId);
  const awayPicked = pred && String(pred) === String(awayId);

  // Event 1: pick changed — re-evaluate current scores for the new pick immediately
  if (scoreError.forPred !== pred) {
    setScoreError({ forPred: pred, msg: exactScoresDisabled ? "" : evalPickError2022(homePicked, awayPicked, h, a) });
  }
  const visibleError = exactScoresDisabled ? "" : scoreError.msg;

  // Event 2: score blur — validate and save
  const handleBlur = () => {
    if (!onScore || scoreDisabled) return;
    const hv = h === "" ? null : parseInt(h, 10);
    const av = a === "" ? null : parseInt(a, 10);
    if (hv !== null && !isNaN(hv) && av !== null && !isNaN(av)) {
      setScoreError({ forPred: pred, msg: evalPickError2022(homePicked, awayPicked, h, a) });
      onScore(matchId, hv, av);
    }
  };

  const actualHome = ko?.home_score ?? null;
  const actualAway = ko?.away_score ?? null;

  const hasPred = !!pred && !!ko?.home_team_name;
  const showInputs = !exactScoresDisabled && hasPred && !matchFinished;
  const showActual = matchFinished && actualHome !== null;

  const pHi = h === "" ? null : parseInt(h, 10);
  const pAi = a === "" ? null : parseInt(a, 10);
  const scoreCorrect = !exactScoresDisabled && showActual && hasPred && pHi !== null && pAi !== null && pHi === actualHome && pAi === actualAway;
  const scoreWrong = !exactScoresDisabled && showActual && hasPred && pHi !== null && pAi !== null && !scoreCorrect;

  const homeLabel = ko?.home_team_name ? <>{flag(ko.home_team_code)} {ko.home_team_name}</> : <SlotLabel />;
  const awayLabel = ko?.away_team_name ? <>{flag(ko.away_team_code)} {ko.away_team_name}</> : <SlotLabel />;

  const timeLabel = matchOpen
    ? { text: "Closes: " + formatKoTime(meta.closesAt, displayTzOffset), red: true }
    : { text: meta.opensAfter ? "Opens: " + formatKoTime(meta.opensAfter, displayTzOffset) : null, red: false };

  return (
    <div
      className={`bracket-match ${status || ""} ${isSaving ? "saving" : ""} ${!matchOpen ? "not-open" : ""} ${matchOpen && !pred && ko?.home_team_name ? "unpicked" : ""} ${pickedNoScore ? "picked-no-score" : ""}`}
      style={{ position: "absolute", left, top, width: ROUND_W, height: MATCH_H }}
    >
      <div className={`bracket-team top ${canPick ? "clickable" : ""} ${homePicked ? "picked" : ""}`}
        onClick={canPick && homeId ? () => onPick(matchId, homeId) : undefined}>
        <span className="team-label">{homeLabel}</span>
        <div className="team-score-area" onClick={(e) => e.stopPropagation()}>
          {showInputs && (
            <input type="number" min="0" max="20" value={h}
              onChange={(e) => { setH(e.target.value); setScoreError({ forPred: pred, msg: "" }); }}
              onBlur={handleBlur}
              disabled={scoreDisabled} className="bracket-score-input" placeholder="?" />
          )}
          {showActual && <span className="score-actual">{actualHome}</span>}
        </div>
      </div>
      <div className={`bracket-team bottom ${canPick ? "clickable" : ""} ${awayPicked ? "picked" : ""}`}
        onClick={canPick && awayId ? () => onPick(matchId, awayId) : undefined}>
        <span className="team-label">{awayLabel}</span>
        <div className="team-score-area" onClick={(e) => e.stopPropagation()}>
          {showInputs && (
            <input type="number" min="0" max="20" value={a}
              onChange={(e) => { setA(e.target.value); setScoreError({ forPred: pred, msg: "" }); }}
              onBlur={handleBlur}
              disabled={scoreDisabled} className="bracket-score-input" placeholder="?" />
          )}
          {showActual && <span className="score-actual">{actualAway}</span>}
        </div>
      </div>
      {!exactScoresDisabled && visibleError && <div className="score-error">{visibleError}</div>}
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

function Bracket2022({ predictions = {}, scores = {}, onPick, onScore, saving, koMatches = [], pointsMap = {}, openMatchIds = new Set(), matchMeta = {}, displayTzOffset, exactScoresDisabled = false }) {
  const getKoMatch = (id) => koMatches.find((m) => m.id === id);

  const getMatchStatus = (id) => {
    const ko = getKoMatch(id);
    if (!ko || ko.status !== "finished" || !ko.winner_team_id) return null;
    const pred = predictions[id];
    if (!pred) return null;
    return String(pred) === String(ko.winner_team_id) ? "correct" : "wrong";
  };

  return (
    <div className="bracket">
      <div className="bracket-canvas" style={{ position: "relative", width: TOTAL_W, height: TOTAL_H }}>
        <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {LINES.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#2a5a2a" strokeWidth="1" />
          ))}
        </svg>

        {ROUNDS.map((round, ri) => (
          <div key={round.name}>
            <div className="bracket-round-title" style={{ position: "absolute", left: roundLeft(ri), top: 0, width: ROUND_W }}>
              {round.name}
              {pointsMap[round.name] && <span className="bracket-pts-label"> ({pointsMap[round.name]} pts)</span>}
            </div>

            {round.ids.map((matchId, mi) => {
              const ko = getKoMatch(matchId);
              const pred = predictions[matchId];
              const status = getMatchStatus(matchId);
              const matchOpen = openMatchIds.has(matchId);
              const scoreData = scores[matchId];
              return (
                <BracketMatch2022
                  key={`${matchId}-${scoreData?.home ?? ""}-${scoreData?.away ?? ""}`}
                  matchId={matchId}
                  left={roundLeft(ri)}
                  top={matchCenterY(ri, mi) - MATCH_H / 2}
                  pred={pred}
                  status={status}
                  isSaving={saving === matchId}
                  ko={ko}
                  matchOpen={matchOpen}
                  meta={matchMeta[matchId] || {}}
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

export default Bracket2022;
