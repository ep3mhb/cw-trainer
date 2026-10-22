import { describe, expect, it } from 'vitest';
import {
  KOCH_ORDER, MORSE, PROSIGNS, characterFor, isSendable, kochSet, patternFor, tokenize,
} from '../src/core/morse';

describe('character tables', () => {
  it('covers all 26 letters and 10 digits', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      expect(patternFor(ch), ch).toBeDefined();
    }
  });

  it('uses only dots and dashes in every pattern', () => {
    for (const pattern of [...Object.values(MORSE), ...Object.values(PROSIGNS)]) {
      expect(pattern).toMatch(/^[.-]+$/);
    }
  });

  it('has no duplicate pattern among the plain characters', () => {
    const patterns = Object.values(MORSE);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it('knows the classic patterns', () => {
    expect(patternFor('S')).toBe('...');
    expect(patternFor('O')).toBe('---');
    expect(patternFor('K')).toBe('-.-');
    expect(patternFor('5')).toBe('.....');
    expect(patternFor('?')).toBe('..--..');
  });

  it('accepts lower case', () => {
    expect(patternFor('q')).toBe(patternFor('Q'));
  });

  it('includes the prosigns the RFP names', () => {
    for (const token of ['<AR>', '<BT>', '<SK>', '<KN>']) {
      expect(patternFor(token), token).toBeDefined();
    }
  });

  it('decodes a pattern back to a character, plain characters winning a collision', () => {
    expect(characterFor('.-.')).toBe('R');
    // <AR> and + share a pattern; the plain character wins.
    expect(characterFor('.-.-.')).toBe('+');
    // <SK> has no plain-character collision.
    expect(characterFor('...-.-')).toBe('<SK>');
  });

  it('returns undefined for an unknown pattern', () => {
    expect(characterFor('........')).toBeUndefined();
    expect(patternFor('#')).toBeUndefined();
    expect(isSendable('#')).toBe(false);
  });
});

describe('tokenizing', () => {
  it('splits a message one character per token', () => {
    expect(tokenize('CQ')).toEqual(['C', 'Q']);
  });

  it('keeps a prosign whole', () => {
    expect(tokenize('R <AR>')).toEqual(['R', ' ', '<AR>']);
  });

  it('treats an unknown angle-bracket token as plain characters', () => {
    // <XX> is not a prosign; the sendable characters inside survive.
    expect(tokenize('<XX>')).toEqual(['X', 'X']);
  });

  it('collapses runs of whitespace into one space', () => {
    expect(tokenize('A \t\n B')).toEqual(['A', ' ', 'B']);
  });

  it('upper-cases and drops unsendable characters', () => {
    expect(tokenize('a~b')).toEqual(['A', 'B']);
  });

  it('returns nothing for an empty string', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('Koch order', () => {
  it('starts K M R S U A, as the standard sequence does', () => {
    expect(KOCH_ORDER.slice(0, 6)).toEqual(['K', 'M', 'R', 'S', 'U', 'A']);
  });

  it('has 40 unique characters, all sendable', () => {
    expect(KOCH_ORDER).toHaveLength(40);
    expect(new Set(KOCH_ORDER).size).toBe(40);
    for (const ch of KOCH_ORDER) expect(isSendable(ch), ch).toBe(true);
  });

  it('takes the first n characters, clamped at both ends', () => {
    expect(kochSet(2)).toEqual(['K', 'M']);
    expect(kochSet(0)).toEqual([]);
    expect(kochSet(-5)).toEqual([]);
    expect(kochSet(500)).toHaveLength(40);
  });

  it('accepts a operator-supplied order', () => {
    expect(kochSet(3, ['E', 'T', 'A', 'N'])).toEqual(['E', 'T', 'A']);
  });
});
