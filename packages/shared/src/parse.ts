/**
 * Markdown to the editor's document (ProseMirror / TipTap JSON), the inverse
 * of docToMarkdown. Runs anywhere (no DOM), so round trips are unit-tested.
 * Anything without an editor equivalent (raw HTML, link definitions) becomes
 * a rawMarkdown block that is written back exactly as it was.
 */
import { Lexer, type Token, type Tokens } from 'marked';
import { normalizeChart } from './chart.js';
import { SKETCH_SUFFIX, type PMNode } from './markdown.js';

type Mark = NonNullable<PMNode['marks']>[number];

const text = (t: string, marks: Mark[]): PMNode => (marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const paragraph = (content: PMNode[]): PMNode => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });

/** Decodes the few entities marked leaves in inline text. */
function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function inlineTokens(tokens: Token[] = [], marks: Mark[] = []): PMNode[] {
  const out: PMNode[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case 'text': {
        const t = tok as Tokens.Text;
        if (t.tokens?.length) out.push(...inlineTokens(t.tokens, marks));
        else if (t.text) out.push(text(decode(t.text), marks));
        break;
      }
      case 'escape':
        out.push(text(decode((tok as Tokens.Escape).text), marks));
        break;
      case 'strong':
        out.push(...inlineTokens((tok as Tokens.Strong).tokens, [...marks, { type: 'bold' }]));
        break;
      case 'em':
        out.push(...inlineTokens((tok as Tokens.Em).tokens, [...marks, { type: 'italic' }]));
        break;
      case 'del':
        out.push(...inlineTokens((tok as Tokens.Del).tokens, [...marks, { type: 'strike' }]));
        break;
      case 'codespan':
        out.push(text(decode((tok as Tokens.Codespan).text), [...marks.filter((m) => m.type === 'link'), { type: 'code' }]));
        break;
      case 'link': {
        const l = tok as Tokens.Link;
        out.push(...inlineTokens(l.tokens, [...marks, { type: 'link', attrs: { href: l.href } }]));
        break;
      }
      case 'image': {
        const im = tok as Tokens.Image;
        out.push({ type: 'image', attrs: { src: im.href, alt: im.text || null, title: im.title || null } });
        break;
      }
      case 'br':
        out.push({ type: 'hardBreak' });
        break;
      case 'html':
        // Inline HTML stays as the text it was typed as.
        out.push(text((tok as Tokens.HTML).raw, marks));
        break;
      default:
        if ('raw' in tok && tok.raw) out.push(text(tok.raw, marks));
    }
  }
  return merge(out);
}

/** Joins neighbouring text nodes with the same marks, as the editor would. */
function merge(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (last && last.type === 'text' && n.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      last.text = (last.text ?? '') + (n.text ?? '');
    } else out.push({ ...n });
  }
  return out.filter((n) => n.type !== 'text' || n.text);
}

function raw(source: string): PMNode {
  return { type: 'rawMarkdown', attrs: { source: source.replace(/\n+$/, '') } };
}

function code(tok: Tokens.Code): PMNode {
  const lang = (tok.lang ?? '').trim().split(/\s+/)[0] ?? '';
  if (lang === 'mermaid') return { type: 'flowchart', attrs: { code: tok.text } };
  if (lang === 'chart') {
    try {
      const j = JSON.parse(tok.text) as Record<string, unknown>;
      const c = normalizeChart({ ...j, chartType: j.type ?? j.chartType });
      return { type: 'chart', attrs: { chartType: c.chartType, title: c.title, labels: c.labels, series: c.series } };
    } catch {
      /* not valid chart JSON: keep it as code so nothing is lost */
    }
  }
  const content = tok.text ? [{ type: 'text', text: tok.text }] : undefined;
  return { type: 'codeBlock', attrs: { language: lang || null }, ...(content ? { content } : {}) };
}

function listItemBlocks(item: Tokens.ListItem): PMNode[] {
  const content = blockTokens(item.tokens, true);
  return content.length && content[0]!.type === 'paragraph' ? content : [paragraph([]), ...content];
}

