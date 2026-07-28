# Google Play listing — Sports Pooling

Copy-paste material for the Play Console. Character limits are Google's.

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
| `shot-2-knockouts.png` | Phone screenshot | see caveat below |

**Screenshot caveat.** Play listings are public. Screenshots taken from the live
app show real pool names and, on the leaderboard and picks screens, other
people's usernames and predictions. Before uploading, create a pool with neutral
names and capture from that. It doubles as the demo account Apple will require
later.

Play needs a minimum of 2 phone screenshots; 4–8 is better. Good candidates that
contain no personal data: the sport picker, group standings, the knockout
bracket, and the scoring-rules panel.

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
