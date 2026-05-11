function Bracket() {
  // 2026 World Cup: 48 teams, 12 groups (A-L)
  // Top 2 from each group (24) + 8 best 3rd-place teams = 32
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

  return (
    <div className="bracket">
      <div className="bracket-rounds">
        {rounds.map((round) => (
          <div key={round.name} className="bracket-round">
            <h4 className="bracket-round-title">{round.name}</h4>
            <div className="bracket-matches">
              {round.matches.map((m) => (
                <div key={m.id} className="bracket-match">
                  <div className="bracket-team">{m.home}</div>
                  <div className="bracket-vs">vs</div>
                  <div className="bracket-team">{m.away}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Bracket;
