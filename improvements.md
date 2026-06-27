# Improvements Tracker

Last updated: 2026-06-27

## Backlog

| Priority | Status | Item | Resolved | Remarks |
|----------|--------|------|----------|---------|
| MED | `[ ]` | KO exact-score bonus vs penalty-decided matches: validation now allows tie predictions (e.g. `1-1` + "Brazil wins"), but football-data.org may sync the post-shootout score into `knockout_matches.home_score`/`away_score`. If so, a `1-1` prediction on a penalties match can never trigger the exact-score double bonus. Audit `syncWCKnockouts` in `backend/index.js` — what score field does the API return for penalty-decided matches, and is it stored as the regulation/ET score or the post-pens score? If post-pens, decide whether to store regulation score separately or change the bonus rule to "match regulation/ET score". | — | Surfaced 2026-06-27 alongside v1.29 tie-allowed validation fix |
