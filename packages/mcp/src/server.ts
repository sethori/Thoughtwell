/**
 * The Thoughtwell MCP server: lets AI agents work in a vault through tools
 * instead of raw file access. Reading is allowed anywhere in the vault;
 * writing only inside Brain/, and nothing is ever deleted. These are the
 * vault's AGENTS.md rules, enforced.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { stringify as toYaml } from 'yaml';
import { z } from 'zod';
import {
  AGENTS_FILE,
  areaOf,
  BRAIN,
  BRAIN_DIRS,
  BRAIN_LOG,
  dirname,
  fileKind,
  isNotePath,
  joinFrontmatter,
  joinPath,
  ME,
  noteName,
  parseMeta,
  safeFileName,
  splitFrontmatter,
} from '@notes/shared';
import { VaultError, type VaultService } from '@notes/vault';

export const SERVER_NAME = 'thoughtwell';

const INSTRUCTIONS = `Thoughtwell is the owner's second brain: a folder of Markdown notes.
- ${ME}/ is the owner's own notes. Read it to learn what they care about (owner_interests, search with area "me"), but you cannot change it.
- ${BRAIN}/ is yours: ${BRAIN_DIRS.inbox} (new material), ${BRAIN_DIRS.sources} (originals), ${BRAIN_DIRS.summaries}, ${BRAIN_DIRS.topics}, ${BRAIN_LOG}.
- To process the inbox: vault_overview, then for each item: file_info or read_note to read it, move_to_sources, save_summary (it links topics and logs for you).
- Search before creating topics, and reuse existing tags (vault_overview lists them).
- Nothing can be deleted. Notes are GitHub-flavored Markdown; link notes with [[Note name]].
The vault's ${AGENTS_FILE} has the full conventions; read it with read_note.`;

const MAX_READ = 512 * 1024;

const area = z.enum(['me', 'brain']).optional().describe('Limit to one area: "me" (the owner\'s notes) or "brain" (agent notes). Omit for both.');

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Normalizes a vault path from an agent: forward slashes, no leading slash, no trailing slash. */
function clean(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/** Agents may write only inside Brain/ (not Brain/ itself), and never hidden files. */
function assertWritable(path: string): void {
  if (areaOf(path) !== 'brain' || path === BRAIN) {
    throw new VaultError('protected', `Agents can only write inside ${BRAIN}/. ${path.startsWith(ME) ? `${ME}/ belongs to the owner and is read-only.` : ''}`.trim());
  }
  if (path.split('/').some((p) => p.startsWith('.') || p === '..')) throw new VaultError('invalid', 'Hidden files and ".." are not allowed');
}

const today = () => new Date().toISOString().slice(0, 10);

/** Runs a tool body, turning vault errors into tool errors the agent can read. */
async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    const code = err instanceof VaultError ? `${err.code}: ` : '';
    return fail(code + (err as Error).message);
  }
}

export interface ServerOptions {
  /** The agent's name for frontmatter and the log, when the client does not say. */
  agentName?: string;
  version?: string;
}

