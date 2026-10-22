import { describe, expect, it } from 'vitest';
import { LESSON_LABELS, generate, type LessonType } from '../src/core/generators';
import { isSendable, kochSet, tokenize } from '../src/core/morse';
import { seeded } from '../src/core/random';

const ALL_TYPES = Object.keys(LESSON_LABELS) as LessonType[];

describe('lesson generators', () => {
  it.each(ALL_TYPES)('%s produces only sendable characters', (type) => {
    const drill = generate({ type, activeSet: kochSet(12), length: 25, random: seeded(42) });
    expect(drill.send.length).toBeGreaterThan(0);
    for (const token of tokenize(drill.send)) {
      if (token === ' ') continue;
      expect(isSendable(token), `${type}: ${token}`).toBe(true);
    }
  });

  it.each(ALL_TYPES)('%s is reproducible from a seed', (type) => {
    const options = { type, activeSet: kochSet(12), length: 25 };
    const a = generate({ ...options, random: seeded(7) });
    const b = generate({ ...options, random: seeded(7) });
    expect(a.send).toBe(b.send);
  });

  // The whole point of Koch: never send a character the student has not met.
  it.each(['characters', 'groups'] as LessonType[])('%s stays inside the active set', (type) => {
    const activeSet = kochSet(3);
    const drill = generate({ type, activeSet, length: 40, random: seeded(11) });
    for (const ch of drill.send.replace(/ /g, '')) {
      expect(activeSet, ch).toContain(ch);
    }
  });

  it('falls back to groups when no whole word fits the active set', () => {
    const drill = generate({ type: 'words', activeSet: ['K', 'M'], length: 20, random: seeded(3) });
    for (const ch of drill.send.replace(/ /g, '')) expect(['K', 'M']).toContain(ch);
  });

  it('builds five-character groups', () => {
    const drill = generate({ type: 'groups', activeSet: kochSet(10), length: 20, random: seeded(5) });
    for (const group of drill.send.split(' ')) expect(group).toHaveLength(5);
  });

  it('sends digits only for the numbers drill', () => {
    const drill = generate({ type: 'numbers', activeSet: kochSet(10), length: 15, random: seeded(9) });
    expect(drill.send.replace(/ /g, '')).toMatch(/^[0-9]+$/);
  });

  it('sends recognisable callsigns', () => {
    const drill = generate({ type: 'callsigns', activeSet: kochSet(40), length: 24, random: seeded(13) });
    for (const call of drill.send.split(' ')) expect(call).toMatch(/^[A-Z0-9]{3,7}$/);
  });

  it('puts several stations in a pileup', () => {
    const drill = generate({ type: 'pileup', activeSet: kochSet(40), length: 30, random: seeded(17) });
    expect(drill.send.split(' ').length).toBeGreaterThanOrEqual(2);
  });

  it('includes a signal report in a contest exchange', () => {
    const drill = generate({ type: 'contest', activeSet: kochSet(40), length: 12, random: seeded(19) });
    expect(drill.send).toContain('5NN');
  });

  it('uses only the four prosigns from the RFP', () => {
    const drill = generate({ type: 'prosigns', activeSet: kochSet(40), length: 20, random: seeded(23) });
    for (const token of drill.send.split(' ')) expect(['<AR>', '<BT>', '<SK>', '<KN>']).toContain(token);
  });

  it('never produces an empty drill even at length zero', () => {
    for (const type of ALL_TYPES) {
      expect(generate({ type, activeSet: kochSet(5), length: 0, random: seeded(1) }).send.length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown lesson type', () => {
    expect(() => generate({ type: 'nope' as LessonType, activeSet: kochSet(5), length: 10 })).toThrow();
  });
});

describe('seeded random', () => {
  it('produces the same stream for the same seed', () => {
    const a = seeded(99);
    const b = seeded(99);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('stays in range', () => {
    const rnd = seeded(4);
    for (let i = 0; i < 500; i += 1) {
      const v = rnd.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(rnd.int(7)).toBeLessThan(7);
    }
  });

  it('refuses to pick from an empty list', () => {
    expect(() => seeded(1).pick([])).toThrow(RangeError);
  });
});
