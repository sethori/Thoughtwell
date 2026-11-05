/**
 * Converts a ProseMirror (TipTap) JSON document to Markdown, for export.
 * Import goes the other way in the browser (Markdown to HTML to the editor).
 * Blocks without a Markdown equivalent are exported as a short placeholder
 * so nothing disappears silently.
 */
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function escapeText(s: string): string {
  return s.replace(/([\\`*_[\]#|])/g, '\\$1');
}

function inline(nodes: PMNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n';
      if (n.type === 'image') return image(n);
      if (n.type !== 'text') return inline(n.content);
      let t = n.text ?? '';
      const marks = n.marks ?? [];
      const isCode = marks.some((m) => m.type === 'code');
      t = isCode ? '`' + t.replace(/`/g, '\\`') + '`' : escapeText(t);
      for (const m of marks) {
        if (m.type === 'bold') t = `**${t}**`;
        else if (m.type === 'italic') t = `*${t}*`;
        else if (m.type === 'strike') t = `~~${t}~~`;
        else if (m.type === 'link') t = `[${t}](${String(m.attrs?.href ?? '')})`;
      }
      return t;
    })
    .join('');
}

function image(n: PMNode): string {
  const alt = String(n.attrs?.alt ?? '');
  return `![${alt}](${String(n.attrs?.src ?? '')})`;
}

function indent(text: string, by: string): string {
  return text
    .split('\n')
    .map((l, i) => (i === 0 || l === '' ? l : by + l))
    .join('\n');
}

function block(n: PMNode): string {
  switch (n.type) {
    case 'paragraph':
      return inline(n.content);
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
      const code = (n.content ?? []).map((c) => c.text ?? '').join('');
      return '```' + lang + '\n' + code + '\n```';
    }
    case 'horizontalRule':
      return '---';
    case 'bulletList':
      return (n.content ?? []).map((li) => '- ' + indent(blocks(li.content), '  ')).join('\n');
    case 'orderedList': {
      const start = Number(n.attrs?.start ?? 1);
      return (n.content ?? [])
        .map((li, i) => {
          const marker = `${start + i}. `;
          return marker + indent(blocks(li.content), ' '.repeat(marker.length));
        })
        .join('\n');
    }
    case 'taskList':
      return (n.content ?? [])
        .map((li) => `- [${li.attrs?.checked ? 'x' : ' '}] ` + indent(blocks(li.content), '  '))
        .join('\n');
    case 'image':
      return image(n);
    case 'table':
      return table(n);
    default:
      return n.content ? blocks(n.content) : `<!-- ${n.type} block: open in the app to view -->`;
  }
}

function table(n: PMNode): string {
  const rows = (n.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      blocks(cell.content).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim(),
    ),
  );
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const [head, ...body] = rows.map(pad);
  const line = (r: string[]) => '| ' + r.join(' | ') + ' |';
  return [line(head!), line(Array(width).fill('---')), ...body.map(line)].join('\n');
}

function blocks(nodes: PMNode[] = []): string {
  return nodes.map(block).join('\n\n');
}

export function docToMarkdown(doc: PMNode, title?: string): string {
  const body = blocks(doc.content);
  const out = title ? `# ${title}\n\n${body}` : body;
  return out.trimEnd() + '\n';
}
