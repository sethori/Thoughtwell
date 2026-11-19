/**
 * YAML frontmatter: the `---` block at the top of a note. Agents use it for a
 * note's source, tags and summary. The app keeps the original text and writes
 * it back untouched, so fields it does not know about are never lost.
 */
import { parse as parseYaml } from 'yaml';

export interface Split {
  /** The YAML between the fences, or null when the note has none. */
  frontmatter: string | null;
  body: string;
}

const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(md: string): Split {
  const text = md.replace(/^﻿/, '');
  const m = FENCE.exec(text);
  if (!m) return { frontmatter: null, body: text };
  return { frontmatter: m[1] ?? '', body: text.slice(m[0].length).replace(/^\r?\n/, '') };
}

export function joinFrontmatter(frontmatter: string | null, body: string): string {
  if (frontmatter === null) return body;
  return `---\n${frontmatter.replace(/\n+$/, '')}\n---\n\n${body}`;
}

/** What the app reads from frontmatter. Everything else in it is kept but not interpreted. */
export interface NoteMeta {
  title?: string;
  tags: string[];
  /** Where an agent got this from: a vault path (Brain/Sources/x.pdf) or a URL. */
  source?: string;
  summary?: string;
  /** For example summary, topic, person, project, idea. */
  type?: string;
  created?: string;
  updated?: string;
  /** Who wrote it: "me" or an agent's name. */
  author?: string;
}

const str = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return String(v);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return undefined;
};

export function normalizeTag(t: string): string {
  return t.trim().replace(/^#/, '').toLowerCase();
}

export function parseMeta(frontmatter: string | null): NoteMeta {
  if (!frontmatter) return { tags: [] };
  let data: unknown;
  try {
    data = parseYaml(frontmatter);
  } catch {
    return { tags: [] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { tags: [] };
  const d = data as Record<string, unknown>;
  const rawTags = d.tags ?? d.tag;
  const tags = (Array.isArray(rawTags) ? rawTags.map(str) : typeof rawTags === 'string' ? rawTags.split(/[,\s]+/) : [])
    .filter((t): t is string => Boolean(t))
    .map(normalizeTag)
    .filter(Boolean);
  const source = Array.isArray(d.source) ? str(d.source[0]) : str(d.source);
  return {
    title: str(d.title),
    tags: [...new Set(tags)],
    source,
    summary: str(d.summary) ?? str(d.description),
    type: str(d.type),
    created: str(d.created),
    updated: str(d.updated),
    author: str(d.author),
  };
}

/** Inline #tags in a note's text (not inside code, not headings). */
export function inlineTags(body: string): string[] {
  const noCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const found = new Set<string>();
  for (const m of noCode.matchAll(/(?:^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu)) found.add(normalizeTag(m[1]!));
  return [...found];
}

/** [[Wikilink]] targets in a note, without any |alias or #heading part. */
export function wikilinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g)) out.add(m[1]!.trim());
  return [...out];
}
