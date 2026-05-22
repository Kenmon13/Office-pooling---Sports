import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { useState, useEffect } from "react";
import Matches from "./pages/Matches";
import Knockouts from "./pages/Knockouts";
import Leaderboard from "./pages/Leaderboard";
import Champion from "./pages/Champion";
import History from "./pages/History";
import SelectSport from "./pages/SelectSport";
import SelectTournament from "./pages/SelectTournament";
import JoinPool from "./pages/JoinPool";
import AdminPanel from "./pages/AdminPanel";
import Auth from "./pages/Auth";
import { autoJoinPool, fetchLeaderboard, fetchWC2022Leaderboard, adminAddTestParticipants, adminRandomizePicks, adminSetMockDate, adminClearMockDate } from "./api";
import "./App.css";

const TOURNAMENT_META = {
  wc2026: { id: "wc2026", name: "World Cup 2026", emoji: "🏆" },
  wc2022: { id: "wc2022", name: "World Cup 2022", emoji: "🏆" },
};

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("auth_user");
    return saved ? JSON.parse(saved) : null;
  });
  const [participant, setParticipant] = useState(null);
  const [points, setPoints] = useState(0);

  const [showAdmin, setShowAdmin] = useState(false);
  const [selectedSport, setSelectedSport] = useState(() => {
    const saved = localStorage.getItem("pool_session");
    if (!saved) return null;
    return JSON.parse(saved).sport ?? null;
  });
  const [selectedTournament, setSelectedTournament] = useState(() => {
    const saved = localStorage.getItem("pool_session");
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    const t = parsed.tournament ?? null;
    if (!t && parsed.pool?.tournament) {
      return TOURNAMENT_META[parsed.pool.tournament] || { id: parsed.pool.tournament, name: parsed.pool.tournament, emoji: "🏆" };
    }
    return t;
  });
  const [pool, setPool] = useState(() => {
    const saved = localStorage.getItem("pool_session");
    if (!saved) return null;
    return JSON.parse(saved).pool ?? null;
  });

  // Auto-join pool when user and pool are both set
  useEffect(() => {
    if (user && pool) {
      autoJoinPool(user.id, pool.id).then((p) => {
        if (!p.error) setParticipant(p);
      });
    }
  }, [user, pool]);

  // Refresh points whenever participant or pool changes
  useEffect(() => {
    if (participant && pool) {
      const fetchFn = pool.tournament === "wc2022" ? fetchWC2022Leaderboard : fetchLeaderboard;
      fetchFn(pool.id).then((data) => {
        const me = data.find((p) => p.id === participant.id);
        setPoints(me ? me.points : 0);
      });
    }
  }, [participant, pool]);

  const handleAuth = (userData) => {
    setUser(userData);
    localStorage.setItem("auth_user", JSON.stringify(userData));
  };

  const handleSignOut = () => {
    setUser(null);
    setParticipant(null);
    setSelectedSport(null);
    setSelectedTournament(null);
    setPool(null);
    localStorage.removeItem("auth_user");
    localStorage.removeItem("pool_session");
  };

  const handleSelectSport = (sport) => {
    setSelectedSport(sport);
  };

  const handleJoinPool = (poolData) => {
    setPool(poolData);
    setShowAdmin(false);
    const sport = selectedSport || { id: poolData.sport, name: poolData.sport, emoji: poolData.sport === "soccer" ? "\u26BD" : "\uD83C\uDFC0" };
    setSelectedSport(sport);
    const tournament = selectedTournament || TOURNAMENT_META[poolData.tournament] || { id: poolData.tournament, name: poolData.tournament, emoji: "\uD83C\uDFC6" };
    setSelectedTournament(tournament);
    localStorage.setItem(
      "pool_session",
      JSON.stringify({ sport, tournament, pool: poolData })
    );
  };

  const handleBackToSport = () => {
    setSelectedSport(null);
    setSelectedTournament(null);
  };

  const handleBackToTournament = () => {
    setSelectedTournament(null);
  };

  const handleLeavePool = () => {
    setSelectedSport(null);
    setSelectedTournament(null);
    setPool(null);
    setParticipant(null);
    localStorage.removeItem("pool_session");
  };

  // Step 0: Sign in / Sign up
  if (!user) {
    return (
      <div className="app">
        <Auth onAuth={handleAuth} />
      </div>
    );
  }

  // Admin panel
  if (showAdmin) {
    return (
      <div className="app">
        <AdminPanel
          user={user}
          onSelectPool={handleJoinPool}
          onBack={() => setShowAdmin(false)}
        />
      </div>
    );
  }

  // Step 1: Pick a sport
  if (!selectedSport) {
    return (
      <div className="app">
        <div className="auth-bar">
          Signed in as <strong>{user.display_name}</strong>
          <button onClick={handleSignOut} className="btn-small">Sign Out</button>
        </div>
        <SelectSport onSelect={handleSelectSport} onAdminLogin={user.is_admin ? () => setShowAdmin(true) : null} />
      </div>
    );
  }

  // Step 2: Pick a tournament
  if (!selectedTournament) {
    return (
      <div className="app">
        <SelectTournament
          sport={selectedSport}
          onSelect={(t) => setSelectedTournament(t)}
          onBack={handleBackToSport}
        />
      </div>
    );
  }

  // Step 3: Create or join a pool
  if (!pool) {
    return (
      <div className="app">
        <JoinPool
          sport={selectedSport}
          tournament={selectedTournament}
          onJoin={handleJoinPool}
          onBack={handleBackToTournament}
        />
      </div>
    );
  }

  // Step 4: The main pool view
  return (
    <BrowserRouter>
      <div className="app">
        <header>
          <div className="header-top">
            <div>
              <h1>{selectedTournament.emoji} {pool.name}</h1>
              <p className="pool-meta">
                {selectedTournament.name}
                <button onClick={handleLeavePool} className="btn-small">
                  Leave Pool
                </button>
              </p>
            </div>
            <div className="header-right">
              <div className="header-user">
                <span className="header-user-name">{user.display_name}</span>
                {participant && (
                  <span className="header-user-points">{points} pts</span>
                )}
                <button onClick={handleSignOut} className="btn-small">Sign Out</button>
              </div>
              <svg className="soccer-ball" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="48" fill="#fff" stroke="#222" strokeWidth="2"/>
                <polygon points="50,18 61,30 56,44 44,44 39,30" fill="#222"/>
                <polygon points="75,38 82,52 74,63 62,58 62,44" fill="#222"/>
                <polygon points="68,76 56,82 44,82 32,76 38,63 62,63" fill="#222"/>
                <polygon points="25,38 38,44 38,58 26,63 18,52" fill="#222"/>
                <polygon points="50,6 61,18 39,18" fill="#222" opacity="0.3"/>
                <polygon points="84,30 75,38 62,30 66,18 78,20" fill="#222" opacity="0.3"/>
                <polygon points="16,30 22,20 34,18 38,30 25,38" fill="#222" opacity="0.3"/>
                <polygon points="88,62 82,52 86,40" fill="#222" opacity="0.15"/>
                <polygon points="12,62 14,40 18,52" fill="#222" opacity="0.15"/>
                <polygon points="26,76 18,64 12,72" fill="#222" opacity="0.15"/>
                <polygon points="74,76 82,64 88,72" fill="#222" opacity="0.15"/>
                <polygon points="44,94 44,82 56,82 56,94" fill="#222" opacity="0.15"/>
              </svg>
            </div>
          </div>
          <nav>
            <NavLink to="/">Groups</NavLink>
            <NavLink to="/knockouts">Knockouts</NavLink>
            <NavLink to="/champion">Winner</NavLink>
            <NavLink to="/leaderboard">Leaderboard</NavLink>
            <NavLink to="/history">History</NavLink>
          </nav>
        </header>

        <main>
          {!!pool.is_test && !!user.is_admin && (
            <TestControls userId={user.id} pool={pool} onMockDateChange={(d) => setPool((p) => ({ ...p, mock_date: d }))} />
          )}
          <Routes>
            <Route path="/" element={<Matches currentUser={participant} tournament={pool.tournament} poolId={pool.id} mockDate={pool.mock_date} />} />
            <Route path="/knockouts" element={<Knockouts currentUser={participant} tournament={pool.tournament} poolId={pool.id} mockDate={pool.mock_date} />} />
            <Route path="/champion" element={<Champion currentUser={participant} tournament={pool.tournament} poolId={pool.id} mockDate={pool.mock_date} />} />
            <Route path="/leaderboard" element={<Leaderboard poolId={pool.id} tournament={pool.tournament} mockDate={pool.mock_date} />} />
            <Route path="/history" element={<History currentUser={participant} tournament={pool.tournament} poolId={pool.id} mockDate={pool.mock_date} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

function utcToSGTParts(utcStr) {
  if (!utcStr) return { date: "", time: "00:00" };
  const sgt = new Date(new Date(utcStr.replace(" ", "T") + "Z").getTime() + 8 * 3600000);
  const iso = sgt.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function TestControls({ userId, pool, onMockDateChange }) {
  const [mockDate, setMockDate] = useState(() => utcToSGTParts(pool.mock_date).date);
  const [mockTime, setMockTime] = useState(() => utcToSGTParts(pool.mock_date).time);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(""), 2500); };

  const syncInputs = (utcStr) => {
    const { date, time } = utcToSGTParts(utcStr);
    setMockDate(date);
    setMockTime(time);
  };

  const adjustDate = async (offsetMs) => {
    setBusy(true);
    const base = pool.mock_date ? new Date(pool.mock_date.replace(" ", "T") + "Z") : new Date();
    const next = new Date(base.getTime() + offsetMs);
    const utcStr = next.toISOString().slice(0, 16).replace("T", " ");
    await adminSetMockDate(userId, pool.id, utcStr);
    onMockDateChange(utcStr);
    syncInputs(utcStr);
    flash("Date adjusted");
    setBusy(false);
  };

  const applyDate = async () => {
    if (!mockDate) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mockDate)) { flash("Date: YYYY-MM-DD"); return; }
    if (!/^\d{2}:\d{2}$/.test(mockTime)) { flash("Time: HH:MM"); return; }
    setBusy(true);
    const utcStr = new Date(`${mockDate}T${mockTime}+08:00`).toISOString().slice(0, 16).replace("T", " ");
    await adminSetMockDate(userId, pool.id, utcStr);
    onMockDateChange(utcStr);
    flash("Date set");
    setBusy(false);
  };

  const clearDate = async () => {
    setBusy(true);
    await adminClearMockDate(userId, pool.id);
    setMockDate("");
    setMockTime("00:00");
    onMockDateChange(null);
    flash("Using real time");
    setBusy(false);
  };

  const addPlayers = async (n) => {
    setBusy(true);
    const res = await adminAddTestParticipants(userId, pool.id, n);
    flash(res.added?.length ? `Added ${res.added.length} player(s)` : (res.error || "No more names available"));
    setBusy(false);
  };

  const randomize = async () => {
    setBusy(true);
    const res = await adminRandomizePicks(userId, pool.id);
    flash(res.success ? `Randomized picks for ${res.participants} players` : (res.error || "Error"));
    setBusy(false);
  };

  const H = 3600000;
  const D = 86400000;

  return (
    <div className="test-controls">
      <span className="test-badge">TEST POOL</span>
      <div className="test-controls-actions">
        <button className="btn-test" onClick={() => addPlayers(5)} disabled={busy}>+5 Players</button>
        <button className="btn-test" onClick={() => addPlayers(1)} disabled={busy}>+1 Player</button>
        <button className="btn-test" onClick={randomize} disabled={busy}>Randomize Picks</button>
        <span className="test-divider" />
        <span className="test-date-label">Sim time (SGT):</span>
        <input type="text" className="test-date-input" placeholder="YYYY-MM-DD" value={mockDate} onChange={(e) => setMockDate(e.target.value)} />
        <div className="test-spin">
          <button className="btn-spin" onClick={() => adjustDate(D)} disabled={busy}>▲</button>
          <button className="btn-spin" onClick={() => adjustDate(-D)} disabled={busy}>▼</button>
        </div>
        <input type="text" className="test-date-input test-time-input" placeholder="HH:MM" value={mockTime} onChange={(e) => setMockTime(e.target.value)} />
        <div className="test-spin">
          <button className="btn-spin" onClick={() => adjustDate(H)} disabled={busy}>▲</button>
          <button className="btn-spin" onClick={() => adjustDate(-H)} disabled={busy}>▼</button>
        </div>
        <button className="btn-test" onClick={applyDate} disabled={busy || !mockDate}>Set</button>
        {pool.mock_date && (
          <button className="btn-test btn-test-clear" onClick={clearDate} disabled={busy}>Clear</button>
        )}
      </div>
      {msg && <span className="test-msg">{msg}</span>}
    </div>
  );
}

export default App;
