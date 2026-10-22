import { describe, expect, it } from 'vitest';
import { spectrumRow, waterfallColour } from '../src/core/spectrum';
import { seeded } from '../src/core/random';

const rnd = (seed: number) => { const r = seeded(seed); return () => r.next(); };

describe('a spectrum row', () => {
  it('has a noise floor that rises with the band conditions', () => {
    const quiet = spectrumRow({ bins: 200, stations: [], noise: 0.06, random: rnd(1) });
    const poor = spectrumRow({ bins: 200, stations: [], noise: 0.45, random: rnd(1) });
    const mean = (r: Float32Array) => r.reduce((a, b) => a + b, 0) / r.length;
    expect(mean(quiet)).toBeGreaterThan(0.03);
    expect(mean(poor)).toBeGreaterThan(mean(quiet) * 2);
    expect(Math.max(...poor)).toBeLessThanOrEqual(1);
  });

  it('draws a peak at a keying station and nothing at a silent one', () => {
    const on = spectrumRow({ bins: 400, stations: [{ frac: 0.5, level: 0.9, on: true }], noise: 0.06, random: rnd(2) });
    const off = spectrumRow({ bins: 400, stations: [{ frac: 0.5, level: 0.9, on: false }], noise: 0.06, random: rnd(2) });
    const peak = (r: Float32Array) => Math.max(...Array.from(r.slice(198, 203)));
    expect(peak(on)).toBeGreaterThan(0.8);
    expect(peak(off)).toBeLessThan(0.2);
    // Narrow: a bin 1% of the band away is back at the floor.
    expect(on[204]).toBeLessThan(0.2);
  });

  it('keeps a weak station just above the floor and a strong one well clear', () => {
    const weak = spectrumRow({ bins: 400, stations: [{ frac: 0.5, level: 0.1, on: true }], noise: 0.06, random: rnd(3) });
    const strong = spectrumRow({ bins: 400, stations: [{ frac: 0.5, level: 1, on: true }], noise: 0.06, random: rnd(3) });
    const peak = (r: Float32Array) => Math.max(...Array.from(r.slice(198, 203)));
    expect(peak(weak)).toBeGreaterThan(0.25);
    expect(peak(weak)).toBeLessThan(0.45);
    expect(peak(strong)).toBeGreaterThan(0.95);
  });
});

describe('the waterfall colours', () => {
  it('run black → blue → cyan → white/yellow with level', () => {
    expect(waterfallColour(0)).toEqual([0, 0, 40]);
    const [r1, g1, b1] = waterfallColour(0.4);
    expect(b1).toBeGreaterThan(150); expect(g1).toBeGreaterThan(100); expect(r1).toBe(0);
    const [r2, g2] = waterfallColour(0.7);
    expect(r2).toBeGreaterThan(150); expect(g2).toBeGreaterThan(200);
    expect(waterfallColour(1)).toEqual([255, 255, 40]);
    expect(waterfallColour(2)).toEqual([255, 255, 40]);
  });
});

describe('the key trace', () => {
  it('reports the key as it is at the moment asked, not as it was last scheduled', async () => {
    const { KeyTrace } = await import('../src/core/spectrum');
    const t = new KeyTrace();
    t.push(1000, true);
    t.push(1060, false);
    expect(t.at(900)).toBe(false);   // not yet
    expect(t.at(1030)).toBe(true);   // the dit is sounding
    expect(t.at(1100)).toBe(false);  // and has ended
    t.push(1200, true);
    expect(t.at(1250)).toBe(true);
  });
});
