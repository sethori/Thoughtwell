# Thoughtwell: agent guide

## What this project is
Thoughtwell is a local-first desktop second brain (Electron, Linux AppImage). A vault is a plain folder of Markdown files: `Me/` holds the owner's notes, and `Brain/` is where their AI agents ingest material (`Inbox/` → `Sources/`, `Summaries/`, `Topics/`, `Log.md`). The vault's own `AGENTS.md` (template in `packages/vault/src/templates.ts`) tells those agents the rules. There is no server: sync and multi-user support are a later, optional backend. README.md has the features and the note format.

```
apps/desktop     Electron main: VaultService, IPC handlers (main.ts), preload bridge, app:// + vault:// (protocols.ts), --smoke test; build/icon.svg (PNGs: scripts/icons.sh)
apps/web         React + Vite + TipTap UI; reaches disk only via window.thoughtwell (lib/vault.ts)
packages/mcp     MCP server for agents: tools over VaultService, Brain/-only writes (assertWritable); run by `--mcp` in the app
packages/vault   Folder access (safe paths, atomic writes, import, attachments), search index, chokidar watcher; tests
packages/shared  Markdown <-> editor JSON (markdown.ts, parse.ts), frontmatter, vault layout, bridge types, formulas, charts, theme
scripts/version.py  Release version from git tags (next / latest / stamp) + test_version.py
```

## Build, run, test
```bash
pnpm install                      # Node 22, pnpm 10
pnpm dev                          # Vite :5173 + Electron window
pnpm typecheck
pnpm test                         # shared + vault unit tests, version tests
pnpm desktop:package              # AppImage in apps/desktop/release
THOUGHTWELL_RESOURCES=<dir containing web/> electron apps/desktop --smoke   # end-to-end check, throwaway vault
node apps/desktop/scripts/mcp-smoke.mjs <electron or AppImage> [args]       # MCP mode over stdio, throwaway vault
```
Generated, never commit: `node_modules/`, `dist/`, `apps/desktop/release/`, `apps/desktop/resources/`, `coverage/`, `.env`.

## Things every agent must know
- **The vault is the user's real data.** Never run the app, tests or scripts against their vault (default `~/Thoughtwell`). Tests and `--smoke` use temp folders. Deleting goes to the system trash (`shell.trashItem`), never `rm`.
- **Markdown is the storage format, not an export.** Every editor node needs a Markdown form in `markdown.ts` and a parse in `parse.ts`, and must round-trip (add a test in `packages/shared/test/markdown.test.ts`). Unknown content becomes `rawMarkdown` and is written back verbatim. A note is only written when the user edits it.
- **All disk access goes through `Vault`** (`resolve()` blocks `..` and symlink escapes), and the web app reaches it only via the bridge (`packages/shared/src/bridge.ts`, `CALLS`). Add a call in all three places: bridge type, `CALLS`, handler in `main.ts`.
- **MCP agents may write only inside `Brain/` and never delete.** Keep `assertWritable` on every write path, and add no delete tool. MCP owns stdout in `--mcp` mode: log to stderr only.
- Writes are atomic and carry `expectedVersion` (inode:size:mtime, since Linux mtimes tick in coarse steps). A `conflict` means someone (often an agent) changed the file. Don't overwrite silently.
- Errors cross `contextBridge` as `[code] message`. Use `errorCode`/`errorText` in the web app.
- `vault://` serves HTML/JS as text and sandboxes everything except PDFs. Keep it that way: agents save untrusted web content.
- Don't change the vault layout or AGENTS.md template rules lightly. Existing vaults and the user's agents depend on them, and the template is only written when missing.
- `pnpm-lock.yaml` is committed; CI installs with `--frozen-lockfile`. Commit lockfile changes with the dependency change.
- Self-update (`apps/desktop/src/updates.ts`) reads the latest GitHub release of `sethori/Thoughtwell` and needs its `Thoughtwell-<ver>-<arch>.AppImage` and `SHA256SUMS` assets. Keep those names in CI, and keep the swap in place (same path, rename in the same folder). The check on open runs only in release builds (not 0.0.0, `--smoke` or `--mcp`).
- Say clearly what was and wasn't tested for real (unit tests vs. the smoke test vs. a person using the app vs. CI).

## Versioning and releases
- Versions are `MAJOR.MINOR.PATCH`, and each part counts 0-9 before rolling over: `1.0.9 → 1.1.0`, `1.9.9 → 2.0.0`. The first release is `1.0.1`.
- **Every push to `main` is a release.** The version comes from the `vX.Y.Z` tags (`vX.Y` = `vX.Y.0`), and nobody edits it by hand. Source keeps `0.0.0` in every `package.json`, and you must never commit a stamped version.
- `.github/workflows/build.yml` runs typecheck, tests, the web build and the AppImage build plus smoke test on every push and PR. On `main` it also runs `scripts/version.py next`, then `stamp`, then publishes GitHub release `vX.Y.Z` with the AppImage and `SHA256SUMS`. The release notes are the commit subjects since the previous tag. Runs on the same ref are serialized (`concurrency: build-<ref>`). A waiting run can be superseded by a newer push, and the next release then includes its commits.

## Milestones
- 2026-11-05: Phase 1 multi-user server (org tree, roles, review, co-editing, notifications). Renamed to Thoughtwell.
- 2026-11-19: Automatic versioning and GitHub releases set up. The first release will be 1.0.1.
- 2026-11-19: Pivot to local-first. Server, Postgres and Docker deploy removed; Markdown vault with Me/ and Brain/ areas for AI agents.

## Known open issues
- Still to come: optional sync/multi-user backend, a built-in agent runner, `[[` link autocomplete, macOS/Windows builds.
- The AppImage needs glibc 2.39+ and FUSE 2, and it can't run as root. Without FUSE, `--appimage-extract-and-run` prints to stdout, which breaks `--mcp`: extract once and run `squashfs-root/thoughtwell --mcp` instead.

## How to work here (owner preferences)
- **Communication:** give concise, plain answers and lead with the outcome. Explain trade-offs only when they matter. No filler. When reporting work, say what was verified and what wasn't.
- **Questions:** when something is unclear or the decision is the owner's, ask instead of guessing. Give concrete options and a recommendation.
- **Git:** commit freely on feature branches with clear messages, and branch first if you're on `main`. **Ask before pushing**, opening PRs, touching `main`, creating or deleting releases or tags, or force-pushing. Pushing to `main` publishes a release. Write commit subjects a user could read, because they become the release notes.
- **Destructive or outward-facing actions:** confirm first. That includes deleting files or branches, rewriting history, publishing, changing CI secrets, deploying, and contacting external services. Approval for one action doesn't carry over to the next.
- **Upkeep (required on every change):** add a line to `CHANGELOG.md` for any user-visible change or fix. Update Milestones and Known open issues when they change. Keep this file under ~80 lines.
