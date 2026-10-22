import { describe, expect, it, vi } from 'vitest';
import { BandChain } from '../src/core/band-audio';
import { BAND_PRESETS, DEFAULT_BAND } from '../src/core/band';

/**
 * A fake AudioContext, enough to check the chain's wiring and lifecycle.
 *
 * Worth having despite the file being Web Audio glue: the noise carrying on
 * after a contact ended was a real fault a member hit, and it is exactly the
 * kind of thing that comes back silently.
 */
function fakeParam() {
  return {
    value: 0,
    setValueAtTime: vi.fn(function (this: unknown, v: number) { (fakeParam as never); return v; }),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

class FakeContext {
  currentTime = 10;
  sampleRate = 48000;
  destination = { kind: 'destination' };
  readonly sources: { started: boolean; stopped: number | null; loop: boolean }[] = [];

  createGain(): unknown {
    return { gain: fakeParam(), connect: (n: unknown) => n, disconnect: vi.fn() };
  }
  createBiquadFilter(): unknown {
    return {
      type: '', frequency: fakeParam(), Q: fakeParam(),
      connect: (n: unknown) => n, disconnect: vi.fn(),
    };
  }
  createBuffer(_c: number, length: number): unknown {
    const data = new Float32Array(length);
    return { getChannelData: () => data, length };
  }
  createBufferSource(): unknown {
    const source = {
      buffer: null as unknown,
      loop: false,
      started: false,
      stopped: null as number | null,
      connect: (n: unknown) => n,
      disconnect: vi.fn(),
      start: vi.fn(function (this: { started: boolean }) { this.started = true; }),
      stop: vi.fn(function (this: { stopped: number | null }, at?: number) { this.stopped = at ?? 0; }),
    };
    this.sources.push(source as never);
    return source;
  }
}

const make = (): { ctx: FakeContext; chain: BandChain } => {
  const ctx = new FakeContext();
  let seed = 1;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return { ctx, chain: new BandChain(ctx as never, BAND_PRESETS.poor, random) };
};

describe('band chain lifecycle', () => {
  it('generates nothing until it is started', () => {
    const { ctx } = make();
    expect(ctx.sources).toHaveLength(0);
  });

  it('starts a looping noise source and a crash source', () => {
    const { ctx, chain } = make();
    chain.start();
    expect(ctx.sources).toHaveLength(2);
    for (const source of ctx.sources) {
      expect(source.started).toBe(true);
      expect(source.loop).toBe(true);
    }
  });

  it('does not start twice if asked twice', () => {
    const { ctx, chain } = make();
    chain.start();
    chain.start();
    expect(ctx.sources).toHaveLength(2);
  });

  // The fault a member hit: the band kept hissing after they gave up.
  it('stops every source when the contact ends', () => {
    const { ctx, chain } = make();
    chain.start();
    chain.stop();
    for (const source of ctx.sources) expect(source.stopped).not.toBeNull();
  });

  it('fades out rather than cutting, so stopping does not click', () => {
    const { ctx, chain } = make();
    chain.start();
    chain.stop();
    // Every source is stopped after the fade has finished, not at once.
    for (const source of ctx.sources) {
      expect(source.stopped as number).toBeGreaterThan(ctx.currentTime);
    }
  });

  it('is safe to stop when it was never started', () => {
    const { chain } = make();
    expect(() => chain.stop()).not.toThrow();
  });

  it('is safe to stop twice', () => {
    const { chain } = make();
    chain.start();
    chain.stop();
    expect(() => chain.stop()).not.toThrow();
  });

  it('can be started again after stopping', () => {
    const { ctx, chain } = make();
    chain.start();
    chain.stop();
    chain.start();
    expect(ctx.sources).toHaveLength(4);
  });

  it('does nothing on tick once stopped', () => {
    const { ctx, chain } = make();
    chain.start();
    chain.stop();
    const before = ctx.sources.length;
    chain.tick();
    chain.tick();
    expect(ctx.sources).toHaveLength(before);
  });
});

describe('band chain settings', () => {
  it('clamps whatever it is given', () => {
    const { chain } = make();
    chain.update({ ...DEFAULT_BAND, noise: 9, filterHz: 1 });
    expect(chain.current.noise).toBe(1);
    expect(chain.current.filterHz).toBe(100);
  });

  it('keeps the settings it was built with', () => {
    const { chain } = make();
    expect(chain.current.qrm).toBeCloseTo(BAND_PRESETS.poor.qrm, 6);
  });

  it('exposes an input, a QRM input and an output to wire up', () => {
    const { chain } = make();
    expect(chain.input).toBeDefined();
    expect(chain.qrmInput).toBeDefined();
    expect(chain.output).toBeDefined();
  });
});
