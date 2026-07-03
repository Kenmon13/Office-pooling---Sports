import { useState, useEffect } from "react";
import { fetchPollStatus, submitPollVote, dismissPoll } from "../api";
import { POLL_OPTIONS } from "../pollOptions";
import DonateModal from "./DonateModal";

// sessionStorage (not localStorage) — "Maybe later" hides the poll for this browser
// session only, so it reappears next login. "Voted"/"Dismissed" are server-side (never again).
const SNOOZE_KEY = "poll:next:snooze";

function PollPrompt({ user }) {
  const [show, setShow] = useState(false);
  const [choices, setChoices] = useState([]);
  const [other, setOther] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [showDonate, setShowDonate] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (sessionStorage.getItem(SNOOZE_KEY)) return;
    let alive = true;
    fetchPollStatus()
      .then((d) => { if (alive && d && !d.done) setShow(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user]);

  if (!show) return null;

  const toggle = (key) =>
    setChoices((c) => (c.includes(key) ? c.filter((x) => x !== key) : [...c, key]));

  const canSubmit = choices.length > 0 || other.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    const res = await submitPollVote(choices, other.trim());
    setSubmitting(false);
    if (res && !res.error) setThanks(true);
  };

  const handleLater = () => {
    sessionStorage.setItem(SNOOZE_KEY, "1");
    setShow(false);
  };

  const handleDismiss = () => {
    setShow(false);
    dismissPoll().catch(() => {});
  };

  return (
    <>
    <div className="modal-overlay" onClick={thanks ? () => setShow(false) : handleLater}>
      <div className="modal-box poll-modal" onClick={(e) => e.stopPropagation()}>
        {thanks ? (
          <div className="poll-thanks">
            <h3>Thanks! 🙌</h3>
            <p>Your vote's in — we'll use it to decide what to build next.</p>
            <div className="modal-actions">
              <button className="btn-submit" onClick={() => setShow(false)}>Close</button>
            </div>
          </div>
        ) : (
          <>
            <div className="issue-chat-header">
              <h3>🗳️ Poll</h3>
            </div>
            <p className="poll-subtitle">
              Tell us what other sports pool you would like to see! Pick as many as you want.
            </p>
            <div className="poll-options">
              {POLL_OPTIONS.map((o) => (
                <label key={o.key} className={`poll-option ${choices.includes(o.key) ? "checked" : ""}`}>
                  <input type="checkbox" checked={choices.includes(o.key)} onChange={() => toggle(o.key)} />
                  <span className="poll-option-emoji">{o.emoji}</span>
                  <span className="poll-option-label">{o.label}</span>
                </label>
              ))}
            </div>
            <input
              className="poll-other"
              type="text"
              placeholder="Something else? Tell us…"
              value={other}
              maxLength={300}
              onChange={(e) => setOther(e.target.value)}
            />
            <p className="poll-note">Thanks for being part of Sports Pooling!<br />We appreciate all your comments and suggestions.</p>
            <div className="modal-actions poll-actions">
              <button className="btn-submit" disabled={!canSubmit || submitting} onClick={handleSubmit}>
                {submitting ? "Submitting…" : "Submit vote"}
              </button>
              <button className="btn-submit btn-cancel" onClick={handleLater}>Maybe later</button>
              <button className="poll-dismiss-link" onClick={handleDismiss}>Don&rsquo;t show again</button>
            </div>
            <button type="button" className="poll-donate-link" onClick={() => setShowDonate(true)}>
              Enjoying Sports Pooling? ☕ Click here to support us ❤️
            </button>
          </>
        )}
      </div>
    </div>
    {showDonate && <DonateModal onClose={() => setShowDonate(false)} />}
    </>
  );
}

export default PollPrompt;
