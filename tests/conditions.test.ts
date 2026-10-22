/**
 * Receive drills under real conditions (RFD A39).
 *
 * The amendment makes testability a condition rather than a nicety: "all
 * randomness is drawn from the seeded generator the application already
 * uses for its sessions, so any session can be replayed exactly — which is
 * what makes these conditions testable rather than merely plausible". So
 * every test here runs from a fixed seed, and the properties asserted are
 * the ones a learner would complain about if they broke: that off is
 * silent, that the sending stays copyable, and that nothing ever vanishes.
 */

import { describe, expect, it } from 'vitest';
import {
  CONDITIONS_UNLOCK_AT,
  DEFAULT_CONDITIONS,
  conditionsActive,
  conditionsAvailable,
  fadingCurve,
  handSent,
  recordedLevel,
  secondStationVoice,
  staticSamples,
  type ConditionSettings,
} from '../src/core/conditions';
import { seeded } from '../src/core/random';
import { schedule } from '../src/core/timing';

const TIMING = { characterWpm: 18, effectiveWpm: 8, weighting: 3 };
const clean = (): ReturnType<typeof schedule> => schedule('CQ TEST DE EP2MHB K', TIMING);
const set = (over: Partial<ConditionSettings> = {}): ConditionSettings =>
  ({ ...DEFAULT_CONDITIONS, ...over });

describe('off means off', () => {
  it('leaves the timing untouched', () => {
    const base = clean();
    expect(handSent(base, 'off', seeded(1))).toBe(base);
  });

  it('asks the signal level to do nothing', () => {
    const curve = fadingCurve(10, 'off', seeded(1));
    expect([...curve].every((v) => v === 1)).toBe(true);
  });

  it('produces silence rather than quiet static', () => {
    const s = staticSamples(1, 8000, 'off', seeded(1));
    expect([...s].every((v) => v === 0)).toBe(true);
  });

  it('puts nobody else on the band', () => {
    expect(secondStationVoice(600, 'off', seeded(1))).toBeNull();
  });

  /*
   * The level and the four switches can disagree. A member who set strong
   * and then turned all four off must be recorded as having worked clean,
   * or the figures A39 exists to keep honest become dishonest in the other
   * direction.
   */
  it('counts a level with nothing switched on as off', () => {
    const none = set({ level: 'strong', fading: false, static: false, secondStation: false, hand: false });
    expect(conditionsActive(none)).toBe(false);
    expect(recordedLevel(none)).toBe('off');
  });

  it('counts one condition on as on', () => {
    const one = set({ level: 'mild', fading: true, static: false, secondStation: false, hand: false });
    expect(conditionsActive(one)).toBe(true);
    expect(recordedLevel(one)).toBe('mild');
  });

  it('is off by default, whatever the switches say', () => {
    expect(DEFAULT_CONDITIONS.level).toBe('off');
    expect(conditionsActive(DEFAULT_CONDITIONS)).toBe(false);
  });
});

describe('the same seed gives the same conditions', () => {
  it('fades identically', () => {
    expect([...fadingCurve(20, 'strong', seeded(7))]).toEqual([...fadingCurve(20, 'strong', seeded(7))]);
  });

  it('crashes identically', () => {
    expect([...staticSamples(0.5, 8000, 'strong', seeded(7))])
      .toEqual([...staticSamples(0.5, 8000, 'strong', seeded(7))]);
  });

  it('sends by the same hand', () => {
    const a = handSent(clean(), 'strong', seeded(7));
    const b = handSent(clean(), 'strong', seeded(7));
    expect(a.tones).toEqual(b.tones);
  });

  it('and differently from another seed', () => {
    const a = handSent(clean(), 'strong', seeded(7));
    const b = handSent(clean(), 'strong', seeded(8));
    expect(a.tones).not.toEqual(b.tones);
  });
});

