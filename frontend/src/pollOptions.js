// The next-competition poll options. Edit freely — the backend stores whatever
// keys are sent and the admin results view maps keys back via this list.
export const POLL_OPTIONS = [
  // Soccer
  { key: "euro_copa",     emoji: "⚽", label: "Euro / Copa América" },
  { key: "club_leagues",  emoji: "⚽", label: "Club leagues (La Liga, Serie A…)" },
  // Basketball
  { key: "nba",           emoji: "🏀", label: "NBA Playoffs" },
  { key: "march_madness", emoji: "🏀", label: "March Madness (NCAA)" },
  // Other sports
  { key: "nfl",           emoji: "🏈", label: "NFL — playoffs / Super Bowl" },
  { key: "cricket",       emoji: "🏏", label: "Cricket — T20 World Cup / IPL" },
  { key: "tennis",        emoji: "🎾", label: "Tennis — Grand Slams" },
  { key: "f1",            emoji: "🏎️", label: "Formula 1 season" },
  { key: "olympics",      emoji: "🥇", label: "Olympics medal predictions" },
];
