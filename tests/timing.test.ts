import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMING, ditMs, durations, effectiveWpmOf, farnsworthUnitMs, schedule,
} from '../src/core/timing';

const standard = (wpm: number) => ({ characterWpm: wpm, effectiveWpm: wpm, weighting: 3 });

describe('PARIS timing', () => {
  it('derives dit length as 1200 / WPM', () => {
    expect(ditMs(20)).toBe(60);
    expect(ditMs(5)).toBe(240);
    expect(ditMs(25)).toBe(48);
  });

  it('rejects a non-positive speed rather than producing nonsense', () => {
    expect(() => ditMs(0)).toThrow(RangeError);
    expect(() => ditMs(-10)).toThrow(RangeError);
  });

  // Acceptance criterion 1: element timing measured against PARIS at
  // 5, 15 and 25 WPM.
  it.each([5, 15, 25])('sends "PARIS " in exactly 60/WPM seconds at %i WPM', (wpm) => {
    const { paddedMs } = schedule('PARIS ', standard(wpm));
    expect(paddedMs).toBeCloseTo(60_000 / wpm, 6);
  });

  it('counts a PARIS word as 50 dit units', () => {
    const { paddedMs } = schedule('PARIS ', standard(20));
    expect(paddedMs / ditMs(20)).toBeCloseTo(50, 9);
  });

  it('reports the nominal speed back from a generated schedule', () => {
    expect(effectiveWpmOf('PARIS ', standard(18))).toBeCloseTo(18, 6);
  });
});

describe('element durations', () => {
  it('uses one dit between elements and 3 / 7 units between characters and words', () => {
    const d = durations(standard(20));
    expect(d.ditMs).toBe(60);
    expect(d.dahMs).toBe(180);
    expect(d.intraCharGapMs).toBe(60);
    expect(d.interCharGapMs).toBeCloseTo(180, 9);
    expect(d.interWordGapMs).toBeCloseTo(420, 9);
  });

  it('applies adjustable weighting to the dah only', () => {
    const light = durations({ characterWpm: 20, effectiveWpm: 20, weighting: 2.6 });
    expect(light.ditMs).toBe(60);
    expect(light.dahMs).toBeCloseTo(156, 9);
    expect(light.intraCharGapMs).toBe(60);
  });

  it('rejects a non-positive weighting', () => {
    expect(() => durations({ characterWpm: 20, effectiveWpm: 20, weighting: 0 })).toThrow(RangeError);
  });
});

describe('Farnsworth spacing', () => {
  it('collapses to standard timing when both speeds are equal', () => {
    expect(farnsworthUnitMs(20, 20)).toBeCloseTo(ditMs(20), 9);
    expect(farnsworthUnitMs(13, 13)).toBeCloseTo(ditMs(13), 9);
  });

  it('pads the gaps so a word takes the effective-speed time', () => {
    // 18 WPM characters at 8 WPM effective: one PARIS word must take 60/8 s.
    const { paddedMs } = schedule('PARIS ', { characterWpm: 18, effectiveWpm: 8, weighting: 3 });
    expect(paddedMs).toBeCloseTo(60_000 / 8, 6);
  });

  it('keeps the characters themselves at the character speed', () => {
    const farnsworth = schedule('K', { characterWpm: 18, effectiveWpm: 8, weighting: 3 });
    const plain = schedule('K', standard(18));
    expect(farnsworth.totalMs).toBeCloseTo(plain.totalMs, 9);
  });

  it('never lets the effective speed exceed the character speed', () => {
    expect(farnsworthUnitMs(10, 30)).toBeCloseTo(ditMs(10), 9);
  });

  it('rejects non-positive speeds', () => {
    expect(() => farnsworthUnitMs(0, 5)).toThrow(RangeError);
    expect(() => farnsworthUnitMs(20, 0)).toThrow(RangeError);
  });
});

describe('schedules', () => {
  it('places every element on an absolute offset with no overlaps', () => {
    const { tones } = schedule('CQ TEST', standard(20));
    for (let i = 1; i < tones.length; i += 1) {
      const previous = tones[i - 1]!;
      const current = tones[i]!;
      expect(current.atMs).toBeGreaterThanOrEqual(previous.atMs + previous.durationMs);
    }
  });

  it('marks dits and dahs correctly for a known character', () => {
    const { tones } = schedule('R', standard(20));
    expect(tones.map((t) => t.element)).toEqual(['dit', 'dah', 'dit']);
  });

  it('sends a prosign as one character with no internal character gap', () => {
    const prosign = schedule('<SK>', standard(20));
    // ...-.- is six elements, five intra-character gaps, no 3-unit gaps.
    expect(prosign.tones).toHaveLength(6);
    const d = durations(standard(20));
    for (let i = 1; i < prosign.tones.length; i += 1) {
      const gap = prosign.tones[i]!.atMs - (prosign.tones[i - 1]!.atMs + prosign.tones[i - 1]!.durationMs);
      expect(gap).toBeCloseTo(d.intraCharGapMs, 9);
    }
  });

  it('collapses repeated spaces into a single word gap', () => {
    const one = schedule('A B', standard(20));
    const many = schedule('A    B', standard(20));
    expect(many.totalMs).toBeCloseTo(one.totalMs, 9);
  });

  it('returns an empty schedule for an empty message', () => {
    const empty = schedule('', DEFAULT_TIMING);
    expect(empty.tones).toHaveLength(0);
    expect(empty.paddedMs).toBe(0);
    expect(effectiveWpmOf('', DEFAULT_TIMING)).toBe(0);
  });

  it('drops characters it cannot send instead of throwing', () => {
    const { tokens } = schedule('A#B', DEFAULT_TIMING);
    expect(tokens).toEqual(['A', 'B']);
  });
});