export function createServer(service: VaultService, opts: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: opts.version ?? '0.0.0' }, { instructions: INSTRUCTIONS });
  const vault = service.vault;
  const index = service.index;

  /** Who is writing: the client's name (claude-code, cursor…) unless the agent names itself. */
  const agent = (given?: string) =>
    (given || opts.agentName || server.server.getClientVersion()?.name || 'agent').replace(/[^\w .@-]+/g, '').slice(0, 60) || 'agent';

  /** Writes a text file in Brain/, keeping the index current. */
  async function writeBrain(path: string, content: string, expectedVersion?: string | null, create = false) {
    assertWritable(path);
    const r = await vault.write(path, content, { expectedVersion, create });
    await service.touched(path);
    return r;
  }

  /** Read-modify-write that retries if someone else wrote in between (the app, another agent). */
  async function update(path: string, change: (current: string | null) => string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const current = (await vault.exists(path)) ? await vault.read(path) : null;
      try {
        await writeBrain(path, change(current?.content ?? null), current?.version ?? null, !current);
        return;
      } catch (err) {
        const retry = err instanceof VaultError && (err.code === 'conflict' || err.code === 'exists');
        if (!retry || attempt >= 4) throw err;
      }
    }
  }

  async function appendLog(name: string, message: string): Promise<void> {
    const line = `- ${today()} · ${name} · ${message.replace(/\s*\n\s*/g, ' ').trim()}`;
    await update(BRAIN_LOG, (cur) => (cur ? cur.replace(/\n*$/, '\n') : '# Agent log\n\n') + line + '\n');
  }

  async function addToTopic(topic: string, line: string, name: string): Promise<string> {
    const title = safeFileName(topic);
    const path = joinPath(BRAIN_DIRS.topics, `${title}.md`);
    const bullet = line.trim().startsWith('- ') ? line.trim() : `- ${line.trim()}`;
    await update(path, (cur) => {
      if (cur === null) {
        const fm = toYaml({ title, type: 'topic', author: name, created: today(), updated: today() }).trimEnd();
        return joinFrontmatter(fm, `# ${title}\n\n${bullet}\n`);
      }
      if (cur.includes(bullet)) return cur;
      const { frontmatter, body } = splitFrontmatter(cur);
      const fm = frontmatter === null ? null : frontmatter.replace(/^updated:.*$/m, `updated: ${today()}`);
      return joinFrontmatter(fm, body.replace(/\n*$/, '\n') + bullet + '\n');
    });
    return path;
  }

  // ---------------------------------------------------------------- reading

  server.registerTool(
    'vault_overview',
    {
      title: 'Vault overview',
      description: 'Start here. The vault layout, what is waiting in the Brain inbox, note counts, and the tags already in use (reuse them).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(async () => {
        const docs = index.all();
        const inbox = (await vault.list()).filter((e) => dirname(e.path) === BRAIN_DIRS.inbox);
        return ok({
          root: vault.root,
          rules: `Read anything. Write only inside ${BRAIN}/. ${ME}/ is the owner's and read-only. Nothing can be deleted. Full conventions: read_note("${AGENTS_FILE}").`,
          folders: { me: ME, ...BRAIN_DIRS, log: BRAIN_LOG },
          inbox: inbox.map((e) => ({ path: e.path, kind: e.kind, bytes: e.size })),
          notes: { me: docs.filter((d) => d.area === 'me' && d.kind === 'note').length, brain: docs.filter((d) => d.area === 'brain' && d.kind === 'note').length },
          tags: index.tags('brain').slice(0, 60),
        });
      }),
  );

  server.registerTool(
    'list_files',
    {
      title: 'List files',
      description: 'Files and folders in a vault folder.',
      inputSchema: {
        folder: z.string().default(BRAIN).describe('Vault folder, for example "Brain/Topics" or "Me". Use "" for the vault root.'),
        recursive: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true },
    },
    ({ folder, recursive }) =>
      guard(async () => {
        const dir = clean(folder);
        vault.resolve(dir);
        const prefix = dir ? dir + '/' : '';
        const entries = (await vault.list()).filter((e) => e.path.startsWith(prefix) && (recursive || !e.path.slice(prefix.length).includes('/')));
        return ok(entries.map((e) => ({ path: e.path, kind: e.kind, bytes: e.size, modified: new Date(e.mtime).toISOString() })));
      }),
  );

  server.registerTool(
    'read_note',
    {
      title: 'Read a note',
      description: 'Reads a Markdown note or other text file. Returns its frontmatter fields, its text, and `version` (pass it to write_note as expected_version to update it safely). For PDFs, video and other binary files use file_info.',
      inputSchema: { path: z.string().describe('Vault path, for example "Brain/Summaries/Some title.md"') },
      annotations: { readOnlyHint: true },
    },
    ({ path }) =>
      guard(async () => {
        const p = clean(path);
        const kind = fileKind(p);
        if (kind !== 'note' && kind !== 'text' && kind !== 'sketch') return fail(`${p} is a ${kind} file, not text. Use file_info for its location on disk.`);
        const { content, version } = await vault.read(p);
        const truncated = content.length > MAX_READ;
        const meta = isNotePath(p) ? parseMeta(splitFrontmatter(content).frontmatter) : undefined;
        return ok({ path: p, version, meta, truncated, content: truncated ? content.slice(0, MAX_READ) : content });
      }),
  );

  server.registerTool(
    'file_info',
    {
      title: 'File info',
      description: "A file's kind, size and absolute path on disk, so you can open it with your own tools (PDF text extraction, transcription). Also lists notes that mention it.",
      inputSchema: { path: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ path }) =>
      guard(async () => {
        const p = clean(path);
        const entry = (await vault.list()).find((e) => e.path === p);
        if (!entry) return fail(`${p} not found`);
        const mentions = index.search(noteName(p.split('/').pop() ?? p).replace(/\.[^.]+$/, ''), { limit: 10 }).filter((h) => h.kind === 'note');
        return ok({ path: p, kind: entry.kind, bytes: entry.size, modified: new Date(entry.mtime).toISOString(), absolutePath: vault.resolve(p), mentionedIn: mentions.map((h) => h.path) });
      }),
  );

  server.registerTool(
    'search',
    {
      title: 'Search the vault',
      description: 'Full-text search over notes (titles, tags and summaries weigh more) and file names. Search before creating a topic, to extend the existing one.',
      inputSchema: { query: z.string(), area, limit: z.number().int().min(1).max(50).default(10) },
      annotations: { readOnlyHint: true },
    },
    ({ query, area: a, limit }) => guard(async () => ok(index.search(query, { area: a, limit }).map(({ score: _s, ...h }) => h))),
  );

  server.registerTool(
    'related',
    {
      title: 'Related notes',
      description: 'Notes related to a note (by path) or to some text: shared distinctive words, shared tags and wikilinks.',
      inputSchema: { path: z.string().optional(), text: z.string().optional(), area, limit: z.number().int().min(1).max(30).default(8) },
      annotations: { readOnlyHint: true },
    },
    ({ path, text, area: a, limit }) =>
      guard(async () => {
        if (!path && !text) return fail('Give a path or some text');
        return ok(index.related({ path: path ? clean(path) : undefined, text }, { area: a, limit }).map(({ score: _s, ...h }) => h));
      }),
  );

  server.registerTool(
    'backlinks',
    {
      title: 'Backlinks',
      description: 'Notes that link to this note with [[its name]].',
      inputSchema: { path: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ path }) => guard(async () => ok(index.backlinks(clean(path)).map((h) => ({ path: h.path, title: h.title })))),
  );

  server.registerTool(
    'owner_interests',
    {
      title: "The owner's interests",
      description: `What the owner has been writing about in ${ME}/: their most used tags, the distinctive words of their recent notes, and those notes' titles. Use it to decide what matters when summarizing and which topics to link.`,
      inputSchema: { recent: z.number().int().min(1).max(50).default(15).describe('How many recent notes to look at') },
      annotations: { readOnlyHint: true },
    },
    ({ recent }) =>
      guard(async () => {
        const mine = index
          .all()
          .filter((d) => d.area === 'me' && d.kind === 'note')
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, recent);
        const weight = new Map<string, number>();
        for (const d of mine) for (const t of index.keyTerms(d.path, 10)) weight.set(t, (weight.get(t) ?? 0) + 1);
        const terms = [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t]) => t);
        return ok({
          tags: index.tags('me').slice(0, 30),
          themes: terms,
          recentNotes: mine.map((d) => ({ path: d.path, title: d.title, modified: new Date(d.mtime).toISOString().slice(0, 10) })),
        });
      }),
  );

  // ---------------------------------------------------------------- writing (Brain/ only)

  server.registerTool(
    'write_note',
    {
      title: 'Write a note',
      description: `Creates or replaces a text file inside ${BRAIN}/ (atomically). To change an existing note, read it first and pass its version as expected_version; the write is refused if it changed since. Prefer save_summary for summaries.`,
      inputSchema: {
        path: z.string().describe(`Vault path inside ${BRAIN}/, ending in .md for notes`),
        content: z.string().describe('The whole file, including any frontmatter'),
        expected_version: z.string().optional().describe('From read_note. Required to replace an existing file.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ path, content, expected_version }) =>
      guard(async () => {
        const p = clean(path);
        const exists = await vault.exists(p);
        if (exists && expected_version === undefined) return fail(`${p} already exists. read_note it and pass expected_version to replace it.`);
        const { version } = await writeBrain(p, content, exists ? expected_version : null, !exists);
        return ok({ path: p, version, created: !exists });
      }),
  );

  server.registerTool(
    'save_summary',
    {
      title: 'Save a summary',
      description: `Writes a summary note in ${BRAIN_DIRS.summaries}/ with the standard frontmatter, links it from each topic (creating topics as needed), and adds a line to the log. The note is named after the title.`,
      inputSchema: {
        title: z.string(),
        source: z.string().describe('Vault path of the original (for example Brain/Sources/report.pdf) or a URL'),
        summary: z.string().describe('One sentence for lists'),
        body: z.string().describe('Markdown body: short summary, key points, quotes, open questions. A "# Title" heading is added if missing.'),
        tags: z.array(z.string()).default([]).describe('Lowercase, hyphenated. Reuse tags from vault_overview.'),
        topics: z.array(z.string()).default([]).describe(`Topic note names in ${BRAIN_DIRS.topics}/ to link this from`),
        folder: z.string().optional().describe(`Subfolder of ${BRAIN_DIRS.summaries}/, if this belongs to a group`),
        overwrite: z.boolean().default(false).describe('Replace an existing summary with the same title'),
        agent: z.string().optional().describe('Your name, for author and the log'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (a) =>
      guard(async () => {
        const name = agent(a.agent);
        const title = a.title.trim();
        const dir = a.folder ? joinPath(BRAIN_DIRS.summaries, clean(a.folder)) : BRAIN_DIRS.summaries;
        const path = joinPath(dir, `${safeFileName(title)}.md`);
        const existing = (await vault.exists(path)) ? await vault.read(path) : null;
        if (existing && !a.overwrite) return fail(`${path} already exists. Read it and extend it, or pass overwrite: true.`);
        const created = (existing && parseMeta(splitFrontmatter(existing.content).frontmatter).created) || today();
        const tags = [...new Set(a.tags.map((t) => t.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-')).filter(Boolean))];
        const fm = toYaml({ title, type: 'summary', source: a.source, tags, summary: a.summary.trim(), author: name, created, updated: today() }, { lineWidth: 0 }).trimEnd();
        const body = /^#\s/m.test(a.body.trimStart().split('\n')[0] ?? '') ? a.body.trim() : `# ${title}\n\n${a.body.trim()}`;
        await writeBrain(path, joinFrontmatter(fm, body + '\n'), existing?.version ?? null, !existing);
        const topics: string[] = [];
        for (const t of a.topics) topics.push(await addToTopic(t, `[[${noteName(path)}]]: ${a.summary.trim()}`, name));
        await appendLog(name, `${existing ? 'Updated' : 'Summarized'} [[${noteName(path)}]] from ${a.source}.`);
        return ok({ path, topics, log: BRAIN_LOG });
      }),
  );

  server.registerTool(
    'add_to_topic',
    {
      title: 'Add to a topic',
      description: `Appends a line (usually a [[wikilink]] and why it matters) to a topic note in ${BRAIN_DIRS.topics}/, creating the topic if needed. Lines already there are not repeated.`,
      inputSchema: { topic: z.string(), line: z.string(), agent: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ topic, line, agent: given }) => guard(async () => ok({ path: await addToTopic(topic, line, agent(given)) })),
  );

  server.registerTool(
    'move_to_sources',
    {
      title: 'Move to Sources',
      description: `Moves a processed item from ${BRAIN_DIRS.inbox}/ to ${BRAIN_DIRS.sources}/ (never replacing a file there; a number is added if the name is taken). Returns the new path to use as the summary's source.`,
      inputSchema: { path: z.string().describe(`Path in ${BRAIN_DIRS.inbox}/`), folder: z.string().optional().describe(`Subfolder of ${BRAIN_DIRS.sources}/`) },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ path, folder }) =>
      guard(async () => {
        const from = clean(path);
        if (!from.startsWith(BRAIN_DIRS.inbox + '/')) return fail(`Only items in ${BRAIN_DIRS.inbox}/ can be moved to Sources`);
        const dir = folder ? joinPath(BRAIN_DIRS.sources, clean(folder)) : BRAIN_DIRS.sources;
        assertWritable(dir);
        const to = await vault.uniquePath(dir, from.split('/').pop()!);
        const moved = await vault.move(from, to);
        index.removeUnder(from);
        await service.touched(moved);
        return ok({ from, path: moved });
      }),
  );

  server.registerTool(
    'append_log',
    {
      title: 'Log your work',
      description: `Adds a line to ${BRAIN_LOG}: what you did, for the owner to see. save_summary logs for you.`,
      inputSchema: { message: z.string(), agent: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ message, agent: given }) =>
      guard(async () => {
        await appendLog(agent(given), message);
        return ok({ path: BRAIN_LOG });
      }),
  );

  server.registerPrompt(
    'process_inbox',
    {
      title: 'Process the Brain inbox',
      description: 'Summarize and file everything waiting in Brain/Inbox, following the vault rules.',
    },
    async () => {
      const agents = (await vault.exists(AGENTS_FILE)) ? (await vault.read(AGENTS_FILE)).content : '';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Process everything in ${BRAIN_DIRS.inbox} using the thoughtwell tools.\n\n1. vault_overview, and owner_interests to see what I care about.\n2. For each inbox item: read it (read_note, or file_info for binary files and your own tools to extract text or transcribe), then move_to_sources, then save_summary with tags and topics. Search first so you extend existing topics.\n3. Finish with a short report of what you filed.\n\nThe vault's rules:\n\n${agents}`,
            },
          },
        ],
      };
    },
  );

  return server;
}
