/**
 * Receive drills under real conditions (RFD A39).
 *
 * Every drill this application has ever sent has been a perfect signal: a
 * steady tone at a constant level, nothing behind it, nothing else on the
 * frequency, and timing exact to the millisecond because a machine made it.
 * Nothing on the air is like that, and a learner who copies this cleanly
 * meets all four departures at once on their first evening and concludes
 * that they cannot copy after all.
 *
 * Everything here is PURE and SEEDED. The audio graph consumes the numbers
 * these functions return; it does not invent any of its own. That is what
 * makes a session with conditions replayable, and the difference between
 * testing these and merely listening to them. The amendment makes it a
 * condition: "all randomness is drawn from the seeded generator the
 * application already uses for its sessions, so any session can be replayed
 * exactly".
 */

import type { Random } from './random';
import type { Schedule, ToneEvent } from './timing';

export type ConditionLevel = 'off' | 'mild' | 'strong';

/**
 * What a learner has chosen. One level for all four, with each adjustable
 * beneath it for anyone who wants to work against one alone (A39).
 */
export interface ConditionSettings {
  level: ConditionLevel;
  fading: boolean;
  static: boolean;
  secondStation: boolean;
  hand: boolean;
}

export const DEFAULT_CONDITIONS: Readonly<ConditionSettings> = Object.freeze({
  // Off until a learner asks for it, and not offered at all before ten
  // characters. A beginner still struggling with K and M is not helped by
  // static.
  level: 'off',
  fading: true,
  static: true,
  secondStation: true,
  hand: true,
});

/** Conditions are not offered until this much of the course is unlocked. */
export const CONDITIONS_UNLOCK_AT = 10;

export function conditionsAvailable(unlocked: number): boolean {
  return unlocked >= CONDITIONS_UNLOCK_AT;
}

/**
 * Whether anything at all will be heard differently.
 *
 * Used to decide what gets recorded against a session and whether the audio
 * graph is built at all, so it has to agree with the ear: a level of mild
 * with every condition switched off is off.
 */
export function conditionsActive(c: ConditionSettings): boolean {
  if (c.level === 'off') return false;
  return c.fading || c.static || c.secondStation || c.hand;
}

/** The level recorded against a session, which is 'off' unless something sounds. */
export function recordedLevel(c: ConditionSettings): ConditionLevel {
  return conditionsActive(c) ? c.level : 'off';
}

/* ------------------------------------------------------------------ *
 * The four conditions, as numbers.
 * ------------------------------------------------------------------ */

interface Depths {
  /** Fading: how far below full the signal goes at its deepest, 0..1. */
  fadeDepth: number;
  /** Fading: roughly how many seconds one cycle takes. */
  fadePeriodS: number;
  /** Static: the steady floor, as a fraction of the signal. */
  noiseFloor: number;
  /** Static: how loud a crash is, as a fraction of the signal. */
  crashPeak: number;
  /** Static: crashes per second, on average. */
  crashesPerS: number;
  /** The second station's level, as a fraction of ours. */
  otherLevel: number;
  /** Hand: how much an element's length varies, as a fraction. */
  jitter: number;
  /** Hand: how far the dit/dah weighting drifts, as a fraction. */
  weightDrift: number;
}

/**
 * Mild is "a decent signal on a quiet evening". Strong is "worth copying
 * but you will have to work". Neither is "impossible", because a drill
 * nobody can copy teaches nothing — the amendment asks for variation "held
 * inside limits that keep the sending copyable".
 */
const DEPTHS: Readonly<Record<Exclude<ConditionLevel, 'off'>, Depths>> = Object.freeze({
  mild: {
    fadeDepth: 0.35, fadePeriodS: 9,
    noiseFloor: 0.05, crashPeak: 0.30, crashesPerS: 0.6,
    otherLevel: 0.18,
    jitter: 0.08, weightDrift: 0.06,
  },
  strong: {
    fadeDepth: 0.70, fadePeriodS: 5,
    noiseFloor: 0.12, crashPeak: 0.65, crashesPerS: 1.8,
    otherLevel: 0.34,
    jitter: 0.18, weightDrift: 0.14,
  },
});

export function depthsFor(level: ConditionLevel): Depths | null {
  return level === 'off' ? null : DEPTHS[level];
}

