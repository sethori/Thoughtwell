/**
 * What changed between two versions of a page, for review.
 *
 * Pages are compared block by block (paragraphs, headings, lists, tables,
 * images, diagrams). Each changed block is one change that a reviewer accepts
 * or rejects. Inside a changed block, words are compared too, so the markup
 * shows exactly which words were added and removed.
 *
 * Rejecting a change puts the old block back (or removes an added one), which
 * works the same way for every kind of block.
 */

import { diagramText, normalizeDiagram } from './flow.js';

export interface JsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export type WordOp = { op: 'eq' | 'ins' | 'del'; text: string };

export type DocChange =
  | {
      kind: 'modified';
      key: string;
      /** Index of the block in the new document. */
      index: number;
      oldIndex: number;
      oldBlock: JsonNode;
      newBlock: JsonNode;
      /** Word-level diff of the block's text; empty when only formatting or attributes changed. */
      words: WordOp[];
      summary: string;
    }
  | { kind: 'added'; key: string; index: number; newBlock: JsonNode; summary: string }
  | {
      kind: 'removed';
      key: string;
      oldIndex: number;
      /** Where the block would go back: before this index in the new document. */
      insertAt: number;
      oldBlock: JsonNode;
      summary: string;
    };

const EMPTY: JsonNode = { type: 'doc', content: [] };

/** All text in a node, in document order. Images and other leaves add nothing. */
export function nodeText(node: JsonNode): string {
  if (node.text !== undefined) return node.text;
  return (node.content ?? []).map(nodeText).join('');
}

/** JSON with keys sorted, so equal blocks compare equal however they were built. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined && obj[k] !== null)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Short, stable hash (FNV-1a, 32 bit) used to key decisions on a change. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const BLOCK_LABEL: Record<string, string> = {
  paragraph: 'Paragraph',
  heading: 'Heading',
  bulletList: 'List',
  orderedList: 'Numbered list',
  taskList: 'Task list',
  table: 'Table',
  image: 'Image',
  codeBlock: 'Code',
  blockquote: 'Quote',
  horizontalRule: 'Divider',
  chart: 'Graph',
  sketch: 'Sketch diagram',
  flowchart: 'Flowchart',
};

export function blockLabel(node: JsonNode): string {
  return BLOCK_LABEL[node.type] ?? node.type;
}

function summarize(node: JsonNode): string {
  const raw = node.type === 'flowchart' ? diagramText(normalizeDiagram(node.attrs?.diagram)) : nodeText(node);
  const text = raw.replace(/\s+/g, ' ').trim();
  const label = blockLabel(node);
  if (!text) return label;
  return `${label}: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`;
}

/** Longest common subsequence of two lists, as index pairs. */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length;
  const m = b.length;
  // Lengths table, one row per element of a. Fine for page-sized inputs.
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = eq(a[i]!, b[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i]!, b[j]!)) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

const MAX_WORD_TOKENS = 3000;

/** Word-level diff. Whitespace is kept as its own tokens so the text rebuilds exactly. */
export function diffWords(oldText: string, newText: string): WordOp[] {
  if (oldText === newText) return oldText ? [{ op: 'eq', text: oldText }] : [];
  const tok = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];
  const a = tok(oldText);
  const b = tok(newText);
  if (a.length > MAX_WORD_TOKENS || b.length > MAX_WORD_TOKENS) {
    return [
      ...(oldText ? [{ op: 'del' as const, text: oldText }] : []),
      ...(newText ? [{ op: 'ins' as const, text: newText }] : []),
    ];
  }
  const pairs = lcs(a, b, (x, y) => x === y);
  const out: WordOp[] = [];
  const push = (op: WordOp['op'], text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    push('del', a.slice(i, pi).join(''));
    push('ins', b.slice(j, pj).join(''));
    if (pi < a.length) push('eq', a[pi]!);
    i = pi + 1;
    j = pj + 1;
  }
  return out;
}

/** Changes that turn `oldDoc` (the published version) into `newDoc` (the draft). */
export function diffDocs(oldDoc: JsonNode | null | undefined, newDoc: JsonNode | null | undefined): DocChange[] {
  const a = (oldDoc ?? EMPTY).content ?? [];
  const b = (newDoc ?? EMPTY).content ?? [];
  const sa = a.map(canonical);
  const sb = b.map(canonical);
  const anchors = lcs(
    sa.map((_, i) => i),
    sb.map((_, j) => j),
    (i, j) => sa[i] === sb[j],
  );

  const changes: DocChange[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj] of [...anchors, [a.length, b.length] as [number, number]]) {
    // The gap before this anchor: old blocks i..ai-1 became new blocks j..bj-1.
    const olds = a.slice(i, ai).map((block, k) => ({ block, index: i + k }));
    const news = b.slice(j, bj).map((block, k) => ({ block, index: j + k }));
    while (olds.length || news.length) {
      const o = olds[0];
      const n = news[0];
      if (o && n && o.block.type === n.block.type) {
        olds.shift();
        news.shift();
        const oldText = nodeText(o.block);
        const newText = nodeText(n.block);
        changes.push({
          kind: 'modified',
          key: hashString(`m${sa[o.index]}>${sb[n.index]}`),
          index: n.index,
          oldIndex: o.index,
          oldBlock: o.block,
          newBlock: n.block,
          words: oldText === newText ? [] : diffWords(oldText, newText),
          summary: summarize(n.block),
        });
      } else if (o && (!n || olds.length >= news.length)) {
        olds.shift();
        changes.push({
          kind: 'removed',
          key: hashString(`r${sa[o.index]}@${n?.index ?? bj}`),
          oldIndex: o.index,
          insertAt: n?.index ?? bj,
          oldBlock: o.block,
          summary: summarize(o.block),
        });
      } else if (n) {
        news.shift();
        changes.push({ kind: 'added', key: hashString(`a${sb[n.index]}@${n.index}`), index: n.index, newBlock: n.block, summary: summarize(n.block) });
      }
    }
    i = ai + 1;
    j = bj + 1;
  }
  const at = (c: DocChange) => (c.kind === 'removed' ? c.insertAt - 0.5 : c.index);
  return changes.sort((x, y) => at(x) - at(y));
}

/**
 * Applies reviewer decisions to the draft: rejected changes are undone, the
 * rest are kept. Returns the document to publish.
 */
export function applyDecisions(newDoc: JsonNode, changes: DocChange[], rejected: Set<string>): JsonNode {
  const blocks: (JsonNode | null)[] = [...(newDoc.content ?? [])];
  const inserts = new Map<number, JsonNode[]>();
  for (const c of changes) {
    if (!rejected.has(c.key)) continue;
    if (c.kind === 'modified') blocks[c.index] = c.oldBlock;
    else if (c.kind === 'added') blocks[c.index] = null;
    else inserts.set(c.insertAt, [...(inserts.get(c.insertAt) ?? []), c.oldBlock]);
  }
  const out: JsonNode[] = [];
  for (let k = 0; k <= blocks.length; k++) {
    out.push(...(inserts.get(k) ?? []));
    const b = blocks[k];
    if (b) out.push(b);
  }
  return { ...newDoc, content: out };
}
