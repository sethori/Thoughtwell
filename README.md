# Notes Platform

A shared, multi-user notes platform. One organization holds a tree of
directorates, divisions, branches, sections and projects. Each unit has its own
people, groups, folders and access rules. This is **phase 1** of the
[design spec](https://claude.ai/artifact/P2MH2qgMPLBcjqwP5ZUexi).

## What phase 1 includes

| Area | In this release |
| --- | --- |
| Org tree | Admin tree editor: right-click a unit to add the next level, rename, move (the whole subtree moves) or delete when empty |
| Directory | Everyone can browse the whole tree and the people in it, with contact details |
| Workspace | Each person sees only the units and folders their roles reach, plus recent pages, their groups, and pages shared with them |
| Access | Roles (viewer, contributor, editor, approver, admin) granted to people or groups on a unit, folder or page, inherited downward and additive |
| Pages | Text, headings, lists and tasks, tables, images, code, quotes; autosave; publish creates numbered, immutable versions |
| Import and export | Markdown import (right-click a folder) and export (download button) |
| Appearance | Light or dark, comfortable or compact, five accents or the brand color, chosen per person |
| Branding | Admins set a brand color; readable light and dark accents are derived from it |
| Attachments | Admin-set size limit, with per-role and per-group overrides, plus an allowed-types list |
| Audit | Append-only log of sign-ins, tree changes, access changes, publishes and uploads |
| Agents | People can be created with kind "agent" now; agent sign-in and editing come later |

The review flow (tracked changes, per-change approval, send back), live
co-editing, notifications, Entra ID, graph and diagram blocks and the desktop
app are later phases. The database already holds their tables.

## How it is built

```
apps/api         Fastify + TypeScript API, Postgres 16
apps/web         React + Vite + TipTap editor
packages/shared  Roles, tree rules, theme math, Markdown export, upload policy (used by both)
apps/api/migrations  SQL schema, row-level security, permission functions
```

Security is enforced in Postgres, not only in the API:

- The API connects as `notes_app`, a role that does not own any table, so
  row-level security applies to every query. Each request runs in a
  transaction scoped to the caller's organization.
- `notes_app` cannot read password hashes, delete people, edit the audit log or
  delete published versions.
- Permission checks (`effective_role`, `accessible_folders`) are SQL functions,
  so every query path agrees on who can see what.

## Run it on the home server

Requires Docker with Compose.

```bash
cp .env.example .env        # then set real passwords and a 32+ character SESSION_SECRET
./deploy.sh --no-pull       # builds, migrates, starts; web listens on 127.0.0.1:8080
docker compose run --rm migrate pnpm exec tsx src/seed.ts   # once: creates the org, placeholder tree and your admin
```

Then point your nginx subdomain at it, and set `COOKIE_SECURE=true` once it is
served over HTTPS:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    client_max_body_size 200m;
}
```

Later updates are one command: `./deploy.sh`. It pulls, builds, backs up
the database and attachments to `./backups` (keeping the last 14), runs
migrations, restarts and checks health. If the health check fails, it prints
the restore command for the backup it just took.

## Develop locally

Requires Node 22, pnpm 10 and a local Postgres 16.

```bash
pnpm install
cp .env.example .env        # point DATABASE_URL at your local Postgres owner role
pnpm db:migrate
pnpm db:seed                # add -- --empty to skip the placeholder tree
pnpm dev                    # API on :3000, web on :5173
```

Commit `pnpm-lock.yaml` after the first install so CI uses exact versions.

## Tests

```bash
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
pnpm test:e2e               # with the app running; see apps/web/playwright.config.ts
```

- `packages/shared`: roles, tree rules, brand color contrast, upload limits,
  Markdown export.
- `apps/api`: runs against a real, throwaway Postgres database per run. It
  covers sign-in, the tree editor (including subtree moves), permission
  inheritance through units and groups, drafts and publishing, tenant
  isolation, the app role's restrictions, audit entries, upload limits and
  branding.
- `apps/web/e2e`: Playwright drives sign-in, writing, publishing, tables and
  theme switching in a real browser.

CI (`.github/workflows/ci.yml`) runs typecheck, all tests and the web build on
every push.
