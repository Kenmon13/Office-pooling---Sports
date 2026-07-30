# Google Play listing — Sports Pooling

Copy-paste material for the Play Console. Character limits are Google's.

---

## Where this was left off — 2026-07-31

Everything code-side is done, merged to `main`, and deployed. **The keystore is
backed up (step 1) and the screenshots are captured (step 2).** What remains is
the Play Console work itself, steps 3–6.

### 1. Back up the upload keystore — done 2026-07-31

`frontend/android/upload-keystore.jks` and `frontend/android/key.properties` are
gitignored and this machine has no Time Machine destination, so they used to
exist in exactly one place. Lose the disk and you lose the ability to ship
updates without a Google support round-trip.

Now backed up to **iCloud Drive → `Sports Pooling Android Signing Key/`**:

| File | What |
|---|---|
| `upload-keystore-backup-2026-07-31.enc` | both files, `openssl enc -aes-256-cbc -pbkdf2 -iter 600000` |
| `README.txt` | what it is, and the restore command |

The passphrase is in the macOS **Passwords** app, not in that folder — an
encrypted archive stored next to its own passphrase is the same as storing
neither. The archive was verified by decrypting it and listing both filenames
before the unencrypted intermediate was deleted, and the iCloud copy is
byte-identical to the local one (matching SHA-256).

Two things to remember if this ever needs restoring:

- The `-iter 600000` must match what encrypted it. Omit it and you get
  `bad decrypt` even with the correct passphrase.
- `openssl` cannot prompt for a passphrase without a TTY, so run it in a real
  Terminal window — not through a tool or script that captures stdin. And
  terminals echo nothing while a password is typed; that is normal, not a
  broken prompt.

Worth re-running the verify command from the README about once a year.

### 2. Screenshots — done 2026-07-31

Eight `shot-*.png` files are in this folder, ready to upload. They are gitignored
(they are build output, not source) so they live only on this machine — see
"Retaking the screenshots" below to reproduce them.

They were captured against a **local** backend seeded with neutral data, never
production, so no real pool name, member or prediction appears in any of them.
The pool is "Office League" and the members are Alex, Sam, Jordan, Riley, Casey
and Morgan.

**These accounts exist only in the local database, so they are not the demo
account Apple will ask for.** The earlier plan assumed one throwaway pool could
serve both purposes; it cannot, because App Review signs in against production.
When the iOS submission comes around, create a separate neutral account and pool
on sportspooling.com for the reviewer.

### 3. Play Console — $25

Listing text, Data Safety table and content-rating notes are all below.

### 4. Upload the AAB to internal testing, not production

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd frontend && npm run cap:sync && cd android && ./gradlew bundleRelease
# → app/build/outputs/bundle/release/app-release.aab
```

### 5. Add the Play App Signing SHA-1 to the Android OAuth client

From the Console (**not** the upload key), into GCP project `719484309775`.
Miss this and Google sign-in works in debug and fails in production.

### 6. Promote to production

---

## App name (30 max)

```
Sports Pooling
```

## Short description (80 max)

```
Predict match results, run a pool with friends, and climb the leaderboard.
```
*(74 characters)*

## Full description (4000 max)

```
Sports Pooling turns the games you already watch into a competition with your
friends, your office, or your group chat.

Create a pool, invite people with a single link, and everyone predicts the same
matches. Points are scored automatically as results come in, and the leaderboard
updates itself. No spreadsheets, no chasing people for their picks.

COMPETITIONS
• FIFA World Cup 2026 — group stage, knockouts, champion and award picks
• English Premier League
• La Liga
• Serie A
• NFL

HOW IT WORKS
• Pick the winner of each match, and optionally predict the exact score for
  bonus points
• Group-stage pools: choose which teams qualify from each group
• Knockout pools: predictions unlock as each matchup is confirmed and lock when
  the match kicks off
• Call the tournament winner and the individual awards for extra points

BUILT FOR GROUPS
• Public pools anyone can join, or private pools protected by a password
• No limit on pool size
• Invite anyone with one link
• Pool admins can manage members and settings
• Pool chat, so the trash talk lives next to the table

STAY ON TOP OF IT
• Get a reminder before kickoff if you have not made your pick yet
• Get the result when a match you predicted finishes
• Live leaderboard, head-to-head comparisons, and a breakdown of where your
  points came from

