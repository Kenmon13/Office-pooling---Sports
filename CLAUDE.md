# Office Pooling — Sports

Pool funds and predict sports events. Full-stack JS app deployed on Railway.

**GitHub:** https://github.com/Kenmon13/Office-pooling---Sports  
**Live app:** https://office-pooling-sports-production.up.railway.app/  
**Default branch:** `main`

---

## Collaborators

| Person | GitHub | Branch |
|--------|--------|--------|
| Zhennan (you) | FieryZephyr | `Zhennan` |
| Partner | Kenmon13 | TBD |

---

## Tech Stack

### Frontend — `frontend/`
- React 19 + React Router DOM 7
- Vite (build tool)
- ESLint for linting

### Backend — `backend/`
- Node.js + Express 5
- SQLite via `better-sqlite3`
- CORS enabled

### Deployment
- Docker container deployed to Railway
- Build: root `npm run build` (installs both sides, builds frontend, copies `dist/` → `backend/public/`)
- Start: `node backend/index.js`

---

## Key Commands

```bash
# Install all deps
cd backend && npm install
cd ../frontend && npm install

# Dev (run both terminals)
cd frontend && npm run dev       # Vite dev server
node backend/index.js            # Express server

# Lint (frontend only)
cd frontend && npm run lint

# Production build
npm run build   # from repo root
```

---

## Git Workflow

- **Your branch:** `Zhennan` — all your work goes here; merge into `main` via PR.
- **Never commit directly to `main`.**
- Before starting work each session:
  ```bash
  git fetch origin
  git log --oneline -8            # check partner's recent commits
  git pull origin Zhennan         # sync your own branch
  ```
- Commit messages must be self-describing (another person reads them cold).
- Never `git push --force`, `git rebase`, or `git reset --hard` on `Zhennan` or `main`.
- To undo a shared commit: `git revert <sha>` — creates a safe new commit.

---

## Project Structure

```
├── backend/
│   ├── db.js        # SQLite connection
│   ├── index.js     # Express entry point
│   ├── scores.js    # Scoring logic
│   └── seed.js      # DB seed script
├── frontend/
│   ├── src/
│   ├── public/
│   └── vite.config.js
├── Dockerfile
├── railway.toml
└── package.json     # Root build script
```

---

## Before Finishing Any Task
1. Run `cd frontend && npm run lint` — fix all issues before committing.
2. No backend test suite exists — note this explicitly if relevant.
3. Verify the live app at https://office-pooling-sports-production.up.railway.app/ after any Railway deploy.
