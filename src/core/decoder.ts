/**
 * Decoder and timing analysis for the student's own sending (RFP §5).
 *
 * Two jobs, deliberately separate:
 *   1. decode()  — what did the student actually send?
 *   2. analyse() — how well did they send it? (dit/dah ratio, spacing,
 *      consistency), because "report timing quality, not only whether the
 *      character was correct".
 *
 * Pure functions over a list of key transitions, so the whole thing is
 * unit-testable without audio or a browser.
 */

import { characterFor, patternFor, tokenize } from './morse';
import { durations, type TimingSettings } from './timing';

/** One key transition. `t` is milliseconds on any monotonic clock. */
export interface KeyEvent {
  down: boolean;
  t: number;
}

/** A completed key closure and the gap that followed it. */
export interface Mark {
  startMs: number;
  durationMs: number;
  kind: 'dit' | 'dah';
}

export interface DecodedCharacter {
  pattern: string;
  /** The decoded character, or '?' where the pattern is not in the table. */
  character: string;
  startMs: number;
  endMs: number;
}

export interface DecodeOptions {
  /**
   * Speed to judge against. When omitted the decoder estimates it from the
   * sending itself, which is what a student practising free-hand needs.
   */
  referenceWpm?: number;
  /**
   * 0 = strict textbook boundaries, 1 = very forgiving. RFP §5: "loose
   * enough for a beginner and tightening as accuracy improves".
   */
  tolerance: number;
}

export const DEFAULT_DECODE: Readonly<DecodeOptions> = Object.freeze({ tolerance: 0.35 });

export interface DecodeResult {
  text: string;
  characters: DecodedCharacter[];
  marks: Mark[];
  /** Gaps between marks, classified. */
  gaps: { durationMs: number; kind: 'element' | 'character' | 'word' }[];
  /** Dit length the decode was based on, in ms. */
  ditMs: number;
  estimatedWpm: number;
}

/** Pair up transitions into closures, ignoring repeats and a trailing down. */
export function marksFrom(events: readonly KeyEvent[]): { startMs: number; durationMs: number }[] {
  const closures: { startMs: number; durationMs: number }[] = [];
  let downAt: number | null = null;
  for (const e of events) {
    if (e.down) {
      if (downAt === null) downAt = e.t;
    } else if (downAt !== null) {
      if (e.t > downAt) closures.push({ startMs: downAt, durationMs: e.t - downAt });
      downAt = null;
    }
  }
  return closures;
}

/**
 * Estimate the dit length from the marks alone, by splitting them into a
 * short and a long cluster (two-means, three passes — enough for the tens
 * of marks a practice session produces, and stable).
 */
export function estimateDitMs(markDurations: readonly number[]): number {
  const values = markDurations.filter((d) => d > 0);
  if (values.length === 0) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  // All one length: either all dits or all dahs. A ratio under 2 means the
  // student sent no dahs, so the marks are dits.
  if (max / min < 2) return values.reduce((a, b) => a + b, 0) / values.length;

  let threshold = (min + max) / 2;
  let shortMean = min;
  for (let pass = 0; pass < 3; pass += 1) {
    const shorts = values.filter((d) => d <= threshold);
    const longs = values.filter((d) => d > threshold);
    if (shorts.length === 0 || longs.length === 0) break;
    shortMean = shorts.reduce((a, b) => a + b, 0) / shorts.length;
    const longMean = longs.reduce((a, b) => a + b, 0) / longs.length;
    threshold = (shortMean + longMean) / 2;
  }
  return shortMean;
}

