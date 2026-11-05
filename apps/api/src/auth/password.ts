import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt from Node's standard library: no native add-ons to build.
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Returns `scrypt$N$r$p$salt$hash`, all base64 where binary. */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash to compare against when the user does not exist, so timing does not reveal it. */
export const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');
