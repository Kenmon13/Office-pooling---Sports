import { useState, useEffect, useRef } from "react";
import { fetchWcPlayers, fetchPlayerAwardPicks, submitPlayerAwardPick, fetchGroups,
  fetchLeaguePlayers, fetchLeaguePlayerAwardPicks, submitLeaguePlayerAwardPick, fetchLeagueTeams } from "../api";
import { flag, plCrest, registerCrests } from "../flags";
import { isLeague, getLeague } from "../leagues";

const WC_AWARDS = [
  { key: "golden_ball",   label: "Golden Ball",          emoji: "🥇", pts: 5, type: "player", desc: "Awarded to the best overall player of the tournament." },
  { key: "golden_boot",   label: "Golden Boot",          emoji: "👟", pts: 5, type: "player", desc: "Awarded to the top goalscorer of the tournament." },
  { key: "golden_glove",  label: "Golden Glove",         emoji: "🧤", pts: 5, type: "player", posFilter: "GK", desc: "Awarded to the best goalkeeper of the tournament." },
  { key: "young_player",  label: "FIFA Young Player",    emoji: "🌟", pts: 2, type: "player", dobAfter: "2005-01-01", desc: "Awarded to the best player aged 21 or younger." },
  { key: "fair_play",     label: "FIFA Fair Play Trophy", emoji: "🤝", pts: 2, type: "team", desc: "Awarded to the team with the best fair play record (fewest fouls, cards, and disciplinary incidents)." },
];