/** Decode a stream of key transitions into text. */
export function decode(events: readonly KeyEvent[], options: DecodeOptions = DEFAULT_DECODE): DecodeResult {
  const closures = marksFrom(events);
  const tolerance = Math.min(1, Math.max(0, options.tolerance));

  const ditMs =
    options.referenceWpm !== undefined
      ? 1200 / options.referenceWpm
      : estimateDitMs(closures.map((c) => c.durationMs));

  if (closures.length === 0 || ditMs <= 0) {
    return { text: '', characters: [], marks: [], gaps: [], ditMs: 0, estimatedWpm: 0 };
  }

  // Boundaries. Textbook values are 2 dits (dit/dah), 2 dits (element vs
  // character gap) and 5 dits (character vs word gap). Tolerance widens the
  // window in which a mark still counts as the shorter of the two.
  const markBoundary = ditMs * (2 + tolerance);
  const charGapBoundary = ditMs * (2 - tolerance * 0.5);
  const wordGapBoundary = ditMs * (5 - tolerance);

  const marks: Mark[] = closures.map((c) => ({
    startMs: c.startMs,
    durationMs: c.durationMs,
    kind: c.durationMs >= markBoundary ? 'dah' : 'dit',
  }));

  const gaps: DecodeResult['gaps'] = [];
  const characters: DecodedCharacter[] = [];
  let pattern = '';
  let patternStart = marks[0]?.startMs ?? 0;
  let patternEnd = patternStart;
  let text = '';

  const flush = (): void => {
    if (pattern === '') return;
    const character = characterFor(pattern) ?? '?';
    characters.push({ pattern, character, startMs: patternStart, endMs: patternEnd });
    text += character;
    pattern = '';
  };

  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i] as Mark;
    if (pattern === '') patternStart = mark.startMs;
    pattern += mark.kind === 'dah' ? '-' : '.';
    patternEnd = mark.startMs + mark.durationMs;

    const next = marks[i + 1];
    if (next === undefined) break;
    const gapMs = next.startMs - patternEnd;
    if (gapMs >= wordGapBoundary) {
      gaps.push({ durationMs: gapMs, kind: 'word' });
      flush();
      text += ' ';
    } else if (gapMs >= charGapBoundary) {
      gaps.push({ durationMs: gapMs, kind: 'character' });
      flush();
    } else {
      gaps.push({ durationMs: gapMs, kind: 'element' });
    }
  }
  flush();

  return { text, characters, marks, gaps, ditMs, estimatedWpm: 1200 / ditMs };
}

// ---- Timing quality ----

export interface Spread {
  meanMs: number;
  sdMs: number;
  count: number;
  /** Coefficient of variation: sd / mean. Lower is steadier. */
  cv: number;
}

export interface TimingQuality {
  dit: Spread;
  dah: Spread;
  elementGap: Spread;
  characterGap: Spread;
  wordGap: Spread;
  /** Measured dah:dit ratio. 3.0 is textbook. */
  weighting: number;
  /**
   * 0..1 summary of steadiness across the session, from the coefficients of
   * variation of the dits, dahs and element gaps.
   */
  consistency: number;
  estimatedWpm: number;
}

function spread(values: readonly number[]): Spread {
  const count = values.length;
  if (count === 0) return { meanMs: 0, sdMs: 0, count: 0, cv: 0 };
  const meanMs = values.reduce((a, b) => a + b, 0) / count;
  const variance = values.reduce((a, b) => a + (b - meanMs) ** 2, 0) / count;
  const sdMs = Math.sqrt(variance);
  return { meanMs, sdMs, count, cv: meanMs === 0 ? 0 : sdMs / meanMs };
}

/** Measure how evenly the student is sending. */
export function analyse(result: DecodeResult): TimingQuality {
  const dit = spread(result.marks.filter((m) => m.kind === 'dit').map((m) => m.durationMs));
  const dah = spread(result.marks.filter((m) => m.kind === 'dah').map((m) => m.durationMs));
  const elementGap = spread(result.gaps.filter((g) => g.kind === 'element').map((g) => g.durationMs));
  const characterGap = spread(result.gaps.filter((g) => g.kind === 'character').map((g) => g.durationMs));
  const wordGap = spread(result.gaps.filter((g) => g.kind === 'word').map((g) => g.durationMs));

  const weighting = dit.meanMs === 0 ? 0 : dah.meanMs / dit.meanMs;
  const cvs = [dit, dah, elementGap].filter((s) => s.count >= 2).map((s) => s.cv);
  // With nothing measurable, consistency is unknown — report 0 rather than
  // a flattering 1, which would tell a student who sent nothing that their
  // fist was perfect.
  const meanCv = cvs.reduce((a, b) => a + b, 0) / cvs.length;
  const consistency = cvs.length === 0 ? 0 : Math.max(0, Math.min(1, 1 - meanCv / 0.4));

  return { dit, dah, elementGap, characterGap, wordGap, weighting, consistency, estimatedWpm: result.estimatedWpm };
}

// ---- Comparison against ideal timing (the visual display in RFP §5) ----

