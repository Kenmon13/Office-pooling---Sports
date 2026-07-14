import { useState } from "react";
import DonateModal from "./DonateModal";

// Shown once per user after login, in place of the old "what should we build next?" poll.
//
// Dismissal lives in localStorage (not sessionStorage, which the poll used to make itself
// reappear every login) — an announcement people have already read shouldn't nag. Bump
// ANNOUNCEMENT_KEY when there's something new to say and everyone sees it again.
const ANNOUNCEMENT_KEY = "announcement:seen:pools-2627";

const POOLS = [
  { tournament: "nfl2627",    sport: "americanfootball", emoji: "🏈", name: "NFL 26/27",            blurb: "Weekly picks, division winners and the Super Bowl", isNew: true },
  { tournament: "epl2627",    sport: "soccer",           emoji: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", name: "Premier League 26/27", blurb: "38 matchdays, season table and player awards" },
  { tournament: "laliga2627", sport: "soccer",           emoji: "🇪🇸", name: "La Liga 26/27",        blurb: "38 matchdays, season table and player awards" },
  { tournament: "seriea2627", sport: "soccer",           emoji: "🇮🇹", name: "Serie A 26/27",        blurb: "38 matchdays, season table and player awards" },
];

function AnnouncementPrompt({ user, onSelectPool }) {
  // App only mounts this once there's a user, and unmounts it on sign-out, so the decision can be
  // made at mount rather than in an effect (which would also trip react-hooks/set-state-in-effect).
  const [show, setShow] = useState(() => !!user && !localStorage.getItem(ANNOUNCEMENT_KEY));
  const [showDonate, setShowDonate] = useState(false);

  if (!show) return null;

  const close = () => {
    localStorage.setItem(ANNOUNCEMENT_KEY, "1");
    setShow(false);
  };

  const pick = (p) => {
    close();
    onSelectPool(p);
  };

  return (
    <>
      <div className="modal-overlay" onClick={close}>
        <div className="modal-box announce-modal" onClick={(e) => e.stopPropagation()}>
          <div className="issue-chat-header">
            <h3>🎉 New pools are live</h3>
          </div>
          <p className="poll-subtitle">
            These pools are open now — pick one to jump straight in.
          </p>

          <div className="announce-pools">
            {POOLS.map((p) => (
              <button key={p.tournament} className="announce-pool" onClick={() => pick(p)}>
                <span className="announce-pool-emoji">{p.emoji}</span>
                <span className="announce-pool-text">
                  <span className="announce-pool-name">
                    {p.name}
                    {p.isNew && <span className="announce-new">NEW</span>}
                  </span>
                  <span className="announce-pool-blurb">{p.blurb}</span>
                </span>
                <span className="announce-pool-go">&rarr;</span>
              </button>
            ))}
          </div>

          <p className="poll-note">Thanks for being part of Sports Pooling!<br />Good luck this season.</p>

          <div className="modal-actions poll-actions">
            <button className="btn-submit" onClick={close}>Got it</button>
          </div>

          <button type="button" className="poll-donate-link" onClick={() => setShowDonate(true)}>
            Enjoying Sports Pooling? ☕ Click here to support us ❤️
          </button>
        </div>
      </div>
      {showDonate && <DonateModal onClose={() => setShowDonate(false)} />}
    </>
  );
}

export default AnnouncementPrompt;
