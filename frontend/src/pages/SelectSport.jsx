function SelectSport({ onSelect }) {
  const sports = [
    { id: "soccer", name: "Soccer", emoji: "\u26BD", available: true },
    { id: "americanfootball", name: "American Football", emoji: "\uD83C\uDFC8", available: true },
    { id: "basketball", name: "Basketball", emoji: "\uD83C\uDFC0", available: false },
  ];

  return (
    <div className="select-page">
      <h2>Pick a Sport</h2>
      <p className="select-subtitle">Choose the sport you want to join a pool for</p>
      <div className="sport-grid">
        {sports.map((sport) => (
          <button
            key={sport.id}
            className={`sport-card${!sport.available ? " disabled" : ""}`}
            onClick={() => sport.available && onSelect(sport)}
            disabled={!sport.available}
          >
            <span className="sport-emoji">{sport.emoji}</span>
            <span className="sport-name">{sport.name}</span>
            {!sport.available && <span className="coming-soon">Coming Soon</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export default SelectSport;
