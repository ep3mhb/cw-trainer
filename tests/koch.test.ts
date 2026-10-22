import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COURSE, activeSet, evaluateSession, initialProgress, nextCharacter, promote,
} from '../src/core/koch';

describe('Koch progression', () => {
  it('starts with two characters', () => {
    const progress = initialProgress();
    expect(activeSet(progress)).toEqual(['K', 'M']);
  });

  it('names the character a promotion would add', () => {
    expect(nextCharacter(initialProgress())).toBe('R');
  });

  it('promotes at 90% accuracy over a full session', () => {
    const decision = evaluateSession({ attempted: 100, correct: 92 }, initialProgress());
    expect(decision).toMatchObject({ promote: true, reason: 'promoted' });
    expect(decision.accuracy).toBeCloseTo(0.92, 9);
  });

  it('holds the student back below 90%', () => {
    const decision = evaluateSession({ attempted: 100, correct: 88 }, initialProgress());
    expect(decision).toMatchObject({ promote: false, reason: 'below-threshold' });
  });

  it('promotes at exactly 90%, not just above it', () => {
    expect(evaluateSession({ attempted: 100, correct: 90 }, initialProgress()).promote).toBe(true);
  });

  it('refuses to promote on a handful of characters', () => {
    const decision = evaluateSession({ attempted: 5, correct: 5 }, initialProgress());
    expect(decision).toMatchObject({ promote: false, reason: 'too-few-attempts' });
  });

  it('handles an empty session without dividing by zero', () => {
    const decision = evaluateSession({ attempted: 0, correct: 0 }, initialProgress());
    expect(decision.accuracy).toBe(0);
    expect(decision.promote).toBe(false);
  });

  it('adds one character per promotion and stops at the end of the course', () => {
    let progress = initialProgress();
    for (let i = 0; i < 100; i += 1) progress = promote(progress);
    expect(progress.unlocked).toBe(DEFAULT_COURSE.order.length);
    expect(nextCharacter(progress)).toBeNull();
    expect(evaluateSession({ attempted: 100, correct: 100 }, progress).reason).toBe('course-complete');
  });

  it('honours an operator configuration that overrides the order and threshold', () => {
    const config = { order: ['E', 'T', 'A'], startingCount: 1, promotionAccuracy: 0.8, minimumAttempts: 10 };
    expect(activeSet(initialProgress(config), config)).toEqual(['E']);
    expect(evaluateSession({ attempted: 10, correct: 8 }, initialProgress(config), config).promote).toBe(true);
  });
});
