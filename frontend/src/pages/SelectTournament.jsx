function SelectTournament({ sport, onSelect, onBack }) {
  const tournaments = {
    soccer: [
      { id: "wc2026", name: "World Cup 2026", emoji: "\uD83C\uDFC6", available: true },
      { id: "ucl2627", name: "Champions League 26/27", emoji: "\u2B50", available: true },
      { id: "epl2627", name: "English Premier League 26/27", emoji: "\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F", available: true },
      { id: "laliga2627", name: "La Liga 26/27", emoji: "\uD83C\uDDEA\uD83C\uDDF8", available: true },
      { id: "seriea2627", name: "Serie A 26/27", emoji: "\uD83C\uDDEE\uD83C\uDDF9", available: true },
    ],
    americanfootball: [
      { id: "nfl2627", name: "NFL 26/27", emoji: "\uD83C\uDFC8", available: true },
    ],
  };

  const list = tournaments[sport.id] || [];

  return (
    <div className="select-page">
      <button className="back-btn" onClick={onBack}>&larr; Back</button>
      <h2>{sport.emoji} {sport.name}</h2>
      <p className="select-subtitle">Pick a tournament</p>
      <div className="tournament-list">
        {list.map((t) => (
          <button
            key={t.id}
            className={`tournament-card${!t.available ? " disabled" : ""}`}
            onClick={() => t.available && onSelect(t)}
            disabled={!t.available}
          >
            <span className="tournament-emoji">{t.emoji}</span>
            <span className="tournament-name">{t.name}</span>
            {!t.available && <span className="coming-soon">Coming Soon</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export default SelectTournament;
