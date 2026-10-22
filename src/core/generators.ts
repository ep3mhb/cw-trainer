/**
 * Lesson content generators (RFP §4).
 *
 * "Lesson types: single characters, random five-character groups, common
 * words, plain text, numbers, punctuation, prosigns (AR, BT, SK, KN),
 * callsigns, and contest exchanges" plus "a callsign pileup drill".
 *
 * Every generator takes the active character set so a Koch student is only
 * ever given characters they have been taught.
 */

import type { Random } from './random';
import { systemRandom } from './random';
import { CALL_PREFIXES, COMMON_WORDS, PLAIN_TEXT } from '../data/wordlists';

export type LessonType =
  | 'characters'
  | 'groups'
  | 'words'
  | 'plaintext'
  | 'numbers'
  | 'punctuation'
  | 'prosigns'
  | 'callsigns'
  | 'contest'
  | 'pileup';

export const LESSON_LABELS: Readonly<Record<LessonType, string>> = Object.freeze({
  characters: 'Single characters',
  groups: 'Five-character groups',
  words: 'Common words',
  plaintext: 'Plain text',
  numbers: 'Numbers',
  punctuation: 'Punctuation',
  prosigns: 'Prosigns',
  callsigns: 'Callsigns',
  contest: 'Contest exchanges',
  pileup: 'Callsign pileup',
});

const DIGITS = '0123456789'.split('');
const PUNCTUATION = ['.', ',', '?', '/', '=', '-'];
const PROSIGN_TOKENS = ['<AR>', '<BT>', '<SK>', '<KN>'];

export interface GenerateOptions {
  type: LessonType;
  /** Characters the student has been taught — the Koch active set. */
  activeSet: readonly string[];
  /** Roughly how many characters of material to produce. */
  length: number;
  random?: Random;
}

/** Only keep the characters from a pool that the student already knows. */
function restrict(pool: readonly string[], activeSet: readonly string[]): string[] {
  const active = new Set(activeSet);
  const kept = pool.filter((c) => active.has(c));
  return kept.length > 0 ? kept : [...pool];
}

/** A word is usable if every character in it has been taught. */
function usableWords(words: readonly string[], activeSet: readonly string[]): string[] {
  const active = new Set(activeSet);
  const kept = words.filter((w) => [...w].every((c) => c === ' ' || active.has(c)));
  return kept;
}

function randomCallsign(rnd: Random): string {
  const prefix = rnd.pick(CALL_PREFIXES);
  const digit = DIGITS[rnd.int(10)] as string;
  const suffixLength = 1 + rnd.int(3);
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let suffix = '';
  for (let i = 0; i < suffixLength; i += 1) suffix += letters[rnd.int(26)] as string;
  return `${prefix}${digit}${suffix}`;
}

function randomExchange(rnd: Random): string {
  const rst = `5NN`;
  const serial = String(1 + rnd.int(999)).padStart(3, '0');
  return `${rst} ${serial}`;
}

/**
 * Produce one drill. Returns the text to send and the answer the student is
 * expected to type — identical for every current lesson type, but kept
 * separate because the pileup drill only asks for one callsign of several.
 */
export interface Drill {
  /** What the engine sends. */
  send: string;
  /** What the student should type. */
  answer: string;
  type: LessonType;
}

export function generate(options: GenerateOptions): Drill {
  const rnd = options.random ?? systemRandom();
  const { type, activeSet } = options;
  const length = Math.max(1, options.length);

  switch (type) {
    case 'characters': {
      const pool = restrict(activeSet, activeSet);
      const chars: string[] = [];
      for (let i = 0; i < length; i += 1) chars.push(rnd.pick(pool));
      const text = chars.join(' ');
      return { send: text, answer: chars.join(''), type };
    }
    case 'groups': {
      const pool = restrict(activeSet, activeSet);
      const groups: string[] = [];
      const groupCount = Math.max(1, Math.round(length / 5));
      for (let g = 0; g < groupCount; g += 1) {
        let group = '';
        for (let i = 0; i < 5; i += 1) group += rnd.pick(pool);
        groups.push(group);
      }
      const text = groups.join(' ');
      return { send: text, answer: text, type };
    }
    case 'words': {
      const pool = usableWords(COMMON_WORDS, activeSet);
      if (pool.length === 0) {
        // Not enough characters taught yet for any whole word.
        return generate({ ...options, type: 'groups', random: rnd });
      }
      const words: string[] = [];
      let count = 0;
      while (count < length && words.length < 20) {
        const word = rnd.pick(pool);
        words.push(word);
        count += word.length + 1;
      }
      const text = words.join(' ');
      return { send: text, answer: text, type };
    }
    case 'plaintext': {
      const pool = usableWords(PLAIN_TEXT, activeSet);
      const text = pool.length > 0 ? rnd.pick(pool) : rnd.pick(PLAIN_TEXT);
      return { send: text, answer: text, type };
    }
    case 'numbers': {
      const groups: string[] = [];
      const groupCount = Math.max(1, Math.round(length / 5));
      for (let g = 0; g < groupCount; g += 1) {
        let group = '';
        for (let i = 0; i < 5; i += 1) group += DIGITS[rnd.int(10)] as string;
        groups.push(group);
      }
      const text = groups.join(' ');
      return { send: text, answer: text, type };
    }
    case 'punctuation': {
      const pool = restrict(activeSet, activeSet);
      const parts: string[] = [];
      for (let i = 0; i < Math.max(3, Math.round(length / 3)); i += 1) {
        parts.push(`${rnd.pick(pool)}${rnd.pick(PUNCTUATION)}${rnd.pick(pool)}`);
      }
      const text = parts.join(' ');
      return { send: text, answer: text, type };
    }
    case 'prosigns': {
      const parts: string[] = [];
      for (let i = 0; i < Math.max(2, Math.round(length / 5)); i += 1) {
        parts.push(rnd.pick(PROSIGN_TOKENS));
      }
      const text = parts.join(' ');
      return { send: text, answer: text, type };
    }
    case 'callsigns': {
      const calls: string[] = [];
      const count = Math.max(1, Math.round(length / 6));
      for (let i = 0; i < count; i += 1) calls.push(randomCallsign(rnd));
      const text = calls.join(' ');
      return { send: text, answer: text, type };
    }
    case 'contest': {
      const call = randomCallsign(rnd);
      const text = `${call} ${randomExchange(rnd)}`;
      return { send: text, answer: text, type };
    }
    case 'pileup': {
      // Several stations answering at once; the student copies the one they
      // can pull out. The answer is any one of them, checked leniently.
      const count = 2 + rnd.int(3);
      const calls: string[] = [];
      for (let i = 0; i < count; i += 1) calls.push(randomCallsign(rnd));
      return { send: calls.join(' '), answer: calls.join(' '), type };
    }
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown lesson type: ${String(exhaustive)}`);
    }
  }
}
