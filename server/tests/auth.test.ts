import { describe, expect, it } from 'vitest';
import { hashPassword, looksLikeEmail, newToken, tokenHash, verifyPassword } from '../src/auth';

describe('passwords', () => {
  it('round-trip, and never store the password itself', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false);
  });

  it('salt every hash, so two members with the same password differ in the table', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('refuse a malformed stored hash rather than throwing', async () => {
    expect(await verifyPassword('x', 'nonsense')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});

describe('tokens', () => {
  it('are random, url-safe, and stored only as a digest', () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash(a)).toBe(tokenHash(a));
  });
});

describe('email shape', () => {
  it('accepts the ordinary and refuses the obviously wrong', () => {
    expect(looksLikeEmail('someone@example.com')).toBe(true);
    expect(looksLikeEmail('nope')).toBe(false);
    expect(looksLikeEmail('a@b')).toBe(false);
    expect(looksLikeEmail('two words@example.com')).toBe(false);
  });
});
