/**
 * The spectrum check acceptance criterion 2 asks for.
 *
 * "Gain envelope of 4 to 8 ms rise and fall, adjustable. Hard switching
 * produces key clicks that are fatiguing to copy and unlike a real signal."
 * Acceptance: "No key clicks — envelope shaping audible and adjustable;
 * spectrum check on request."
 *
 * Audible is not checkable, so this renders the real envelope — the points
 * src/core/audio.ts schedules, not a copy of them — multiplies it by the
 * sidetone, and measures how far the sidebands sit below the carrier.
 *
 * The control matters more than any single number: the same measurement is
 * run against hard switching, which is what the criterion exists to rule
 * out. A threshold that only passes because the figure happens to be small
 * proves nothing; a threshold that hard keying fails by 30 dB proves the
 * measurement can tell the difference.
 */

import { describe, expect, it } from 'vitest';
import { envelopePoints, type EnvelopePoint } from '../src/core/audio';

const SAMPLE_RATE = 48_000;
/** Power of two, so the radix-2 transform below is exact. 0.68 s at 48 kHz. */
const N = 32_768;
const CARRIER_HZ = 600;

/**
 * Evaluate a scheduled envelope at one instant, the way the Web Audio
 * automation timeline does: setValueAtTime holds until the next event, and
 * linearRampToValueAtTime interpolates from the previous event.
 */
function valueAt(points: readonly EnvelopePoint[], t: number): number {
  const first = points[0];
  if (first === undefined || t <= first.atS) return first?.value ?? 0;
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i] as EnvelopePoint;
    const previous = points[i - 1] as EnvelopePoint;
    if (t >= point.atS) continue;
    if (!point.ramp) return previous.value;
    const span = point.atS - previous.atS;
    if (span <= 0) return point.value;
    return previous.value + ((t - previous.atS) / span) * (point.value - previous.value);
  }
  return (points[points.length - 1] as EnvelopePoint).value;
}

/** One keyed element, centred in the analysis window, silence either side. */
function renderKeyedTone(durationS: number, envelopeS: number): Float64Array {
  const points = envelopePoints(durationS, envelopeS);
  const samples = new Float64Array(N);
  const startSample = Math.round((N - durationS * SAMPLE_RATE) / 2);
  for (let i = 0; i < N; i += 1) {
    const t = (i - startSample) / SAMPLE_RATE;
    const gain = t < 0 || t > durationS ? 0 : valueAt(points, t);
    samples[i] = gain * Math.sin(2 * Math.PI * CARRIER_HZ * (i / SAMPLE_RATE));
  }
  return samples;
}

/**
 * Four-term Blackman-Harris. Its own sidelobes are about 92 dB down, far
 * below anything being measured here, so what the transform shows is the
 * signal's spectrum rather than the window's.
 */