export interface ComparisonRow {
  index: number;
  element: 'dit' | 'dah';
  /** The character of the target this element belongs to. */
  character: string;
  /** True on the first element of each character, so the UI can group them. */
  firstOfCharacter: boolean;
  idealMs: number;
  actualMs: number | null;
  /** actual / ideal; 1 is exact. */
  ratio: number | null;
}

/**
 * Line the student's marks up against the ideal elements of the target
 * text, element by element, so the UI can draw one against the other.
 */
export function compareToIdeal(
  target: string,
  result: DecodeResult,
  settings: TimingSettings,
): { rows: ComparisonRow[]; idealElementCount: number; sentElementCount: number } {
  const d = durations(settings);
  const ideal: { element: 'dit' | 'dah'; character: string; firstOfCharacter: boolean }[] = [];
  for (const token of tokenize(target)) {
    if (token === ' ') continue;
    const pattern = patternFor(token);
    if (pattern === undefined) continue;
    let first = true;
    for (const symbol of pattern) {
      ideal.push({ element: symbol === '-' ? 'dah' : 'dit', character: token, firstOfCharacter: first });
      first = false;
    }
  }

  const rows: ComparisonRow[] = ideal.map(({ element, character, firstOfCharacter }, index) => {
    const idealMs = element === 'dah' ? d.dahMs : d.ditMs;
    const mark = result.marks[index];
    const actualMs = mark === undefined ? null : mark.durationMs;
    return {
      index,
      element,
      character,
      firstOfCharacter,
      idealMs,
      actualMs,
      ratio: actualMs === null ? null : actualMs / idealMs,
    };
  });

  return { rows, idealElementCount: ideal.length, sentElementCount: result.marks.length };
}

// ---- Plain-language timing report (the visual display in RFP §5) ----

export type TimingKey = 'dit' | 'dah' | 'elementGap' | 'characterGap' | 'wordGap';

export interface TimingRow {
  key: TimingKey;
  /** What to call this on screen, in words a beginner knows. */
  label: string;
  /** Length standard Morse asks for, counted in dits. */
  units: number;
  idealMs: number;
  /** Mean of what the student actually sent, or null if they sent none. */
  actualMs: number | null;
  count: number;
  /** actual / ideal; 1.0 is exact. */
  ratio: number | null;
  verdict: 'good' | 'long' | 'short' | 'unknown';
}

const REPORT_ROWS: readonly { key: TimingKey; label: string; units: number }[] = Object.freeze([
  { key: 'dit', label: 'Dit', units: 1 },
  { key: 'dah', label: 'Dah', units: 3 },
  { key: 'elementGap', label: 'Gap inside a letter', units: 1 },
  { key: 'characterGap', label: 'Gap between letters', units: 3 },
  { key: 'wordGap', label: 'Gap between words', units: 7 },
]);

/** Within this fraction of the ideal counts as right. */
const REPORT_TOLERANCE = 0.15;

/*
 * Every message names the consequence, because "characterGap 0.81" tells a
 * student nothing they can act on. What they need to hear is that their
 * letters are running together.
 */
const DIAGNOSES: Readonly<Record<TimingKey, { long: string; short: string }>> = Object.freeze({
  dit: {
    long: 'Your dits are too long. Lift the key sooner — a dit should be a third of a dah, and yours are closer to a dah than that.',
    short: 'Your dits are too short. At this length they arrive as clicks and are easy to miss.',
  },
  dah: {
    long: 'Your dahs are too long. A dah is three dits and no more; holding them stretches your sending out.',
    short: 'Your dahs are too short. At this length they can be heard as dits, which turns one letter into another.',
  },
  elementGap: {
    long: 'The gaps inside a letter are too long, so single letters are breaking apart into two.',
    short: 'The gaps inside a letter are too short, so the dits and dahs of one letter run into each other.',
  },
  characterGap: {
    long: 'The gaps between letters are longer than standard. That is fine if you are practising Farnsworth spacing on purpose; otherwise it reads as hesitation.',
    short: 'The gaps between letters are too short, so separate letters run together and are heard as one. Leave three dit lengths between letters.',
  },
  wordGap: {
    long: 'The gaps between words are longer than standard. Harmless, but it costs you speed.',
    short: 'The gaps between words are too short, so words run into one another. Leave seven dit lengths between words.',
  },
});

