# Changelog

All notable changes to Thoughtwell are recorded here, based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries are grouped
by date instead of by version, because versions are assigned automatically:
every push to `main` is released as the next `vX.Y.Z`, and each GitHub release
lists that version's commits. A heading's version is the first release that
included those changes.

## Unreleased

### Changed
- Thoughtwell is now local-first: a desktop app that keeps your notes as Markdown files in a
  folder you choose (default `~/Thoughtwell`), with no server, database or account.
- The vault has two areas: **Me** for your notes, and **Brain** for your AI agents to ingest,
  summarize and organize (Inbox, Sources, Summaries, Topics, Log). A generated `AGENTS.md`
  tells agents such as Claude Code the rules, including never changing Me/.
- Charts, sketches and diagrams are saved in Markdown (```` ```chart ````, `.excalidraw.svg`
  images, ```` ```mermaid ````), so agents and other Markdown tools can read them.

### Added
- File tree per area: create, rename, drag to move, drop files in to import, move to trash.
- Viewers for PDFs, video, audio, images and text files.
- "From your Brain": agent notes related to the note you are writing, plus backlinks.
- Search across all notes and file names (Ctrl+K), wikilinks (`[[Note name]]`), and a
  properties row for agent notes (type, author, source, tags, summary).
- Live updates when agents or other tools change files, with a warning instead of an
  overwrite if a note you are editing changed on disk.

### Removed
- The multi-user server: sign-in, org tree, roles, review and approval, live co-editing,
  email and Teams notifications, Docker/Unraid deploy and the bundled PostgreSQL. A sync
  backend is planned for later.

## 2026-11-19 (from 1.0.1)

### Added
- Automatic releases: every push to `main` publishes a GitHub release with the
  desktop AppImage and a `SHA256SUMS` file, versioned 1.0.1, 1.0.2, … from git tags.
- The AppImage is built and smoke-tested on every push and pull request, not only on demand.
- Agent instructions (`AGENTS.md`, with `CLAUDE.md` and `GEMINI.md` pointing to it) and this changelog.

### Changed
- The `CI` and `Desktop build` workflows are merged into one `Build` workflow.
  `desktop-v*` tags no longer trigger builds.
- Source checkouts carry version `0.0.0`. Only release builds carry a real version.

## 2026-11-05 (before versioned releases)

### Added
- Org tree with directorates, divisions, branches, sections and projects, an admin
  tree editor, a directory, and per-person workspaces.
- Roles (viewer, contributor, editor, approver, admin) on units, folders and pages,
  inherited downward and enforced in Postgres with row-level security.
- Pages with text, lists, tasks, tables, images, quotes, and immutable numbered versions.
- Live co-editing with cursors, presence, offline sync and saving as you type.
- Review workflow: require approval per unit or folder, inline change markup,
  accepting or rejecting each change, comments, and optional self-approval.
- Watching, in-app notifications, and email (SMTP) and Teams delivery.
- Table formulas (`SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `ROUND`, references, arithmetic).
- Bar, line and pie graphs, Excalidraw sketches, Mermaid flowcharts, and code
  highlighting for about 35 languages.
- Markdown import and export, appearance settings, brand color, attachment limits, and an audit log.
- Home-server deploy (`deploy.sh` with backups, migrations and a health check), plus an Unraid guide.
- Self-contained Linux desktop AppImage with bundled PostgreSQL.

### Changed
- Renamed the product to Thoughtwell.

### Fixed
- Desktop: Postgres gets a file descriptor for its log, so it starts reliably.
- CI: the AppImage smoke test runs with `--no-sandbox`, and the AppImage uploads before testing.
