import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'notes_session';

/** A random token for the cookie; only its hash is stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