/**
 * What the student was asked to send and what came back, in letters. Given
 * these, the report can say the one thing the ratios cannot: that the letters
 * did not survive the journey.
 */
export interface ReportContext {
  targetLetters: number;
  decodedLetters: number;
  /** Elements the whole target contains, and elements the student sent. */
  targetElements: number;
  sentElements: number;
}

/**
 * Compare what the student sent against standard Morse timing.
 *
 * The yardstick is the student's OWN dit length, not the drill speed. A fist
 * is readable or not because of the ratios between its parts; sending the
 * whole thing faster than asked is a separate matter, and the speed badge
 * says so on its own. Judging the ratios against the drill speed would paint
 * every row red for a student whose only sin was going quickly.
 */
export function timingReport(
  quality: TimingQuality,
  referenceDitMs: number,
  context?: ReportContext,
): { rows: TimingRow[]; diagnosis: string } {
  const source: Record<TimingKey, Spread> = {
    dit: quality.dit,
    dah: quality.dah,
    elementGap: quality.elementGap,
    characterGap: quality.characterGap,
    wordGap: quality.wordGap,
  };

  const rows: TimingRow[] = REPORT_ROWS.map(({ key, label, units }) => {
    const spreadForKey = source[key];
    const idealMs = units * referenceDitMs;
    const known = spreadForKey.count > 0 && referenceDitMs > 0;
    const actualMs = known ? spreadForKey.meanMs : null;
    const ratio = actualMs === null ? null : actualMs / idealMs;
    const verdict: TimingRow['verdict'] =
      ratio === null ? 'unknown' : Math.abs(ratio - 1) <= REPORT_TOLERANCE ? 'good' : ratio > 1 ? 'long' : 'short';
    return { key, label, units, idealMs, actualMs, count: spreadForKey.count, ratio, verdict };
  });

  return { rows, diagnosis: diagnose(rows, context) };
}

/*
 * Comparing letters in against letters out only means anything if the student
 * set out to send the whole target. Stopping a quarter of the way through is
 * not a fist that merges letters, and telling them it is would send them off
 * correcting a habit they do not have.
 */
function attemptedTheWholeTarget(context: ReportContext): boolean {
  if (context.targetLetters <= 0 || context.decodedLetters <= 0) return false;
  if (context.targetElements <= 0) return false;
  return context.sentElements >= context.targetElements * 0.75;
}

/** The single most useful sentence to say about a set of report rows. */
function diagnose(rows: readonly TimingRow[], context?: ReportContext): string {
  const measured = rows.filter((row) => row.verdict !== 'unknown');
  if (measured.length === 0) return 'Send something and press Analyse to see how your timing compares.';

  /*
   * Letters that merged or split outrank any ratio, because they are the
   * failure the student can actually hear in the decode. They also hide from
   * the ratios: when a letter gap is short enough, the decoder files it as a
   * gap inside a letter, the "gap between letters" row reports nothing at
   * all, and the ratios go on to blame the wrong thing entirely.
   */
  if (context !== undefined && attemptedTheWholeTarget(context)) {
    const { targetLetters, decodedLetters } = context;
    if (decodedLetters < targetLetters * 0.8) {
      return (
        `Your letters are running into each other \u2014 the target's ${String(targetLetters)} letters came ` +
        `back as ${String(decodedLetters)}. Leave a clear pause between letters: three times the gap you ` +
        'leave inside one.'
      );
    }
    if (decodedLetters > targetLetters * 1.25) {
      return (
        `Your letters are breaking apart \u2014 the target's ${String(targetLetters)} letters came back as ` +
        `${String(decodedLetters)}. The gaps inside a letter are too long; keep them to the length of one dit ` +
        'and save the pause for the end of the letter.'
      );
    }
  }

  let worst: TimingRow | null = null;
  let worstOff = 0;
  for (const row of measured) {
    if (row.verdict === 'good' || row.ratio === null) continue;
    const off = Math.abs(row.ratio - 1);
    // Ties go to the earlier row, which is the shorter element — a wrong dit
    // is more fundamental than a wrong word gap.
    if (off > worstOff) {
      worst = row;
      worstOff = off;
    }
  }

  if (worst === null || worst.ratio === null) {
    return 'Your timing is close to standard throughout. This would be comfortable to read on the air.';
  }
  return DIAGNOSES[worst.key][worst.ratio > 1 ? 'long' : 'short'];
}
