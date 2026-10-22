import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCHED,
  envelope,
  findOnset,
  findOnsetMatched,
  latencyTone,
  looksRemoved,
  rms,
  roomLevel,
} from '../src/core/onset';

const RATE = 44100;
const CLICK_MS = 30;
const CLICK_SAMPLES = Math.round((CLICK_MS / 1000) * RATE);

interface Burst {
  atMs: number;
  amplitude: number;
}

/**
 * A recording of the room with one or more tone bursts in it.
 *
 * Deterministic noise, because a detector that passes only on a lucky seed
 * has not been tested. The carrier is 1 kHz, which is what the probe plays.
 */
function recording(lengthMs: number, bursts: Burst[], noise = 0.001): Float32Array {
  const out = new Float32Array(Math.round((lengthMs / 1000) * RATE));
  let seed = 12345;
  for (let i = 0; i < out.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((seed / 0x7fffffff) * 2 - 1) * noise;
  }
  for (const burst of bursts) {
    const start = Math.round((burst.atMs / 1000) * RATE);
    for (let i = 0; i < CLICK_SAMPLES; i += 1) {
      const at = start + i;
      if (at >= out.length) break;
      out[at] = (out[at] as number) + Math.sin((2 * Math.PI * 1000 * i) / RATE) * burst.amplitude;
    }
  }
  return out;
}

const found = (samples: Float32Array, searchFrom = 0): number | null => {
  const onset = findOnsetMatched(samples, { clickSamples: CLICK_SAMPLES, searchFrom });
  return onset.index === null ? null : (onset.index / RATE) * 1000;
};

describe('the envelope', () => {
  it('follows the outline of a tone rather than its waveform', () => {
    const env = envelope(recording(100, [{ atMs: 40, amplitude: 0.5 }], 0.0001), 64, 16);
    const quiet = env[Math.round((0.01 * RATE) / 16)] as number;
    const loud = env[Math.round((0.05 * RATE) / 16)] as number;
    expect(loud).toBeGreaterThan(quiet * 50);
    // RMS of a sine is its amplitude over root two.
    expect(loud).toBeCloseTo(0.5 / Math.SQRT2, 1);
  });

  it('is one value per hop and survives an empty signal', () => {
    expect(envelope(new Float32Array(1000), 64, 16)).toHaveLength(Math.floor(999 / 16) + 1);
    expect(envelope(new Float32Array(0), 64, 16)).toHaveLength(0);
  });
});

describe('matched-filter onset detection', () => {
  it('puts the onset on the click, not half a window late', () => {
    const at = found(recording(600, [{ atMs: 120, amplitude: 0.3 }]));
    expect(at).not.toBeNull();
    expect(Math.abs((at as number) - 120)).toBeLessThan(1);
  });

  it('is accurate across the capture, not only in one place', () => {
    for (const trueAt of [60, 150, 300, 480]) {
      const at = found(recording(600, [{ atMs: trueAt, amplitude: 0.2 }]));
      expect(at).not.toBeNull();
      expect(Math.abs((at as number) - trueAt)).toBeLessThan(1);
    }
  });

  /*
   * The case that matters, and the comparison that justifies the change.
   * At a click ten times the room level both detectors fire, but the
   * threshold one is nearly two milliseconds late: noise decides which
   * single sample crosses the line first, and the click's opening cycles
   * are its quietest. Matching the whole 30 ms is accurate to a tenth of a
   * millisecond on the same recording.
   */
  it('is an order of magnitude more accurate than the threshold detector', () => {
    const quiet = recording(600, [{ atMs: 200, amplitude: 0.01 }], 0.0025);
    const old = findOnset(quiet);
    const matched = findOnsetMatched(quiet, { clickSamples: CLICK_SAMPLES });
    expect(old.index).not.toBeNull();
    expect(matched.index).not.toBeNull();
    const errOld = Math.abs(((old.index as number) / RATE) * 1000 - 200);
    const errNew = Math.abs(((matched.index as number) / RATE) * 1000 - 200);
    expect(errOld).toBeGreaterThan(1);
    expect(errNew).toBeLessThan(0.2);
  });

  /*
   * Both halves of the trade described on `minPeakRatio`, pinned so that
   * changing the policy has to be deliberate.
   *
   * A click at twice the room level is rejected at the shipped setting, and
   * timed to within a tenth of a millisecond once the bar is lowered. So the
   * clicks Safari is losing are almost certainly recoverable — and what stops
   * us lowering it is not capability but the open question of whether those
   * recovered arrivals are the click or its reflection.
   */
  it('rejects a click near the room level at the shipped setting', () => {
    expect(found(recording(600, [{ atMs: 200, amplitude: 0.004 }], 0.0025))).toBeNull();
  });

  it('times that same click accurately once the bar is lowered', () => {
    const quiet = recording(600, [{ atMs: 200, amplitude: 0.004 }], 0.0025);
    const onset = findOnsetMatched(quiet, { clickSamples: CLICK_SAMPLES, minPeakRatio: 1.5 });
    expect(onset.index).not.toBeNull();
    expect(Math.abs(((onset.index as number) / RATE) * 1000 - 200)).toBeLessThan(0.2);
  });

  /*
   * In a hard room the first arrival can be quieter than its own reflection.
   * Taking the strongest peak would time the wall.
   */
  it('takes the first arrival, not the loudest', () => {
    const withEcho = recording(600, [
      { atMs: 150, amplitude: 0.05 },
      { atMs: 260, amplitude: 0.12 },
    ]);
    const at = found(withEcho);
    expect(at).not.toBeNull();
    expect(Math.abs((at as number) - 150)).toBeLessThan(2);
  });

  it('says nothing happened when the room is all there is', () => {
    expect(found(recording(600, [], 0.002))).toBeNull();
  });

  it('never reports a click before it was played', () => {
    const samples = recording(600, [{ atMs: 100, amplitude: 0.3 }, { atMs: 350, amplitude: 0.3 }]);
    const searchFrom = Math.round(0.3 * RATE);
    const at = found(samples, searchFrom);
    expect(at).not.toBeNull();
    expect(at as number).toBeGreaterThanOrEqual(300);
    expect(Math.abs((at as number) - 350)).toBeLessThan(2);
  });

  it('refuses rather than guessing when the capture is shorter than the click', () => {
    const stub = recording(10, [{ atMs: 1, amplitude: 0.3 }]);
    expect(findOnsetMatched(stub, { clickSamples: CLICK_SAMPLES }).index).toBeNull();
  });

  it('keeps the acceptance ratio conservative until the Safari question is settled', () => {
    expect(DEFAULT_MATCHED.minPeakRatio).toBe(4);
  });
});

