import { flag } from "../flags";

function formatKoTime(utcStr) {
  if (!utcStr) return null;
  const d = new Date(utcStr.replace(" ", "T") + "Z");
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatSlot(slot) {
  if (!slot) return "TBD";
  // "1A" / "2B" → "1st, Group A"
  const single = slot.match(/^([123])([A-L])$/);
  if (single) {
    const ord = { "1": "1st", "2": "2nd", "3": "3rd" }[single[1]];
    return `${ord}, Group ${single[2]}`;
  }
  // "3C/D/E" → "Best 3rd (C/D/E)"
  const best3 = slot.match(/^3([A-L](?:\/[A-L])+)$/);
  if (best3) return `Best 3rd (${best3[1]})`;
  // "W R32-1" → "R32 Match 1 winner"
  const win = slot.match(/^W (R32|R16|QF|SF)-(\d+)$/);
  if (win) return `${win[1]} Match ${win[2]} winner`;
  return slot;
}

function Bracket({ predictions = {}, onPick, saving, koMatches = [], pointsMap = {}, openMatchIds = new Set(), matchMeta = {} }) {
  const rounds = [
    {
      name: "Round of 32",
      matches: [
        { id: "R32-1", home: "1A", away: "3C/D/E" },
        { id: "R32-2", home: "2B", away: "2C" },
        { id: "R32-3", home: "1D", away: "3A/B/F" },
        { id: "R32-4", home: "1B", away: "3A/C/D" },
        { id: "R32-5", home: "1E", away: "3B/F/G" },
        { id: "R32-6", home: "2F", away: "2E" },
        { id: "R32-7", home: "1C", away: "3D/E/F" },
        { id: "R32-8", home: "2A", away: "2D" },
        { id: "R32-9", home: "1G", away: "3H/I/J" },
        { id: "R32-10", home: "2H", away: "2I" },
        { id: "R32-11", home: "1J", away: "3G/K/L" },
        { id: "R32-12", home: "1H", away: "3G/I/J" },
        { id: "R32-13", home: "1K", away: "3H/K/L" },
        { id: "R32-14", home: "2L", away: "2K" },
        { id: "R32-15", home: "1I", away: "3J/K/L" },
        { id: "R32-16", home: "2G", away: "2J" },
      ],
    },
    {
      name: "Round of 16",
      matches: [
        { id: "R16-1", home: "W R32-1", away: "W R32-2" },
        { id: "R16-2", home: "W R32-3", away: "W R32-4" },
        { id: "R16-3", home: "W R32-5", away: "W R32-6" },
        { id: "R16-4", home: "W R32-7", away: "W R32-8" },
        { id: "R16-5", home: "W R32-9", away: "W R32-10" },
        { id: "R16-6", home: "W R32-11", away: "W R32-12" },
        { id: "R16-7", home: "W R32-13", away: "W R32-14" },
        { id: "R16-8", home: "W R32-15", away: "W R32-16" },
      ],
    },
    {
      name: "Quarter-Finals",
      matches: [
        { id: "QF-1", home: "W R16-1", away: "W R16-2" },
        { id: "QF-2", home: "W R16-3", away: "W R16-4" },
        { id: "QF-3", home: "W R16-5", away: "W R16-6" },
        { id: "QF-4", home: "W R16-7", away: "W R16-8" },
      ],
    },
    {
      name: "Semi-Finals",
      matches: [
        { id: "SF-1", home: "W QF-1", away: "W QF-2" },
        { id: "SF-2", home: "W QF-3", away: "W QF-4" },
      ],
    },
    {
      name: "Final",
      matches: [{ id: "F", home: "W SF-1", away: "W SF-2" }],
    },
  ];

  const MATCH_H = 72;
  const BASE_GAP = 10;
  const SLOT = MATCH_H + BASE_GAP;
  const ROUND_W = 140;
  const CONN_W = 36;
  const TITLE_H = 28;
  const TOTAL_H = 16 * SLOT - BASE_GAP + TITLE_H;
  const TOTAL_W = rounds.length * ROUND_W + (rounds.length - 1) * CONN_W;

  const matchCenterY = (r, m) =>
    TITLE_H + (Math.pow(2, r) - 1) * SLOT / 2 + m * Math.pow(2, r) * SLOT + MATCH_H / 2;

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

  // Check if a knockout match has a result
  const getKoMatch = (matchId) => koMatches.find((m) => m.id === matchId);

  const getMatchStatus = (matchId) => {
    const ko = getKoMatch(matchId);
    if (!ko) return null;
    if (ko.status !== "finished" || !ko.winner_team_id) return null;
    const pred = predictions[matchId];
    if (!pred) return null;
    return String(pred) === String(ko.winner_team_id) ? "correct" : "wrong";
  };

  return (
    <div className="bracket">
      <div className="bracket-canvas" style={{ position: "relative", width: TOTAL_W, height: TOTAL_H }}>
        <svg
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        >
          {lines.map((l, i) => (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#2a5a2a" strokeWidth="1" />
          ))}
        </svg>

        {rounds.map((round, ri) => (
          <div key={round.name}>
            <div
              className="bracket-round-title"
              style={{ position: "absolute", left: roundLeft(ri), top: 0, width: ROUND_W }}
            >
              {round.name}
              {pointsMap[round.name] && (
                <span className="bracket-pts-label"> ({pointsMap[round.name]} pts)</span>
              )}
            </div>
            {round.matches.map((m, mi) => {
              const pred = predictions[m.id];
              const status = getMatchStatus(m.id);
              const isSaving = saving === m.id;
              const ko = getKoMatch(m.id);
              const matchOpen = openMatchIds.has(m.id);
              const matchLocked = !matchOpen || (ko && ko.status !== "upcoming");
              const canPick = onPick && !matchLocked;
              const meta = matchMeta[m.id] || {};
              const timeLabel = matchOpen
                ? { text: "Closes: " + formatKoTime(meta.closesAt), red: true }
                : { text: "Opens after: " + formatKoTime(meta.opensAfter), red: false };

              const homeLabel = ko?.home_team_name
                ? <>{flag(ko.home_team_code)} {ko.home_team_name}</>
                : formatSlot(m.home);
              const awayLabel = ko?.away_team_name
                ? <>{flag(ko.away_team_code)} {ko.away_team_name}</>
                : formatSlot(m.away);

              return (
                <div
                  key={m.id}
                  className={`bracket-match ${status || ""} ${isSaving ? "saving" : ""} ${!matchOpen ? "not-open" : ""}`}
                  style={{
                    position: "absolute",
                    left: roundLeft(ri),
                    top: matchCenterY(ri, mi) - MATCH_H / 2,
                    width: ROUND_W,
                    height: MATCH_H,
                  }}
                >
                  <div
                    className={`bracket-team top ${canPick ? "clickable" : ""} ${pred === "home" ? "picked" : ""}`}
                    onClick={canPick ? () => onPick(m.id, "home") : undefined}
                  >
                    {homeLabel}
                  </div>
                  <div
                    className={`bracket-team bottom ${canPick ? "clickable" : ""} ${pred === "away" ? "picked" : ""}`}
                    onClick={canPick ? () => onPick(m.id, "away") : undefined}
                  >
                    {awayLabel}
                  </div>
                  {timeLabel.text && (
                    <div className="bracket-match-time" style={{ color: timeLabel.red ? "#ff6b6b" : undefined }}>
                      {timeLabel.text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Bracket;
