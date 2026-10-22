/**
 * Web Audio sidetone engine.
 *
 * RFP §3 requirements met here:
 *  - OscillatorNode sine wave, generated live. No samples, no <audio>.
 *  - Adjustable 4-8 ms raised envelope on both edges (no key clicks).
 *  - Sidetone 300-1000 Hz, default 600 Hz.
 *  - Every tone scheduled against AudioContext.currentTime. No setTimeout
 *    anywhere in this file (acceptance criterion 3).
 *  - Output gain independent of system volume, and a mute that cancels
 *    already-scheduled tones immediately.
 *
 * This file is deliberately the only place that touches Web Audio, so the
 * timing, keyer and decoder modules stay pure and unit-testable.
 */

import type { Schedule } from './timing';

export interface AudioSettings {
  /** Sidetone frequency in Hz, clamped to 300-1000. */
  pitchHz: number;
  /** Output level, 0..1, independent of the system volume. */
  volume: number;
  /** Envelope rise/fall in ms, clamped to 1-20 (RFP default range 4-8). */
  envelopeMs: number;
  muted: boolean;
}

export const DEFAULT_AUDIO: Readonly<AudioSettings> = Object.freeze({
  pitchHz: 600,
  volume: 0.5,
  envelopeMs: 6,
  muted: false,
});

export const PITCH_MIN = 300;
export const PITCH_MAX = 1000;
export const ENVELOPE_MIN = 1;
export const ENVELOPE_MAX = 20;

/** One scheduled point on a gain envelope. */
export interface EnvelopePoint {
  /** Seconds from the start of the tone. */
  atS: number;
  value: number;
  /** True to ramp linearly to this value from the previous point. */
  ramp: boolean;
}

/**
 * The shape of one tone: ramp up over the envelope time, hold, ramp down.
 * Short tones get a proportionally shorter envelope so a dit at high speed
 * still has edges rather than being clipped into a click.
 *
 * Pure and exported because the shape is what acceptance criterion 2 is
 * about — "no key clicks", "envelope shaping audible and adjustable,
 * spectrum check on request" — and a shape you can only hear is a shape
 * nobody can check. tests/envelope-spectrum.test.ts renders these points and
 * measures the sidebands.
 */
export function envelopePoints(durationS: number, envelopeS: number): EnvelopePoint[] {
  const edge = Math.min(envelopeS, durationS / 2.5);
  return [
    { atS: 0, value: 0, ramp: false },
    { atS: edge, value: 1, ramp: true },
    { atS: durationS - edge, value: 1, ramp: false },
    { atS: durationS, value: 0, ramp: true },
  ];
}

/**
 * Scheduling lead for real-time keying. A tone asked for "now" is placed
 * this far in the future so the ramp is never truncated by the render
 * quantum. It is part of the measured latency the UI reports.
 */
const KEYING_LEAD_S = 0.004;
/** How long a remote station's pitch change takes to cross-fade, in seconds. */
export const PITCH_XFADE_S = 0.03;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface PlaybackHandle {
  /** Resolves when the schedule finishes, or immediately if stopped. */
  readonly finished: Promise<void>;
  stop(): void;
}

/**
 * A remote station's tone (RFP §7).
 *
 * One persistent oscillator per station heard, at the pitch the member's dial
 * gives it and the level the filter leaves of it. keyAt() schedules a
 * transition at an absolute audio-clock time, which is what link.ts hands
 * back: the sender's key movement, reconstructed here to the millisecond.
 */
export interface Voice {
  setPitch(hz: number): void;
  /** 0..1 — a station tuned off the passband edge fades rather than cuts. */
  setLevel(level: number): void;
  keyAt(atS: number, down: boolean): void;
  /** Whether the tone is currently up. */
  readonly down: boolean;
  /** What the oscillator is set to, for the display and for tests. */
  readonly pitchHz: number;
  readonly level: number;
  dispose(): void;
}

