/**
 * The promotion exam (RFD A25).
 *
 * The rule the whole thing exists for is the per-character one, so most of
 * these tests are about a single character failing inside an otherwise
 * excellent result — the case the old session rule could not see.
 */

import { describe, expect, it } from 'vitest';
import { KOCH_ORDER } from '../src/core/morse';
import { seeded } from '../src/core/random';
import {
  DEFAULT_EXAM, buildExam, gradeExam, weightedSet,
} from '../src/core/koch';

const perfect = (shown: string[]): string[] => [...shown];

/** Answer everything right except `wrong` appearances of `character`. */
function missing(shown: string[], character: string, wrong: number): string[] {
  let left = wrong;
  return shown.map((c) => {
    if (c === character && left > 0) { left -= 1; return '?'; }
    return c;
  });
}

describe('building an exam', () => {
  it('gives every unlocked character exactly four appearances', () => {
    const exam = buildExam({ unlocked: 5 }, seeded(1));
    expect(exam).toHaveLength(20);
    const counts = new Map<string, number>();
    for (const c of exam) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(5);
    for (const [, n] of counts) expect(n).toBe(4);
  });

  it('grows with the course and never groups a character together', () => {
    expect(buildExam({ unlocked: 2 }, seeded(2))).toHaveLength(8);
    expect(buildExam({ unlocked: 11 }, seeded(2))).toHaveLength(44);
    expect(buildExam({ unlocked: 40 }, seeded(2))).toHaveLength(160);
    // Shuffled, not four of each in a row.
    const exam = buildExam({ unlocked: 10 }, seeded(3));
    const runs = exam.filter((c, i) => i > 0 && c === exam[i - 1]).length;
    expect(runs).toBeLessThan(exam.length / 4);
  });

  it('is reproducible from a seed, so an instructor can set the same exam twice', () => {
    expect(buildExam({ unlocked: 8 }, seeded(42))).toEqual(buildExam({ unlocked: 8 }, seeded(42)));
  });
});

describe('grading an exam', () => {
  it('passes a clean run', () => {
    const shown = buildExam({ unlocked: 6 }, seeded(4));
    const result = gradeExam(shown, perfect(shown));
    expect(result.pass).toBe(true);
    expect(result.accuracy).toBe(1);
    expect(result.failed).toEqual([]);
    expect(result.reason).toBe('passed');
  });

  it('fails one weak character hiding behind a high average', () => {
    // This is the whole point. At eleven characters, two misses on one of
    // them is 95.5% overall — a comfortable pass under the old session rule.
    const shown = buildExam({ unlocked: 11 }, seeded(5));
    const weak = shown[0] as string;
    const result = gradeExam(shown, missing(shown, weak, 2));
    expect(result.accuracy).toBeGreaterThan(0.9);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('character-below-bar');
    expect(result.failed).toEqual([weak]);
  });

  it('allows one miss on a character, but not two', () => {
    const shown = buildExam({ unlocked: 12 }, seeded(6));
    const c = shown[0] as string;
    expect(gradeExam(shown, missing(shown, c, 1)).pass).toBe(true);
    expect(gradeExam(shown, missing(shown, c, 2)).pass).toBe(false);
  });

  it('fails a run of nothing but three-out-of-fours on the overall bar', () => {
    const shown = buildExam({ unlocked: 5 }, seeded(7));
    let typed = [...shown];
    for (const c of new Set(shown)) typed = missing(typed, c, 1);
    const result = gradeExam(shown, typed);
    expect(result.failed).toEqual([]);
    expect(result.accuracy).toBeCloseTo(0.75, 5);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('below-accuracy');
  });

  it('names every character that failed, in the order they were taught', () => {
    const shown = buildExam({ unlocked: 8 }, seeded(8));
    // Teaching order, not the order they happened to be shuffled into: a
    // member reads the list against the course they are working through.
    const taught = KOCH_ORDER.slice(0, 8);
    const a = taught[5] as string;
    const b = taught[2] as string;
    const result = gradeExam(shown, missing(missing(shown, a, 2), b, 3));
    expect(result.failed).toEqual([b, a]);
  });

  it('reports per-character scores so the member can see where they stand', () => {
    const shown = buildExam({ unlocked: 3 }, seeded(9));
    const c = shown[0] as string;
    const result = gradeExam(shown, missing(shown, c, 1));
    const row = result.perCharacter.find((r) => r.character === c);
    expect(row).toEqual({ character: c, correct: 3, of: 4 });
    for (const r of result.perCharacter) expect(r.of).toBe(DEFAULT_EXAM.appearances);
  });

  it('refuses a submission that does not line up with what was sent', () => {
    const shown = buildExam({ unlocked: 4 }, seeded(10));
    expect(() => gradeExam(shown, shown.slice(1))).toThrow();
  });

  it('is case-insensitive and ignores surrounding space', () => {
    const shown = buildExam({ unlocked: 4 }, seeded(11));
    const typed = shown.map((c) => ` ${c.toLowerCase()} `);
    expect(gradeExam(shown, typed).pass).toBe(true);
  });
});

describe('what a failed exam does to later practice', () => {
  it('over-samples the characters that failed, without removing the others', () => {
    const set = ['K', 'M', 'R', 'S'];
    const weighted = weightedSet(set, ['R']);
    expect(new Set(weighted)).toEqual(new Set(set));
    expect(weighted.filter((c) => c === 'R')).toHaveLength(1 + DEFAULT_EXAM.extraWeight);
    expect(weighted.filter((c) => c === 'K')).toHaveLength(1);
  });

  it('leaves the set alone when nothing failed', () => {
    const set = ['K', 'M', 'R'];
    expect(weightedSet(set, [])).toEqual(set);
  });

  it('ignores a failed character that is no longer in the set', () => {
    expect(weightedSet(['K', 'M'], ['Z'])).toEqual(['K', 'M']);
  });
});
