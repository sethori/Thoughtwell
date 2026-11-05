import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docToMarkdown, type PMNode } from '../src/index.js';

const t = (text: string, marks?: PMNode['marks']): PMNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const li = (...content: PMNode[]): PMNode => ({ type: 'listItem', content });

test('exports headings, paragraphs and marks', () => {
  const doc: PMNode = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [t('Scope')] },
      p(t('Replace the '), t('core', [{ type: 'bold' }]), t(' switch, see '), t('docs', [{ type: 'link', attrs: { href: 'https://example.com' } }])),
      p(t('run'), t(' '), t('show vlan', [{ type: 'code' }])),
    ],
  };
  assert.equal(
    docToMarkdown(doc),
    '## Scope\n\nReplace the **core** switch, see [docs](https://example.com)\n\nrun `show vlan`\n',
  );
});

test('escapes characters that would change meaning', () => {
  assert.equal(docToMarkdown({ type: 'doc', content: [p(t('Use * and _ and #1'))] }), 'Use \\* and \\_ and \\#1\n');
});

test('exports nested, ordered and task lists', () => {
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
  assert.equal(
    docToMarkdown(doc),
    '- One\n\n  - Nested\n- Two\n\n3. Third\n4. Fourth\n\n- [x] Done\n- [ ] Todo\n',
  );
});

test('exports tables with a header row', () => {
  const cell = (s: string, type = 'tableCell'): PMNode => ({ type, content: [p(t(s))] });
  const doc: PMNode = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('Item', 'tableHeader'), cell('Qty', 'tableHeader')] },
          { type: 'tableRow', content: [cell('Core switch'), cell('2')] },
        ],
      },
    ],
  };
  assert.equal(docToMarkdown(doc), '| Item | Qty |\n| --- | --- |\n| Core switch | 2 |\n');
});

test('exports code blocks, images and unknown blocks', () => {
  const doc: PMNode = {
    type: 'doc',
    content: [
      { type: 'codeBlock', attrs: { language: 'bash' }, content: [t('show vlan brief')] },
      { type: 'image', attrs: { src: '/api/assets/1', alt: 'Rack' } },
      { type: 'sketch', attrs: {} },
    ],
  };
  assert.equal(
    docToMarkdown(doc, 'Runbook'),
    '# Runbook\n\n```bash\nshow vlan brief\n```\n\n![Rack](/api/assets/1)\n\n<!-- sketch block: open in the app to view -->\n',
  );
});