/**
 * Fading: a slow, smooth variation in the level of the signal.
 *
 * Three sine components at unrelated periods rather than one, because a
 * single sine is heard as a tremolo and real fading is not periodic in any
 * way the ear can latch on to. Returned as a curve of gain multipliers at a
 * fixed interval, which is what `AudioParam.setValueCurveAtTime` wants.
 *
 * Never reaches zero, and the bound is the depth itself rather than a
 * clamp: the curve runs between 1 - fadeDepth and 1, so keeping every
 * fadeDepth below one is what keeps the signal present. A signal that
 * vanishes entirely is not a fade but a dropout, and copying through one
 * teaches guessing rather than copying. (An earlier version also clamped
 * at 0.08. It never once bound at these depths — reverting it failed no
 * test — so it was a comfort rather than a safeguard and is gone.)
 */
export function fadingCurve(
  durationS: number,
  level: ConditionLevel,
  rnd: Random,
  stepS = 0.05,
): Float32Array {
  const d = depthsFor(level);
  const steps = Math.max(2, Math.ceil(durationS / stepS) + 1);
  const curve = new Float32Array(steps);
  if (d === null) { curve.fill(1); return curve; }

  // Three periods around the nominal one, and three phases, all drawn once
  // so the whole fade is a function of the seed.
  const periods = [d.fadePeriodS, d.fadePeriodS * 1.7, d.fadePeriodS * 0.43]
    .map((p) => p * (0.8 + rnd.next() * 0.4));
  const phases = [rnd.next(), rnd.next(), rnd.next()].map((x) => x * Math.PI * 2);
  const weights = [0.6, 0.27, 0.13];

  for (let i = 0; i < steps; i += 1) {
    const t = i * stepS;
    let sum = 0;
    for (let k = 0; k < 3; k += 1) {
      sum += (weights[k] as number) * Math.sin((2 * Math.PI * t) / (periods[k] as number) + (phases[k] as number));
    }
    // sum is about -1..1; map to 1-depth .. 1 and never below a usable floor.
    const gain = 1 - d.fadeDepth * ((1 - sum) / 2);
    curve[i] = Math.min(1, gain);
  }
  return curve;
}

/**
 * Static: short crashes over a low floor.
 *
 * Returned as raw samples for an AudioBuffer rather than as an envelope,
 * because the character of static is in the samples: a floor of white noise
 * with occasional crashes that rise fast and decay over a few tens of
 * milliseconds, which is what an HF receiver actually delivers.
 */
export function staticSamples(
  durationS: number,
  sampleRate: number,
  level: ConditionLevel,
  rnd: Random,
): Float32Array {
  const n = Math.max(1, Math.round(durationS * sampleRate));
  const out = new Float32Array(n);
  const d = depthsFor(level);
  if (d === null) return out;

  for (let i = 0; i < n; i += 1) out[i] = (rnd.next() * 2 - 1) * d.noiseFloor;

  // Crashes, placed by drawing gaps from the mean rate rather than by
  // testing every sample: the same distribution, a few thousand times less
  // arithmetic, and reproducible from the seed either way.
  let at = 0;
  while (at < n) {
    const gapS = -Math.log(1 - rnd.next()) / d.crashesPerS;
    at += Math.max(1, Math.round(gapS * sampleRate));
    if (at >= n) break;
    const lenS = 0.01 + rnd.next() * 0.05;
    const len = Math.round(lenS * sampleRate);
    const peak = d.crashPeak * (0.5 + rnd.next() * 0.5);
    for (let i = 0; i < len && at + i < n; i += 1) {
      const decay = Math.exp(-5 * (i / len));
      out[at + i] = (out[at + i] as number) + (rnd.next() * 2 - 1) * peak * decay;
    }
    at += len;
  }
  for (let i = 0; i < n; i += 1) out[i] = Math.max(-1, Math.min(1, out[i] as number));
  return out;
}

/**
 * The second station: how far off frequency, and how loud.
 *
 * A few hundred hertz away, which is where an interfering CW station
 * actually sits — close enough to be inside the filter and genuinely
 * distracting, far enough that the ear can separate the two if it learns
 * how. Learning how is the point.
 */
