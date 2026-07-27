// End-to-end test of the push scan against a throwaway SQLite database.
// Intercepts fetch so no real FCM call is made, and asserts on what would be sent.
process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({
  project_id: "test-project",
  client_email: "test@test-project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----\\n",
});
const path = require("path");
const DB = path.join(require("os").tmpdir(), `push-test-${process.pid}.db`);
require("fs").rmSync(DB, { force: true });
process.env.DB_PATH = DB;

const BE = path.join(__dirname, "..") + "/";
const db = require(BE + "db");
const push = require(BE + "push");
const pushJobs = require(BE + "pushJobs");

// --- stub FCM transport ---
const sent = [];
let nextStatus = 200;
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  sent.push({ token: body.message.token, title: body.message.notification.title, body: body.message.notification.body, data: body.message.data });
  if (nextStatus === 200) return { ok: true, status: 200, json: async () => ({}) };
  return { ok: false, status: nextStatus, json: async () => ({ error: { status: "UNREGISTERED" } }) };
};
// Bypass real OAuth: swap the access-token call for a constant.
const { JWT } = require("google-auth-library");
JWT.prototype.getAccessToken = async () => ({ token: "fake-access-token" });

// --- fixture data ---
function setup() {
  db.prepare("INSERT INTO users (id, username, password, display_name) VALUES (9001,'alice','x','Alice')").run();
  db.prepare("INSERT INTO users (id, username, password, display_name) VALUES (9002,'bob','x','Bob')").run();
  db.prepare("INSERT INTO users (id, username, password, display_name) VALUES (9003,'carol','x','Carol')").run();

  db.prepare("INSERT INTO pools (id, name, sport, tournament, password) VALUES (9010,'EPL A','soccer','epl2627','p')").run();
  db.prepare("INSERT INTO pools (id, name, sport, tournament, password) VALUES (9011,'EPL B','soccer','epl2627','p')").run();
  // participants: alice in both EPL pools, bob in one, carol in a different league
  db.prepare("INSERT INTO participants (id,name,pool_id,user_id) VALUES (9100,'Alice',9010,9001)").run();
  db.prepare("INSERT INTO participants (id,name,pool_id,user_id) VALUES (9101,'Alice',9011,9001)").run();
  db.prepare("INSERT INTO participants (id,name,pool_id,user_id) VALUES (9102,'Bob',9010,9002)").run();
  db.prepare("INSERT INTO pools (id, name, sport, tournament, password) VALUES (9012,'Liga','soccer','laliga2627','p')").run();
  db.prepare("INSERT INTO participants (id,name,pool_id,user_id) VALUES (9103,'Carol',9012,9003)").run();

  db.prepare("INSERT INTO league_teams (id,league,name,code) VALUES (9200,'epl2627','ZZ Arsenal','ZAR')").run();
  db.prepare("INSERT INTO league_teams (id,league,name,code) VALUES (9201,'epl2627','ZZ Chelsea','ZCH')").run();

  for (const uid of [9001, 9002, 9003]) {
    db.prepare("INSERT INTO device_tokens (token,user_id,platform) VALUES (?,?,'android')").run(`tok-${uid}`, uid);
  }
}

