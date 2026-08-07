import { tournamentsForSport } from "../catalog";

function SelectTournament({ sport, onSelect, onBack }) {
  const list = tournamentsForSport(sport.id);

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
