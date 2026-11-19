/**
 * Editor document (ProseMirror / TipTap JSON) to Markdown. Notes are stored as
 * Markdown files, so this is the save format, not only an export: it must read
 * naturally in any editor and parse back (parse.ts) to the same document.
 *
 * Rich blocks use conventions that other Markdown tools still show sensibly:
 *   flowchart  ```mermaid fence
 *   chart      ```chart fence holding JSON
 *   sketch     ![Sketch](attachments/name.excalidraw.svg); the scene sits beside it as name.excalidraw
 *   raw        anything we could not model (HTML, link definitions) is written back verbatim
 */
import { normalizeChart } from './chart.js';

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/** Image paths ending in this are sketches: an SVG picture with its Excalidraw scene beside it. */
export const SKETCH_SUFFIX = '.excalidraw.svg';

/**
 * Escapes text so it reads back as the same text, while leaving ordinary prose
 * (and [[wikilinks]]) alone. "<" is left as is: inline HTML reads back as text,
 * so <br> in an agent's table stays <br>.
 */
export function escapeText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const prev = s[i - 1] ?? '';
    const next = s[i + 1] ?? '';
    if (c === '\\' || c === '`' || c === '*') out += '\\' + c;
    else if (c === '_' && !(/[\p{L}\p{N}]/u.test(prev) && /[\p{L}\p{N}]/u.test(next))) out += '\\_';
    else if (c === '~' && (next === '~' || prev === '~')) out += '\\~';
    // "[text](url)", "[a][b]" and "[a]: x" would become links; a lone [x] or [[wikilink]] stays as typed.
    else if (c === ']' && (next === '(' || next === ':' || (next === '[' && s[i + 2] !== '['))) out += '\\]';
    else out += c;
  }
  return out;
}

