import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorPoint, diagramToMermaid, normalizeDiagram, docToMarkdown, type Diagram } from '../src/index.js';

const d: Diagram = {
  v: 1,
  nodes: [
    { id: 'a', shape: 'pill', x: 0, y: 0, w: 140, h: 48, label: 'Request received' },
    { id: 'b', shape: 'diamond', x: 0, y: 100, w: 120, h: 84, label: 'Approved?' },
    { id: 'c', shape: 'rect', x: 0, y: 240, w: 140, h: 56, label: 'Say "done"' },
  ],
  edges: [
    { id: 'e1', from: 'a', to: 'b', label: '' },
    { id: 'e2', from: 'b', to: 'c', label: 'Yes' },
  ],
};

test('normalizes stored diagrams and drops broken parts', () => {
  const n = normalizeDiagram({ nodes: [{ id: 'x', shape: 'blob', x: 'no' }, { id: 'x' }, null], edges: [{ from: 'x', to: 'gone' }] });
  assert.equal(n.nodes.length, 1);
  assert.equal(n.nodes[0]!.shape, 'rect');
  assert.equal(n.nodes[0]!.x, 0);
  assert.equal(n.edges.length, 0);
  assert.deepEqual(normalizeDiagram('not json'), { v: 1, nodes: [], edges: [] });
  assert.equal(normalizeDiagram(JSON.stringify(d)).edges.length, 2);
});

test('arrows meet the outline of each shape', () => {
  const rect = d.nodes[2]!;
  assert.deepEqual(anchorPoint(rect, { x: 70, y: 1000 }), { x: 70, y: 296 });
  const diamond = d.nodes[1]!;
  const p = anchorPoint(diamond, { x: 1000, y: 142 });
  assert.equal(Math.round(p.x), 120);
});

test('exports a drawn flowchart as Mermaid', () => {
  const m = diagramToMermaid(d);
  assert.match(m, /^flowchart TD/);
  assert.match(m, /n1\(\["Request received"\]\)/);
  assert.match(m, /n2\{"Approved\?"\}/);
  assert.match(m, /n2 -- "Yes" --> n3/);
  assert.match(m, /#quot;done#quot;/);
  const md = docToMarkdown({ type: 'doc', content: [{ type: 'flowchart', attrs: { diagram: d, code: '' } }] });
  assert.match(md, /```mermaid\nflowchart TD/);
});
