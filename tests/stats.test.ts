import { describe, expect, it } from 'vitest';
import {
  alignAnswer, characterStats, characterStatsToCsv, confusionMatrix,
  partitionForRollup, sessionsToCsv, type Attempt,
} from '../src/core/stats';

const attempt = (sent: string, typed: string, responseMs = 400, at = Date.now()): Attempt =>
  ({ sent, typed, responseMs, at });

describe('answer alignment', () => {
  it('pairs character for character when the length matches', () => {
    expect(alignAnswer('KMR', 'KMR')).toEqual([
      { sent: 'K', typed: 'K' },
      { sent: 'M', typed: 'M' },
      { sent: 'R', typed: 'R' },
    ]);
  });

  it('records a substitution against the character that was sent', () => {
    expect(alignAnswer('KMR', 'KNR')).toEqual([
      { sent: 'K', typed: 'K' },
      { sent: 'M', typed: 'N' },
      { sent: 'R', typed: 'R' },
    ]);
  });

  // The case a naive index-by-index comparison gets wrong: one dropped
  // character must not mark everything after it as an error.
  it('does not cascade errors when the student drops a character', () => {
    const pairs = alignAnswer('KMRSU', 'KRSU');
    expect(pairs).toContainEqual({ sent: 'M', typed: '' });
    expect(pairs.filter((p) => p.sent !== '' && p.typed !== p.sent)).toHaveLength(1);
  });

  it('records a spurious keystroke without charging it to a sent character', () => {
    const pairs = alignAnswer('KM', 'KXM');
    expect(pairs).toContainEqual({ sent: '', typed: 'X' });
    expect(pairs.filter((p) => p.sent !== '' && p.typed !== p.sent)).toHaveLength(0);
  });

  it('ignores whitespace and case differences', () => {
    const pairs = alignAnswer('CQ TEST', 'cq test');
    expect(pairs.every((p) => p.sent === p.typed)).toBe(true);
  });

  it('handles an empty answer as all misses', () => {
    expect(alignAnswer('KM', '')).toEqual([
      { sent: 'K', typed: '' },
      { sent: 'M', typed: '' },
    ]);
  });
});

describe('per-character accuracy', () => {
  it('computes accuracy per character and sorts the worst first', () => {
    const stats = characterStats([
      attempt('K', 'K'), attempt('K', 'K'), attempt('K', 'K'), attempt('K', 'K'),
      attempt('M', 'N'), attempt('M', 'M'),
    ]);
    expect(stats[0]!.character).toBe('M');
    expect(stats[0]!.accuracy).toBeCloseTo(0.5, 9);
    expect(stats[1]!.character).toBe('K');
    expect(stats[1]!.accuracy).toBe(1);
  });

  it('reports the median response time of correct answers only', () => {
    const stats = characterStats([
      attempt('K', 'K', 300), attempt('K', 'K', 500), attempt('K', 'K', 900),
      attempt('K', 'M', 50),
    ]);
    expect(stats[0]!.medianResponseMs).toBe(500);
  });

  it('skips spurious keystrokes that were never sent', () => {
    expect(characterStats([attempt('', 'X')])).toEqual([]);
  });
});

describe('confusion matrix', () => {
  it('shows which character is mistaken for which', () => {
    const matrix = confusionMatrix([
      attempt('M', 'N'), attempt('M', 'N'), attempt('N', 'M'), attempt('K', 'K'),
    ]);
    expect(matrix.counts.get('M')!.get('N')).toBe(2);
    expect(matrix.counts.get('N')!.get('M')).toBe(1);
    expect(matrix.topConfusions[0]).toEqual({ sent: 'M', typed: 'N', count: 2 });
  });

  it('records a missed character under its own marker', () => {
    const matrix = confusionMatrix([attempt('R', '')]);
    expect(matrix.counts.get('R')!.get('·')).toBe(1);
  });

  it('excludes correct answers from the confusion list', () => {
    const matrix = confusionMatrix([attempt('K', 'K'), attempt('K', 'K')]);
    expect(matrix.topConfusions).toEqual([]);
  });

  it('is empty for no attempts', () => {
    const matrix = confusionMatrix([]);
    expect(matrix.characters).toEqual([]);
    expect(matrix.topConfusions).toEqual([]);
  });
});

describe('CSV export', () => {
  it('writes a session history with a header row', () => {
    const csv = sessionsToCsv([{
      id: 's1', startedAt: 0, endedAt: 60_000, lessonType: 'groups',
      characterWpm: 18, effectiveWpm: 8, attempted: 100, correct: 92, unlockedCount: 4,
    }]);
    const [header, row] = csv.split('\n');
    expect(header).toContain('session_id');
    expect(row).toContain('groups');
    expect(row).toContain('0.9200');
  });

  it('quotes a comma so the column count survives', () => {
    // The comma is itself a Koch character, so this row is routine.
    const csv = characterStatsToCsv([
      { character: ',', attempted: 4, correct: 3, accuracy: 0.75, medianResponseMs: 410 },
    ]);
    expect(csv.split('\n')[1]).toBe('",",4,3,0.7500,410');
    expect(csv.split('\n')[1]!.split(',')).toHaveLength(6); // the quoted field splits
  });

  it('escapes a quote character by doubling it', () => {
    const csv = characterStatsToCsv([
      { character: '"', attempted: 1, correct: 1, accuracy: 1, medianResponseMs: 0 },
    ]);
    expect(csv.split('\n')[1]).toBe('"""",1,1,1.0000,0');
  });

  it('writes a header even with no rows', () => {
    expect(sessionsToCsv([]).split('\n')).toHaveLength(1);
  });
});

describe('raw attempt retention', () => {
  const day = 24 * 60 * 60 * 1000;

  it('keeps 30 days of raw attempts and rolls up the rest', () => {
    const now = 100 * day;
    const { keep, rollUp } = partitionForRollup([
      attempt('K', 'K', 300, now - 1 * day),
      attempt('M', 'M', 300, now - 29 * day),
      attempt('R', 'R', 300, now - 31 * day),
      attempt('S', 'S', 300, now - 90 * day),
    ], now);
    expect(keep.map((a) => a.sent)).toEqual(['K', 'M']);
    expect(rollUp.map((a) => a.sent)).toEqual(['R', 'S']);
  });

  it('keeps an attempt exactly on the boundary', () => {
    const now = 100 * day;
    const { keep } = partitionForRollup([attempt('K', 'K', 300, now - 30 * day)], now);
    expect(keep).toHaveLength(1);
  });
});
