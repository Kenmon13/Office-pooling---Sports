function Legal({ onBack }) {
  return (
    <div className="legal-page">
      <div className="legal-header">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <h1 className="legal-title">Terms & Privacy</h1>
      </div>

      <nav className="legal-nav">
        <a href="#terms" onClick={(e) => { e.preventDefault(); document.getElementById("terms").scrollIntoView({ behavior: "smooth" }); }}>Terms of Service</a>
        <a href="#privacy" onClick={(e) => { e.preventDefault(); document.getElementById("privacy").scrollIntoView({ behavior: "smooth" }); }}>Privacy Policy</a>
      </nav>

      <section id="terms" className="legal-section">
        <h2>Terms of Service</h2>
        <p className="legal-updated">Last updated: June 7, 2025</p>

        <h3>1. Acceptance</h3>
        <p>
          By creating an account or using Sports Pooling ("the Service"), you agree to these Terms.
          If you do not agree, do not use the Service.
        </p>

        <h3>2. Description of Service</h3>
        <p>
          Sports Pooling is a free, social prediction platform. Users join pools, submit picks on
          match outcomes, and compete on a leaderboard for entertainment purposes. The Service
          does not involve real-money wagering or prizes of monetary value.
        </p>

        <h3>3. Your Account</h3>
        <p>
          You are responsible for keeping your password secure and for all activity under your
          account.
        </p>

        <h3>4. Acceptable Use</h3>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for any unlawful purpose</li>
          <li>Harass, abuse, or harm other users</li>
          <li>Attempt to gain unauthorised access to any part of the Service</li>
          <li>Scrape, copy, or redistribute the Service or its data without permission</li>
        </ul>

        <h3>5. Pool Rules & Admin Rights</h3>
        <p>
          Pool administrators may set pool passwords, remove members, and close pool chat at their
          discretion. Site administrators may suspend or remove any account that violates these Terms.
        </p>

        <h3>6. Availability</h3>
        <p>
          The Service is provided "as is" with no guarantee of uptime or accuracy of sports data.
          We may modify, suspend, or discontinue the Service at any time without notice.
        </p>

        <h3>7. Disclaimer of Warranties</h3>
        <p>
          The Service is provided without warranties of any kind, express or implied. We are not
          liable for any loss of data, missed picks due to downtime, or disputes between pool
          members.
        </p>

        <h3>8. Limitation of Liability</h3>
        <p>
          To the maximum extent permitted by law, Sports Pooling and its operators are not liable
          for any indirect, incidental, or consequential damages arising from your use of the
          Service.
        </p>

        <h3>9. Changes to Terms</h3>
        <p>
          We may update these Terms at any time. Continued use of the Service after changes are
          posted constitutes acceptance of the revised Terms.
        </p>
      </section>

      <section id="privacy" className="legal-section">
        <h2>Privacy Policy</h2>
        <p className="legal-updated">Last updated: July 29, 2026</p>

        <h3>1. Information We Collect</h3>
        <p>We collect the following when you register and use the Service:</p>
        <ul>
          <li><strong>Account data:</strong> account username, account password, display name, email address (if provided)</li>
          <li><strong>Sign-in identifiers:</strong> if you sign in with Google or Apple, the account identifier they give us, along with the email address and name on that account. We never receive your Google or Apple password.</li>
          <li><strong>Activity data:</strong> match predictions, champion picks, leaderboard scores</li>
          <li><strong>Pool data:</strong> pools you create or join, chat messages you send</li>
          <li><strong>Device notification token:</strong> in our iOS and Android apps, a token issued by Apple or Google that lets us send notifications to your device. It is stored only while the app is installed and you are signed in.</li>
        </ul>

        <h3>2. How We Use Your Information</h3>
        <ul>
          <li>To operate your account and the pools you participate in</li>
          <li>To send password-reset emails when you request them</li>
          <li>To display your picks and scores to other members of your pools</li>
          <li>To send notifications about matches you have not predicted yet and results for matches you did predict, in our mobile apps. You can turn these off, and we do not use them for marketing.</li>
          <li>To investigate reports of abuse or terms violations</li>
        </ul>

        <h3>3. Data Sharing</h3>
        <p>
          We do not sell, rent, or share your personal information with third parties for
          marketing purposes. Your data may be disclosed if required by law or to protect
          the rights and safety of users.
        </p>
        <p>
          We rely on a small number of service providers purely to operate the Service:
          Google (Firebase Cloud Messaging) and Apple (Push Notification service) to
          deliver notifications to your device, Google and Apple to verify your identity
          if you choose to sign in with them, and an email provider to send
          password-reset messages. They process only what is needed for those tasks.
        </p>

        <h3>4. Data Storage</h3>
        <p>
          Data is stored on secured servers and is encrypted in transit. Account passwords
          are stored securely. We retain your data for as long as your account is active.
        </p>

        <h3>5. Deleting Your Account</h3>
        <p>
          You can ask us to delete your account and its data at any time. Use{" "}
          <strong>Report Issue</strong> inside the app or on the website and say you want
          your account deleted, and we will remove it.
        </p>
        <p>
          Deleting your account removes your account record, your predictions and picks,
          your pool memberships, the chat messages you sent, your support requests, and
          the notification tokens for your devices. Signing out or uninstalling the app
          removes the notification token for that device on its own, without deleting
          your account.
        </p>

        <h3>6. Cookies & Local Storage</h3>
        <p>
          The Service uses browser local storage to keep you signed in between sessions. No
          third-party tracking cookies are used.
        </p>

        <h3>7. Changes to This Policy</h3>
        <p>
          We may update this Privacy Policy at any time. Continued use of the Service after
          changes are posted constitutes acceptance of the revised Policy.
        </p>
      </section>

      <footer className="legal-footer">
        <p>© {new Date().getFullYear()} Sports Pooling. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default Legal;