function list(tok: Tokens.List): PMNode {
  const allTasks = tok.items.length > 0 && tok.items.every((i) => i.task);
  if (allTasks) {
    return {
      type: 'taskList',
      content: tok.items.map((i) => ({ type: 'taskItem', attrs: { checked: Boolean(i.checked) }, content: listItemBlocks(i) })),
    };
  }
  // A list mixing tasks and plain items stays a plain list; tasks keep their "[ ]" as text.
  const items = tok.items.map((i) => {
    const content = listItemBlocks(i);
    if (i.task) {
      const first = content[0]!;
      first.content = merge([{ type: 'text', text: i.checked ? '[x] ' : '[ ] ' }, ...(first.content ?? [])]);
    }
    return { type: 'listItem', content };
  });
  if (tok.ordered) {
    const start = typeof tok.start === 'number' ? tok.start : 1;
    return { type: 'orderedList', attrs: { start }, content: items };
  }
  return { type: 'bulletList', content: items };
}

function table(tok: Tokens.Table): PMNode {
  const cell = (c: Tokens.TableCell, type: string): PMNode => ({ type, content: [paragraph(inlineTokens(c.tokens))] });
  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: tok.header.map((c) => cell(c, 'tableHeader')) },
      ...tok.rows.map((r) => ({ type: 'tableRow', content: r.map((c) => cell(c, 'tableCell')) })),
    ],
  };
}

function blockTokens(tokens: Token[] = [], inList = false): PMNode[] {
  const out: PMNode[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case 'space':
        break;
      case 'heading': {
        const h = tok as Tokens.Heading;
        out.push({ type: 'heading', attrs: { level: h.depth }, content: inlineTokens(h.tokens) });
        break;
      }
      case 'paragraph': {
        const p = tok as Tokens.Paragraph;
        const content = inlineTokens(p.tokens);
        const only = content.length === 1 ? content[0]! : null;
        if (only?.type === 'image' && String(only.attrs?.src ?? '').endsWith(SKETCH_SUFFIX)) {
          out.push({ type: 'sketch', attrs: { src: only.attrs!.src, alt: only.attrs!.alt ?? 'Sketch' } });
        } else out.push(paragraph(content));
        break;
      }
      case 'text': {
        // Tight list items hold text tokens rather than paragraphs.
        const t = tok as Tokens.Text;
        const content = t.tokens ? inlineTokens(t.tokens) : [{ type: 'text', text: decode(t.text) }];
        const last = out[out.length - 1];
        if (inList && last?.type === 'paragraph') last.content = merge([...(last.content ?? []), { type: 'hardBreak' }, ...content]);
        else out.push(paragraph(content));
        break;
      }
      case 'code':
        out.push(code(tok as Tokens.Code));
        break;
      case 'blockquote': {
        const content = blockTokens((tok as Tokens.Blockquote).tokens);
        out.push({ type: 'blockquote', content: content.length ? content : [paragraph([])] });
        break;
      }
      case 'hr':
        out.push({ type: 'horizontalRule' });
        break;
      case 'list':
        out.push(list(tok as Tokens.List));
        break;
      case 'table':
        out.push(table(tok as Tokens.Table));
        break;
      case 'html':
        out.push(raw(tok.raw));
        break;
      default:
        if ('raw' in tok && tok.raw?.trim()) out.push(raw(tok.raw));
    }
  }
  return out;
}

/** Parses a Markdown body (frontmatter already removed) into an editor document. */
export function markdownToDoc(md: string): PMNode {
  const tokens = new Lexer({ gfm: true }).lex(md.replace(/\r\n?/g, '\n'));
  const content = blockTokens(tokens);
  // Reference definitions ("[label]: url") are not tokens of their own; keep them at the end.
  const defs = Object.entries(tokens.links ?? {}).map(([label, l]) => `[${label}]: ${l.href}${l.title ? ` "${l.title}"` : ''}`);
  if (defs.length) content.push(raw(defs.join('\n')));
  return { type: 'doc', content: content.length ? content : [paragraph([])] };
}
