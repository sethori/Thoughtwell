import { areaOf, inlineTags, noteName, parseMeta, splitFrontmatter, wikilinks, type Area, type FileKind, type NoteMeta, type SearchHit } from '@notes/shared';

export type { SearchHit };

/**
 * An in-memory search index over the vault. Small and dependency-free: BM25
 * ranking over words, with titles and tags weighted up. Rebuilt at start and
 * kept current from file-watcher events.
 */

export interface IndexedDoc {
  path: string;
  area: Area | null;
  kind: FileKind;
  title: string;
  meta: NoteMeta;
  /** Plain text, for snippets. Empty for files that are not notes. */
  text: string;
  links: string[];
  terms: Map<string, number>;
  length: number;
  mtime: number;
}

const STOP = new Set(
  `a an and are as at be but by can do for from has have how i if in into is it its just me my no not of on or our so
  than that the their them then there these they this to too up us was we were what when where which who why will with you
  your about after all also any been before being both did does each few had he her here him his more most much must
  other out over same she should some such very would one two new like get got make made use used using well way
  md http https www com`.split(/\s+/),
);

export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const m of s.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    let w = m[0];
    if (w.length < 2 || w.length > 40 || STOP.has(w)) continue;
    // A light plural fold, so "agents" finds "agent".
    if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}

