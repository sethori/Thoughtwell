import { marked } from 'marked';
import { docToMarkdown, type PMNode } from '@notes/shared';

/** Markdown to HTML, which the editor parses into its own document. Raw HTML in the file is dropped. */
export function markdownToHtml(md: string): string {
  const renderer = new marked.Renderer();
  renderer.html = () => '';
  return marked.parse(md, { async: false, gfm: true, renderer }) as string;
}

/** The first "# Heading" becomes the page title. */
export function titleFromMarkdown(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return (m?.[1] ?? fallback).trim().slice(0, 300);
}

export function downloadMarkdown(title: string, doc: PMNode) {
  const blob = new Blob([docToMarkdown(doc, title)], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (title || 'page').replace(/[^\w\- ]+/g, '').trim() + '.md';
  a.click();
  URL.revokeObjectURL(a.href);
}
