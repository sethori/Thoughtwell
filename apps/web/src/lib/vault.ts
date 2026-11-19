import { parseError, type Bridge } from '@notes/shared/bridge';
import { dirname, resolveRelative } from '@notes/shared';

export type { Entry, SearchHit, VaultInfo } from '@notes/shared/bridge';

declare global {
  interface Window {
    /** Set by the desktop app's preload script. Missing when the page is opened in a plain browser. */
    thoughtwell?: Bridge;
  }
}

export const hasBridge = typeof window !== 'undefined' && Boolean(window.thoughtwell);

/** The desktop app's calls. Only use after checking hasBridge (App does). */
export const tw = window.thoughtwell as Bridge;

/** URL for showing a vault file (image, PDF, video) in the page. */
export function vaultUrl(path: string, version?: number): string {
  return 'vault://f/' + path.split('/').map(encodeURIComponent).join('/') + (version ? `?v=${version}` : '');
}

/** Error codes from the desktop app: conflict, outside, not_found, exists, protected, invalid. */
export function errorCode(err: unknown): string {
  return parseError(err).code;
}

/** An error's message for people, without its code. */
export function errorText(err: unknown): string {
  return parseError(err).message;
}

// ---------------------------------------------------------------- the open note

/**
 * The note open in the editor. Blocks use it to resolve relative links
 * (images, sketches) to vault paths. Only one note is open at a time.
 */
let currentNote = '';
export function setCurrentNote(path: string) {
  currentNote = path;
}
export function currentNotePath(): string {
  return currentNote;
}

/** A link written in the open note, as a vault path. Web links and odd paths give null. */
export function resolveFromNote(link: string, notePath = currentNote): string | null {
  if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('#')) return null;
  return resolveRelative(dirname(notePath), link.split('#')[0]!.split('?')[0]!);
}

/** What an <img> should load for a src written in a note. */
export function displaySrc(src: string): string {
  if (!src || /^(https?|data|blob|vault):/i.test(src)) return src;
  const path = resolveFromNote(src);
  return path ? vaultUrl(path) : src;
}
