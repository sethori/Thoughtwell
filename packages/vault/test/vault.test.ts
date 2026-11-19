import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, utimes, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SearchIndex, Vault, VaultError, VaultService } from '../src/index.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'thoughtwell-test-'));
}

test('a new vault gets the standard folders and starter files, and never overwrites them', async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await Vault.open(dir, '2026-11-19');
  const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Never create, edit, move or delete anything in `Me\/`/);
  const v = await Vault.open(dir);
  const paths = (await v.list()).map((e) => e.path);
  for (const p of ['Me', 'Me/Welcome.md', 'Brain', 'Brain/Inbox', 'Brain/Sources', 'Brain/Summaries', 'Brain/Topics', 'Brain/Log.md', 'AGENTS.md']) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
  await writeFile(join(dir, 'AGENTS.md'), 'my own rules');
  await Vault.open(dir);
  assert.equal(await readFile(join(dir, 'AGENTS.md'), 'utf8'), 'my own rules');
});

test('paths cannot leave the vault, including through symlinks', async (t) => {
  const dir = await tempDir();
  const outside = await tempDir();
  t.after(() => Promise.all([rm(dir, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  const v = await Vault.open(dir);
  for (const bad of ['../x.md', 'Me/../../x.md', '..', 'a\0b']) {
    assert.throws(() => v.resolve(bad), VaultError, bad);
  }
  // A leading slash means the vault root, not the computer's.
  assert.equal(v.resolve('/Me/a.md'), join(dir, 'Me/a.md'));
  assert.equal(v.resolve('/etc/passwd'), join(dir, 'etc/passwd'));
  await symlink(outside, join(dir, 'Me', 'escape'));
  assert.throws(() => v.resolve('Me/escape/x.md'), /outside the vault/);
  await assert.rejects(v.write('Me/escape/x.md', 'nope'), /outside the vault/);
  assert.ok(!(await v.list()).some((e) => e.path.startsWith('Me/escape/')));
});

test('writes are atomic, and refuse to overwrite changes made outside the app', async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const v = await Vault.open(dir);
  const path = await v.createNote('Me', 'Idea: one/two');
  assert.equal(path, 'Me/Idea one two.md');
  assert.equal(await v.createNote('Me', 'Idea: one/two'), 'Me/Idea one two 2.md');

  const { mtime } = await v.write(path, 'first');
  const r = await v.read(path);
  assert.equal(r.content, 'first');
  // An agent edits the file meanwhile.
  await writeFile(join(dir, path), 'agent edit');
  await utimes(join(dir, path), new Date(), new Date(Date.now() + 5000));
  await assert.rejects(v.write(path, 'mine', { expectedMtime: mtime }), (e: VaultError) => e.code === 'conflict');
  assert.equal((await v.read(path)).content, 'agent edit');
  const fresh = await v.read(path);
  await v.write(path, 'mine', { expectedMtime: fresh.mtime });
  assert.equal((await v.read(path)).content, 'mine');
  assert.ok(!(await v.list()).some((e) => e.name.endsWith('.tmp')), 'no temporary files left behind');
});

test('moving: no overwrites, no moving areas, no folder into itself', async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const v = await Vault.open(dir);
  await v.createNote('Me', 'A');
  await v.createNote('Me', 'B');
  await assert.rejects(v.move('Me/A.md', 'Me/B.md'), (e: VaultError) => e.code === 'exists');
  await assert.rejects(v.move('Me', 'Other'), (e: VaultError) => e.code === 'protected');
  assert.throws(() => v.checkDeletable('Brain'), (e: VaultError) => e.code === 'protected');
  const f = await v.createFolder('Me', 'Projects');
  await assert.rejects(v.move(f, `${f}/Sub`), (e: VaultError) => e.code === 'invalid');
  assert.equal(await v.move('Me/A.md', `${f}/A.md`), 'Me/Projects/A.md');
});

test('attachments go beside the note; imports go to the inbox without replacing anything', async (t) => {
  const dir = await tempDir();
  const elsewhere = await tempDir();
  t.after(() => Promise.all([rm(dir, { recursive: true, force: true }), rm(elsewhere, { recursive: true, force: true })]));
  const v = await Vault.open(dir);
  const a = await v.saveAttachment('Me/Ideas/Plan.md', 'my pic.png', new Uint8Array([1, 2, 3]));
  assert.deepEqual(a, { path: 'Me/Ideas/attachments/my pic.png', link: 'attachments/my%20pic.png' });

  await writeFile(join(elsewhere, 'paper.pdf'), 'pdf');
  await mkdir(join(elsewhere, 'clips'));
  await writeFile(join(elsewhere, 'clips', 'one.txt'), 'x');
  const first = await v.importPaths([join(elsewhere, 'paper.pdf'), join(elsewhere, 'clips'), join(elsewhere, 'missing')]);
  assert.deepEqual(first, ['Brain/Inbox/paper.pdf', 'Brain/Inbox/clips']);
  assert.deepEqual(await v.importPaths([join(elsewhere, 'paper.pdf')]), ['Brain/Inbox/paper 2.pdf']);
  assert.ok(await v.exists('Brain/Inbox/clips/one.txt'));
});

function indexOf(notes: Record<string, string>): SearchIndex {
  const idx = new SearchIndex();
  for (const [path, md] of Object.entries(notes)) idx.setNote(path, md, 0);
  return idx;
}

test('search ranks titles and tags, filters by area, and gives snippets', () => {
  const idx = indexOf({
    'Brain/Summaries/Transformers.md': '---\ntags: [machine-learning]\nsummary: How attention works.\n---\n# Transformers\nSelf-attention replaces recurrence in sequence models.',
    'Brain/Summaries/Gardening.md': '# Gardening\nTomatoes need sun. Attention to watering helps.',
    'Me/Thoughts.md': 'I keep thinking about attention and focus.',
  });
  idx.setFile('Brain/Sources/attention-paper.pdf', 'pdf', 0);
  const hits = idx.search('attention');
  // The note about it and the file named after it come first, in either order.
  assert.deepEqual(hits.slice(0, 2).map((h) => h.path).sort(), ['Brain/Sources/attention-paper.pdf', 'Brain/Summaries/Transformers.md']);
  assert.deepEqual(
    idx.search('attention', { area: 'me' }).map((h) => h.path),
    ['Me/Thoughts.md'],
  );
  assert.match(idx.search('watering')[0]!.snippet, /watering/);
  assert.equal(idx.search('transf')[0]!.path, 'Brain/Summaries/Transformers.md', 'title prefix while typing');
  assert.deepEqual(idx.search('machine learning')[0]!.tags, ['machine-learning']);
  idx.removeUnder('Brain/Summaries');
  assert.ok(!idx.search('attention').some((h) => h.path.startsWith('Brain/Summaries')));
});

test('related notes for something you are writing come from the Brain', () => {
  const idx = indexOf({
    'Me/Idea.md': '---\ntags: [agents]\n---\nWhat if agents organized my reading list? Linking [[Agent Memory]] and retrieval.',
    'Brain/Topics/Agent Memory.md': '# Agent memory\nHow agents remember: retrieval, vector stores, summaries.',
    'Brain/Summaries/Reading list tools.md': '---\ntags: [agents]\n---\nTools that organize a reading list automatically.',
    'Brain/Summaries/Bread.md': 'Sourdough starter feeding schedule.',
  });
  const rel = idx.related({ path: 'Me/Idea.md' }, { area: 'brain' }).map((h) => h.path);
  assert.deepEqual(rel.slice(0, 2).sort(), ['Brain/Summaries/Reading list tools.md', 'Brain/Topics/Agent Memory.md']);
  assert.ok(!rel.includes('Brain/Summaries/Bread.md'));
  assert.ok(!rel.includes('Me/Idea.md'));
  assert.deepEqual(idx.related({ text: 'sourdough bread starter' }, { area: 'brain' })[0]!.path, 'Brain/Summaries/Bread.md');
  assert.deepEqual(idx.backlinks('Brain/Topics/Agent Memory.md').map((h) => h.path), ['Me/Idea.md']);
  assert.equal(idx.resolveLink('agent memory'), 'Brain/Topics/Agent Memory.md');
  assert.equal(idx.resolveLink('Nope'), null);
  assert.deepEqual(idx.tags('brain'), [{ tag: 'agents', count: 1 }]);
});

test('the service picks up files written by someone else', async (t) => {
  const dir = await tempDir();
  const svc = await VaultService.open(dir);
  t.after(async () => {
    await svc.close();
    await rm(dir, { recursive: true, force: true });
  });
  assert.ok(svc.index.get('Me/Welcome.md'), 'starter note indexed at open');
  const seen = new Promise<string[]>((resolve) => svc.onChange((e) => resolve(e.paths)));
  await writeFile(join(dir, 'Brain/Summaries/New.md'), '# New\nquantum gardening');
  const paths = await Promise.race([seen, new Promise<string[]>((_, rej) => setTimeout(() => rej(new Error('no change event')), 5000))]);
  assert.ok(paths.includes('Brain/Summaries/New.md'));
  assert.equal(svc.index.search('quantum')[0]?.path, 'Brain/Summaries/New.md');
});