/** Markdown to rough plain text: enough for snippets and word counts. */
export function plainText(md: string): string {
  return md
    .replace(/```[a-z]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/^[ \t]*(#{1,6}|>|[-*+]|\d+\.)[ \t]+(\[[ xX]\][ \t]+)?/gm, '')
    .replace(/[*_~`|]+/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const K1 = 1.2;
const B = 0.75;

export class SearchIndex {
  private docs = new Map<string, IndexedDoc>();
  private df = new Map<string, number>();
  private totalLength = 0;

  get size(): number {
    return this.docs.size;
  }

  get(path: string): IndexedDoc | undefined {
    return this.docs.get(path);
  }

  all(): IndexedDoc[] {
    return [...this.docs.values()];
  }

  /** Adds or replaces a note from its Markdown. */
  setNote(path: string, markdown: string, mtime: number): void {
    const { frontmatter, body } = splitFrontmatter(markdown);
    const meta = parseMeta(frontmatter);
    meta.tags = [...new Set([...meta.tags, ...inlineTags(body)])];
    const title = meta.title ?? noteName(path);
    const text = plainText(body);
    const counts = new Map<string, number>();
    const add = (words: string[], weight: number) => {
      for (const w of words) counts.set(w, (counts.get(w) ?? 0) + weight);
    };
    add(tokenize(title), 3);
    add(meta.tags.flatMap((t) => tokenize(t)), 3);
    add(tokenize(meta.summary ?? ''), 2);
    add(tokenize(text), 1);
    this.put({ path, area: areaOf(path), kind: 'note', title, meta, text, links: wikilinks(body), terms: counts, length: sum(counts), mtime });
  }

  /** Adds a file that is not a note (PDF, video…), searchable by its name. */
  setFile(path: string, kind: FileKind, mtime: number): void {
    const name = path.split('/').pop() ?? path;
    const counts = new Map<string, number>();
    for (const w of tokenize(name.replace(/\.[^.]+$/, ''))) counts.set(w, (counts.get(w) ?? 0) + 3);
    this.put({ path, area: areaOf(path), kind, title: name, meta: { tags: [] }, text: '', links: [], terms: counts, length: sum(counts), mtime });
  }

  remove(path: string): void {
    const old = this.docs.get(path);
    if (!old) return;
    this.docs.delete(path);
    this.totalLength -= old.length;
    for (const t of old.terms.keys()) {
      const n = (this.df.get(t) ?? 1) - 1;
      if (n <= 0) this.df.delete(t);
      else this.df.set(t, n);
    }
  }

  /** Removes everything at or under a path (a deleted or moved folder). */
  removeUnder(path: string): void {
    for (const p of [...this.docs.keys()]) if (p === path || p.startsWith(path + '/')) this.remove(p);
  }

  private put(doc: IndexedDoc): void {
    this.remove(doc.path);
    this.docs.set(doc.path, doc);
    this.totalLength += doc.length;
    for (const t of doc.terms.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
  }

  private idf(term: string): number {
    const n = this.docs.size;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  private score(doc: IndexedDoc, terms: Map<string, number>): number {
    const avg = this.totalLength / Math.max(1, this.docs.size) || 1;
    let s = 0;
    for (const [term, weight] of terms) {
      const tf = doc.terms.get(term);
      if (!tf) continue;
      s += weight * this.idf(term) * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / avg)));
    }
    return s;
  }

  private hit(doc: IndexedDoc, score: number, words: string[]): SearchHit {
    return { path: doc.path, area: doc.area, kind: doc.kind, title: doc.title, summary: doc.meta.summary, tags: doc.meta.tags, snippet: snippet(doc.text, words), score };
  }

  search(query: string, opts: { area?: Area; limit?: number } = {}): SearchHit[] {
    const words = tokenize(query);
    const q = query.trim().toLowerCase();
    if (!words.length && !q) return [];
    const terms = new Map(words.map((w) => [w, 1]));
    const hits: SearchHit[] = [];
    for (const doc of this.docs.values()) {
      if (opts.area && doc.area !== opts.area) continue;
      let s = this.score(doc, terms);
      // Prefix matches on titles, so "agen" finds "Agents" while typing.
      const title = doc.title.toLowerCase();
      if (q && title.includes(q)) s += title.startsWith(q) ? 2 : 1;
      // A file known only by its name ranks below notes that discuss the same thing.
      if (doc.kind !== 'note') s *= 0.5;
      if (s > 0) hits.push(this.hit(doc, s, words));
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 50);
  }

  /** The words that best describe a note: its own most distinctive terms. */
  keyTerms(path: string, count = 16): string[] {
    const doc = this.docs.get(path);
    if (!doc) return [];
    return [...doc.terms.entries()]
      .map(([t, tf]) => [t, tf * this.idf(t)] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([t]) => t);
  }

  /**
   * Notes in an area that relate to the given note (or free text): shared
   * distinctive words, shared tags, and wikilinks in either direction.
   */
  related(input: { path?: string; text?: string }, opts: { area?: Area; limit?: number } = {}): SearchHit[] {
    const self = input.path ? this.docs.get(input.path) : undefined;
    const terms = new Map<string, number>();
    if (self) for (const t of this.keyTerms(self.path)) terms.set(t, 1);
    if (input.text) {
      const counts = new Map<string, number>();
      for (const w of tokenize(input.text)) counts.set(w, (counts.get(w) ?? 0) + 1);
      [...counts.entries()]
        .sort((a, b) => b[1] * this.idf(b[0]) - a[1] * this.idf(a[0]))
        .slice(0, 16)
        .forEach(([t]) => terms.set(t, 1));
    }
    const tags = new Set(self?.meta.tags ?? []);
    const name = self ? noteName(self.path).toLowerCase() : '';
    const linksOut = new Set((self?.links ?? []).map((l) => l.toLowerCase()));
    const hits: SearchHit[] = [];
    for (const doc of this.docs.values()) {
      if (doc.path === input.path) continue;
      if (opts.area && doc.area !== opts.area) continue;
      let s = this.score(doc, terms);
      s += doc.meta.tags.filter((t) => tags.has(t)).length * 4;
      if (linksOut.has(noteName(doc.path).toLowerCase()) || linksOut.has(doc.title.toLowerCase())) s += 8;
      if (name && doc.links.some((l) => l.toLowerCase() === name)) s += 8;
      if (s > 0.5) hits.push(this.hit(doc, s, [...terms.keys()]));
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 12);
  }

  /** Notes that link to this one with [[its name]]. */
  backlinks(path: string): SearchHit[] {
    const name = noteName(path).toLowerCase();
    const title = this.docs.get(path)?.title.toLowerCase();
    return this.all()
      .filter((d) => d.path !== path && d.links.some((l) => l.toLowerCase() === name || l.toLowerCase() === title))
      .map((d) => this.hit(d, 1, []));
  }

  /** The note a [[wikilink]] points to: by file name, then title. Prefers the same area. */
  resolveLink(target: string, fromPath?: string): string | null {
    const t = target.trim().replace(/\.md$/i, '').toLowerCase();
    const withPath = t.includes('/');
    const area = fromPath ? areaOf(fromPath) : null;
    const notes = this.all().filter((d) => d.kind === 'note');
    const matches = notes.filter((d) =>
      withPath ? d.path.toLowerCase().replace(/\.md$/, '').endsWith(t) : noteName(d.path).toLowerCase() === t,
    );
    const pool = matches.length ? matches : notes.filter((d) => d.title.toLowerCase() === t);
    if (!pool.length) return null;
    return (pool.find((d) => d.area === area) ?? pool.sort((a, b) => a.path.length - b.path.length)[0]!).path;
  }

  /** Every tag in use, with how many notes carry it. */
  tags(area?: Area): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const d of this.docs.values()) {
      if (area && d.area !== area) continue;
      for (const t of d.meta.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }
}

function sum(m: Map<string, number>): number {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
}

/** About 160 characters around the first matching word. */
export function snippet(text: string, words: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const lower = flat.toLowerCase();
  let at = -1;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return flat.slice(0, 160) + (flat.length > 160 ? '…' : '');
  const start = Math.max(0, at - 50);
  const end = Math.min(flat.length, start + 160);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}
