import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { useState, useEffect } from "react";
import Matches from "./pages/Matches";
import Predictions from "./pages/Predictions";
import Leaderboard from "./pages/Leaderboard";
import SelectSport from "./pages/SelectSport";
import SelectTournament from "./pages/SelectTournament";
import JoinPool from "./pages/JoinPool";
import AdminPanel from "./pages/AdminPanel";
import Auth from "./pages/Auth";
import { autoJoinPool } from "./api";
import "./App.css";

function App() {
  const [user, setUser] = useState(null);
  const [participant, setParticipant] = useState(null);

  const [showAdmin, setShowAdmin] = useState(false);
  const [selectedSport, setSelectedSport] = useState(null);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [pool, setPool] = useState(null);

  useEffect(() => {
    const savedUser = localStorage.getItem("auth_user");
    if (savedUser) setUser(JSON.parse(savedUser));

    const savedSession = localStorage.getItem("pool_session");
    if (savedSession) {
      const session = JSON.parse(savedSession);
      setSelectedSport(session.sport);
      setSelectedTournament(session.tournament);
      setPool(session.pool);
    }
  }, []);

  // Auto-join pool when user and pool are both set
  useEffect(() => {
    if (user && pool) {
      autoJoinPool(user.id, pool.id).then((p) => {
        if (!p.error) setParticipant(p);
      });
    }
  }, [user, pool]);

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
    localStorage.setItem(
      "pool_session",
      JSON.stringify({ sport, tournament: selectedTournament, pool: poolData })
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
          <nav>
            <NavLink to="/">Matches</NavLink>
            <NavLink to="/predictions">My Predictions</NavLink>
            <NavLink to="/leaderboard">Leaderboard</NavLink>
          </nav>
          <div className="user-bar">
            <span>
              Playing as <strong>{user.display_name}</strong>
              <button onClick={handleSignOut} className="btn-small">
                Sign Out
              </button>
            </span>
          </div>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<Matches />} />
            <Route
              path="/predictions"
              element={<Predictions currentUser={participant} />}
            />
            <Route path="/leaderboard" element={<Leaderboard poolId={pool.id} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
