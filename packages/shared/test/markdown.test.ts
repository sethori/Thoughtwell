import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  docToMarkdown,
  inlineTags,
  joinFrontmatter,
  markdownToDoc,
  parseMeta,
  resolveRelative,
  safeFileName,
  splitFrontmatter,
  wikilinks,
  type PMNode,
} from '../src/index.js';

const t = (text: string, marks?: PMNode['marks']): PMNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const li = (...content: PMNode[]): PMNode => ({ type: 'listItem', content });

/** Markdown → document → Markdown must be stable after the first save. */
function roundTrip(md: string): string {
  const once = docToMarkdown(markdownToDoc(md));
  assert.equal(docToMarkdown(markdownToDoc(once)), once, 'second round trip changed the file');
  return once;
}

test('writes headings, paragraphs and marks', () => {
  const doc: PMNode = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [t('Scope')] },
      p(t('Replace the '), t('core', [{ type: 'bold' }]), t(' switch, see '), t('docs', [{ type: 'link', attrs: { href: 'https://example.com' } }])),
      p(t('run'), t(' '), t('show vlan', [{ type: 'code' }])),
    ],
  };
  assert.equal(docToMarkdown(doc), '## Scope\n\nReplace the **core** switch, see [docs](https://example.com)\n\nrun `show vlan`\n');
});

test('a link over differently formatted text stays one link', () => {
  const href = { type: 'link', attrs: { href: 'https://x.dev' } };
  const doc: PMNode = { type: 'doc', content: [p(t('very ', [href]), t('bold', [href, { type: 'bold' }]), t(' link', [href]))] };
  assert.equal(docToMarkdown(doc), '[very **bold** link](https://x.dev)\n');
});

test('escapes only what would change meaning; prose and wikilinks stay readable', () => {
  const md = (s: string) => docToMarkdown({ type: 'doc', content: [p(t(s))] });
  assert.equal(md('Use * and _ and #1'), 'Use \\* and \\_ and #1\n');
  assert.equal(md('snake_case_name and [[My Note]] and [1]'), 'snake_case_name and [[My Note]] and [1]\n');
  assert.equal(md('# not a heading'), '\\# not a heading\n');
  assert.equal(md('1. not a list'), '1\\. not a list\n');
  assert.equal(md('[text](url) typed literally'), '[text\\](url) typed literally\n');
  for (const s of ['Use * and _ and #1', '# not a heading', '- dash', '[text](url)', 'a ~~b~~ c', 'a <div> typed', 'back\\slash']) {
    const doc = markdownToDoc(md(s));
    assert.equal(doc.content?.[0]?.content?.map((n) => n.text).join(''), s, `"${s}" did not survive`);
  }
});

test('lists: nested, ordered and tasks', () => {
  const doc: PMNode = {
    type: 'doc',
    content: [
      { type: 'bulletList', content: [li(p(t('One')), { type: 'bulletList', content: [li(p(t('Nested')))] }), li(p(t('Two')))] },
      { type: 'orderedList', attrs: { start: 3 }, content: [li(p(t('Third'))), li(p(t('Fourth')))] },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p(t('Done'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [p(t('Todo'))] },
        ],
      },
    ],
  };
  const md = docToMarkdown(doc);
  assert.equal(md, '- One\n  - Nested\n- Two\n\n3. Third\n4. Fourth\n\n- [x] Done\n- [ ] Todo\n');
  assert.deepEqual(markdownToDoc(md), doc);
});

test('tables keep formulas and escaped pipes', () => {
  const md = '| Item | Qty |\n| --- | --- |\n| a \\| b | 2 |\n| Total | =SUM(B2:B2) |\n';
  assert.equal(roundTrip(md), md);
  const table = markdownToDoc(md).content![0]!;
  assert.equal(table.type, 'table');
  assert.equal(table.content![0]!.content![0]!.type, 'tableHeader');
  assert.equal(table.content![2]!.content![1]!.content![0]!.content![0]!.text, '=SUM(B2:B2)');
});