/** A paragraph starting like a heading, quote, list or rule would turn into one. */
function escapeLineStart(s: string): string {
  return s.replace(/^(\s*)(#{1,6}(?=\s|$)|>|[-+](?=\s)|=+\s*$|-{3,}\s*$)/, '$1\\$2').replace(/^(\s*\d{1,9})([.)])(?=\s)/, '$1\\$2');
}

function hrefOf(n: PMNode): string | null {
  const link = n.type === 'text' ? n.marks?.find((m) => m.type === 'link') : undefined;
  return link ? String(link.attrs?.href ?? '') : null;
}

function inline(nodes: PMNode[] = []): string {
  let out = '';
  for (let i = 0; i < nodes.length; ) {
    const href = hrefOf(nodes[i]!);
    if (href === null) {
      out += piece(nodes[i]!);
      i++;
      continue;
    }
    // Neighbouring text with the same link is one link, whatever other marks it has.
    let j = i;
    let text = '';
    while (j < nodes.length && hrefOf(nodes[j]!) === href) {
      const n = nodes[j]!;
      text += piece({ ...n, marks: n.marks?.filter((m) => m.type !== 'link') });
      j++;
    }
    out += `[${text}](${linkTarget(href)})`;
    i = j;
  }
  return out;
}

function piece(n: PMNode): string {
  if (n.type === 'hardBreak') return '\\\n';
  if (n.type === 'image') return image(n);
  if (n.type !== 'text') return inline(n.content);
  const t = n.text ?? '';
  const marks = n.marks ?? [];
  if (marks.some((m) => m.type === 'code')) {
    const ticks = '`'.repeat(longestRun(t, '`') + 1);
    const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : '';
    return ticks + pad + t + pad + ticks;
  }
  // Keep surrounding spaces outside the markers, or **bold ** would not parse.
  const lead = t.match(/^\s*/)![0];
  const trail = t.slice(lead.length).match(/\s*$/)![0];
  let core = escapeText(t.slice(lead.length, t.length - trail.length));
  if (!core) return t;
  for (const m of marks) {
    if (m.type === 'bold') core = `**${core}**`;
    else if (m.type === 'italic') core = `*${core}*`;
    else if (m.type === 'strike') core = `~~${core}~~`;
  }
  return lead + core + trail;
}

function linkTarget(href: string): string {
  return /[\s()<>]/.test(href) ? `<${href.replace(/>/g, '%3E')}>` : href;
}

function longestRun(s: string, ch: string): number {
  let best = 0;
  let cur = 0;
  for (const c of s) {
    cur = c === ch ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

function image(n: PMNode): string {
  const alt = String(n.attrs?.alt ?? '').replace(/[[\]]/g, '');
  const title = n.attrs?.title ? ` "${String(n.attrs.title).replace(/"/g, '\\"')}"` : '';
  return `![${alt}](${linkTarget(String(n.attrs?.src ?? ''))}${title})`;
}

function indent(text: string, by: string): string {
  return text
    .split('\n')
    .map((l, i) => (i === 0 || l === '' ? l : by + l))
    .join('\n');
}

function fence(code: string, lang: string): string {
  const ticks = '`'.repeat(Math.max(3, longestRun(code, '`') + 1));
  return ticks + lang + '\n' + code.replace(/\n$/, '') + '\n' + ticks;
}

/** A list item's blocks: a nested list sits right under its line, other blocks get a blank line. */
function itemBody(content: PMNode[] = []): string {
  let out = '';
  content.forEach((child, i) => {
    const text = block(child);
    if (i > 0) out += /List$/.test(child.type) && content[i - 1]!.type === 'paragraph' ? '\n' : '\n\n';
    out += text;
  });
  return out;
}

function block(n: PMNode): string {
  switch (n.type) {
    case 'paragraph':
      return escapeLineStart(inline(n.content));
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1)));
      return '#'.repeat(level) + ' ' + inline(n.content);
    }
    case 'blockquote':
      return blocks(n.content)
        .split('\n')
        .map((l) => (l ? '> ' + l : '>'))
        .join('\n');
    case 'codeBlock': {
      const lang = String(n.attrs?.language ?? '');
      return fence((n.content ?? []).map((c) => c.text ?? '').join(''), lang);
    }
    case 'horizontalRule':
      return '---';
    case 'bulletList':
      return (n.content ?? []).map((li) => '- ' + indent(itemBody(li.content), '  ')).join('\n');
    case 'orderedList': {
      const start = Number(n.attrs?.start ?? 1);
      return (n.content ?? [])
        .map((li, i) => {
          const marker = `${start + i}. `;
          return marker + indent(itemBody(li.content), ' '.repeat(marker.length));
        })
        .join('\n');
    }
    case 'taskList':
      return (n.content ?? [])
        .map((li) => `- [${li.attrs?.checked ? 'x' : ' '}] ` + indent(itemBody(li.content), '  '))
        .join('\n');
    case 'image':
      return image(n);
    case 'table':
      return table(n);
    case 'flowchart':
      return fence(String(n.attrs?.code ?? '').trim(), 'mermaid');
    case 'chart':
      return chart(n);
    case 'sketch': {
      const src = String(n.attrs?.src ?? '');
      return src ? image({ type: 'image', attrs: { src, alt: n.attrs?.alt || 'Sketch' } }) : '';
    }
    case 'rawMarkdown':
      return String(n.attrs?.source ?? '').replace(/\n+$/, '');
    default:
      return n.content ? blocks(n.content) : `<!-- ${n.type} block: open in Thoughtwell to view -->`;
  }
}

/** A chart is a ```chart fence with its data as JSON, so agents can read and write it. */
function chart(n: PMNode): string {
  const c = normalizeChart(n.attrs);
  const body = { type: c.chartType, title: c.title, labels: c.labels, series: c.series };
  // One line per field and per series: short enough to read, easy for an agent to edit.
  const series = body.series.map((x) => '    ' + JSON.stringify(x)).join(',\n');
  const json = [
    `  "type": ${JSON.stringify(body.type)}`,
    `  "title": ${JSON.stringify(body.title)}`,
    `  "labels": ${JSON.stringify(body.labels)}`,
    `  "series": [${series ? `\n${series}\n  ` : ''}]`,
  ].join(',\n');
  return fence(`{\n${json}\n}`, 'chart');
}

function table(n: PMNode): string {
  const rows = (n.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((b) => inline(b.content))
        .join(' ')
        .replace(/\n+/g, ' ')
        .replace(/\|/g, '\\|')
        .trim(),
    ),
  );
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill('')];
  const [head, ...body] = rows.map(pad);
  const line = (r: string[]) => '| ' + r.join(' | ') + ' |';
  return [line(head!), line(Array<string>(width).fill('---')), ...body.map(line)].join('\n');
}

function blocks(nodes: PMNode[] = []): string {
  return nodes
    .map(block)
    .filter((b) => b !== '')
    .join('\n\n');
}

/** The document as Markdown. A title, when given, goes first as "# Title" (used for export). */
export function docToMarkdown(doc: PMNode, title?: string): string {
  const body = blocks(doc.content);
  const out = title ? `# ${title}\n\n${body}` : body;
  return out.trim() ? out.trimEnd() + '\n' : '';
}
