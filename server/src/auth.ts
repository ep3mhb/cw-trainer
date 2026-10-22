/**
 * Passwords and sessions (RFP §8).
 *
 * Passwords are hashed with scrypt from node:crypto rather than argon2. The
 * two are comparable for this purpose — both memory-hard, both fine for a
 * project's accounts — and scrypt needs no native module, which on the server
 * means no compiler, no build step, and nothing that breaks on the next
 * Node upgrade. The hash string carries its own parameters so they can be
 * raised later without invalidating existing accounts.
 *
 * Session tokens are 32 random bytes, base64url. The database stores only
 * their SHA-256, so a dump of the sessions table does not log anyone in.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const KEYLEN = 32;

export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { ...PARAMS, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${String(PARAMS.N)}$${String(PARAMS.r)}$${String(PARAMS.p)}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, salt, expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Basic shape check; the real test of an address is whether mail arrives. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
