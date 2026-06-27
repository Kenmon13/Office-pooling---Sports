# Improvements Tracker

Last updated: 2026-06-27

## Backlog

| Priority | Status | Item | Resolved | Remarks |
|----------|--------|------|----------|---------|
| MED | `[x]` | KO exact-score bonus vs penalty-decided matches: validation now allows tie predictions (e.g. `1-1` + "Brazil wins"), but football-data.org may sync the post-shootout score into `knockout_matches.home_score`/`away_score`. If so, a `1-1` prediction on a penalties match can never trigger the exact-score double bonus. Audit `syncWCKnockouts` in `backend/index.js` — what score field does the API return for penalty-decided matches, and is it stored as the regulation/ET score or the post-pens score? If post-pens, decide whether to store regulation score separately or change the bonus rule to "match regulation/ET score". | 2026-06-27 | Resolved by v1.30 PR #32. Empirical EURO 2024 probe confirmed `fullTime` is the post-shootout cumulative; `syncWCKnockouts` now reads `score.regularTime` for ET/pens matches. Stored score = regulation 90', so `1-1 wins on pens` predictions correctly earn the exact-score bonus. |