test('rich blocks: mermaid, chart and sketch', () => {
  const md = [
    '```mermaid\nflowchart TD\n  A --> B\n```',
    '```chart\n{\n  "type": "line",\n  "title": "Sales",\n  "labels": ["Jan","Feb"],\n  "series": [\n    {"name":"A","values":[1,2]}\n  ]\n}\n```',
    '![Sketch](attachments/plan.excalidraw.svg)',
  ].join('\n\n');
  const doc = markdownToDoc(md);
  assert.deepEqual(
    doc.content!.map((n) => n.type),
    ['flowchart', 'chart', 'sketch'],
  );
  assert.equal(doc.content![0]!.attrs!.code, 'flowchart TD\n  A --> B');
  assert.deepEqual(doc.content![1]!.attrs, { chartType: 'line', title: 'Sales', labels: ['Jan', 'Feb'], series: [{ name: 'A', values: [1, 2] }] });
  assert.equal(doc.content![2]!.attrs!.src, 'attachments/plan.excalidraw.svg');
  const out = roundTrip(md);
  assert.ok(out.includes('"labels": ["Jan","Feb"]'));
  assert.ok(out.includes('{"name":"A","values":[1,2]}'));
});

test('invalid chart JSON stays a code block, so nothing is lost', () => {
  const doc = markdownToDoc('```chart\nnot json\n```');
  assert.equal(doc.content![0]!.type, 'codeBlock');
  assert.equal(doc.content![0]!.content![0]!.text, 'not json');
});

test('HTML and link definitions are kept verbatim', () => {
  const md = 'See [the docs][d].\n\n<details>\n<summary>More</summary>\nHidden\n</details>\n\n[d]: https://example.com "Docs"\n';
  const out = roundTrip(md);
  assert.ok(out.includes('<details>\n<summary>More</summary>\nHidden\n</details>'));
  assert.ok(out.includes('[the docs](https://example.com)'));
  assert.ok(out.includes('[d]: https://example.com "Docs"'));
});

test('mixed task lists and inline HTML survive', () => {
  assert.equal(roundTrip('- [ ] a\n- b\n'), '- [ ] a\n- b\n');
  assert.equal(roundTrip('| a | b |\n| --- | --- |\n| one<br>two | x |\n'), '| a | b |\n| --- | --- |\n| one<br>two | x |\n');
});

test('code fences survive backticks inside them', () => {
  const doc: PMNode = { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'md' }, content: [t('```js\nx\n```')] }] };
  const md = docToMarkdown(doc);
  assert.ok(md.startsWith('````md\n'));
  assert.deepEqual(markdownToDoc(md), doc);
});

test('a realistic agent note survives a round trip', () => {
  const md = `# Attention Is All You Need

Short summary with **bold**, *italic*, \`code\` and a [link](https://arxiv.org/abs/1706.03762).

## Key points

- Self-attention replaces recurrence
- Scales well; see [[Transformers]]
  - Multi-head attention
- [Original](../Sources/attention.pdf)

> A quote from the paper.

---

1. First
2. Second
`;
  const out = roundTrip(md);
  assert.equal(out, md);
});

test('frontmatter is split off and put back untouched', () => {
  const fm = 'title: Attention\ntags: [ml, Papers]\nsource: Brain/Sources/attention.pdf\nweird: { keep: me }';
  const md = `---\n${fm}\n---\n\n# Body\n`;
  const s = splitFrontmatter(md);
  assert.equal(s.frontmatter, fm);
  assert.equal(s.body, '# Body\n');
  assert.equal(joinFrontmatter(s.frontmatter, s.body), md);
  assert.deepEqual(splitFrontmatter('# No frontmatter\n'), { frontmatter: null, body: '# No frontmatter\n' });
  const meta = parseMeta(fm);
  assert.equal(meta.title, 'Attention');
  assert.deepEqual(meta.tags, ['ml', 'papers']);
  assert.equal(meta.source, 'Brain/Sources/attention.pdf');
  assert.deepEqual(parseMeta('tags: a, b c').tags, ['a', 'b', 'c']);
  assert.deepEqual(parseMeta(': : not yaml [').tags, []);
});

test('inline tags and wikilinks', () => {
  assert.deepEqual(inlineTags('Working on #AI and #second-brain\n```\n#notatag\n```\n# Heading'), ['ai', 'second-brain']);
  assert.deepEqual(wikilinks('See [[Transformers]], [[People/Ada|Ada]] and [[Note#Part]].'), ['Transformers', 'People/Ada', 'Note']);
});

test('paths: relative links and safe names', () => {
  assert.equal(resolveRelative('Brain/Summaries', '../Sources/a%20b.pdf'), 'Brain/Sources/a b.pdf');
  assert.equal(resolveRelative('Me', 'attachments/x.png'), 'Me/attachments/x.png');
  assert.equal(resolveRelative('Me', '../../etc/passwd'), null);
  assert.equal(safeFileName('  a/b:c*?  '), 'a b c');
  assert.equal(safeFileName('...'), 'Untitled');
});
