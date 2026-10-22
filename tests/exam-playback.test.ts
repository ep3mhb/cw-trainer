/**
 * The exam is the only place in the application that plays Morse from a bare
 * list of tones instead of from text, so `scheduleFromTones` is a playback
 * path of its own that the rest of the suite never exercises.
 *
 * What the server sends is built by `schedule()` and then stripped to
 * `{ atMs, durationMs }` (api.ts, examStart). These tests pin the round trip:
 * what the engine is handed during an exam must be, tone for tone, what it
 * would have been handed had the browser known the characters.
 */
import { describe, expect, it } from 'vitest';
import { schedule, scheduleFromTones, type TimingSettings } from '../src/core/timing';

const SETTINGS: TimingSettings = { characterWpm: 18, effectiveWpm: 12, weighting: 3 };

/** Exactly what examStart puts on the wire. */
const asSent = (text: string): { atMs: number; durationMs: number }[] =>
  schedule(text, SETTINGS).tones.map((t) => ({ atMs: t.atMs, durationMs: t.durationMs }));

describe('exam playback', () => {
  it('hands the engine the same tones it would get from the text', () => {
    const direct = schedule('SRMKK', SETTINGS);
    const viaWire = scheduleFromTones(asSent('SRMKK'));
    expect(viaWire.tones.map((t) => [t.atMs, t.durationMs]))
      .toEqual(direct.tones.map((t) => [t.atMs, t.durationMs]));
    expect(viaWire.totalMs).toBe(direct.totalMs);
  });

  it('keeps dit and dah distinct, at the sent speed', () => {
    const tones = asSent('SRMKK');
    const lengths = [...new Set(tones.map((t) => Math.round(t.durationMs)))].sort((a, b) => a - b);
    // 18 WPM: a dit is 1200/18 ms, a dah three of them.
    expect(lengths).toEqual([67, 200]);
  });

  it('carries no character labels for the browser to read', () => {
    const viaWire = scheduleFromTones(asSent('SRMKK'));
    expect(viaWire.tokens).toEqual([]);
    expect(new Set(viaWire.tones.map((t) => t.tokenIndex))).toEqual(new Set([0]));
  });

  /**
   * The one place the two disagree. `schedule()` pads the end by the gap that
   * would precede the next character; `scheduleFromTones` stops at the last
   * tone, because a gap carries no tone and so never crossed the wire. The
   * exam therefore has no tail after its final character. Asserted rather
   * than fixed: it is the documented consequence of sending tones only.
   */
  it('has no trailing gap, unlike the text path', () => {
    const direct = schedule('SRMKK', SETTINGS);
    const viaWire = scheduleFromTones(asSent('SRMKK'));
    expect(direct.paddedMs).toBeGreaterThan(direct.totalMs);
    expect(viaWire.paddedMs).toBe(viaWire.totalMs);
  });
});