describe('the room level', () => {
  /** A recording that opens with a bang: a microphone waking up. */
  function withStartupTransient(): Float32Array {
    const out = recording(600, [{ atMs: 200, amplitude: 0.05 }], 0.001);
    for (let i = 0; i < Math.round(0.02 * RATE); i += 1) {
      out[i] = Math.sin((2 * Math.PI * 300 * i) / RATE) * 0.25;
    }
    return out;
  }

  /*
   * Safari, 12 October 2026: "room level 0.1657, loudest 0.0387". A floor
   * four times the loudest sample in the recording, which cannot describe a
   * room. The acceptance bar is a multiple of the floor, so it stood at 0.66
   * and no click could ever have cleared it.
   */
  it('is not set by a loud moment at the start of the capture', () => {
    const samples = withStartupTransient();
    const old = rms(samples, 0, 2048);
    const now = roomLevel(samples, 2048);
    expect(old).toBeGreaterThan(0.1);
    expect(now).toBeLessThan(old / 50);
  });

  it('never reports a floor above the loudest thing in the recording', () => {
    const samples = withStartupTransient();
    let peak = 0;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    expect(roomLevel(samples, Math.round(0.15 * RATE))).toBeLessThan(peak);
  });

  it('still finds the click behind the transient', () => {
    const onset = findOnsetMatched(withStartupTransient(), {
      clickSamples: CLICK_SAMPLES,
      searchFrom: Math.round(0.15 * RATE),
    });
    expect(onset.index).not.toBeNull();
    expect(Math.abs(((onset.index as number) / RATE) * 1000 - 200)).toBeLessThan(2);
  });

  it('agrees with the plain RMS on a recording that really is just a room', () => {
    const quiet = recording(600, [], 0.002);
    expect(roomLevel(quiet, 2048)).toBeCloseTo(rms(quiet, 0, 2048), 3);
  });

  it('survives a stretch too short to have an envelope', () => {
    expect(roomLevel(new Float32Array(0), 2048)).toBe(0);
  });
});

describe('the colour of the headline latency badge', () => {
  /*
   * The defect: one colour scale for two quantities. On 12 October a
   * measured 63.2 ms round trip showed red — judged against the 60 ms
   * ONE-WAY limit — directly above a note reading it as an upper bound and
   * calling it "probably fine". Mohammad, who wrote that caveat, read the
   * red as over the limit.
   */
  it('does not call a round trip bad at the one-way threshold', () => {
    expect(latencyTone(63.2, 60, true)).not.toBe('bad');
    expect(latencyTone(63.2, 60, false)).toBe('bad');
  });

  it('agrees with the three bands the note beneath it uses', () => {
    expect(latencyTone(40, 60, true)).toBe('good');
    expect(latencyTone(60, 60, true)).toBe('good');
    expect(latencyTone(63.2, 60, true)).toBe('warn');
    expect(latencyTone(120, 60, true)).toBe('warn');
    expect(latencyTone(121, 60, true)).toBe('bad');
  });

  it('still judges the browser\u2019s own one-way figure against the one-way limit', () => {
    expect(latencyTone(30, 60, false)).toBe('good');
    expect(latencyTone(50, 60, false)).toBe('warn');
    expect(latencyTone(61, 60, false)).toBe('bad');
  });

  it('follows a threshold the member has changed', () => {
    expect(latencyTone(63.2, 30, true)).toBe('bad');
    expect(latencyTone(63.2, 100, true)).toBe('good');
  });
});

describe('a click that never rises above the room', () => {
  /*
   * Measured on one Mac, same speaker and volume, minutes apart: Chrome
   * 0.0507 and Firefox 0.0524 against rooms of 0.0050 and 0.0030; Safari
   * 0.0035 against a room of 0.0034.
   */
  it('recognises the Safari case and not the other two', () => {
    expect(looksRemoved(0.0035, 0.0034)).toBe(true);
    expect(looksRemoved(0.0507, 0.0050)).toBe(false);
    expect(looksRemoved(0.0524, 0.0030)).toBe(false);
  });

  it('does not mistake a merely quiet click for a removed one', () => {
    // Four times the room: quiet, worth turning the volume up for, present.
    expect(looksRemoved(0.0120, 0.0030)).toBe(false);
  });

  it('says nothing when there is no signal at all to judge', () => {
    expect(looksRemoved(0, 0.0030)).toBe(false);
  });
});
