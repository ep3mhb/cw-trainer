/**
 * CW element timing — PARIS standard with Farnsworth spacing.
 *
 * Pure arithmetic, no audio and no clock. Everything the audio engine
 * schedules is derived from here, which is what makes acceptance
 * criterion 1 ("element timing accurate and stable") testable without
 * a browser.
 *
 * RFP §3: "dit length in milliseconds equals 1200 divided by WPM".
 * RFP §4: "Character speed and effective speed are separate settings."
 */

import { patternFor, tokenize } from './morse';

export interface TimingSettings {
  /** Speed the characters themselves are sent at, in WPM. */
  characterWpm: number;
  /**
   * Overall speed including the padded gaps, in WPM. Must be <= character
   * speed; equal values give standard (non-Farnsworth) timing.
   */
  effectiveWpm: number;
  /**
   * Dah length as a multiple of a dit. 3 is standard; higher values make a
   * "heavy" fist, lower a light one (RFP §3: adjustable weighting).
   */
  weighting: number;
}

export const DEFAULT_TIMING: Readonly<TimingSettings> = Object.freeze({
  characterWpm: 18,
  effectiveWpm: 8,
  weighting: 3,
});

/** Resolved millisecond durations for every element and gap. */
export interface ElementDurations {
  ditMs: number;
  dahMs: number;
  /** Gap between elements inside one character — always one dit. */
  intraCharGapMs: number;
  /** Gap between characters — 3 units, stretched by Farnsworth. */
  interCharGapMs: number;
  /** Gap between words — 7 units, stretched by Farnsworth. */
  interWordGapMs: number;
}

/** dit length in ms from the PARIS standard. */
export function ditMs(wpm: number): number {
  if (!(wpm > 0)) throw new RangeError(`WPM must be positive, got ${wpm}`);
  return 1200 / wpm;
}

/**
 * Farnsworth padding.
 *
 * The standard derivation: a PARIS word at character speed c takes
 * 60/c seconds of which 37.2/c is the characters themselves at that speed,
 * so the total delay to distribute across one word is
 *
 *     ta = (60c - 37.2e) / (ce)   seconds
 *
 * spread over the 19 delay units in a word (3 units x 4 inter-character
 * gaps + 7 units of word gap). With e === c this collapses to exactly one
 * dit per unit, i.e. standard timing — asserted in the unit tests.
 */
export function farnsworthUnitMs(characterWpm: number, effectiveWpm: number): number {
  if (!(characterWpm > 0)) throw new RangeError(`character WPM must be positive, got ${characterWpm}`);
  if (!(effectiveWpm > 0)) throw new RangeError(`effective WPM must be positive, got ${effectiveWpm}`);
  const e = Math.min(effectiveWpm, characterWpm);
  const totalDelaySec = (60 * characterWpm - 37.2 * e) / (characterWpm * e);
  return (totalDelaySec / 19) * 1000;
}

/** Resolve a settings object into concrete millisecond durations. */
export function durations(settings: TimingSettings): ElementDurations {
  const { characterWpm, effectiveWpm, weighting } = settings;
  if (!(weighting > 0)) throw new RangeError(`weighting must be positive, got ${weighting}`);
  const dit = ditMs(characterWpm);
  const unit = farnsworthUnitMs(characterWpm, effectiveWpm);
  return {
    ditMs: dit,
    dahMs: dit * weighting,
    intraCharGapMs: dit,
    interCharGapMs: 3 * unit,
    interWordGapMs: 7 * unit,
  };
}

/** One scheduled tone: when it starts and how long it sounds. */
export interface ToneEvent {
  /** Offset from the start of the message, in milliseconds. */
  atMs: number;
  durationMs: number;
  /** Which element this is, for the visual comparison in RFP §5. */
  element: 'dit' | 'dah';
  /** Index into the token list, so the UI can highlight as it plays. */
  tokenIndex: number;
}

export interface Schedule {
  tones: ToneEvent[];
  /** End of the last tone, in ms from zero. */
  totalMs: number;
  /**
   * Including the gap that follows the last character (a word gap where the
   * message ends in a space). This is the figure that makes "PARIS " come
   * to exactly 50 units, so it is the one used for speed arithmetic.
   */
  paddedMs: number;
  /** The tokens actually scheduled, after tokenizing and dropping unknowns. */
  tokens: string[];
}

/**
 * Turn a message into an absolute tone schedule, in milliseconds from zero.
 *
 * The audio engine adds a start time from the Web Audio clock and schedules
 * each tone at `startTime + atMs / 1000`. No timer is involved in the
 * timing itself (RFP §3, acceptance criterion 3).
 */
export function schedule(message: string, settings: TimingSettings): Schedule {
  const d = durations(settings);
  const tokens = tokenize(message);
  const tones: ToneEvent[] = [];
  let cursor = 0;
  /** Gap owed before the next character; also the trailing gap at the end. */
  let gapBeforeNext = 0;

  tokens.forEach((token, tokenIndex) => {
    if (token === ' ') {
      if (tones.length > 0) gapBeforeNext = d.interWordGapMs;
      return;
    }
    const pattern = patternFor(token);
    if (pattern === undefined) return;
    if (tones.length > 0) cursor += gapBeforeNext;
    for (let i = 0; i < pattern.length; i += 1) {
      const isDah = pattern[i] === '-';
      const durationMs = isDah ? d.dahMs : d.ditMs;
      tones.push({ atMs: cursor, durationMs, element: isDah ? 'dah' : 'dit', tokenIndex });
      cursor += durationMs;
      if (i < pattern.length - 1) cursor += d.intraCharGapMs;
    }
    gapBeforeNext = d.interCharGapMs;
  });

  return { tones, totalMs: cursor, paddedMs: cursor + (tones.length > 0 ? gapBeforeNext : 0), tokens };
}

/**
 * Turn a bare timing stream back into something the audio engine will play.
 *
 * The final exam arrives from the server as intervals and nothing else \u2014 no
 * characters, no dit/dah labels, no character boundaries \u2014 so that the
 * answers are not sitting in the response the browser is being asked to
 * answer (docs/PHASE3-COURSE-EXAM.md \u00a74). The engine only reads `atMs` and
 * `durationMs`; the other two fields exist for the on-screen highlight, which
 * an exam deliberately does not have.
 */
export function scheduleFromTones(
  tones: readonly { atMs: number; durationMs: number }[],
): Schedule {
  const events: ToneEvent[] = tones.map((t) => ({
    atMs: t.atMs,
    durationMs: t.durationMs,
    // Honest placeholders: nothing reads these during an exam, and deriving
    // them here would reconstruct locally what the server took care not to
    // send.
    element: 'dit',
    tokenIndex: 0,
  }));
  const last = events[events.length - 1];
  const totalMs = last === undefined ? 0 : last.atMs + last.durationMs;
  return { tones: events, totalMs, paddedMs: totalMs, tokens: [] };
}

/**
 * Effective speed actually achieved by a message, in WPM.
 *
 * Used for the progress charts in RFP §4 and to verify a recorded session
 * against the PARIS figure.
 */
export function effectiveWpmOf(message: string, settings: TimingSettings): number {
  const { paddedMs, tokens } = schedule(message, settings);
  const characters = tokens.filter((t) => t !== ' ').length;
  if (characters === 0 || paddedMs === 0) return 0;
  // A PARIS word is 5 characters, 50 dit-units at the nominal speed.
  const words = characters / 5;
  return (words / (paddedMs / 1000)) * 60;
}
