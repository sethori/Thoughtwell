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
| Table formulas | Type `=` in a cell: `=SUM(B2:B5)`, `=AVERAGE(B2:B5)`, `MIN`, `MAX`, `COUNT`, `ROUND`, cell references and `+ - * /`. The table toolbar's Sum and Avg buttons total the column above the cursor. Cells show the result; click one to edit its formula |
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

## Run it on Unraid

Unraid has no non-root shell user, and its root filesystem lives in RAM, so keep
everything under `appdata`.

1. **Enable SSH** (optional, only if you want remote deploys): Settings, Management
   Access. Add a public key for `root`; on Unraid 6.10 and later it persists from
   `/boot/config/ssh/root/`. Use a key made just for this and delete it afterward.
2. **Check Compose.** In the Unraid terminal run `docker compose version`. If it is
   missing, install the **Compose Manager** plugin from Community Applications.
3. **Get the code** into a persistent folder:
   ```bash
   mkdir -p /mnt/user/appdata/notes-platform && cd /mnt/user/appdata/notes-platform
   git clone <your repo url> app    # or unzip notes-platform.zip here
   cd app && cp .env.example .env
   ```
4. **Edit `.env`:** set real passwords and a 32+ character `SESSION_SECRET`, then
   uncomment the data paths so Docker stores data on the cache pool, not in the
   Docker image file:
   ```
   PGDATA_DIR=/mnt/cache/appdata/notes-platform/pgdata
   ASSETS_DIR=/mnt/user/appdata/notes-platform/assets
   ```
   Use `/mnt/cache/...` for the database, not `/mnt/user/...`: Postgres is slower
   and less reliable through Unraid's user-share layer. If you have no cache pool,
   use a path on an SSD or accept `/mnt/user`.
5. **Pick a port.** Unraid's own UI uses 80 and 443, and many containers take 8080.
   Check the Docker tab, then set `WEB_PORT` to a free one (for example 8087).
   If your nginx runs on a different machine or in a container on its own network,
   set `WEB_BIND=0.0.0.0` so it can reach the port; keep the port closed to the
   internet and reachable only over your LAN or VPN.
6. **Deploy** and create your admin account:
   ```bash
   ./deploy.sh --no-pull
   docker compose run --rm migrate pnpm exec tsx src/seed.ts   # once
   ```
7. **Point your nginx subdomain** at `http://<unraid-ip>:<WEB_PORT>` using the block
   above, then set `COOKIE_SECURE=true` in `.env` and run `./deploy.sh --no-pull`.

The stack does not appear as managed containers in Unraid's Docker tab; it runs as
a Compose project (`docker compose ps` shows it) and restarts with Docker.
Backups land in `./backups` inside the app folder. Copy that folder somewhere off the
server on a schedule, for example with the CA Appdata Backup plugin or a User Script.

## Desktop test build (AppImage)

A single-file Linux app that runs everything on one machine: its own PostgreSQL
server, the API and the web app, with data stored under
`~/.config/Notes Platform/data`. Nothing leaves the computer. It is for trying
the app, not for shared use.

**Get it built.** Push this repo to GitHub, open the **Actions** tab, choose
**Desktop build** and **Run workflow**. When it finishes (about 10 minutes),
download `NotesPlatform-AppImage` from the run's Artifacts and unzip it. The run
also starts the finished AppImage, creates a database, signs in and loads the web
app, and fails if any of that breaks.

**Run it:**
```bash
chmod +x NotesPlatform-0.1.0-x86_64.AppImage
./NotesPlatform-0.1.0-x86_64.AppImage
```
On first launch it creates the organization, the placeholder tree and an `admin`
account, and shows the generated password once (use **Copy password**). File >
**Open data folder** shows where the data lives; File > **Reset test data**
deletes it and starts over.

Notes:
- Built on Ubuntu 24.04, so it needs glibc 2.39 or newer (Ubuntu 24.04+, Debian 13+,
  Fedora 40+). It needs a normal user account; PostgreSQL refuses to run as root.
- If the AppImage will not start, install FUSE 2 (`sudo apt install libfuse2t64`
  on Ubuntu 24.04), or run it with `--appimage-extract-and-run`.
- The app listens on `127.0.0.1:47831` only, so other machines cannot reach it.
- To build it yourself instead: `sudo apt install postgresql-16`, then
  `pnpm install && pnpm desktop:package`; the file lands in `apps/desktop/release`.

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