export function secondStationVoice(
  ourPitchHz: number,
  level: ConditionLevel,
  rnd: Random,
): { pitchHz: number; gain: number; wpm: number } | null {
  const d = depthsFor(level);
  if (d === null) return null;
  const offset = (200 + rnd.next() * 350) * (rnd.next() < 0.5 ? -1 : 1);
  return {
    // Kept inside the audible band whatever our own pitch is.
    pitchHz: Math.max(250, Math.min(1200, ourPitchHz + offset)),
    gain: d.otherLevel,
    // A different speed, because two stations at identical speed blur into
    // one and the learner never learns to hold on to the one they want.
    wpm: Math.round(14 + rnd.next() * 12),
  };
}

/**
 * A hand at the key: small variation in element lengths, in the gaps
 * between them, and in the dit/dah weighting.
 *
 * A pure transform of a Schedule, which is the reason the hand is the
 * easiest of the four to be sure about: the result is numbers that can be
 * compared against the clean schedule in a test rather than listened to.
 *
 * The whole message is kept to roughly its original length. A fist that
 * drifts steadily slower would also be realistic, but it would make the
 * speed setting a lie, and a learner who sets 18 WPM is entitled to get it.
 */
/**
 * The most an element's length may waver before a dah stops being audibly
 * a dah.
 *
 * The configured jitter assumes the standard fist, where a dah is three
 * dits. The weighting slider goes down to two, and there a strong jitter of
 * eighteen per cent leaves the shortest dah only about a fifth longer than
 * the longest dit — ordered on paper and far too close for an ear to call.
 * So the jitter is bounded by the weighting actually in use: the shortest
 * dah this message can produce must stay at least SAFE_RATIO times the
 * longest dit.
 *
 * At the standard weighting of three this allows about thirty per cent and
 * so changes nothing; at two it brings a strong fist down to about ten. The
 * member asked for a hand at the key, not for a message they cannot read.
 */
const SAFE_RATIO = 1.4;

function safeJitter(base: Schedule, d: Depths): number {
  const dits = base.tones.filter((t) => t.element === 'dit');
  const dahs = base.tones.filter((t) => t.element === 'dah');
  const dit = dits[0]?.durationMs;
  const dah = dahs[0]?.durationMs;
  // A message of all dits or all dahs has no ratio to protect.
  if (dit === undefined || dah === undefined || dit <= 0) return d.jitter;

  const shortestDahFactor = (dah / dit) * (1 - d.weightDrift);
  if (shortestDahFactor <= SAFE_RATIO) return 0;
  // Solve W(1-j) >= SAFE(1+j) for j.
  const allowed = (shortestDahFactor - SAFE_RATIO) / (shortestDahFactor + SAFE_RATIO);
  return Math.min(d.jitter, Math.max(0, allowed));
}

export function handSent(base: Schedule, level: ConditionLevel, rnd: Random): Schedule {
  const d = depthsFor(level);
  if (d === null) return base;

  /*
   * One operator, one habit: their weighting is drawn once for the message
   * rather than per element. An operator whose dahs are long has long dahs
   * all evening.
   *
   * Applied to the dah ALONE rather than as weight to the dah and its
   * reciprocal to the dit, because a heavy fist is long dahs. Note that
   * this is a simplification and not the safeguard it first looks like:
   * reverting it to the reciprocal form fails no test, because what
   * actually protects the dit/dah margin is safeJitter below. Said plainly
   * so the next reader does not mistake one for the other.
   */
  const weight = 1 + (rnd.next() * 2 - 1) * d.weightDrift;
  const jitter = safeJitter(base, d);
  const vary = (): number => 1 + (rnd.next() * 2 - 1) * jitter;

  const tones: ToneEvent[] = [];
  let shift = 0;      // how far the message has drifted from the clean one
  let prevEnd = 0;    // end of the previous tone in the CLEAN schedule

  for (const [i, tone] of base.tones.entries()) {
    const cleanGap = i === 0 ? 0 : tone.atMs - prevEnd;
    prevEnd = tone.atMs + tone.durationMs;

    const gap = cleanGap * vary();
    shift += gap - cleanGap;

    const w = tone.element === 'dah' ? weight : 1;
    const duration = Math.max(8, tone.durationMs * w * vary());
    tones.push({ ...tone, atMs: Math.max(0, tone.atMs + shift), durationMs: duration });
    shift += duration - tone.durationMs;
  }

  const last = tones[tones.length - 1];
  const totalMs = last === undefined ? 0 : last.atMs + last.durationMs;
  return {
    tones,
    totalMs,
    paddedMs: totalMs + (base.paddedMs - base.totalMs),
    tokens: base.tokens,
  };
}