Free to play. No betting, no real-money wagering, and no gambling of any kind —
just bragging rights.
```

---

## Data Safety form answers

These match the Privacy Policy at https://sportspooling.com/terms. Keep the two
in sync — a mismatch is a common rejection.

**Does your app collect or share any of the required user data types?** Yes

**Is all user data encrypted in transit?** Yes

**Do you provide a way for users to request that their data be deleted?** Yes —
via the in-app *Report Issue* channel, documented under "Deleting Your Account"
in the privacy policy.

### Data collected

| Category | Type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|---|
| Personal info | Name (display name) | Yes | No | Required | App functionality, account management |
| Personal info | Email address | Yes | No | Optional | App functionality, account management |
| Personal info | User IDs (Google/Apple account identifier) | Yes | No | Optional | Account management |
| App activity | In-app actions (predictions, picks, scores) | Yes | No | Required | App functionality |
| App activity | Other user-generated content (pool chat) | Yes | No | Optional | App functionality |
| Device or other IDs | Device ID (push notification token) | Yes | No | Optional | App functionality (notifications) |

Notes for the form:
- **Not** collected: location, financial info, health, contacts, photos, files,
  browsing history, app-usage analytics, crash logs, advertising ID.
- **Nothing is shared for advertising or marketing.** Google (FCM) and Apple
  (APNs) receive the push token solely to deliver notifications; that is a
  service-provider relationship, not "sharing" in Play's sense.
- Passwords are collected for account creation but are **not** a declarable Data
  Safety type — do not list them.

---

## Assets in this folder

| File | Use | Status |
|---|---|---|
| `icon-512.png` | Store icon, 512×512 | ready |
| `feature-graphic-1024x500.png` | Feature graphic, 1024×500 | ready |
| `shot-1-pick-a-sport.png` | Phone screenshot — sport picker | ready |
| `shot-2-competitions.png` | Phone screenshot — the five competitions | ready |
| `shot-3-group-standings.png` | Phone screenshot — group tables + points earned | ready |
| `shot-4-knockout-picks.png` | Phone screenshot — winner picks and scorelines | ready |
| `shot-5-leaderboard.png` | Phone screenshot — pool leaderboard | ready |
| `shot-6-breakdown.png` | Phone screenshot — where the points came from | ready |
| `shot-7-pool-chat.png` | Phone screenshot — pool chat | ready |
| `shot-8-scoring-rules.png` | Phone screenshot — knockout scoring rules | ready |

Upload them in that order — it reads as a tour of the app. Play allows 2–8 phone
screenshots, so all eight fit.

**They are 1080×2160, not the 1080×2400 the emulator produces.** Play rejects a
screenshot whose long side is more than twice its short side, and 2400 > 2×1080.
The status bar and gesture bar are cropped off to land on 2160, which also keeps
emulator chrome out of the listing.

### Retaking the screenshots

The old live-app capture was deleted: it showed a real pool ("megumi"). Never
capture these against production. To rebuild the neutral environment:

1. Seed and run a local backend — `node backend/seed.js`, then
   `node backend/index.js` (port 3001).
2. Create the demo users and pool through the API: six accounts (`demo`, `sam.d`,
   `jordan`, `riley`, `casey`, `morgan`, all password `demo1234`, display names
   Alex/Sam/Jordan/Riley/Casey/Morgan), a private pool "Office League" with
   password `demo1234`, then `POST /api/participants/auto-join` for each user —
   joining a pool does **not** create the participant row on its own.
3. Give the pool something to show: group predictions for all 12 groups per
   member, every group match finished with a score (group scoring needs complete
   standings or everyone sits on 0), the R32 bracket filled from those standings,
   and knockout predictions with scorelines. Knockout `match_date`s must be in
   the **future** or the pick UI renders greyed out and locked.
4. Point the debug build at it with `frontend/.env.local` containing
   `VITE_API_BASE=http://10.0.2.2:3001` (gitignored; delete it before any
   release build).
5. Two things block that plain-HTTP call, both debug-only:
   - `frontend/android/app/src/debug/AndroidManifest.xml` sets
     `usesCleartextTraffic="true"`. It is committed and never merges into
     release — the shipped AAB still refuses cleartext.
   - Capacitor serves the WebView over `https://localhost`, so the call is also
     blocked as mixed content. Temporarily set `android.allowMixedContent` to
     `true` in `frontend/capacitor.config.json`, and **revert it before building
     the release AAB** — that file is shared with release.
6. Build and install: `npm run cap:sync`, `./gradlew assembleDebug`,
   `adb install -r`. Capture with `adb exec-out screencap -p > shot.png`, then
   crop to 1080×2160 as described above.

---

## Content rating

Answer the IARC questionnaire honestly. The app has **no** gambling: no wagering,
no real-money stakes, no simulated gambling. It does have **user-to-user
communication** (pool chat), which you must declare — that alone usually lands
it at PEGI 3 / ESRB Everyone with a "users interact" notice.

---

## Before you hit publish

1. Upload to **internal testing** first, not production.
2. Take the **Play App Signing SHA-1** from the console and add it to the
   Android OAuth client in Google Cloud project `719484309775`. Sign-in works in
   debug and fails in production without it.
3. Confirm the privacy policy URL resolves: https://sportspooling.com/terms
