// Donors hall of fame — add a new { user } entry here as donations come in.
const DONORS = [
  { user: "Jamie Vejar" },
];

function DonateModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box donate-modal" onClick={(e) => e.stopPropagation()}>
        <div className="issue-chat-header">
          <h3>Support sportspooling ❤️</h3>
        </div>

        <p>Thank you for using sportspooling. We hope you enjoy this, and we aim to constantly add more pools for you guys to enjoy further.</p>
        <p>If you want to show support, you may donate to me at my PayPal account. This goes into resources such as maintaining the website and the domain name.</p>
        <p>If you choose to do so, please also make sure you have enough for yourself as well — after all, this is a pet project and your wellbeing is more important.</p>

        <div className="donate-paypal">
          <span className="donate-paypal-label">PayPal</span>
          <span className="donate-paypal-handle">@kenmon13</span>
        </div>

        <div className="donate-hof">
          <h4>🏆 Hall of Fame of Donors</h4>
          <table className="donate-hof-table">
            <thead>
              <tr><th>User</th></tr>
            </thead>
            <tbody>
              {DONORS.map((d, i) => (
                <tr key={i}><td>{d.user}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal-actions">
          <button className="btn-submit btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default DonateModal;