describe('fading', () => {
  it('never takes the signal away altogether', () => {
    // A signal that vanishes is a dropout, not a fade, and copying through
    // one teaches guessing. The bound is the depth: strong fades to 0.30 of
    // full and no further, so this asserts the depth rather than a clamp.
    for (const seed of [1, 2, 3, 99, 12345]) {
      const curve = fadingCurve(60, 'strong', seeded(seed));
      expect(Math.min(...curve)).toBeGreaterThanOrEqual(0.29);
    }
  });

  it('never makes the signal louder than it was sent', () => {
    const curve = fadingCurve(60, 'strong', seeded(3));
    expect(Math.max(...curve)).toBeLessThanOrEqual(1);
  });

  it('fades deeper at strong than at mild', () => {
    const mild = fadingCurve(120, 'mild', seeded(5));
    const strong = fadingCurve(120, 'strong', seeded(5));
    expect(Math.min(...strong)).toBeLessThan(Math.min(...mild));
  });

  it('moves slowly enough to be a fade rather than a tremolo', () => {
    // No more than a few per cent of the signal per 50 ms step; a jump
    // bigger than that is heard as a wobble in the tone.
    const curve = fadingCurve(60, 'strong', seeded(11));
    let worst = 0;
    for (let i = 1; i < curve.length; i += 1) {
      worst = Math.max(worst, Math.abs((curve[i] as number) - (curve[i - 1] as number)));
    }
    expect(worst).toBeLessThan(0.05);
  });
});

describe('static', () => {
  it('stays inside the range a sample may take', () => {
    const s = staticSamples(2, 8000, 'strong', seeded(4));
    expect(Math.max(...s)).toBeLessThanOrEqual(1);
    expect(Math.min(...s)).toBeGreaterThanOrEqual(-1);
  });

  it('is louder and busier at strong than at mild', () => {
    const rms = (x: Float32Array): number =>
      Math.sqrt([...x].reduce((a, v) => a + v * v, 0) / x.length);
    expect(rms(staticSamples(4, 8000, 'strong', seeded(4))))
      .toBeGreaterThan(rms(staticSamples(4, 8000, 'mild', seeded(4))));
  });

  it('crashes over the floor rather than sitting at it', () => {
    // What makes static static: a quiet bed with peaks well above it.
    const s = staticSamples(6, 8000, 'mild', seeded(4));
    const peak = Math.max(...[...s].map(Math.abs));
    const rms = Math.sqrt([...s].reduce((a, v) => a + v * v, 0) / s.length);
    expect(peak / rms).toBeGreaterThan(4);
  });
});

describe('the second station', () => {
  it('sits a few hundred hertz away, not on top of us', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const v = secondStationVoice(600, 'mild', seeded(seed));
      expect(Math.abs((v?.pitchHz ?? 600) - 600)).toBeGreaterThanOrEqual(190);
    }
  });

  it('stays inside the audible band even from an extreme pitch', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const ours of [300, 1000]) {
        const v = secondStationVoice(ours, 'strong', seeded(seed));
        expect(v?.pitchHz).toBeGreaterThanOrEqual(250);
        expect(v?.pitchHz).toBeLessThanOrEqual(1200);
      }
    }
  });

  it('is weaker than the station being copied', () => {
    expect(secondStationVoice(600, 'strong', seeded(2))?.gain).toBeLessThan(1);
    expect(secondStationVoice(600, 'mild', seeded(2))?.gain).toBeLessThan(0.3);
  });

  it('sends at its own speed', () => {
    // Two stations at identical speed blur into one, and the learner never
    // learns to hold on to the one they want.
    const v = secondStationVoice(600, 'mild', seeded(2));
    expect(v?.wpm).toBeGreaterThanOrEqual(14);
    expect(v?.wpm).toBeLessThanOrEqual(26);
  });
});