function blackmanHarris(length: number): Float64Array {
  const w = new Float64Array(length);
  const [a0, a1, a2, a3] = [0.35875, 0.48829, 0.14128, 0.01168];
  for (let i = 0; i < length; i += 1) {
    const x = (2 * Math.PI * i) / (length - 1);
    w[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
  }
  return w;
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ur = re[i + k] as number;
        const ui = im[i + k] as number;
        const vr = (re[i + k + len / 2] as number) * cr - (im[i + k + len / 2] as number) * ci;
        const vi = (re[i + k + len / 2] as number) * ci + (im[i + k + len / 2] as number) * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Magnitude spectrum in dB, relative to its own peak. */
function spectrumDb(samples: Float64Array): Float64Array {
  const window = blackmanHarris(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i += 1) re[i] = (samples[i] as number) * (window[i] as number);
  fft(re, im);
  const half = N / 2;
  const mag = new Float64Array(half);
  let peak = 0;
  for (let i = 0; i < half; i += 1) {
    const m = Math.hypot(re[i] as number, im[i] as number);
    mag[i] = m;
    if (m > peak) peak = m;
  }
  const db = new Float64Array(half);
  for (let i = 0; i < half; i += 1) db[i] = 20 * Math.log10(Math.max(mag[i] as number, 1e-30) / peak);
  return db;
}

/**
 * The worst level anywhere at least `offsetHz` away from the carrier, in dB
 * relative to the carrier. The worst rather than the level at one bin,
 * because a click is an excess of energy across a spread, not at a point.
 */
function worstSidebandDb(db: Float64Array, offsetHz: number): number {
  const binHz = SAMPLE_RATE / N;
  let worst = -Infinity;
  for (let i = 0; i < db.length; i += 1) {
    const hz = i * binHz;
    if (Math.abs(hz - CARRIER_HZ) < offsetHz) continue;
    // Above a few kHz there is nothing but numerical floor; the band that
    // matters for clicks is the one a receiver's filter cannot remove.
    if (hz > 4000) break;
    worst = Math.max(worst, db[i] as number);
  }
  return worst;
}

/** A dah at 18 WPM. Long enough that the edges, not the length, shape it. */
const DAH_S = 0.2;

describe('the keying envelope, measured (acceptance criterion 2)', () => {
  it('shapes a tone rather than switching it', () => {
    const points = envelopePoints(DAH_S, 0.006);
    expect(points.map((p) => p.ramp)).toEqual([false, true, false, true]);
    expect(points[1]?.atS).toBeCloseTo(0.006, 6);
    expect(points[2]?.atS).toBeCloseTo(DAH_S - 0.006, 6);
  });

  it('keeps a dit at 40 WPM shaped rather than clipping it to a click', () => {
    // 40 WPM is a 30 ms dit; a 6 ms edge each side would still fit, but the
    // rule has to hold when someone winds the envelope up to its maximum.
    const ditS = 1.2 / 40;
    const points = envelopePoints(ditS, 0.02);
    const edge = points[1]?.atS ?? 0;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThanOrEqual(ditS / 2.5 + 1e-9);
    // Still a trapezoid: there is a hold between the ramps, not a spike.
    expect(points[2]?.atS ?? 0).toBeGreaterThan(edge);
  });

  it('puts the sidebands of a 6 ms envelope far below the carrier', () => {
    const db = spectrumDb(renderKeyedTone(DAH_S, 0.006));
    /*
     * Measured on the default 6 ms envelope, a 200 ms dah at 600 Hz:
     *
     *   250 Hz off  -60 dB      500 Hz off  -70 dB
     *     1 kHz off  -84 dB       2 kHz off  -95 dB
     *
     * The thresholds sit a few dB inside those, so a change to the envelope
     * shape fails this test rather than passing it quietly.
     */
    expect(worstSidebandDb(db, 250)).toBeLessThan(-55);
    expect(worstSidebandDb(db, 500)).toBeLessThan(-66);
    expect(worstSidebandDb(db, 1000)).toBeLessThan(-80);
  });

  it('is the shaping that does it, not the measurement', () => {
    /*
     * Hard switching a 200 ms tone leaves the pulse's own sinc skirt, which
     * falls at 6 dB per octave. Shaping the edges adds a second roll-off, so
     * the two diverge with distance from the carrier: 19 dB apart at 500 Hz,
     * 28 dB at 1 kHz, 34 dB at 2 kHz. 1 kHz is measured here because that is
     * where the difference is past argument, and because a receiver's filter
     * cannot remove energy that close in.
     */
    const shaped = worstSidebandDb(spectrumDb(renderKeyedTone(DAH_S, 0.006)), 1000);
    const hard = worstSidebandDb(spectrumDb(renderKeyedTone(DAH_S, 0)), 1000);
    expect(hard).toBeGreaterThan(-60);
    expect(shaped).toBeLessThan(-80);
    expect(hard - shaped).toBeGreaterThan(25);
  });

  it('gets cleaner as the envelope is lengthened, across the adjustable range', () => {
    const levels = [0.001, 0.004, 0.006, 0.008, 0.02].map(
      (edge) => worstSidebandDb(spectrumDb(renderKeyedTone(DAH_S, edge)), 500),
    );
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] as number, `envelope step ${String(i)}`).toBeLessThan(levels[i - 1] as number);
    }
  });

  it('meets the criterion across the whole 4 to 8 ms range the RFD names', () => {
    for (const edge of [0.004, 0.005, 0.006, 0.007, 0.008]) {
      const level = worstSidebandDb(spectrumDb(renderKeyedTone(DAH_S, edge)), 500);
      expect(level, `${String(edge * 1000)} ms envelope`).toBeLessThan(-60);
    }
  });
});
