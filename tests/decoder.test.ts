import { describe, expect, it } from 'vitest';
import {
  analyse, compareToIdeal, decode, estimateDitMs, marksFrom, type KeyEvent,
} from '../src/core/decoder';
import { durations, schedule, type TimingSettings } from '../src/core/timing';

const settings = (wpm: number): TimingSettings => ({ characterWpm: wpm, effectiveWpm: wpm, weighting: 3 });

/**
 * Turn a message into the key events a perfect operator would produce, so
 * the decoder can be tested against known-good sending (acceptance
 * criterion 5).
 */
function perfectSending(message: string, wpm: number, jitterMs = 0, seed = 1): KeyEvent[] {
  const { tones } = schedule(message, settings(wpm));
  let a = seed;
  const jitter = (): number => {
    if (jitterMs === 0) return 0;
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return ((a / 0x7fffffff) * 2 - 1) * jitterMs;
  };
  const events: KeyEvent[] = [];
  for (const tone of tones) {
    const start = tone.atMs + jitter();
    events.push({ down: true, t: start });
    events.push({ down: false, t: start + tone.durationMs + jitter() });
  }
  return events;
}

describe('key event pairing', () => {
  it('pairs downs with ups and ignores repeats', () => {
    const marks = marksFrom([
      { down: true, t: 0 }, { down: true, t: 5 }, { down: false, t: 60 },
      { down: true, t: 120 }, { down: false, t: 180 },
    ]);
    expect(marks).toEqual([
      { startMs: 0, durationMs: 60 },
      { startMs: 120, durationMs: 60 },
    ]);
  });

  it('discards a trailing key-down with no release', () => {
    expect(marksFrom([{ down: true, t: 0 }])).toEqual([]);
  });

  it('discards a zero-length closure', () => {
    expect(marksFrom([{ down: true, t: 10 }, { down: false, t: 10 }])).toEqual([]);
  });
});

describe('speed estimation', () => {
  it('splits dits from dahs and returns the dit length', () => {
    expect(estimateDitMs([60, 180, 60, 180, 60])).toBeCloseTo(60, 6);
  });

  it('treats an all-short stream as dits', () => {
    expect(estimateDitMs([58, 62, 60])).toBeCloseTo(60, 6);
  });

  it('returns zero for no marks', () => {
    expect(estimateDitMs([])).toBe(0);
  });
});

describe('decoding known-good sending', () => {
  // Acceptance criterion 5: 100% at 12 and 20 WPM.
  it.each([12, 20])('decodes perfect sending at %i WPM exactly', (wpm) => {
    const message = 'CQ CQ DE A65XY K';
    const result = decode(perfectSending(message, wpm), { tolerance: 0.35 });
    expect(result.text).toBe(message);
  });

  it('decodes without being told the speed', () => {
    const result = decode(perfectSending('PARIS', 15), { tolerance: 0.3 });
    expect(result.text).toBe('PARIS');
    expect(result.estimatedWpm).toBeCloseTo(15, 0);
  });

  it('decodes when given the reference speed explicitly', () => {
    const result = decode(perfectSending('TEST', 18), { referenceWpm: 18, tolerance: 0.2 });
    expect(result.text).toBe('TEST');
    expect(result.ditMs).toBeCloseTo(1200 / 18, 9);
  });

  it('decodes numbers and punctuation', () => {
    const result = decode(perfectSending('599 TU.', 18), { tolerance: 0.35 });
    expect(result.text).toBe('599 TU.');
  });

  it('tolerates a sloppy fist within the tolerance window', () => {
    const events = perfectSending('SOS TEST', 15, 9, 7);
    const result = decode(events, { tolerance: 0.5 });
    expect(result.text).toBe('SOS TEST');
  });

  it('returns an unknown pattern as ? rather than dropping it', () => {
    // Eight dits is not a character in the table.
    const dit = 60;
    const events: KeyEvent[] = [];
    for (let i = 0; i < 8; i += 1) {
      events.push({ down: true, t: i * dit * 2 });
      events.push({ down: false, t: i * dit * 2 + dit });
    }
    expect(decode(events, { referenceWpm: 20, tolerance: 0.3 }).text).toBe('?');
  });

  it('returns empty for no input', () => {
    const result = decode([], { tolerance: 0.3 });
    expect(result.text).toBe('');
    expect(result.estimatedWpm).toBe(0);
  });

  it('classifies gaps into element, character and word', () => {
    const result = decode(perfectSending('AB C', 20), { referenceWpm: 20, tolerance: 0.3 });
    const kinds = new Set(result.gaps.map((g) => g.kind));
    expect(kinds).toContain('element');
    expect(kinds).toContain('character');
    expect(kinds).toContain('word');
  });
});

describe('timing quality analysis', () => {
  it('reports a textbook 3:1 weighting for perfect sending', () => {
    const quality = analyse(decode(perfectSending('MITE', 18), { referenceWpm: 18, tolerance: 0.3 }));
    expect(quality.weighting).toBeCloseTo(3, 2);
    expect(quality.consistency).toBeCloseTo(1, 2);
  });

  it('reports a light fist as a weighting below 3', () => {
    const light = schedule('MITE', { characterWpm: 18, effectiveWpm: 18, weighting: 2.2 });
    const events: KeyEvent[] = [];
    for (const tone of light.tones) {
      events.push({ down: true, t: tone.atMs });
      events.push({ down: false, t: tone.atMs + tone.durationMs });
    }
    const quality = analyse(decode(events, { referenceWpm: 18, tolerance: 0.3 }));
    expect(quality.weighting).toBeLessThan(2.6);
  });

  it('scores an uneven fist lower on consistency', () => {
    const steady = analyse(decode(perfectSending('SOS SOS', 15), { referenceWpm: 15, tolerance: 0.5 }));
    const ragged = analyse(decode(perfectSending('SOS SOS', 15, 18, 3), { referenceWpm: 15, tolerance: 0.5 }));
    expect(ragged.consistency).toBeLessThan(steady.consistency);
  });

  it('survives an empty decode', () => {
    const quality = analyse(decode([], { tolerance: 0.3 }));
    expect(quality.consistency).toBe(0);
    expect(quality.weighting).toBe(0);
  });
});

describe('comparison against ideal timing', () => {
  it('lines every ideal element up with what was sent', () => {
    const target = 'CQ';
    const { rows, idealElementCount, sentElementCount } = compareToIdeal(
      target,
      decode(perfectSending(target, 20), { referenceWpm: 20, tolerance: 0.3 }),
      settings(20),
    );
    expect(idealElementCount).toBe(8); // -.-. --.-
    expect(sentElementCount).toBe(8);
    for (const row of rows) expect(row.ratio).toBeCloseTo(1, 6);
  });

  it('leaves a null where the student sent nothing', () => {
    const { rows } = compareToIdeal('CQ', decode([], { tolerance: 0.3 }), settings(20));
    expect(rows.every((r) => r.actualMs === null)).toBe(true);
  });

  it('uses the weighted dah length as the ideal', () => {
    const heavy: TimingSettings = { characterWpm: 20, effectiveWpm: 20, weighting: 3.5 };
    const { rows } = compareToIdeal('T', decode([], { tolerance: 0.3 }), heavy);
    expect(rows[0]!.idealMs).toBeCloseTo(durations(heavy).dahMs, 9);
  });
});