function Players({ currentUser, poolId, mockDate, tournament }) {
  const isLeagueMode = isLeague(tournament);
  const managerAward = isLeagueMode ? (getLeague(tournament)?.awards || []).find((a) => a.type === "team") : null;
  const AWARDS = isLeagueMode ? (getLeague(tournament)?.awards || []) : WC_AWARDS;

  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [picks, setPicks] = useState({});
  const [results, setResults] = useState([]);
  const [locked, setLocked] = useState(false);
  const [lockedByAdmin, setLockedByAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState({});
  const [msg, setMsg] = useState("");

  const crestFn = isLeagueMode ? plCrest : flag;

  useEffect(() => {
    if (isLeagueMode) {
      fetchLeaguePlayers(tournament).then(setPlayers);
      fetchLeagueTeams(tournament).then((t) => { registerCrests(t); setTeams(t); });
    } else {
      fetchWcPlayers().then(setPlayers);
      fetchGroups().then((gs) => {
        const allTeams = gs.flatMap((g) => (g.teams || []).map((t) => ({ ...t, groupName: g.name })));
        setTeams(allTeams);
      });
    }
  }, [isLeagueMode, tournament]);

  useEffect(() => {
    if (!currentUser) return;
    const fetchFn = isLeagueMode ? (uid, pid) => fetchLeaguePlayerAwardPicks(tournament, uid, pid) : fetchPlayerAwardPicks;
    fetchFn(currentUser.id, poolId).then((data) => {
      const pickMap = {};
      for (const p of (data.picks || data)) pickMap[p.award_category] = p;
      setPicks(pickMap);
      setResults(data.results || []);
      setLocked(!!data.locked);
      setLockedByAdmin(!!data.lockedByAdmin);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [currentUser, poolId, mockDate, isLeagueMode, tournament]);

  const handleSave = async (awardKey, playerId, teamId) => {
    if (!currentUser) return;
    setSaving((s) => ({ ...s, [awardKey]: true }));
    setMsg("");
    const res = isLeagueMode
      ? await submitLeaguePlayerAwardPick(tournament, currentUser.id, awardKey, playerId, teamId)
      : await submitPlayerAwardPick(currentUser.id, awardKey, playerId, teamId);
    if (res.error) {
      setMsg(res.error);
    } else {
      const fetchFn = isLeagueMode ? (uid, pid) => fetchLeaguePlayerAwardPicks(tournament, uid, pid) : fetchPlayerAwardPicks;
      const data = await fetchFn(currentUser.id, poolId);
      const pickMap = {};
      for (const p of (data.picks || data)) pickMap[p.award_category] = p;
      setPicks(pickMap);
      setResults(data.results || []);
      setMsg("Pick saved!");
      setTimeout(() => setMsg(""), 3000);
      window.dispatchEvent(new CustomEvent("picks-saved"));
    }
    setSaving((s) => ({ ...s, [awardKey]: false }));
  };

  if (!currentUser) {
    return (
      <div className="page">
        <h2>Player Awards</h2>
        <AwardRules isLeagueMode={isLeagueMode} managerLabel={managerAward?.label} />
        <p className="notice">Join the pool to make your player award picks.</p>
      </div>
    );
  }

  const pickedCount = AWARDS.filter((a) => picks[a.key]).length;
  const missingCount = AWARDS.length - pickedCount;

  return (
    <div className="page">
      <h2>Player Awards</h2>
      <AwardRules isLeagueMode={isLeagueMode} managerLabel={managerAward?.label} />

      {loaded && !locked && missingCount > 0 && (
        <div className="notif-window-card win-urgent" style={{ marginBottom: 16 }}>
          <div className="win-card-top">
            <span className="win-icon">🏅</span>
            <span className="win-title">Player Awards</span>
            <span className="win-badge win-badge-open">Open</span>
          </div>
          <div className="win-card-body">
            {pickedCount}/{AWARDS.length} awards picked
          </div>
          <div className="win-missed">
            ⚠️ {pickedCount === 0 ? "No award picks made" : `${missingCount} award${missingCount === 1 ? "" : "s"} remaining`}
          </div>
        </div>
      )}

      {loaded && locked && (
        <div className="deadline-banner locked" style={{ marginBottom: 16 }}>
          <span className="deadline-locked-text">
            {lockedByAdmin || !isLeagueMode
              ? "This section is locked by the pool admin"
              : "Player award picks are locked — the entry window has closed"}
          </span>
        </div>
      )}

      <div className="player-awards-grid">
        {AWARDS.map((award) => {
          const pick = picks[award.key];
          const result = results.find((r) => r.award_category === award.key);
          const isCorrect = result && (
            award.type === "team"
              ? pick?.team_id && String(pick.team_id) === String(result.team_id)
              : pick?.player_id && String(pick.player_id) === String(result.player_id)
          );

          return (
            <div key={award.key} className={`player-award-card ${isCorrect ? "award-correct" : ""}`}>
              <div className="award-header">
                <span className="award-emoji">{award.emoji}</span>
                <span className="award-name">{award.label}</span>
                <span className="award-pts">{award.pts} pts</span>
              </div>
              <p className="award-desc">{award.desc}</p>

              {pick && (
                <div className={`award-current-pick ${isCorrect ? "correct" : ""}`}>
                  <span className="award-pick-label">Your pick:</span>
                  <span className="award-pick-value">
                    {award.type === "team"
                      ? <>{crestFn(pick.team_code)} {pick.team_name}{pick.manager ? ` — ${pick.manager}` : ""}</>
                      : <>{crestFn(pick.team_code)} {pick.player_name}</>
                    }
                  </span>
                  {isCorrect && <span className="award-correct-badge">+{award.pts} pts</span>}
                </div>
              )}

              {result && !isCorrect && pick && (
                <div className="award-result-info">
                  Winner: {award.type === "team"
                    ? <>{crestFn(result.team_code)} {result.team_name}{result.manager ? ` — ${result.manager}` : ""}</>
                    : <>{result.player_name}</>
                  }
                </div>
              )}

              {!locked && !result && (
                award.type === "team"
                  ? <TeamPicker
                      teams={teams}
                      currentPick={pick}
                      onSelect={(teamId) => handleSave(award.key, null, teamId)}
                      saving={!!saving[award.key]}
                      crestFn={crestFn}
                      isLeagueMode={isLeagueMode}
                    />
                  : <PlayerPicker
                      players={players.filter((p) => {
                        if (award.posFilter && p.position !== award.posFilter) return false;
                        if (award.dobAfter && (!p.dob || p.dob < award.dobAfter)) return false;
                        return true;
                      })}
                      currentPick={pick}
                      onSelect={(playerId) => handleSave(award.key, playerId, null)}
                      saving={!!saving[award.key]}
                      crestFn={crestFn}
                    />
              )}
            </div>
          );
        })}
      </div>

      {msg && <p className="champion-msg">{msg}</p>}
    </div>
  );
}

function PlayerPicker({ players, currentPick, onSelect, saving, crestFn }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = search.length > 0
    ? players.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.team_name || "").toLowerCase().includes(search.toLowerCase()) ||
        (p.team_code || "").toLowerCase().includes(search.toLowerCase())
      )
    : players;

  // Group by team
  const grouped = {};
  for (const p of filtered) {
    const tName = p.team_name || p.team_short || "Unknown";
    if (!grouped[tName]) grouped[tName] = { code: p.team_code, players: [] };
    grouped[tName].players.push(p);
  }

  return (
    <div className="player-picker" ref={ref}>
      <input
        type="text"
        className="player-search"
        placeholder="Search player or team..."
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        disabled={saving}
      />
      {open && (
        <div className="player-dropdown">
          {Object.keys(grouped).length === 0 && (
            <div className="player-dropdown-empty">No players found</div>
          )}
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([teamName, data]) => (
            <div key={teamName} className="player-dropdown-group">
              <div className="player-dropdown-team">{crestFn(data.code)} {teamName}</div>
              {data.players.map((p) => (
                <button
                  key={p.id}
                  className={`player-dropdown-item ${currentPick?.player_id === p.id ? "current" : ""}`}
                  onClick={() => { onSelect(p.id); setOpen(false); setSearch(""); }}
                  disabled={saving}
                >
                  {p.name} <span className="player-pos">{p.position}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamPicker({ teams, currentPick, onSelect, saving, crestFn, isLeagueMode }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = search.length > 0
    ? teams.filter((t) =>
        (t.name || "").toLowerCase().includes(search.toLowerCase()) ||
        (t.short_name || "").toLowerCase().includes(search.toLowerCase()) ||
        (t.code || "").toLowerCase().includes(search.toLowerCase()) ||
        (t.manager || "").toLowerCase().includes(search.toLowerCase())
      )
    : teams;

  if (isLeagueMode) {
    // Flat list for domestic-league clubs (EPL, La Liga, …)
    return (
      <div className="player-picker" ref={ref}>
        <input
          type="text"
          className="player-search"
          placeholder="Search team..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          disabled={saving}
        />
        {open && (
          <div className="player-dropdown">
            {filtered.length === 0 && (
              <div className="player-dropdown-empty">No teams found</div>
            )}
            {filtered.sort((a, b) => (a.short_name || a.name).localeCompare(b.short_name || b.name)).map((t) => (
              <button
                key={t.id}
                className={`player-dropdown-item ${currentPick?.team_id === t.id ? "current" : ""}`}
                onClick={() => { onSelect(t.id); setOpen(false); setSearch(""); }}
                disabled={saving}
              >
                {crestFn(t.code)} {t.short_name || t.name}{t.manager ? ` — ${t.manager}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Group by group letter for WC
  const grouped = {};
  for (const t of filtered) {
    const gKey = `Group ${t.groupName}`;
    if (!grouped[gKey]) grouped[gKey] = [];
    grouped[gKey].push(t);
  }

  return (
    <div className="player-picker" ref={ref}>
      <input
        type="text"
        className="player-search"
        placeholder="Search team..."
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        disabled={saving}
      />
      {open && (
        <div className="player-dropdown">
          {Object.keys(grouped).length === 0 && (
            <div className="player-dropdown-empty">No teams found</div>
          )}
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([groupName, gTeams]) => (
            <div key={groupName} className="player-dropdown-group">
              <div className="player-dropdown-team">{groupName}</div>
              {gTeams.map((t) => (
                <button
                  key={t.id}
                  className={`player-dropdown-item ${currentPick?.team_id === t.id ? "current" : ""}`}
                  onClick={() => { onSelect(t.id); setOpen(false); setSearch(""); }}
                  disabled={saving}
                >
                  {crestFn(t.code)} {t.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AwardRules({ isLeagueMode, managerLabel }) {
  if (isLeagueMode) {
    return (
      <div className="ko-rules">
        <p className="ko-rules-title">How player award picks work</p>
        <ul>
          <li>Predict the winners of five individual/team awards given at the end of the season.</li>
          <li>Each correct pick earns <strong>5 pts</strong>.</li>
          {managerLabel && (
            <li>The <strong>{managerLabel}</strong> is awarded to a team&apos;s manager — pick the club.</li>
          )}
          <li>Picks can be changed freely until locked by the pool admin.</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="ko-rules">
      <p className="ko-rules-title">How player award picks work</p>
      <ul>
        <li>Predict the winners of five individual/team awards given at the end of the tournament.</li>
        <li>
          <strong>Points per correct pick:</strong>
          <ul>
            <li>Golden Ball, Golden Boot, Golden Glove — <strong>5 pts</strong> each</li>
            <li>FIFA Young Player Award, FIFA Fair Play Trophy — <strong>2 pts</strong> each</li>
          </ul>
        </li>
        <li>The <strong>Fair Play Trophy</strong> is awarded to a team, not an individual player.</li>
        <li>Picks can be changed freely until locked by the pool admin.</li>
      </ul>
    </div>
  );
}

export default Players;
