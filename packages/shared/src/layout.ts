/**
 * The vault's layout. A vault is an ordinary folder: Me/ is yours, Brain/ is
 * where AI agents work. Paths inside the vault always use forward slashes.
 */
export const ME = 'Me';
export const BRAIN = 'Brain';
export type Area = 'me' | 'brain';

export const AREA_DIR: Record<Area, string> = { me: ME, brain: BRAIN };

/** Folders created in Brain/ for agents. */
export const BRAIN_DIRS = {
  /** Drop anything here: documents, videos, links. Agents pick it up. */
  inbox: `${BRAIN}/Inbox`,
  /** Originals, moved here once an agent has processed them. */
  sources: `${BRAIN}/Sources`,
  /** One note per source: what it says and why it matters. */
  summaries: `${BRAIN}/Summaries`,
  /** Hub notes that pull ideas together across sources. */
  topics: `${BRAIN}/Topics`,
} as const;

/** What agents did and when, newest at the bottom. */
export const BRAIN_LOG = `${BRAIN}/Log.md`;
export const AGENTS_FILE = 'AGENTS.md';
/** Attachments for a note live in this folder beside it. */
export const ATTACHMENTS_DIR = 'attachments';

export function areaOf(path: string): Area | null {
  const top = path.split('/')[0];
  return top === ME ? 'me' : top === BRAIN ? 'brain' : null;
}

export function isNotePath(path: string): boolean {
  return /\.md$/i.test(path);
}

/** File name without folders or the .md extension. */
export function noteName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

/** Resolves a link written in a note (relative to the note's folder) to a vault path, or null if it leaves the vault. */
export function resolveRelative(fromDir: string, link: string): string | null {
  let target = link;
  try {
    target = decodeURI(link);
  } catch {
    /* keep it as written */
  }
  const parts = (target.startsWith('/') ? [] : fromDir.split('/').filter(Boolean)).concat(target.split('/'));
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(p);
  }
  return out.join('/');
}

/** A file name that is safe on Linux, macOS and Windows. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  return cleaned || 'Untitled';
}

export type FileKind = 'note' | 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'sketch' | 'other';

const EXT: Record<string, FileKind> = {
  md: 'note',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image', bmp: 'image',
  pdf: 'pdf',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', mkv: 'video', ogv: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio', aac: 'audio', opus: 'audio',
  txt: 'text', csv: 'text', tsv: 'text', json: 'text', yaml: 'text', yml: 'text', xml: 'text', html: 'text', htm: 'text',
  log: 'text', srt: 'text', vtt: 'text', js: 'text', ts: 'text', py: 'text', sh: 'text', toml: 'text', ini: 'text',
  excalidraw: 'sketch',
};

export function fileKind(path: string): FileKind {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  return EXT[ext] ?? 'other';
}
