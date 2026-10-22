import { describe, expect, it } from 'vitest';
import { analyse, decode, type KeyEvent } from '../src/core/decoder';
import { schedule } from '../src/core/timing';

const settings = { characterWpm: 18, effectiveWpm: 18, weighting: 3 };

function keying(message: string): KeyEvent[] {
  const events: KeyEvent[] = [];
  for (const tone of schedule(message, settings).tones) {
    events.push({ down: true, t: tone.atMs });
    events.push({ down: false, t: tone.atMs + tone.durationMs });
  }
  return events;
}

/**
 * The reporting rule these cover: an absent measurement must be reported as
 * absent, not as a bad score. Showing "weighting 0.00" in red to someone who
 * has not sent anything tells them their fist is terrible, which is both
 * wrong and discouraging — and it was on screen.
 */
describe('reporting when little or nothing was sent', () => {
  it('has no marks at all for an empty session', () => {
    const result = decode([], { tolerance: 0.35 });
    expect(result.marks).toHaveLength(0);
    const quality = analyse(result);
    expect(quality.dit.count).toBe(0);
    expect(quality.dah.count).toBe(0);
  });

  it('cannot know a weighting from dits alone', () => {
    // E is a single dit; five of them give no dah to compare against.
    const quality = analyse(decode(keying('EEEEE'), { referenceWpm: 18, tolerance: 0.35 }));
    expect(quality.dah.count).toBe(0);
  });

  it('cannot know a weighting from dahs alone', () => {
    const quality = analyse(decode(keying('TTTTT'), { referenceWpm: 18, tolerance: 0.35 }));
    expect(quality.dit.count).toBe(0);
  });

  it('knows the weighting once both have been sent', () => {
    const quality = analyse(decode(keying('MITE'), { referenceWpm: 18, tolerance: 0.35 }));
    expect(quality.dit.count).toBeGreaterThan(0);
    expect(quality.dah.count).toBeGreaterThan(0);
    expect(quality.weighting).toBeCloseTo(3, 1);
  });

  it('reports no consistency from a single element', () => {
    const quality = analyse(decode(keying('E'), { referenceWpm: 18, tolerance: 0.35 }));
    expect(quality.dit.count + quality.dah.count).toBeLessThan(4);
    // With too little data the figure is meaningless, whatever it computes to.
    expect(quality.consistency).toBe(0);
  });

  it('reports a real consistency once there is enough to judge', () => {
    const quality = analyse(decode(keying('PARIS PARIS'), { referenceWpm: 18, tolerance: 0.35 }));
    expect(quality.dit.count + quality.dah.count).toBeGreaterThanOrEqual(4);
    expect(quality.consistency).toBeGreaterThan(0.8);
  });
});