describe('a hand at the key', () => {
  it('sends the same elements, in the same order', () => {
    const base = clean();
    const hand = handSent(base, 'strong', seeded(13));
    expect(hand.tones).toHaveLength(base.tones.length);
    expect(hand.tones.map((t) => t.element)).toEqual(base.tones.map((t) => t.element));
    expect(hand.tokens).toEqual(base.tokens);
  });

  it('keeps every dah longer than every dit, so it is still copyable', () => {
    // The limit A39 asks for. A fist that lets a dah fall to the length of
    // a dit is not a fist, it is a different message.
    for (const seed of [1, 5, 23, 404]) {
      const hand = handSent(clean(), 'strong', seeded(seed));
      const dits = hand.tones.filter((t) => t.element === 'dit').map((t) => t.durationMs);
      const dahs = hand.tones.filter((t) => t.element === 'dah').map((t) => t.durationMs);
      expect(Math.max(...dits)).toBeLessThan(Math.min(...dahs));
    }
  });

  /*
   * The slider goes down to 2, where a dah is only twice a dit. An earlier
   * version applied the operator's weighting to the dah and its reciprocal
   * to the dit, squeezing from both ends, and left three per cent between
   * the longest dit and the shortest dah here.
   */
  it('stays copyable even at the lightest weighting the slider allows', () => {
    const light = schedule('CQ TEST DE EP2MHB K', { ...TIMING, weighting: 2 });
    for (const seed of [1, 5, 23, 404, 8080]) {
      const hand = handSent(light, 'strong', seeded(seed));
      const dits = hand.tones.filter((t) => t.element === 'dit').map((t) => t.durationMs);
      const dahs = hand.tones.filter((t) => t.element === 'dah').map((t) => t.durationMs);
      // A MARGIN, not merely an ordering. Applying the operator's weighting
      // to the dah and its reciprocal to the dit squeezes from both ends and
      // leaves about three per cent here — technically ordered, and far too
      // close for an ear to call. A quarter is a gap a learner can hear.
      expect(Math.min(...dahs)).toBeGreaterThan(Math.max(...dits) * 1.25);
    }
  });

  it('never overlaps two elements or sends one backwards', () => {
    const hand = handSent(clean(), 'strong', seeded(21));
    for (let i = 1; i < hand.tones.length; i += 1) {
      const prev = hand.tones[i - 1] as { atMs: number; durationMs: number };
      const here = hand.tones[i] as { atMs: number };
      expect(here.atMs).toBeGreaterThanOrEqual(prev.atMs + prev.durationMs);
    }
    expect(hand.tones.every((t) => t.durationMs > 0)).toBe(true);
  });

  it('keeps the message roughly its intended length', () => {
    // A fist that drifts steadily slower is realistic, but it would make
    // the speed setting a lie: a learner who asks for 18 WPM gets 18.
    const base = clean();
    for (const seed of [2, 44, 777]) {
      const hand = handSent(base, 'strong', seeded(seed));
      expect(hand.totalMs).toBeGreaterThan(base.totalMs * 0.88);
      expect(hand.totalMs).toBeLessThan(base.totalMs * 1.12);
    }
  });

  it('wavers more at strong than at mild', () => {
    const base = clean();
    const spread = (s: ReturnType<typeof schedule>): number => {
      const dits = s.tones.filter((t) => t.element === 'dit').map((t) => t.durationMs);
      return Math.max(...dits) - Math.min(...dits);
    };
    expect(spread(handSent(base, 'strong', seeded(9))))
      .toBeGreaterThan(spread(handSent(base, 'mild', seeded(9))));
  });
});

describe('when conditions are offered at all', () => {
  it('is not offered to a beginner', () => {
    // Somebody still struggling with K and M is not helped by static.
    expect(conditionsAvailable(2)).toBe(false);
    expect(conditionsAvailable(CONDITIONS_UNLOCK_AT - 1)).toBe(false);
  });

  it('is offered once ten characters are unlocked', () => {
    expect(conditionsAvailable(CONDITIONS_UNLOCK_AT)).toBe(true);
    expect(conditionsAvailable(40)).toBe(true);
  });
});
