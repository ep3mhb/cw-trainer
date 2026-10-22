import { describe, expect, it, vi } from 'vitest';
import { CwAudioEngine, DEFAULT_AUDIO, ENVELOPE_MAX, PITCH_MAX, PITCH_MIN } from '../src/core/audio';

/**
 * A minimal fake AudioContext, enough to exercise the lifecycle and recovery
 * logic. The signal path itself is covered by the browser smoke test; what is
 * worth testing here is the part that decides whether audio is actually alive,
 * because it is the part that failed when AirPods were connected.
 */
class FakeContext {
  state: 'running' | 'suspended' | 'interrupted' | 'closed' = 'running';
  currentTime = 0;
  baseLatency = 0.005;
  outputLatency = 0.01;
  destination = {};
  closed = false;
  private listeners: (() => void)[] = [];

  addEventListener(_: string, fn: () => void): void { this.listeners.push(fn); }
  emit(): void { for (const fn of this.listeners) fn(); }
  gains: { gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn> } }[] = [];
  createGain(): unknown {
    const g = {
      gain: {
        value: 0,
        setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(),
      },
      connect: (n: unknown) => n,
      disconnect: vi.fn(),
    };
    this.gains.push(g);
    return g;
  }
  oscillators: { frequency: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> }; stop: ReturnType<typeof vi.fn> }[] = [];
  createOscillator(): unknown {
    const osc = {
      type: 'sine', frequency: { value: 0, setTargetAtTime: vi.fn() },
      connect: (n: unknown) => n, start: vi.fn(), stop: vi.fn(), addEventListener: vi.fn(), disconnect: vi.fn(),
    };
    this.oscillators.push(osc);
    return osc;
  }
  async resume(): Promise<void> { this.state = 'running'; }
  async close(): Promise<void> { this.closed = true; this.state = 'closed'; }
}

function install(): { made: FakeContext[] } {
  const made: FakeContext[] = [];
  vi.stubGlobal('window', {
    AudioContext: class { constructor() { const c = new FakeContext(); made.push(c); return c as never; } },
  });
  return { made };
}

describe('audio engine lifecycle', () => {
  it('reports "none" before it is started', () => {
    install();
    expect(new CwAudioEngine().state).toBe('none');
  });

  it('starts and reports running', async () => {
    install();
    const engine = new CwAudioEngine();
    await engine.start();
    expect(engine.state).toBe('running');
    expect(engine.isRunning).toBe(true);
  });

  it('surfaces the interrupted state Safari uses when the route is taken away', async () => {
    const { made } = install();
    const engine = new CwAudioEngine();
    await engine.start();
    made[0]!.state = 'interrupted';
    expect(engine.state).toBe('interrupted');
    expect(engine.isRunning).toBe(false);
  });

  it('notifies a listener when the state changes', async () => {
    const { made } = install();
    const engine = new CwAudioEngine();
    const seen: string[] = [];
    engine.onStateChange = (s) => seen.push(s);
    await engine.start();
    made[0]!.state = 'suspended';
    made[0]!.emit();
    expect(seen).toContain('suspended');
  });

  // The failure that prompted all of this: the context claims to be running
  // and produces no sound. The only tell is that the clock stops.
  it('detects a stalled clock even while the state says running', async () => {
    const { made } = install();
    const engine = new CwAudioEngine();
    await engine.start();
    const ctx = made[0]!;

    ctx.currentTime = 1;
    engine.clockAdvanced();      // take a reading
    ctx.currentTime = 2;
    expect(engine.clockAdvanced()).toBe(true);

    // Device goes away: state still "running", clock frozen.
    expect(ctx.state).toBe('running');
    expect(engine.clockAdvanced()).toBe(false);
    expect(engine.clockAdvanced()).toBe(false);
  });

  it('builds a new context on restart and closes the old one', async () => {
    const { made } = install();
    const engine = new CwAudioEngine();
    await engine.start();
    await engine.restart();
    expect(made).toHaveLength(2);
    expect(made[0]!.closed).toBe(true);
    expect(engine.isRunning).toBe(true);
  });

  it('does not report a false stall on the new context after a restart', async () => {
    const { made } = install();
    const engine = new CwAudioEngine();
    await engine.start();
    made[0]!.currentTime = 50;
    engine.clockAdvanced();
    await engine.restart();
    // The new context starts at 0, which must not read as "went backwards".
    expect(engine.clockAdvanced()).toBe(true);
  });

  it('tryResume reports whether the context came back', async () => {
    const { made } = install();
    const engine = new CwAudioEngine();
    await engine.start();
    made[0]!.state = 'suspended';
    expect(await engine.tryResume()).toBe(true);
  });

  it('tryResume is false when there is no context at all', async () => {
    install();
    expect(await new CwAudioEngine().tryResume()).toBe(false);
  });
});

describe('audio settings', () => {
  it('clamps pitch and envelope to the supported range', () => {
    install();
    const engine = new CwAudioEngine();
    engine.update({ pitchHz: 50, envelopeMs: 999, volume: 5 });
    expect(engine.current.pitchHz).toBe(PITCH_MIN);
    expect(engine.current.envelopeMs).toBe(ENVELOPE_MAX);
    expect(engine.current.volume).toBe(1);
    engine.update({ pitchHz: 9000 });
    expect(engine.current.pitchHz).toBe(PITCH_MAX);
  });

  it('defaults to a 600 Hz sidetone with a 6 ms envelope', () => {
    expect(DEFAULT_AUDIO.pitchHz).toBe(600);
    expect(DEFAULT_AUDIO.envelopeMs).toBe(6);
  });
});

describe('a remote station\u2019s voice', () => {
  it('changes pitch by cross-fading to a new oscillator, never by automating frequency', async () => {
    // Safari 27, 21 September 2026: frequency automation on an oscillator
    // gave a member clicks instead of a tone as they tuned. Gain automation
    // is dependable everywhere, so that is the only automation a pitch change
    // may use.
    const { made } = install();
    const engine = new CwAudioEngine();
    await engine.start();
    const ctx = made[0]!;
    const voice = engine.voice(600, 0.8);
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0]!.frequency.value).toBe(600);

    voice.setPitch(800);
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[1]!.frequency.value).toBe(800);
    expect(ctx.oscillators[0]!.stop).toHaveBeenCalled();
    for (const o of ctx.oscillators) expect(o.frequency.setTargetAtTime).not.toHaveBeenCalled();
    expect(voice.pitchHz).toBe(800);

    // The fade-in ramp is anchored with a setValueAtTime first: WebKit
    // ignores an unanchored ramp, which left Safari silent after one tuning
    // step (0.4.2). Every gain created after the voice is the new fader;
    // check the last one has its anchor before its ramp.
    const fader = ctx.gains[ctx.gains.length - 1]!;
    expect(fader.gain.setValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    const anchorOrder = fader.gain.setValueAtTime.mock.invocationCallOrder[0]!;
    const rampOrder = fader.gain.linearRampToValueAtTime.mock.invocationCallOrder[0]!;
    expect(anchorOrder).toBeLessThan(rampOrder);

    // A change too small to hear does not start an oscillator.
    voice.setPitch(800.2);
    expect(ctx.oscillators).toHaveLength(2);
  });
});
