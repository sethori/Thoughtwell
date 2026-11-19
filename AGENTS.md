# Thoughtwell: agent guide

## What this project is
Thoughtwell is a self-hosted, multi-user notes platform for personal and family use. An org tree of units holds people, groups and folders. Roles are inherited down the tree. Pages support live co-editing, review/approval and email/Teams notifications. It runs with Docker Compose on a home server or Unraid behind nginx. A Linux AppImage (with bundled Postgres) is for trying it on one machine. Roadmap: Entra ID sign-in, directory sync, search, audit export, AI assistant. README.md has the full feature list and deploy guide.

```
apps/api            Fastify + TypeScript API; src/routes, services, auth, collab (Hocuspocus/Yjs)
apps/api/migrations Numbered SQL schema, row-level security, permission functions; grants.sql re-run every migrate
apps/web            React + Vite + TipTap editor; e2e/ holds Playwright tests
apps/desktop        Electron AppImage: own Postgres (src/postgres.ts), API and web in one process
packages/shared     Roles, tree rules, theme math, Markdown export, formulas, review diff (used by api and web)
scripts/version.py  Release version from git tags (next / latest / stamp) + test_version.py
deploy.sh           Server update: pull, build, back up db + assets, migrate, restart, health check
```

## Build, run, test
```bash
pnpm install                      # Node 22, pnpm 10
cp .env.example .env              # never commit .env
pnpm db:migrate && pnpm db:seed   # local Postgres 16
pnpm dev                          # API :3000, web :5173
pnpm typecheck
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test   # also runs version tests
pnpm test:e2e                     # with the app running
pnpm desktop:package              # needs postgresql-16 installed; output in apps/desktop/release
```
Generated, never commit: `node_modules/`, `dist/`, `apps/desktop/release/`, `apps/desktop/resources/pg`, `data/`, `backups/`, `coverage/`, `playwright-report/`, `test-results/`, `.env`.

## Things every agent must know
- **Security lives in Postgres.** The API connects as `notes_app`, which owns no tables, so RLS applies to every query. You must not grant it ownership, `BYPASSRLS`, or rights to read password hashes, delete people, edit the audit log or delete published versions. Permission checks go through the SQL functions `effective_role` and `accessible_folders`. Don't reimplement them in TypeScript.
- **Migrations run once each.** You must never edit an applied `NNN_*.sql` file, because deployed databases won't re-run it. Add a new numbered file instead. Privilege changes go in `grants.sql`.
- **Real data lives on the home server.** Never run `deploy.sh`, `pg_restore --clean`, or anything against the server or its `backups/` without explicit approval. `deploy.sh` prunes backups beyond 14.
- **Desktop "Reset test data"** recursively deletes `~/.config/Thoughtwell/data`. Keep it behind its confirmation dialog.
- **Secrets:** SMTP passwords and Teams webhook URLs are stored in the database. `SESSION_SECRET` and DB passwords live in `.env`. Never log, commit or echo them.
- API tests create a throwaway database per run. They need a Postgres admin URL and never touch the real DB.
- `pnpm-lock.yaml` isn't committed yet, so CI installs unpinned versions.
- Say clearly what was and wasn't tested for real (unit tests vs. a running app vs. CI vs. a real deploy).

## Versioning and releases
- Versions are `MAJOR.MINOR.PATCH`, and each part counts 0-9 before rolling over: `1.0.9 → 1.1.0`, `1.9.9 → 2.0.0`. The first release is `1.0.1`.
- **Every push to `main` is a release.** The version comes from the `vX.Y.Z` tags (`vX.Y` = `vX.Y.0`), and nobody edits it by hand. Source keeps `0.0.0` in every `package.json`, and you must never commit a stamped version.
- `.github/workflows/build.yml` runs typecheck, tests, the web build and the AppImage build plus smoke test on every push and PR. On `main` it also runs `scripts/version.py next`, then `stamp`, then publishes GitHub release `vX.Y.Z` with the AppImage and `SHA256SUMS`. The release notes are the commit subjects since the previous tag. Runs on the same ref are serialized (`concurrency: build-<ref>`). A waiting run can be superseded by a newer push, and the next release then includes its commits.

## Milestones
- 2026-11-05: Phase 1 foundation (org tree, access, pages, deploy). Then Unraid support, desktop AppImage and table formulas, and phases 2-3 (live co-editing, review, notifications, diagrams). Renamed to Thoughtwell.
- 2026-11-19: Automatic versioning and GitHub releases set up. The first release will be 1.0.1.

## Known open issues
- `pnpm-lock.yaml` isn't committed yet, so builds aren't reproducible.
- Entra ID sign-in, directory sync, search, audit export and the AI assistant are still to come. The assistant button is a placeholder.
- The AppImage needs glibc 2.39+ and FUSE 2, and it can't run as root.

## How to work here (owner preferences)
- **Communication:** give concise, plain answers and lead with the outcome. Explain trade-offs only when they matter. No filler. When reporting work, say what was verified and what wasn't.
- **Questions:** when something is unclear or the decision is the owner's, ask instead of guessing. Give concrete options and a recommendation.
- **Git:** commit freely on feature branches with clear messages, and branch first if you're on `main`. **Ask before pushing**, opening PRs, touching `main`, creating or deleting releases or tags, or force-pushing. Pushing to `main` publishes a release. Write commit subjects a user could read, because they become the release notes.
- **Destructive or outward-facing actions:** confirm first. That includes deleting files or branches, rewriting history, publishing, changing CI secrets, deploying, and contacting external services. Approval for one action doesn't carry over to the next.
- **Upkeep (required on every change):** add a line to `CHANGELOG.md` for any user-visible change or fix. Update Milestones and Known open issues when they change. Keep this file under ~80 lines.
