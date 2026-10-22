import { describe, expect, it } from 'vitest';
import { IambicKeyer, StraightKey, type IambicMode, type KeyerElement } from '../src/core/keyer';

const DIT = 0.06; // 20 WPM
const timings = () => ({ ditS: DIT, dahS: DIT * 3, gapS: DIT });

/**
 * Drive the keyer with a synthetic clock, the way the lookahead scheduler
 * drives it with AudioContext.currentTime. Actions fire at given times.
 */
function run(
  mode: IambicMode,
  actions: { at: number; do: (k: IambicKeyer) => void }[],
  untilS: number,
  stepS = DIT / 20,
): KeyerElement[] {
  const emitted: KeyerElement[] = [];
  const keyer = new IambicKeyer({ mode, timings, emit: (e) => emitted.push(e) });
  const pending = [...actions].sort((a, b) => a.at - b.at);
  for (let now = 0; now <= untilS; now += stepS) {
    while (pending.length > 0 && (pending[0] as { at: number }).at <= now) {
      (pending.shift() as { do: (k: IambicKeyer) => void }).do(keyer);
    }
    keyer.tick(now);
  }
  return emitted;
}

const kinds = (elements: readonly KeyerElement[]): string[] => elements.map((e) => e.kind);

describe('iambic keyer', () => {
  it('repeats dits while the dit paddle is held', () => {
    const elements = run('A', [
      { at: 0, do: (k) => k.press('dit') },
      { at: 0.5, do: (k) => k.release('dit') },
    ], 0.7);
    expect(elements.length).toBeGreaterThanOrEqual(4);
    expect(new Set(kinds(elements))).toEqual(new Set(['dit']));
  });

  it('repeats dahs while the dah paddle is held', () => {
    const elements = run('A', [
      { at: 0, do: (k) => k.press('dah') },
      { at: 0.8, do: (k) => k.release('dah') },
    ], 1.0);
    expect(new Set(kinds(elements))).toEqual(new Set(['dah']));
  });

  it('alternates while both paddles are squeezed', () => {
    const elements = run('A', [
      { at: 0, do: (k) => k.press('dit') },
      { at: 0.01, do: (k) => k.press('dah') },
      { at: 0.9, do: (k) => { k.release('dit'); k.release('dah'); } },
    ], 1.1);
    expect(kinds(elements).slice(0, 4)).toEqual(['dit', 'dah', 'dit', 'dah']);
  });

  it('leaves exactly one element gap between elements', () => {
    const elements = run('A', [
      { at: 0, do: (k) => k.press('dit') },
      { at: 0.5, do: (k) => k.release('dit') },
    ], 0.7);
    for (let i = 1; i < elements.length; i += 1) {
      const previous = elements[i - 1]!;
      const gap = elements[i]!.startS - (previous.startS + previous.durationS);
      expect(gap).toBeCloseTo(DIT, 6);
    }
  });

  // The defining difference between the two modes (RFP §5).
  it('mode A stops after the element in progress when both are released', () => {
    const elements = run('A', [
      { at: 0, do: (k) => k.press('dit') },
      // Tap the dah paddle during the dit and let go of both before the
      // decision point.
      { at: 0.02, do: (k) => k.press('dah') },
      { at: 0.03, do: (k) => { k.release('dah'); k.release('dit'); } },
    ], 0.6);
    expect(kinds(elements)).toEqual(['dit']);
  });

  it('mode B adds the opposite element after release', () => {
    const elements = run('B', [
      { at: 0, do: (k) => k.press('dit') },
      { at: 0.02, do: (k) => k.press('dah') },
      { at: 0.03, do: (k) => { k.release('dah'); k.release('dit'); } },
    ], 0.6);
    expect(kinds(elements)).toEqual(['dit', 'dah']);
  });

  it('emits nothing while no paddle is touched', () => {
    expect(run('B', [], 0.5)).toEqual([]);
  });

  it('gives the dit paddle the decision in a dead heat from idle', () => {
    const elements = run('A', [
      { at: 0, do: (k) => { k.press('dit'); k.press('dah'); } },
      { at: 0.01, do: (k) => { k.release('dit'); k.release('dah'); } },
    ], 0.5);
    expect(elements[0]!.kind).toBe('dit');
  });

  it('uses the weighted dah length from the timings callback', () => {
    const elements = run('A', [
      { at: 0, do: (k) => k.press('dah') },
      { at: 0.1, do: (k) => k.release('dah') },
    ], 0.5);
    expect(elements[0]!.durationS).toBeCloseTo(DIT * 3, 9);
  });

  it('reports busy while sending and clears on reset', () => {
    const keyer = new IambicKeyer({ mode: 'A', timings, emit: () => {} });
    keyer.press('dit');
    keyer.tick(0);
    expect(keyer.busy).toBe(true);
    keyer.reset();
    expect(keyer.busy).toBe(false);
  });

  it('honours a mode change without being rebuilt', () => {
    const emitted: KeyerElement[] = [];
    const keyer = new IambicKeyer({ mode: 'A', timings, emit: (e) => emitted.push(e) });
    keyer.setMode('B');
    keyer.press('dit');
    keyer.tick(0);
    keyer.press('dah');
    keyer.release('dah');
    keyer.release('dit');
    for (let t = 0; t <= 0.6; t += DIT / 10) keyer.tick(t);
    expect(kinds(emitted)).toEqual(['dit', 'dah']);
  });
});

describe('straight key', () => {
  it('reports the closure length the operator produced', () => {
    const key = new StraightKey();
    key.press(1.0);
    expect(key.isDown).toBe(true);
    expect(key.release(1.18)).toBeCloseTo(0.18, 9);
    expect(key.isDown).toBe(false);
  });

  it('ignores a release with no press, and a repeated press', () => {
    const key = new StraightKey();
    expect(key.release(5)).toBeNull();
    key.press(1);
    key.press(2);
    expect(key.release(3)).toBeCloseTo(2, 9);
  });

  it('clears on reset', () => {
    const key = new StraightKey();
    key.press(1);
    key.reset();
    expect(key.isDown).toBe(false);
  });
});
