import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { VaultService } from '@notes/vault';
import { createServer, findVault } from '../src/index.js';

type Result = { isError?: boolean; content: { type: string; text: string }[] };

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'thoughtwell-mcp-'));
  const service = await VaultService.open(dir, { watch: false });
  const server = createServer(service);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  t.after(async () => {
    await client.close();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Result;
  const json = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args);
    assert.ok(!r.isError, `${name} failed: ${r.content[0]?.text}`);
    return JSON.parse(r.content[0]!.text) as Record<string, any>;
  };
  return { dir, service, client, call, json };
}

test('lists the tools and the process_inbox prompt, with server instructions', async (t) => {
  const { client } = await setup(t);
  const names = (await client.listTools()).tools.map((x) => x.name).sort();
  assert.deepEqual(names, ['add_to_topic', 'append_log', 'backlinks', 'file_info', 'list_files', 'move_to_sources', 'owner_interests', 'read_note', 'related', 'save_summary', 'search', 'vault_overview', 'write_note']);
  assert.match(client.getInstructions() ?? '', /cannot change it/);
  const prompt = await client.getPrompt({ name: 'process_inbox' });
  assert.match((prompt.messages[0]!.content as { text: string }).text, /Never create, edit, move or delete anything in `Me\/`/);
});

test('a full inbox run: overview, move to sources, summary with topics and log', async (t) => {
  const { dir, json, call } = await setup(t);
  await writeFile(join(dir, 'Brain/Inbox/attention.pdf'), '%PDF fake');
  const overview = await json('vault_overview');
  assert.deepEqual(overview.inbox.map((i: { path: string }) => i.path), ['Brain/Inbox/attention.pdf']);

  const info = await json('file_info', { path: 'Brain/Inbox/attention.pdf' });
  assert.equal(info.kind, 'pdf');
  assert.equal(info.absolutePath, join(dir, 'Brain/Inbox/attention.pdf'));
  assert.ok((await call('read_note', { path: 'Brain/Inbox/attention.pdf' })).isError, 'binary files are not read as text');

  const moved = await json('move_to_sources', { path: 'Brain/Inbox/attention.pdf' });
  assert.equal(moved.path, 'Brain/Sources/attention.pdf');

  const saved = await json('save_summary', {
    title: 'Attention Is All You Need',
    source: moved.path,
    summary: 'Transformers replace recurrence with self-attention.',
    body: '## Key points\n\n- Self-attention\n- Parallel training',
    tags: ['Machine Learning', '#papers'],
    topics: ['Transformers'],
  });
  assert.equal(saved.path, 'Brain/Summaries/Attention Is All You Need.md');

  const note = await json('read_note', { path: saved.path });
  assert.equal(note.meta.type, 'summary');
  assert.equal(note.meta.source, 'Brain/Sources/attention.pdf');
  assert.deepEqual(note.meta.tags, ['machine-learning', 'papers']);
  assert.equal(note.meta.author, 'test-agent', 'author comes from the MCP client name');
  assert.match(note.content, /^---\n[\s\S]*\n---\n\n# Attention Is All You Need\n\n## Key points/);

  const topic = await readFile(join(dir, 'Brain/Topics/Transformers.md'), 'utf8');
  assert.match(topic, /type: topic/);
  assert.match(topic, /- \[\[Attention Is All You Need\]\]: Transformers replace/);
  await json('add_to_topic', { topic: 'Transformers', line: '[[Attention Is All You Need]]: Transformers replace recurrence with self-attention.' });
  assert.equal((await readFile(join(dir, 'Brain/Topics/Transformers.md'), 'utf8')).match(/Attention Is All/g)!.length, 1, 'no duplicate lines');

  const log = await readFile(join(dir, 'Brain/Log.md'), 'utf8');
  assert.match(log, /· test-agent · Summarized \[\[Attention Is All You Need\]\] from Brain\/Sources\/attention.pdf\.\n$/);

  // Now searchable, linked and visible in the overview.
  assert.equal((await json('search', { query: 'self-attention' }))[0].path, saved.path);
  assert.deepEqual((await json('backlinks', { path: saved.path })).map((h: { path: string }) => h.path).sort(), ['Brain/Log.md', 'Brain/Topics/Transformers.md']);
  assert.ok((await json('vault_overview')).tags.some((x: { tag: string }) => x.tag === 'papers'));
  assert.ok((await call('save_summary', { title: 'Attention Is All You Need', source: 'x', summary: 'y', body: 'z' })).isError, 'no silent overwrite');
});

test("Me/ is read-only, nothing escapes the vault, and existing files are not replaced blindly", async (t) => {
  const { json, call } = await setup(t);
  for (const path of ['Me/Hacked.md', 'AGENTS.md', 'Brain', '../outside.md', 'Brain/../Me/x.md', 'Brain/.hidden.md']) {
    const r = await call('write_note', { path, content: 'x' });
    assert.ok(r.isError, `write to ${path} should fail`);
  }
  assert.match((await call('write_note', { path: 'Me/Hacked.md', content: 'x' })).content[0]!.text, /read-only/);
  assert.ok((await call('read_note', { path: '../../etc/passwd' })).isError);
  assert.ok((await call('move_to_sources', { path: 'Me/Welcome.md' })).isError, 'only inbox items move');
  assert.ok((await call('list_files', { folder: '..' })).isError);

  // The owner's notes can be read.
  assert.match((await json('read_note', { path: 'Me/Welcome.md' })).content, /Welcome to Thoughtwell/);

  const created = await json('write_note', { path: 'Brain/Topics/Ideas.md', content: '# Ideas\n' });
  assert.equal(created.created, true);
  assert.match((await call('write_note', { path: 'Brain/Topics/Ideas.md', content: 'again' })).content[0]!.text, /expected_version/);
  const read = await json('read_note', { path: 'Brain/Topics/Ideas.md' });
  await json('write_note', { path: 'Brain/Topics/Ideas.md', content: '# Ideas\n\nmore\n', expected_version: read.version });
  // Straight away, within the same filesystem clock tick: the old version must still be refused.
  assert.match((await call('write_note', { path: 'Brain/Topics/Ideas.md', content: 'stale', expected_version: read.version })).content[0]!.text, /conflict/);
});

test("owner_interests reads the owner's notes", async (t) => {
  const { dir, service, json } = await setup(t);
  await writeFile(join(dir, 'Me/Garden.md'), '---\ntags: [gardening]\n---\n# Garden plans\nTomatoes, compost and raised beds. More compost.');
  await service.touched('Me/Garden.md');
  const r = await json('owner_interests');
  assert.ok(r.tags.some((x: { tag: string }) => x.tag === 'gardening'));
  assert.ok(r.themes.includes('compost'));
  assert.ok(r.recentNotes.some((n: { path: string }) => n.path === 'Me/Garden.md'));
});

test('the command-line server speaks MCP over stdio and finds the vault from app settings', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'thoughtwell-mcp-cli-'));
  const settings = await mkdtemp(join(tmpdir(), 'thoughtwell-settings-'));
  t.after(() => Promise.all([rm(dir, { recursive: true, force: true }), rm(settings, { recursive: true, force: true })]).then(() => {}));
  await writeFile(join(settings, 'settings.json'), JSON.stringify({ vaultPath: dir }));
  assert.equal(findVault([], settings), dir);
  assert.equal(findVault(['--vault', '/x'], settings), '/x');

  const here = dirname(fileURLToPath(import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', join(here, '../src/cli.ts'), '--vault', dir],
    cwd: join(here, '..'),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  const r = (await client.callTool({ name: 'vault_overview', arguments: {} })) as Result;
  assert.equal(JSON.parse(r.content[0]!.text).root, dir);
});
