import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRACTICE,
  lessonCount,
  lessonOf,
  lessonSet,
  parseCustomSet,
  practiceSet,
} from '../src/core/koch';
import { KOCH_ORDER } from '../src/core/morse';

describe('lessons', () => {
  it('numbers lesson 1 as the starting pair', () => {
    expect(lessonSet(1)).toEqual(['K', 'M']);
    expect(lessonOf({ unlocked: 2 })).toBe(1);
  });

  it('adds one character per lesson, to the end of the order', () => {
    expect(lessonSet(2)).toEqual(['K', 'M', 'R']);
    expect(lessonCount()).toBe(KOCH_ORDER.length - 1);
    expect(lessonSet(lessonCount())).toHaveLength(KOCH_ORDER.length);
  });

  it('clamps a lesson number outside the course', () => {
    expect(lessonSet(0)).toEqual(lessonSet(1));
    expect(lessonSet(9999)).toEqual(lessonSet(lessonCount()));
  });
});

describe('parseCustomSet', () => {
  it('reads characters however they are separated', () => {
    expect(parseCustomSet('K M R').characters).toEqual(['K', 'M', 'R']);
    expect(parseCustomSet('kmr').characters).toEqual(['K', 'M', 'R']);
    expect(parseCustomSet('k,m,r').characters).toEqual(['K', 'M', 'R']);
  });

  it('keeps prosigns whole', () => {
    const { characters } = parseCustomSet('<AR> <SK> K');
    expect(characters).toEqual(['<AR>', '<SK>', 'K']);
  });

  it('drops duplicates, keeping the first appearance', () => {
    expect(parseCustomSet('K K M K').characters).toEqual(['K', 'M']);
  });

  it('reports what it could not use rather than dropping it in silence', () => {
    const { characters, rejected } = parseCustomSet('K # M <ZZ>');
    expect(characters).toEqual(['K', 'M']);
    expect(rejected).toEqual(['#', '<ZZ>']);
  });

  it('accepts digits and punctuation', () => {
    expect(parseCustomSet('7 3 /').characters).toEqual(['7', '3', '/']);
  });
});

describe('practiceSet', () => {
  const progress = { unlocked: 5 }; // lesson 4: K M R S U

  it('follows the course by default', () => {
    const set = practiceSet(DEFAULT_PRACTICE, progress);
    expect(set.characters).toEqual(['K', 'M', 'R', 'S', 'U']);
    expect(set.countsTowardCourse).toBe(true);
  });

  it('lets a student drill a lesson they have not reached', () => {
    const set = practiceSet({ mode: 'lesson', lesson: 12, custom: '' }, progress);
    expect(set.characters).toHaveLength(13);
    expect(set.countsTowardCourse).toBe(false);
  });

  it('still counts when the chosen lesson is the student own one', () => {
    const set = practiceSet({ mode: 'lesson', lesson: 4, custom: '' }, progress);
    expect(set.characters).toEqual(['K', 'M', 'R', 'S', 'U']);
    expect(set.countsTowardCourse).toBe(true);
  });

  it('drills a set of the student own choosing, outside the course', () => {
    const set = practiceSet({ mode: 'custom', lesson: 1, custom: 'C Q D E 7 3' }, progress);
    expect(set.characters).toEqual(['C', 'Q', 'D', 'E', '7', '3']);
    expect(set.countsTowardCourse).toBe(false);
  });

  it('falls back to the course when the custom set is too small to drill', () => {
    const set = practiceSet({ mode: 'custom', lesson: 1, custom: 'K' }, progress);
    expect(set.characters).toEqual(['K', 'M', 'R', 'S', 'U']);
    expect(set.warning).toMatch(/at least 2 characters/);
    // Falling back must not quietly turn a practice run into a course session.
    expect(set.countsTowardCourse).toBe(true);
  });

  it('falls back when the custom set is nothing but unusable characters', () => {
    const set = practiceSet({ mode: 'custom', lesson: 1, custom: '### ***' }, progress);
    expect(set.warning).toBeDefined();
  });
});
