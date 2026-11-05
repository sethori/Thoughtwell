import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDecisions, canonical, diffDocs, diffWords, type JsonNode } from '../src/index.js';

const p = (text: string): JsonNode => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const h = (text: string): JsonNode => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });
const img = (src: string): JsonNode => ({ type: 'image', attrs: { src } });
const doc = (...content: JsonNode[]): JsonNode => ({ type: 'doc', content });

test('word diff keeps unchanged words and rebuilds both texts', () => {
  const ops = diffWords('The quick brown fox', 'The slow brown fox jumps');
  assert.deepEqual(
    ops.filter((o) => o.op !== 'eq').map((o) => [o.op, o.text]),
    [
      ['del', 'quick'],
      ['ins', 'slow'],
      ['ins', ' jumps'],
    ],
  );
  assert.equal(ops.filter((o) => o.op !== 'ins').map((o) => o.text).join(''), 'The quick brown fox');
  assert.equal(ops.filter((o) => o.op !== 'del').map((o) => o.text).join(''), 'The slow brown fox jumps');
});

test('identical documents have no changes', () => {
  const d = doc(h('Title'), p('Body'));
  assert.deepEqual(diffDocs(d, JSON.parse(JSON.stringify(d))), []);
  // Key order does not matter.
  assert.equal(canonical({ a: 1, b: { c: 2, d: 3 } }), canonical({ b: { d: 3, c: 2 }, a: 1 }));
});

test('a first draft is all additions', () => {
  const changes = diffDocs(null, doc(h('New'), p('Text')));
  assert.deepEqual(
    changes.map((c) => [c.kind, c.kind === 'removed' ? c.insertAt : c.index]),
    [
      ['added', 0],
      ['added', 1],
    ],
  );
});

test('edits, additions and removals are found in document order', () => {
  const oldDoc = doc(h('Plan'), p('Ship in May.'), p('Owner: Sam'), img('a.png'));
  const newDoc = doc(h('Plan'), p('Ship in June.'), img('a.png'), p('Risks: none'));
  const changes = diffDocs(oldDoc, newDoc);
  assert.deepEqual(
    changes.map((c) => c.kind),
    ['modified', 'removed', 'added'],
  );
  const mod = changes[0]!;
  assert.ok(mod.kind === 'modified');
  assert.deepEqual(
    mod.words.filter((w) => w.op !== 'eq'),
    [
      { op: 'del', text: 'May.' },
      { op: 'ins', text: 'June.' },
    ],
  );
  const removed = changes[1]!;
  assert.ok(removed.kind === 'removed' && removed.insertAt === 2 && removed.summary === 'Paragraph: Owner: Sam');
});

test('rejecting changes restores the published content; accepting keeps the draft', () => {
  const oldDoc = doc(h('Plan'), p('Ship in May.'), p('Owner: Sam'));
  const newDoc = doc(h('Plan'), p('Ship in June.'), p('Risks: none'));
  const changes = diffDocs(oldDoc, newDoc);
  const all = new Set(changes.map((c) => c.key));
  assert.equal(canonical(applyDecisions(newDoc, changes, all)), canonical(oldDoc));
  assert.equal(canonical(applyDecisions(newDoc, changes, new Set())), canonical(newDoc));

  // Reject just the edit to the second paragraph.
  const mod = changes.find((c) => c.kind === 'modified')!;
  const mixed = applyDecisions(newDoc, changes, new Set([mod.key]));
  assert.equal(canonical(mixed.content![1]), canonical(p('Ship in May.')));
});

test('attribute-only changes count, with no word markup', () => {
  const changes = diffDocs(doc(img('a.png')), doc(img('b.png')));
  assert.equal(changes.length, 1);
  assert.ok(changes[0]!.kind === 'modified' && changes[0]!.words.length === 0);
});

test('change keys are stable for the same edit and differ for different edits', () => {
  const a = diffDocs(doc(p('one')), doc(p('two')));
  const b = diffDocs(doc(p('one')), doc(p('two')));
  const c = diffDocs(doc(p('one')), doc(p('three')));
  assert.equal(a[0]!.key, b[0]!.key);
  assert.notEqual(a[0]!.key, c[0]!.key);
});