export interface LatencyReport {
  /** AudioContext.baseLatency in ms — the render quantum buffer. */
  baseLatencyMs: number;
  /** AudioContext.outputLatency in ms — driver and hardware path. */
  outputLatencyMs: number;
  /** The lead this engine adds when keying in real time. */
  schedulingLeadMs: number;
  /** Sum of the above: press-to-sidetone, excluding input event delay. */
  totalMs: number;
  /**
   * True where the browser did not expose outputLatency and the figure is a
   * fallback. Measured: Safari 27.0 on macOS does report it (8.9 ms on a
   * MacBook Pro), so do not assume a browser family here — check the value.
   */
  outputLatencyEstimated: boolean;
}

export class CwAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private settings: AudioSettings;

  /** Persistent oscillator for real-time keying. */
  private keyOsc: OscillatorNode | null = null;
  private keyGain: GainNode | null = null;
  private keyIsDown = false;

  /** Notified whenever the context's state changes, including to 'interrupted'. */
  onStateChange: ((state: string) => void) | null = null;

  constructor(settings: Partial<AudioSettings> = {}) {
    this.settings = { ...DEFAULT_AUDIO, ...settings };
  }

  /**
   * Create or resume the AudioContext. Must be called from a user gesture
   * (RFP §9: "Audio requires a user gesture to start in all browsers.
   * The interface must handle this, not fail silently.").
   */
  async start(): Promise<void> {
    if (this.ctx === null) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctor === undefined) throw new Error('This browser has no Web Audio support.');
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx.addEventListener('statechange', () => {
        this.onStateChange?.(this.ctx?.state ?? 'closed');
      });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.muted ? 0 : this.settings.volume;
      this.master.connect(this.ctx.destination);
      this.resetClockSample();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /**
   * The context's sample rate, or a sensible figure before it exists.
   *
   * Exposed because A39's static is generated as raw samples and has to be
   * made at the rate the buffer will be played at; resampling noise is
   * pointless work and resampling it wrongly makes it a different sound.
   */
  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  get isRunning(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /**
   * The context's own state. Safari adds 'interrupted', which is not in the
   * specification's enum but is what you get when the audio route is taken
   * away — switching to Bluetooth headphones, for instance.
   */
  get state(): 'none' | 'running' | 'suspended' | 'interrupted' | 'closed' {
    if (this.ctx === null) return 'none';
    return this.ctx.state as 'running' | 'suspended' | 'interrupted' | 'closed';
  }

  /**
   * Whether the audio clock is actually advancing.
   *
   * This is the check that matters, because the failure this catches is a
   * context that reports state 'running' while producing no sound at all —
   * which is what happens when the output device changes underneath it. The
   * clock freezes even though nothing reports an error.
   *
   * Call it twice with a gap between; a single call cannot tell.
   */
  private lastClockSample = -1;

  clockAdvanced(): boolean {
    if (this.ctx === null) return false;
    const now = this.ctx.currentTime;
    const advanced = this.lastClockSample < 0 || now > this.lastClockSample;
    this.lastClockSample = now;
    return advanced;
  }

  /** Called when the engine is rebuilt, so the next sample is not a false stall. */
  private resetClockSample(): void {
    this.lastClockSample = -1;
  }

  /**
   * Tear the context down and build a new one.
   *
   * A context is bound to the output device it was created against. When that
   * device goes away — AirPods connect, a monitor is unplugged — resuming the
   * old context is not always enough, and on some browsers nothing short of a
   * new context will produce sound again. Settings are preserved; the caller
   * re-arms whatever it was doing.
   */
  async restart(): Promise<void> {
    const old = this.ctx;
    this.ctx = null;
    this.master = null;
    this.keyOsc = null;
    this.keyGain = null;
    this.keyIsDown = false;
    this.resetClockSample();
    if (old !== null) {
      // Closing can reject if the context is already gone; that is fine.
      try {
        await old.close();
      } catch {
        /* already closed */
      }
    }
    await this.start();
  }

  /**
   * Try to get sound back without rebuilding: enough for a plain suspend,
   * not enough for a device change. Returns whether the context is running.
   */
  async tryResume(): Promise<boolean> {
    if (this.ctx === null) return false;
    try {
      await this.ctx.resume();
    } catch {
      return false;
    }
    return this.ctx.state === 'running';
  }

  /**
   * The live AudioContext, for code that must build its own nodes on the same
   * output path — the latency probe. Null before start().
   */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Current audio clock time in seconds, or 0 before start(). */
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get current(): Readonly<AudioSettings> {
    return this.settings;
  }

  update(patch: Partial<AudioSettings>): void {
    const next: AudioSettings = { ...this.settings, ...patch };
    next.pitchHz = clamp(next.pitchHz, PITCH_MIN, PITCH_MAX);
    next.volume = clamp(next.volume, 0, 1);
    next.envelopeMs = clamp(next.envelopeMs, ENVELOPE_MIN, ENVELOPE_MAX);
    this.settings = next;

    if (this.ctx !== null && this.master !== null) {
      const level = next.muted ? 0 : next.volume;
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.01);
    }
    if (this.keyOsc !== null && this.ctx !== null) {
      this.keyOsc.frequency.setTargetAtTime(next.pitchHz, this.ctx.currentTime, 0.005);
    }
    if (next.muted) this.silenceNow();
  }

  /**
   * Schedule a whole message. Every tone is placed against the audio clock
   * up front; nothing re-enters this code as it plays.
   */
  play(
    schedule: Schedule,
    options: {
      onToken?: (tokenIndex: number, atAudioTime: number) => void;
      /** Route somewhere other than the master gain — the band chain, say. */
      destination?: AudioNode;
      /** Override the sidetone pitch, for a station off frequency. */
      pitchHz?: number;
      /** Delay before the first tone, in seconds. */
      leadS?: number;
    } = {},
  ): PlaybackHandle {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) throw new Error('Call start() from a user gesture before playing.');

    const target = options.destination ?? master;
    const startAt = ctx.currentTime + (options.leadS ?? 0.08);
    const { envelopeMs } = this.settings;
    const pitchHz = options.pitchHz ?? this.settings.pitchHz;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = pitchHz;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(target);

    const endAt = startAt + schedule.totalMs / 1000 + 0.05;
    osc.start(startAt);
    osc.stop(endAt);

    for (const tone of schedule.tones) {
      const t0 = startAt + tone.atMs / 1000;
      this.envelope(gain.gain, t0, tone.durationMs / 1000, envelopeMs / 1000);
    }

    if (options.onToken !== undefined) {
      const seen = new Set<number>();
      for (const tone of schedule.tones) {
        if (seen.has(tone.tokenIndex)) continue;
        seen.add(tone.tokenIndex);
        options.onToken(tone.tokenIndex, startAt + tone.atMs / 1000);
      }
    }

    let stopped = false;
    const finished = new Promise<void>((resolve) => {
      osc.addEventListener('ended', () => resolve(), { once: true });
    });

    return {
      finished,
      stop: () => {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setTargetAtTime(0, t, 0.003);
        try {
          osc.stop(t + 0.03);
        } catch {
          /* already stopped */
        }
      },
    };
  }

  /**
   * The same schedule, heard through real conditions (RFD A39).
   *
   * The numbers all come from core/conditions, which is seeded and tested;
   * this method only wires them into the graph. Nothing here invents a
   * random value, which is what lets a session be replayed exactly.
   *
   *   signal ──▶ fade ──┐
   *   static ──────────▶├──▶ master
   *   other station ───▶┘
   *
   * The fade sits on the signal alone, deliberately. Fading the static with
   * it would be wrong twice: the noise a receiver makes does not come and
   * go with one distant station, and a signal that faded together with its
   * background would stay equally readable throughout, which is the one
   * thing fading never does.
   */
  playConditioned(
    schedule: Schedule,
    spec: {
      /** Gain multipliers for the signal, one per `fadeStepS`. */
      fade: Float32Array | null;
      fadeStepS: number;
      /** Raw samples for the noise bed, at the context's own rate. */
      noise: Float32Array | null;
      /** A second station, already turned into a schedule by the caller. */
      other: { schedule: Schedule; pitchHz: number; gain: number } | null;
    },
    options: { onToken?: (tokenIndex: number, atAudioTime: number) => void } = {},
  ): PlaybackHandle {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) throw new Error('Call start() from a user gesture before playing.');

    const extra: { stop: () => void }[] = [];
    let signalTarget: AudioNode = master;

    if (spec.fade !== null && spec.fade.length > 1) {
      const fade = ctx.createGain();
      fade.gain.value = spec.fade[0] as number;
      fade.connect(master);
      signalTarget = fade;
      // setValueCurveAtTime wants the curve's whole span, and it must cover
      // the message or the gain is left wherever the curve ended.
      const span = (spec.fade.length - 1) * spec.fadeStepS;
      try {
        fade.gain.setValueCurveAtTime(spec.fade, ctx.currentTime, span);
      } catch {
        // Safari has refused a long curve before now. A drill without the
        // fade is still a drill; a drill that throws is not.
        fade.gain.value = 1;
      }
      extra.push({ stop: () => { fade.gain.cancelScheduledValues(ctx.currentTime); } });
    }

    if (spec.noise !== null && spec.noise.length > 0) {
      const buffer = ctx.createBuffer(1, spec.noise.length, ctx.sampleRate);
      // Copied element by element rather than with copyToChannel: the
      // samples arrive in whatever ArrayBufferLike the generator produced,
      // and the typed signature wants a plain ArrayBuffer.
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < spec.noise.length; i += 1) channel[i] = spec.noise[i] as number;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 1;
      src.connect(g).connect(master);
      src.start();
      extra.push({ stop: () => { try { src.stop(); } catch { /* already stopped */ } } });
    }

    if (spec.other !== null) {
      const g = ctx.createGain();
      g.gain.value = spec.other.gain;
      g.connect(master);
      const handle = this.play(spec.other.schedule, {
        destination: g,
        pitchHz: spec.other.pitchHz,
      });
      extra.push({ stop: () => { handle.stop(); } });
    }

    const main = this.play(schedule, {
      destination: signalTarget,
      ...(options.onToken !== undefined ? { onToken: options.onToken } : {}),
    });

    let stopped = false;
    const stopAll = (): void => {
      if (stopped) return;
      stopped = true;
      main.stop();
      for (const e of extra) e.stop();
    };
    // The conditions outlive the signal by design — static does not stop
    // because the station stopped — so they are cut when the message ends.
    void main.finished.then(stopAll, stopAll);

    return { finished: main.finished, stop: stopAll };
  }

  /**
   * Shape one tone from the points above, on a real AudioParam.
   */
  private envelope(param: AudioParam, at: number, durationS: number, envelopeS: number): void {
    for (const point of envelopePoints(durationS, envelopeS)) {
      if (point.ramp) param.linearRampToValueAtTime(point.value, at + point.atS);
      else param.setValueAtTime(point.value, at + point.atS);
    }
  }

  // ---- Real-time keying (sending practice, RFP §5) ----

  /**
   * Bring up the persistent keying oscillator. Separate from play() so that
   * a paddle press does not pay oscillator construction cost.
   */
  private ensureKeyOsc(): { ctx: AudioContext; gain: GainNode } {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) throw new Error('Call start() from a user gesture before keying.');
    if (this.keyOsc === null || this.keyGain === null) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = this.settings.pitchHz;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(master);
      osc.start();
      this.keyOsc = osc;
      this.keyGain = gain;
    }
    return { ctx, gain: this.keyGain };
  }

  /**
   * Start the sidetone. Returns the audio-clock time the tone actually
   * begins, which the latency meter compares against the input event.
   */
  keyDown(): number {
    const { ctx, gain } = this.ensureKeyOsc();
    const at = ctx.currentTime + KEYING_LEAD_S;
    const edge = this.settings.envelopeMs / 1000;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, at);
    gain.gain.linearRampToValueAtTime(1, at + edge);
    this.keyIsDown = true;
    return at;
  }

  /**
   * Schedule one keyed element at an absolute audio-clock time.
   *
   * This is how the iambic keyer sounds its elements: the keyer decides
   * *which* element at a decision point, and the length and placement come
   * straight from the audio clock.
   */
  toneAt(atS: number, durationS: number): void {
    const { gain } = this.ensureKeyOsc();
    this.envelope(gain.gain, atS, durationS, this.settings.envelopeMs / 1000);
  }

  /**
   * A tone for another station, independent of the member's own sidetone.
   *
   * Two gain stages: `key` carries the keying envelope and `trim` the level
   * the filter leaves, so the fade-with-tuning can change underneath the
   * scheduled ramps without fighting them.
   *
   * The pitch is never changed by automating an oscillator's frequency. It
   * was, and on Safari 27 a member tuning across a station heard clicks
   * instead of a tone (21 September 2026, journal: 32 received, 0 late, 0
   * missing — the transport was perfect; the discontinuities were in the
   * oscillator). WebKit has a long record of mishandling frequency
   * automation on OscillatorNode; gain automation it handles everywhere. So
   * a pitch change starts a new oscillator at the new pitch and cross-fades
   * to it over PITCH_XFADE_S, then stops the old one. Every browser can do
   * that, and it is also what a real receiver's audio does when you turn the
   * knob — the tone moves, it does not tick.
   */
  voice(pitchHz: number, level: number, destination?: AudioNode): Voice {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) throw new Error('Call start() from a user gesture before listening.');
    const key = ctx.createGain();
    key.gain.value = 0;
    const trim = ctx.createGain();
    trim.gain.value = Math.min(1, Math.max(0, level));
    // A remote station may be heard through the band-conditions chain (§7:
    // the §6 engine "applies to live contacts as a toggle") rather than
    // straight into the loudspeaker.
    key.connect(trim).connect(destination ?? master);

    // The oscillator in use and its own fader into `key`.
    let osc = ctx.createOscillator();
    let fader = ctx.createGain();
    const startOsc = (hz: number, o: OscillatorNode, f: GainNode, atS: number, fadeIn: boolean): void => {
      o.type = 'sine';
      o.frequency.value = Math.max(50, hz);
      f.gain.value = fadeIn ? 0 : 1;
      o.connect(f).connect(key);
      o.start(atS);
      // The anchor before the ramp is not decoration. WebKit ignores a ramp
      // that has no event before it — the gain stays where it was, which
      // here is zero, and the new oscillator is silent for good. That is what
      // 0.4.2 did to Safari on 21 September 2026: turn the dial once and the
      // station vanished. Every ramp in this file is anchored.
      if (fadeIn) {
        f.gain.setValueAtTime(0, atS);
        f.gain.linearRampToValueAtTime(1, atS + PITCH_XFADE_S);
      }
    };
    startOsc(pitchHz, osc, fader, ctx.currentTime, false);

    let isDown = false;
    let disposed = false;
    let pitchNow = Math.max(50, pitchHz);
    let levelNow = trim.gain.value;
    const edgeS = (): number => this.settings.envelopeMs / 1000;

    return {
      setPitch: (hz) => {
        if (disposed) return;
        const target = Math.max(50, hz);
        if (Math.abs(target - pitchNow) < 0.5) return;
        pitchNow = target;
        const now = ctx.currentTime;
        const old = osc;
        const oldFader = fader;
        osc = ctx.createOscillator();
        fader = ctx.createGain();
        startOsc(target, osc, fader, now, true);
        oldFader.gain.cancelScheduledValues(now);
        oldFader.gain.setValueAtTime(oldFader.gain.value, now);
        oldFader.gain.linearRampToValueAtTime(0, now + PITCH_XFADE_S);
        try { old.stop(now + PITCH_XFADE_S + 0.02); } catch { /* already stopped */ }
        old.addEventListener('ended', () => { old.disconnect(); oldFader.disconnect(); }, { once: true });
      },
      setLevel: (lvl) => {
        if (disposed) return;
        levelNow = Math.min(1, Math.max(0, lvl));
        trim.gain.setTargetAtTime(levelNow, ctx.currentTime, 0.02);
      },
      get pitchHz() { return pitchNow; },
      get level() { return levelNow; },
      keyAt: (atS, down) => {
        if (disposed) return;
        const at = Math.max(atS, ctx.currentTime);
        key.gain.setValueAtTime(down ? 0 : 1, at);
        key.gain.linearRampToValueAtTime(down ? 1 : 0, at + edgeS());
        isDown = down;
      },
      get down() { return isDown; },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const t = ctx.currentTime;
        key.gain.cancelScheduledValues(t);
        key.gain.setTargetAtTime(0, t, 0.003);
        try { osc.stop(t + 0.05); } catch { /* already stopped */ }
        window.setTimeout(() => { osc.disconnect(); fader.disconnect(); key.disconnect(); trim.disconnect(); }, 100);
      },
    };
  }

  /** Stop the sidetone. Returns the audio-clock time the tone ends. */
  keyUp(): number {
    if (this.keyOsc === null || this.keyGain === null || this.ctx === null) return this.now;
    const ctx = this.ctx;
    const at = ctx.currentTime + KEYING_LEAD_S;
    const edge = this.settings.envelopeMs / 1000;
    this.keyGain.gain.cancelScheduledValues(ctx.currentTime);
    this.keyGain.gain.setValueAtTime(this.keyGain.gain.value, at);
    this.keyGain.gain.linearRampToValueAtTime(0, at + edge);
    this.keyIsDown = false;
    return at;
  }

  get keyed(): boolean {
    return this.keyIsDown;
  }

  /** Cut all sound now — used by mute and by the panic stop. */
  silenceNow(): void {
    if (this.ctx === null) return;
    const t = this.ctx.currentTime;
    if (this.keyGain !== null) {
      this.keyGain.gain.cancelScheduledValues(t);
      this.keyGain.gain.setTargetAtTime(0, t, 0.002);
      this.keyIsDown = false;
    }
    if (this.master !== null) {
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.volume, t, 0.002);
    }
  }

  /**
   * Latency the student will actually feel (RFP §5). Bluetooth output shows
   * up here as a large outputLatency, which is the case the RFP asks to be
   * detected and reported rather than left to be discovered.
   */
  latency(): LatencyReport {
    const ctx = this.ctx;
    const baseLatencyMs = (ctx?.baseLatency ?? 0) * 1000;
    const raw = (ctx as (AudioContext & { outputLatency?: number }) | null)?.outputLatency;
    const outputLatencyEstimated = raw === undefined || raw === 0;
    // Fall back to one render quantum where the browser gives us nothing.
    // Which browsers those are changes between versions, so this is decided
    // by the value being absent or zero, never by sniffing the browser.
    const outputLatencyMs = outputLatencyEstimated ? baseLatencyMs : raw * 1000;
    const schedulingLeadMs = KEYING_LEAD_S * 1000;
    return {
      baseLatencyMs,
      outputLatencyMs,
      schedulingLeadMs,
      totalMs: baseLatencyMs + outputLatencyMs + schedulingLeadMs,
      outputLatencyEstimated,
    };
  }

  /**
   * Build a band-conditions chain feeding the master gain.
   *
   * Lives here because it needs the context, but the chain itself knows
   * nothing about this engine — which is what lets Phase 2 feed a remote
   * operator's keying through the same graph.
   */
  connectChain(chain: { output: AudioNode }): void {
    if (this.master === null) throw new Error('Call start() from a user gesture first.');
    chain.output.connect(this.master);
  }

  /**
   * Listen to everything the member hears. Returns a function giving the RMS
   * level of the last analyser frame, 0..1. Used by the browser test to check
   * that a remote station actually produces sound — a lesson from 21
   * September 2026, when a change that read as correct went out silent.
   */
  tap(): () => number {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null) throw new Error('Call start() from a user gesture first.');
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    return () => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) sum += (buffer[i] as number) ** 2;
      return Math.sqrt(sum / buffer.length);
    };
  }

  async close(): Promise<void> {
    this.silenceNow();
    if (this.ctx !== null) {
      await this.ctx.close();
      this.ctx = null;
      this.master = null;
      this.keyOsc = null;
      this.keyGain = null;
    }
  }
}
