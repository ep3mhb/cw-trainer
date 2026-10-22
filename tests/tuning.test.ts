/**
 * The virtual band (RFP §7).
 *
 * §7's requirement is behavioural — "a tuning interface, not a list of
 * available users" — so the tests are behavioural too. The one that matters
 * most is that a member can tune past a station and not hear it, because that
 * is the property a list cannot have and the reason §7 asks for a band at all.
 */

import { describe, expect, it } from 'vitest';
import {
  AUDIBLE_FLOOR, DEFAULT_BAND_PLAN, bandScan, clearSpot, describeSignal, formatFrequency,
  isClear, nextSignal, receptionOf, snap, tune, zeroBeatError, type Station,
} from '../src/core/tuning';
import { DEFAULT_BAND, BAND_PRESETS } from '../src/core/band';
import { seeded } from '../src/core/random';

const station = (over: Partial<Station> & { frequencyHz: number }): Station => ({
  id: over.callsign ?? 'p1',
  callsign: 'G4ABC',
  strength: 0.8,
  transmitting: false,
  calling: true,
  ...over,
});

const RX = { dialHz: 7_018_000, pitchHz: 600 };
const QUIET = { ...DEFAULT_BAND, noise: 0.05, filterHz: 500 };

describe('tuning', () => {
  it('sounds a zero-beat station at the pitch the member chose', () => {
    const r = receptionOf(station({ frequencyHz: 7_018_000 }), RX, QUIET);
    expect(r.audioHz).toBe(600);
    expect(r.offsetHz).toBe(0);
    expect(r.attenuation).toBe(1);
    expect(r.audible).toBe(true);
  });

  it('raises the pitch as the dial goes low, which is what zero-beating is', () => {
    const them = station({ frequencyHz: 7_018_000 });
    const low = receptionOf(them, { ...RX, dialHz: 7_017_800 }, QUIET);
    const high = receptionOf(them, { ...RX, dialHz: 7_018_200 }, QUIET);
    expect(low.audioHz).toBe(800);
    expect(high.audioHz).toBe(400);
    expect(zeroBeatError(them, { ...RX, dialHz: 7_017_800 })).toBe(200);
  });

  it('lets a station fade rather than vanish as the dial moves off it', () => {
    const them = station({ frequencyHz: 7_018_000 });
    const levels = [0, 300, 500, 700, 900].map(
      (off) => receptionOf(them, { ...RX, dialHz: 7_018_000 - off }, QUIET).level,
    );
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]).toBeLessThan(levels[i - 1]!);
    }
    expect(levels[0]).toBeGreaterThan(0.7);
  });

  it('lets a member tune straight past a weak station — the point of a band', () => {
    const weak = station({ frequencyHz: 7_030_000, strength: 0.5 });
    const onIt = receptionOf(weak, { ...RX, dialHz: 7_030_000 }, QUIET);
    const pastIt = receptionOf(weak, { ...RX, dialHz: 7_026_000 }, QUIET);
    expect(onIt.audible).toBe(true);
    expect(pastIt.audible).toBe(false);
    expect(pastIt.level).toBeLessThan(AUDIBLE_FLOOR);
  });

  it('separates two stations 300 Hz apart by pitch', () => {
    const stations = [
      station({ id: 'a', callsign: 'G4ABC', frequencyHz: 7_018_000 }),
      station({ id: 'b', callsign: 'A65XY', frequencyHz: 7_018_300 }),
    ];
    const heard = bandScan(stations, RX, QUIET);
    expect(heard).toHaveLength(2);
    expect(heard.map((r) => r.audioHz).sort((x, y) => x - y)).toEqual([600, 900]);
  });

  it('makes a narrow filter a real defence against the neighbour', () => {
    const neighbour = station({ frequencyHz: 7_018_400 });
    const wide = receptionOf(neighbour, RX, { ...QUIET, filterHz: 1000 });
    const narrow = receptionOf(neighbour, RX, { ...QUIET, filterHz: 250 });
    expect(narrow.level).toBeLessThan(wide.level / 2);
  });

  it('buries a weak station when the band is poor and not when it is quiet', () => {
    const them = station({ frequencyHz: 7_018_000, strength: 0.12 });
    expect(receptionOf(them, RX, BAND_PRESETS.quiet).snrDb).toBeGreaterThan(0);
    expect(receptionOf(them, RX, BAND_PRESETS.poor).snrDb).toBeLessThan(0);
  });

  it('drops a signal that falls outside the audio range entirely', () => {
    const them = station({ frequencyHz: 7_018_000 });
    const miles = receptionOf(them, { ...RX, dialHz: 7_014_000 }, QUIET);
    expect(miles.audioHz).toBe(4600);
    expect(miles.audible).toBe(false);
  });

  it('snaps the dial to the step and holds it inside the band', () => {
    expect(snap(7_018_004)).toBe(7_018_000);
    expect(snap(7_018_006)).toBe(7_018_010);
    expect(snap(6_000_000)).toBe(DEFAULT_BAND_PLAN.startHz);
    expect(snap(9_000_000)).toBe(DEFAULT_BAND_PLAN.endHz);
    expect(tune(7_018_000, -3)).toBe(7_017_970);
  });

  it('keeps a CQ spot clear of everyone already on the band', () => {
    const busy: Station[] = [7_005_000, 7_010_000, 7_020_000].map((hz) => station({ frequencyHz: hz }));
    expect(isClear(7_005_100, busy)).toBe(false);
    expect(isClear(7_005_300, busy)).toBe(true);
    const spot = clearSpot(busy, seeded(7));
    expect(spot).not.toBeNull();
    expect(isClear(spot!, busy)).toBe(true);
  });

  it('gives up honestly when the band has no room left', () => {
    const packed: Station[] = [];
    for (let hz = DEFAULT_BAND_PLAN.startHz; hz <= DEFAULT_BAND_PLAN.endHz; hz += 100) {
      packed.push(station({ id: String(hz), frequencyHz: hz }));
    }
    expect(clearSpot(packed, seeded(1))).toBeNull();
  });

  it('scans to the next audible signal and skips the ones that are not', () => {
    const stations = [
      station({ id: 'a', frequencyHz: 7_012_000, strength: 0.9 }),
      station({ id: 'b', frequencyHz: 7_022_000, strength: 0.001 }),
      station({ id: 'c', frequencyHz: 7_026_000, strength: 0.9 }),
    ];
    expect(nextSignal(stations, RX, QUIET, 1)?.id).toBe('c');
    expect(nextSignal(stations, RX, QUIET, -1)?.id).toBe('a');
    expect(nextSignal(stations, { ...RX, dialHz: 7_038_000 }, QUIET, 1)).toBeNull();
  });

  it('writes a frequency the way an operator says it', () => {
    expect(formatFrequency(7_018_500)).toBe('7 018.50 kHz');
    expect(formatFrequency(7_000_000)).toBe('7 000.00 kHz');
  });

  it('describes a signal in words a new member can act on', () => {
    const strong = receptionOf(station({ frequencyHz: 7_018_000 }), RX, QUIET);
    const weak = receptionOf(
      station({ frequencyHz: 7_018_000, strength: 0.08 }), RX, BAND_PRESETS.poor,
    );
    const absent = receptionOf(
      station({ frequencyHz: 7_018_000, strength: 0.005 }), RX, BAND_PRESETS.poor,
    );
    expect(describeSignal(strong)).toBe('loud and clear');
    expect(describeSignal(weak)).toBe('weak, in the noise');
    expect(describeSignal(absent)).toBe('nothing there');
  });
});
