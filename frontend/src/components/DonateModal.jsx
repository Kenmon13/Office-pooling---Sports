import paypalLogo from "../assets/paypal-logo.png";

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
        <p>If you'd like to support the site, you can do so via PayPal or Buy Me a Coffee. This goes into resources such as maintaining the website and the domain name.</p>

        <div className="donate-options">
          <a
            className="donate-paypal"
            href="https://www.paypal.me/kenmon13"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img className="donate-paypal-logo" src={paypalLogo} alt="PayPal" />
            <span className="donate-paypal-handle">@kenmon13</span>
          </a>

          <a
            className="donate-paypal donate-bmc"
            href="https://buymeacoffee.com/kenmon"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="donate-paypal-label">Buy Me a Coffee</span>
            <span className="donate-paypal-handle">☕ @kenmon</span>
          </a>
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
