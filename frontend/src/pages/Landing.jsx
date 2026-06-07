import Auth from "./Auth";

const FEATURES = [
  { icon: "🎯", text: "Group stage and knockout predictions" },
  { icon: "🏆", text: "Tournament champion prediction" },
  { icon: "🌍", text: "Public or secured private pools" },
  { icon: "👥", text: "No player limit — pools of any size" },
  { icon: "👑", text: "Pool admin controls — members and settings" },
  { icon: "🔗", text: "Invite anyone with one link" },
  { icon: "📊", text: "Live leaderboard after every match" },
  { icon: "💬", text: "Pool chat with your group" },
];

function Landing({ onAuth, initialView }) {
  return (
    <div className="landing">
      <div className="landing-hero">
        <h1 className="landing-title">Sports Pooling</h1>
        <p className="landing-tagline-sub">Free sports pools. Set up in seconds.</p>
      </div>

      <div className="landing-auth">
        <Auth onAuth={onAuth} initialView={initialView} />
      </div>

      <div className="landing-features-section">
        <p className="landing-live-subtitle">
          <span className="live-dot" />
          <span className="live-emoji">⚽</span>
          <span>World Cup 2026 Pools — Live</span>
        </p>
        <div className="landing-features">
          {FEATURES.map((f) => (
            <div key={f.text} className="feature-card">
              <span className="feature-icon">{f.icon}</span>
              <span className="feature-text">{f.text}</span>
            </div>
          ))}
        </div>
        <div className="landing-coming-soon">
          <span className="coming-soon-emoji">🏀</span>
          <span className="coming-soon-text">More sports & tournaments coming soon</span>
          <span className="coming-soon-emoji">⚽</span>
        </div>
      </div>

      <footer className="landing-footer">
        <div className="landing-footer-links">
          <a href="/terms">Terms of Service</a>
          <a href="/terms#privacy">Privacy Policy</a>
        </div>
        <p className="landing-footer-copy">© {new Date().getFullYear()} Sports Pooling</p>
      </footer>
    </div>
  );
}

export default Landing;
