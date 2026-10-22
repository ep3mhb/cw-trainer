import { describe, expect, it } from 'vitest';
import { findOnset } from '../src/core/onset';

function recording(length: number, at: number, amplitude: number, noise: number): Float32Array {
  const buffer = new Float32Array(length);
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };
  for (let i = 0; i < length; i += 1) buffer[i] = rand() * noise;
  for (let i = at; i < Math.min(length, at + 500); i += 1) {
    buffer[i] = (buffer[i] as number) + amplitude * Math.exp(-(i - at) / 150) * Math.sin(i * 0.35);
  }
  return buffer;
}

describe('peak-anchored onset detection', () => {
  // The point of anchoring to the peak: the member's volume setting must not
  // decide whether the probe works.
  it.each([0.9, 0.3, 0.08, 0.02])('finds the click at amplitude %f', (amplitude) => {
    const { index, peak } = findOnset(recording(30000, 9000, amplitude, 0.0008));
    expect(peak).toBeGreaterThan(0);
    expect(index).not.toBeNull();
    expect(Math.abs((index as number) - 9000)).toBeLessThan(300);
  });

  it('reports the peak and its position even when it rejects the recording', () => {
    const onset = findOnset(recording(30000, 9000, 0.0005, 0.002));
    expect(onset.index).toBeNull();
    expect(onset.peak).toBeGreaterThan(0);
    expect(onset.peakIndex).toBeGreaterThanOrEqual(0);
  });

  it('rejects a recording that is only room noise', () => {
    expect(findOnset(recording(30000, 29999, 0, 0.003)).index).toBeNull();
  });

  it('rejects pure digital silence and reports a zero peak', () => {
    const onset = findOnset(new Float32Array(20000));
    expect(onset.index).toBeNull();
    expect(onset.peak).toBe(0);
  });

  it('does not find the click before it was played', () => {
    const buffer = recording(30000, 4000, 0.6, 0.0008);
    expect(findOnset(buffer, { searchFrom: 12000 }).index).toBeNull();
  });

  it('finds the onset before the peak, not at it', () => {
    const onset = findOnset(recording(30000, 9000, 0.6, 0.0008));
    expect(onset.index as number).toBeLessThanOrEqual(onset.peakIndex);
  });
});
