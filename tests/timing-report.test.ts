import { describe, expect, it } from 'vitest';
import { analyse, decode, timingReport, type KeyEvent, type TimingKey } from '../src/core/decoder';
import { schedule } from '../src/core/timing';

const settings = { characterWpm: 18, effectiveWpm: 18, weighting: 3 };
const ditMs = 1200 / 18;

/**
 * Key a message perfectly, then optionally distort one aspect of it — which is
 * how a student actually goes wrong: everything is fine except the one habit
 * they have not noticed.
 */
function keying(message: string, distort: (events: KeyEvent[]) => KeyEvent[] = (e) => e): KeyEvent[] {
  const events: KeyEvent[] = [];
  for (const tone of schedule(message, settings).tones) {
    events.push({ down: true, t: tone.atMs });
    events.push({ down: false, t: tone.atMs + tone.durationMs });
  }
  return distort(events);
}

function report(events: KeyEvent[]): ReturnType<typeof timingReport> {
  const result = decode(events, { tolerance: 0.35 });
  return timingReport(analyse(result), result.ditMs);
}

function row(r: ReturnType<typeof timingReport>, key: TimingKey) {
  const found = r.rows.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`no row for ${key}`);
  return found;
}

describe('timingReport', () => {
  it('passes a machine-perfect fist on every measured row', () => {
    const r = report(keying('PARIS PARIS'));
    for (const measured of r.rows.filter((candidate) => candidate.verdict !== 'unknown')) {
      expect(measured.verdict, measured.label).toBe('good');
    }
    expect(r.diagnosis).toMatch(/close to standard/);
  });

  it('measures every row of a message that has all five kinds of gap', () => {
    const r = report(keying('PARIS PARIS'));
    for (const key of ['dit', 'dah', 'elementGap', 'characterGap', 'wordGap'] as const) {
      expect(row(r, key).count, key).toBeGreaterThan(0);
    }
  });

  it('reports an element that was never sent as unknown, not as wrong', () => {
    // One word, so there is no gap between words to measure. A row with no
    // data behind it must say so rather than score zero and show red.
    const r = report(keying('PARIS'));
    expect(row(r, 'wordGap').verdict).toBe('unknown');
    expect(row(r, 'wordGap').actualMs).toBeNull();
    expect(row(r, 'wordGap').count).toBe(0);
    expect(row(r, 'dah').verdict).toBe('good');
    expect(r.diagnosis).not.toMatch(/between words/);
  });

  it('holds the ideal lengths to the standard 1 : 3 : 1 : 3 : 7 ratios', () => {
    const r = report(keying('PARIS'));
    expect(row(r, 'dit').idealMs).toBeCloseTo(ditMs, 1);
    expect(row(r, 'dah').idealMs).toBeCloseTo(3 * ditMs, 1);
    expect(row(r, 'elementGap').idealMs).toBeCloseTo(ditMs, 1);
    expect(row(r, 'characterGap').idealMs).toBeCloseTo(3 * ditMs, 1);
    expect(row(r, 'wordGap').idealMs).toBeCloseTo(7 * ditMs, 1);
  });

  it('catches letters running together, and says so in words', () => {
    // The failure from the project's own testing: every element right, but the
    // gap between letters cut short, so the decode came back as gibberish.
    const r = report(
      keying('PARIS PARIS', (events) => {
        // Pull each letter forward, shortening the gap that precedes it.
        const squeezed: KeyEvent[] = [];
        let drift = 0;
        for (let i = 0; i < events.length; i += 1) {
          const event = events[i];
          const previous = events[i - 1];
          if (event !== undefined && previous !== undefined && event.down) {
            const gap = event.t - previous.t;
            if (gap > 2.5 * ditMs && gap < 5 * ditMs) drift += 0.8 * ditMs;
          }
          if (event !== undefined) squeezed.push({ down: event.down, t: event.t - drift });
        }
        return squeezed;
      }),
    );
    expect(row(r, 'characterGap').verdict).toBe('short');
    expect(row(r, 'dit').verdict).toBe('good');
    expect(row(r, 'dah').verdict).toBe('good');
    expect(r.diagnosis).toMatch(/between letters are too short/);
  });

  it('says nothing was measured when nothing was sent', () => {
    const r = report([]);
    expect(r.rows.every((candidate) => candidate.verdict === 'unknown')).toBe(true);
    expect(r.diagnosis).toMatch(/Send something/);
  });

  it('judges the fist by its own speed, not by the drill speed', () => {
    // Textbook proportions sent at double speed is a fast fist, not a bad one.
    const fast = keying('PARIS PARIS').map((event) => ({ down: event.down, t: event.t / 2 }));
    const r = report(fast);
    for (const measured of r.rows.filter((candidate) => candidate.verdict !== 'unknown')) {
      expect(measured.verdict, measured.label).toBe('good');
    }
  });

  it('leads with letters that merged, whatever the ratios say', () => {
    // The trap this exists for: when the gap between letters is short enough,
    // the decoder files it as a gap inside a letter. The "gap between letters"
    // row then has nothing in it at all, and a report driven by ratios alone
    // blames the element gaps instead of saying the letters ran together.
    const r = timingReport(analyse(decode(keying('PARIS'), { tolerance: 0.35 })), ditMs, {
      targetLetters: 5,
      decodedLetters: 2,
      targetElements: 17,
      sentElements: 17,
    });
    expect(r.diagnosis).toMatch(/running into each other/);
    expect(r.diagnosis).toMatch(/5 letters came back as 2/);
  });

  it('leads with letters that broke apart', () => {
    const r = timingReport(analyse(decode(keying('PARIS'), { tolerance: 0.35 })), ditMs, {
      targetLetters: 5,
      decodedLetters: 9,
      targetElements: 17,
      sentElements: 17,
    });
    expect(r.diagnosis).toMatch(/breaking apart/);
  });

  it('keeps the ratio advice when the letters did survive', () => {
    const r = timingReport(analyse(decode(keying('PARIS'), { tolerance: 0.35 })), ditMs, {
      targetLetters: 5,
      decodedLetters: 5,
      targetElements: 17,
      sentElements: 17,
    });
    expect(r.diagnosis).toMatch(/close to standard/);
  });

  it('does not call a half-finished attempt a merged fist', () => {
    // Sending four letters of a fifteen-letter target is stopping early, not
    // running letters together, and must not be reported as the latter.
    const r = timingReport(analyse(decode(keying('PARIS'), { tolerance: 0.35 })), ditMs, {
      targetLetters: 15,
      decodedLetters: 3,
      targetElements: 40,
      sentElements: 10,
    });
    expect(r.diagnosis).not.toMatch(/running into each other/);
  });

  it('names the worst offender when more than one row is off', () => {
    const r = report(keying('PARIS').map((event) => ({ down: event.down, t: event.t })));
    // A perfect fist has no offender to name.
    expect(r.diagnosis).not.toMatch(/too short|too long/);
  });
});