const soon = db.prepare("SELECT strftime('%Y-%m-%d %H:%M','now','+60 minutes') v").get().v;
const justNow = db.prepare("SELECT strftime('%Y-%m-%d %H:%M','now','-30 minutes') v").get().v;

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name} ${detail}`); fail++; }
};

(async () => {
  setup();

  // === reminders ===
  db.prepare("INSERT INTO league_matches (id,league,matchday,home_team_id,away_team_id,match_date,status) VALUES (300,'epl2627',1,9200,9201,?, 'upcoming')").run(soon);
  // Bob has picked in his only pool; Alice has picked in one of two.
  db.prepare("INSERT INTO league_match_predictions (participant_id,match_id,predicted_outcome) VALUES (9102,300,'home')").run();
  db.prepare("INSERT INTO league_match_predictions (participant_id,match_id,predicted_outcome) VALUES (9100,300,'home')").run();

  await pushJobs.runScan();
  const reminders = sent.filter((s) => s.data.kind === "reminder");
  check("reminder goes to the user with a missing pick", reminders.some((r) => r.token === "tok-9001"));
  check("no reminder for the user who picked everywhere", !reminders.some((r) => r.token === "tok-9002"),
    JSON.stringify(reminders.map((r) => r.token)));
  check("no reminder leaks to another league's pool", !reminders.some((r) => r.token === "tok-9003"));
  check("reminder names both teams", reminders[0] && reminders[0].body.includes("ZZ Arsenal") && reminders[0].body.includes("ZZ Chelsea"),
    reminders[0] && reminders[0].body);

  // === dedupe across a second scan ===
  const before = sent.length;
  await pushJobs.runScan();
  check("re-scan does not resend the same reminder", sent.length === before, `sent ${sent.length - before} extra`);

  // === results ===
  sent.length = 0;
  db.prepare("UPDATE league_matches SET status='finished', home_score=2, away_score=1, match_date=? WHERE id=300").run(justNow);
  await pushJobs.runScan();
  const results = sent.filter((s) => s.data.kind === "result");
  check("result goes to everyone who predicted", results.length === 2, `got ${results.length}`);
  check("correct picker is congratulated", results.some((r) => r.token === "tok-9002" && r.body.includes("called it")),
    JSON.stringify(results.map((r) => [r.token, r.body])));
  check("result shows the score", results.every((r) => r.body.includes("2–1")));
  check("non-predictor gets no result", !results.some((r) => r.token === "tok-9003"));

  // === old results are not announced ===
  sent.length = 0;
  const old = db.prepare("SELECT strftime('%Y-%m-%d %H:%M','now','-40 hours') v").get().v;
  db.prepare("INSERT INTO league_matches (id,league,matchday,home_team_id,away_team_id,match_date,status,home_score,away_score) VALUES (301,'epl2627',1,9200,9201,?, 'finished',3,0)").run(old);
  db.prepare("INSERT INTO league_match_predictions (participant_id,match_id,predicted_outcome) VALUES (9100,301,'home')").run();
  await pushJobs.runScan();
  check("results older than the lookback window stay silent", sent.length === 0, `sent ${sent.length}`);

  // === opt-out ===
  sent.length = 0;
  db.prepare("INSERT INTO push_prefs (user_id,reminders,results) VALUES (9001,0,0)").run();
  db.prepare("INSERT INTO league_matches (id,league,matchday,home_team_id,away_team_id,match_date,status) VALUES (302,'epl2627',2,9200,9201,?, 'upcoming')").run(soon);
  await pushJobs.runScan();
  check("opted-out user receives nothing", !sent.some((s) => s.token === "tok-9001"), JSON.stringify(sent.map((s) => s.token)));

  // === dead token pruning ===
  sent.length = 0;
  nextStatus = 404;
  await push.sendToUser(9002, { title: "t", body: "b", data: {} });
  const bobTokens = push.tokensFor(9002);
  check("FCM 404 prunes the dead token", bobTokens.length === 0, JSON.stringify(bobTokens));
  nextStatus = 200;

  // === transient failure keeps the token ===
  db.prepare("INSERT INTO device_tokens (token,user_id,platform) VALUES ('tok-9002b',9002,'android')").run();
  nextStatus = 503;
  await push.sendToUser(9002, { title: "t", body: "b", data: {} });
  check("FCM 503 keeps the token", push.tokensFor(9002).length === 1, JSON.stringify(push.tokensFor(9002)));
  nextStatus = 200;

  // === unit checks ===
  const { outcomeOf, groupPredictorVerdicts } = pushJobs._internals;
  check("outcomeOf draw", outcomeOf(1, 1) === "draw");
  check("outcomeOf away", outcomeOf(0, 2) === "away");
  const v = groupPredictorVerdicts([{ user_id: 9, predicted_outcome: "home" }, { user_id: 9, predicted_outcome: "away" }], "home");
  check("mixed picks across pools are not called correct", v.get(9) === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  require("fs").rmSync(DB, { force: true });
  process.exit(fail ? 1 : 0);
})();
