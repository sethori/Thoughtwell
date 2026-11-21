# Thoughtwell

A local-first second brain for your desktop. Your notes and your AI agents'
notes live side by side as plain Markdown files in a folder on your computer:

- **Me/** is yours: notes, thoughts and ideas.
- **Brain/** belongs to your AI agents. Drop in documents, PDFs, videos and
  anything else. Point an agent (Claude Code, or any agent that can read and
  write files) at the folder, and it summarizes, links and organizes it all.

While you write in Me/, Thoughtwell shows what your Brain knows that relates to
the note you're working on.

There is no server and no account, and nothing leaves your computer. Sync and
multi-user sharing will come later as an optional backend.

## The vault

The first time you start Thoughtwell, you choose a folder for your vault
(by default `~/Thoughtwell`). It looks like this:

```
~/Thoughtwell/
  AGENTS.md            Rules for AI agents. Edit freely; Thoughtwell never overwrites it.
  Me/                  Your notes. Agents may read but never change anything here.
  Brain/
    Inbox/             Drop new material here (drag it onto the Brain area, or use Add files).
    Sources/           Originals, moved here by an agent once processed.
    Summaries/         One note per source, with frontmatter: source, tags, summary.
    Topics/            Hub notes linking ideas across sources.
    Log.md             One line per piece of agent work.
```

Everything is ordinary files, so backups, git, Syncthing or Obsidian all work
on the same folder. Hidden files and folders (`.git`, `.obsidian`) are ignored.

### Using it with an AI agent

From the Brain home screen, copy the ready-made command, or run it yourself:

```bash
cd ~/Thoughtwell && claude "Read AGENTS.md, then process everything in Brain/Inbox."
```

The vault's `AGENTS.md` tells the agent what to do with each item: move the
original into `Sources/`, transcribe video and audio, write a summary note with
frontmatter, link it into topic notes, and log the work. Thoughtwell picks up
every change the moment it's written: the tree, search and the related-notes
panel update, and an open note reloads, or warns you if you are editing it.

### Connecting agents over MCP

Thoughtwell is also an [MCP](https://modelcontextprotocol.io) server, so agents
get proper tools instead of raw file access, and the vault's rules are enforced:
**agents can read anything, write only inside `Brain/`, and delete nothing.**
The AppImage is the server; it serves the vault the app last opened, with no
window. Add it to Claude Code once (the Brain home screen has this command,
with your real path, ready to copy):

```bash
claude mcp add --scope user thoughtwell -- /path/to/Thoughtwell.AppImage --mcp --ozone-platform=headless
```

For other agents, the same command goes in their MCP config
(`{"mcpServers": {"thoughtwell": {"command": "/path/to/Thoughtwell.AppImage", "args": ["--mcp", "--ozone-platform=headless"]}}}`).
`--vault <folder>` picks another vault. Then ask the agent to "process my
Thoughtwell inbox", or use its `process_inbox` prompt.

| Tool | What it does |
| --- | --- |
| `vault_overview` | Layout, what's waiting in the inbox, note counts, tags in use |
| `owner_interests` | Your most-used tags, the themes and titles of your recent Me/ notes |
| `search`, `related`, `backlinks` | Search the vault, find related notes, see what links to a note |
| `list_files`, `read_note`, `file_info` | Browse, read notes, and get a file's location on disk (for PDF text extraction or transcription) |
| `move_to_sources` | Move a processed inbox item to Sources/ (never replacing a file) |
| `save_summary` | Write a summary with standard frontmatter, link it from topic notes, and log it |
| `add_to_topic`, `write_note`, `append_log` | Extend topic notes, write other Brain/ notes (refused if the file changed since read), log work |

### Note format

GitHub-flavored Markdown with optional YAML frontmatter (`title`, `type`,
`source`, `tags`, `summary`, `author`, `created`, `updated`; other fields are
kept). Link notes with `[[Note name]]` and files with relative links. Rich
blocks use conventions that other Markdown tools still show sensibly:

| Block | In the file |
| --- | --- |
| Diagrams (mind maps, flowcharts, timelines) | a ```` ```mermaid ```` fence |
| Charts | a ```` ```chart ```` fence holding `{"type": "bar", "title": …, "labels": […], "series": [{"name": …, "values": […]}]}` |
| Sketches (Excalidraw) | `![Sketch](attachments/name.excalidraw.svg)`, with the editable scene beside it as `name.excalidraw` |
| Table formulas | cell text such as `=SUM(B2:B5)` |
| Images and dropped files | saved in an `attachments/` folder beside the note |
| Anything else (HTML, link definitions) | kept exactly as written |

Thoughtwell only writes a file when you change it. Agent notes open read-only
until you click **Edit**.

## Features

| Area | What you get |
| --- | --- |
| Two areas | Me and Brain, each with a file tree: create, rename, drag to move, move to the system trash, show in the file manager |
| Editor | Headings, lists and tasks, tables with formulas, code with highlighting for about 35 languages, quotes, images, links, wikilinks, charts, Excalidraw sketches and Mermaid diagrams, with undo and redo. Autosaves as you type |
| Agent notes | Read-only by default. A properties row shows type, author, a source link, tags and the summary |
| Files | PDFs, video (with seeking), audio, images and text open in the app. Anything else opens in its own app |
| Related | For your notes, "From your Brain" ranks agent notes by shared words, tags and links. Backlinks show for every note |
| Search | Ctrl+K searches every note and file name, across both areas or just one |
| Safe with agents | Atomic writes (a reader never sees half a file), and a conflict banner when a note you're editing is changed on disk |
| Appearance | Light or dark, comfortable or compact, five accents |

## How it is built

```
apps/desktop     Electron: vault service, IPC bridge (preload), app:// and vault:// protocols, smoke test
apps/web         React + Vite + TipTap editor (the window's UI)
packages/mcp     MCP server for agents (tools over the vault; Brain/-only writes), stdio CLI
packages/vault   The folder: safe paths, atomic writes, import, search index, file watcher, AGENTS.md template
packages/shared  Markdown <-> editor conversion, frontmatter, vault layout, bridge types, formulas, charts, theme
scripts/         Release versioning (version.py)
```

The web app reaches the disk only through the `window.thoughtwell` bridge.
Every path is checked to stay inside the vault, symlinks included. Files are
shown through `vault://`. HTML and scripts from the vault are served as text or
sandboxed, so a saved web page can't run code in the app.

## Develop

Node 22 and pnpm 10.

```bash
pnpm install
pnpm dev          # Vite on :5173 and the Electron window
pnpm typecheck
pnpm test         # shared + vault unit tests, version-script tests
pnpm desktop:package   # AppImage in apps/desktop/release
```

Smoke tests (CI runs both on the AppImage), each on a throwaway vault and settings folder:

- App: build, then `THOUGHTWELL_RESOURCES=<folder with web/> electron apps/desktop --smoke`.
- MCP: `node apps/desktop/scripts/mcp-smoke.mjs <path to electron or the AppImage> [args]`.

Run the MCP server from source with `pnpm --filter @notes/mcp start --vault <folder>`.

## Releases

Every push to `main` builds, tests and smoke-tests the AppImage. It is then
published as GitHub release `vX.Y.Z`. Versions come from git tags; see
`scripts/version.py`. The AppImage needs glibc 2.39+ and FUSE 2.

The AppImage updates itself. When it opens (and from **Settings → Updates** or
**File → Check for updates…**), it looks at the latest GitHub release. If there is a
newer one, it downloads that release's AppImage, checks it against `SHA256SUMS`, and
replaces the AppImage file in place, keeping its path so shortcuts and MCP configs still
work. The new version runs the next time you open Thoughtwell, or right away if you
choose **Restart now**. Turn off the check on open in the same place.

## License

Thoughtwell is free software under the [GNU General Public License v3.0 or later](LICENSE).
You may use, share and change it for any purpose. If you distribute it or a modified
version, you must do so under the same license, with its source code.
