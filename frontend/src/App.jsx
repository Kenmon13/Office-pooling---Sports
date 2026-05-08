import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { useState, useEffect } from "react";
import Matches from "./pages/Matches";
import Predictions from "./pages/Predictions";
import Leaderboard from "./pages/Leaderboard";
import Admin from "./pages/Admin";
import { fetchParticipants, createParticipant } from "./api";
import "./App.css";

function App() {
  const [participants, setParticipants] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [joinName, setJoinName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchParticipants().then(setParticipants);
    const saved = localStorage.getItem("worldcup_user");
    if (saved) setCurrentUser(JSON.parse(saved));
  }, []);

  const handleJoin = async (e) => {
    e.preventDefault();
    setError("");
    const result = await createParticipant(joinName);
    if (result.error) {
      setError(result.error);
      return;
    }
    setCurrentUser(result);
    localStorage.setItem("worldcup_user", JSON.stringify(result));
    setParticipants((prev) => [...prev, result]);
    setJoinName("");
  };

  const handleSelect = (p) => {
    setCurrentUser(p);
    localStorage.setItem("worldcup_user", JSON.stringify(p));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem("worldcup_user");
  };

  return (
    <BrowserRouter>
      <div className="app">
        <header>
          <div className="header-top">
            <h1>World Cup 2026 Pool</h1>
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
            <NavLink to="/admin">Admin</NavLink>
          </nav>
          <div className="user-bar">
            {currentUser ? (
              <span>
                Playing as <strong>{currentUser.name}</strong>
                <button onClick={handleLogout} className="btn-small">
                  Switch
                </button>
              </span>
            ) : (
              <div className="join-section">
                <form onSubmit={handleJoin} className="join-form">
                  <input
                    value={joinName}
                    onChange={(e) => setJoinName(e.target.value)}
                    placeholder="Enter your name to join"
                  />
                  <button type="submit">Join Pool</button>
                </form>
                {participants.length > 0 && (
                  <div className="existing-users">
                    <span>Or select: </span>
                    {participants.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleSelect(p)}
                        className="btn-small"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
                {error && <p className="error">{error}</p>}
              </div>
            )}
          </div>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<Matches />} />
            <Route
              path="/predictions"
              element={<Predictions currentUser={currentUser} />}
            />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
