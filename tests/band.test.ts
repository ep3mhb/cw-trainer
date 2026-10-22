import { describe, expect, it } from 'vitest';
import {
  BAND_PRESETS, DEFAULT_BAND, FILTER_MAX_HZ, FILTER_MIN_HZ, crashIn, describe as describeBand,
  fadeAt, filterResponse, normalise, signalToNoiseDb, type BandSettings,
} from '../src/core/band';
import { seeded } from '../src/core/random';

const withQsb = (qsb: number, periodS = 8): BandSettings => ({ ...DEFAULT_BAND, qsb, qsbPeriodS: periodS });

describe('QSB fading', () => {
  it('leaves the signal flat when depth is zero', () => {
    for (const t of [0, 1, 3.7, 20]) expect(fadeAt(t, withQsb(0))).toBe(1);
  });

  it('never exceeds full strength and never goes negative', () => {
    for (let t = 0; t < 30; t += 0.13) {
      const level = fadeAt(t, withQsb(1));
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });

  it('takes the signal to zero at the trough when depth is 1', () => {
    // Trough is three quarters through the cycle for a sine mapped this way.
    const period = 8;
    const trough = fadeAt(period * 0.75, withQsb(1, period));
    expect(trough).toBeCloseTo(0, 6);
  });

  it('dips only partway at partial depth', () => {
    const period = 8;
    expect(fadeAt(period * 0.75, withQsb(0.4, period))).toBeCloseTo(0.6, 6);
  });

  it('repeats on its period, so fading has a rhythm to ride', () => {
    const period = 6;
    expect(fadeAt(1.5, withQsb(0.7, period))).toBeCloseTo(fadeAt(1.5 + period, withQsb(0.7, period)), 9);
  });
});

describe('receiver filter', () => {
  it('passes a signal in the middle of the passband untouched', () => {
    expect(filterResponse(0, DEFAULT_BAND)).toBe(1);
    expect(filterResponse(200, { ...DEFAULT_BAND, filterHz: 500 })).toBe(1);
  });

  it('rolls off smoothly rather than cutting off at a wall', () => {
    const settings = { ...DEFAULT_BAND, filterHz: 500 };
    const near = filterResponse(300, settings);
    const far = filterResponse(800, settings);
    expect(near).toBeLessThan(1);
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(0);
  });

  it('is symmetrical either side of centre', () => {
    expect(filterResponse(-400, DEFAULT_BAND)).toBeCloseTo(filterResponse(400, DEFAULT_BAND), 9);
  });

  // The point of the control: narrowing it must actually help with QRM.
  it('rejects an interfering station harder as the filter narrows', () => {
    const wide = filterResponse(400, { ...DEFAULT_BAND, filterHz: 2000 });
    const narrow = filterResponse(400, { ...DEFAULT_BAND, filterHz: 250 });
    expect(narrow).toBeLessThan(wide);
  });
});

describe('QRN crashes', () => {
  it('produces nothing when switched off', () => {
    const rnd = seeded(1);
    for (let i = 0; i < 50; i += 1) {
      expect(crashIn(0.1, { ...DEFAULT_BAND, qrn: 0 }, () => rnd.next()).hit).toBe(false);
    }
  });

  it('gets busier as the setting rises', () => {
    const count = (qrn: number): number => {
      const rnd = seeded(42);
      let hits = 0;
      for (let i = 0; i < 2000; i += 1) {
        if (crashIn(0.05, { ...DEFAULT_BAND, qrn }, () => rnd.next()).hit) hits += 1;
      }
      return hits;
    };
    expect(count(0.6)).toBeGreaterThan(count(0.15));
  });

  it('is reproducible from a seed, so a drill can be repeated', () => {
    const run = (): boolean[] => {
      const rnd = seeded(7);
      return Array.from({ length: 40 }, () => crashIn(0.1, BAND_PRESETS.poor, () => rnd.next()).hit);
    };
    expect(run()).toEqual(run());
  });

  it('varies crash loudness rather than firing one fixed level', () => {
    const rnd = seeded(3);
    const levels = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const { hit, level } = crashIn(0.1, { ...DEFAULT_BAND, qrn: 0.8 }, () => rnd.next());
      if (hit) levels.add(Math.round(level * 100));
    }
    expect(levels.size).toBeGreaterThan(5);
  });
});

describe('settings are clamped', () => {
  it('holds every field inside its range', () => {
    const wild = normalise({
      noise: 5, qsb: -2, qsbPeriodS: 0.1, qrn: 99, qrm: -1, qrmOffsetHz: 9000, filterHz: 1,
    });
    expect(wild.noise).toBe(1);
    expect(wild.qsb).toBe(0);
    expect(wild.qsbPeriodS).toBe(1);
    expect(wild.qrn).toBe(1);
    expect(wild.qrm).toBe(0);
    expect(wild.qrmOffsetHz).toBe(2000);
    expect(wild.filterHz).toBe(FILTER_MIN_HZ);
    expect(normalise({ ...DEFAULT_BAND, filterHz: 99999 }).filterHz).toBe(FILTER_MAX_HZ);
  });
});

describe('signal to noise', () => {
  it('is high on a quiet band and lower on a poor one', () => {
    expect(signalToNoiseDb(BAND_PRESETS.quiet)).toBeGreaterThan(signalToNoiseDb(BAND_PRESETS.poor));
  });

  it('improves when the filter is narrowed', () => {
    const wide = signalToNoiseDb({ ...BAND_PRESETS.typical, filterHz: 2000 });
    const narrow = signalToNoiseDb({ ...BAND_PRESETS.typical, filterHz: 250 });
    expect(narrow).toBeGreaterThan(wide);
  });

  it('reports a clean band rather than dividing by zero', () => {
    expect(signalToNoiseDb({ ...DEFAULT_BAND, noise: 0 })).toBe(40);
  });
});

describe('presets and description', () => {
  it('orders the presets from easiest to hardest', () => {
    expect(signalToNoiseDb(BAND_PRESETS.quiet)).toBeGreaterThan(signalToNoiseDb(BAND_PRESETS.typical));
    expect(signalToNoiseDb(BAND_PRESETS.typical)).toBeGreaterThan(signalToNoiseDb(BAND_PRESETS.poor));
  });

  it('describes conditions in words a member would use', () => {
    expect(describeBand(BAND_PRESETS.quiet)).toContain('quiet band');
    expect(describeBand(BAND_PRESETS.poor)).toContain('deep fading');
    expect(describeBand(BAND_PRESETS.contest)).toContain('strong interference');
    expect(describeBand(DEFAULT_BAND)).toContain('Hz filter');
  });
});
