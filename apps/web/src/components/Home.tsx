import { useMemo } from 'react';
import { AGENTS_FILE, AREA_DIR, BRAIN_DIRS, BRAIN_LOG, dirname, noteName, type Area, type Entry } from '@notes/shared';
import { tw, type VaultInfo } from '../lib/vault';
import { Icon } from './Icon';

/** What a coding agent can be told, from a terminal opened in the vault folder. */
const PROMPT = 'Read AGENTS.md, then process everything in Brain/Inbox.';

/** The start page for an area: recent notes, and for the Brain, the inbox and how to hand it to an agent. */
export function Home({ area, entries, info, onOpen, notify }: { area: Area; entries: Entry[]; info: VaultInfo; onOpen: (p: string) => void; notify: (m: string) => void }) {
  const root = AREA_DIR[area];
  const recent = useMemo(
    () =>
      entries
        .filter((e) => e.kind === 'note' && e.path.startsWith(root + '/') && e.path !== BRAIN_LOG)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 8),
    [entries, root],
  );
  const inbox = entries.filter((e) => dirname(e.path) === BRAIN_DIRS.inbox);
  const command = `cd "${info.root}" && claude "${PROMPT}"`;
  const q = (a: string) => (/^[\w./:=@-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  const [mcpCmd = '', ...mcpArgs] = info.mcpCommand;
  const claudeAdd = `claude mcp add --scope user thoughtwell -- ${info.mcpCommand.map(q).join(' ')}`;
  const mcpJson = JSON.stringify({ mcpServers: { thoughtwell: { command: mcpCmd, args: mcpArgs } } }, null, 2);

  return (
    <div className="stage">
      <div className="home">
        {area === 'me' ? (
          <>
            <h2>Your notes</h2>
            <p className="muted">Notes, thoughts and ideas. Your agents read these to learn what you care about, but never change them.</p>
          </>
        ) : (
          <>
            <h2>Brain</h2>
            <p className="muted">Where your AI agents ingest, summarize and organize. Drop anything into the inbox, then hand it to an agent.</p>
            <div className="card">
              <div className="card-h">
                <Icon name="upload" small />
                Inbox: {inbox.length ? `${inbox.length} item${inbox.length === 1 ? '' : 's'} waiting` : 'empty'}
              </div>
              {inbox.slice(0, 6).map((e) => (
                <button key={e.path} type="button" className="rel" onClick={() => onOpen(e.path)}>
                  <span className="rel-t">{e.name}</span>
                </button>
              ))}
              <div className="row">
                <button type="button" className="btn" onClick={() => void tw.pickAndImport(BRAIN_DIRS.inbox).then((a) => a.length && notify(`Added ${a.length} to the inbox`))}>
                  Add files…
                </button>
              </div>
            </div>
            <div className="card">
              <div className="card-h">
                <Icon name="sparkle" small />
                Connect an agent (MCP)
              </div>
              <p className="muted">
                Thoughtwell is also an MCP server. Agents get tools to search the vault, read what you care about, file inbox items and write summaries, and
                they can only write in Brain/. Add it to Claude Code once:
              </p>
              <code className="path">{claudeAdd}</code>
              <div className="row">
                <button type="button" className="btn" onClick={() => void tw.copyText(claudeAdd).then(() => notify('Command copied'))}>
                  Copy for Claude Code
                </button>
                <button type="button" className="btn" onClick={() => void tw.copyText(mcpJson).then(() => notify('MCP config copied'))}>
                  Copy JSON for other agents
                </button>
              </div>
              <p className="muted">Then ask it to use the process_inbox prompt, or just to process your Thoughtwell inbox. If you move the app, add it again.</p>
            </div>
            <div className="card">
              <div className="card-h">
                <Icon name="folder" small />
                Or point an agent at the folder
              </div>
              <p className="muted">
                Any agent that can read and write files works. The vault's <b>{AGENTS_FILE}</b> tells it the rules: never touch Me/, keep originals, write summaries with sources and tags, and log its work.
              </p>
              <code className="path">{command}</code>
              <div className="row">
                <button type="button" className="btn" onClick={() => void tw.copyText(command).then(() => notify('Command copied'))}>
                  Copy command (Claude Code)
                </button>
                <button type="button" className="btn" onClick={() => void tw.copyText(info.root).then(() => notify('Vault path copied'))}>
                  Copy vault path
                </button>
                <button type="button" className="btn" onClick={() => onOpen(AGENTS_FILE)}>
                  Read {AGENTS_FILE}
                </button>
                <button type="button" className="btn" onClick={() => onOpen(BRAIN_LOG)}>
                  Agent log
                </button>
              </div>
            </div>
          </>
        )}
        <h3>Recently changed</h3>
        {recent.length ? (
          recent.map((e) => (
            <button key={e.path} type="button" className="rel" onClick={() => onOpen(e.path)}>
              <span className="rel-t">
                <Icon name="note" small />
                {noteName(e.path)}
                <span className="rel-path">{new Date(e.mtime).toLocaleString()}</span>
              </span>
            </button>
          ))
        ) : (
          <p className="muted">Nothing here yet.</p>
        )}
      </div>
    </div>
  );
}
