/**
 * The band conditions audio graph (RFP §6, reused by §7).
 *
 * Built as its own chain with its own input and output, rather than as
 * options on the sidetone oscillator. That is deliberate: section 7 requires
 * the same conditions engine to be switchable onto live member-to-member
 * contacts in Phase 2. A chain with an input you feed and an output you take
 * can be dropped in front of anything — a robot's tones now, a remote
 * operator's keying later. Options bolted onto the sidetone could not.
 *
 * Signal path:
 *
 *   wanted station -> fade (QSB) -.
 *   QRM station ----> its own gain -+-> filter (receiver passband) -> out
 *   noise + crashes ---------------'
 *
 * The noise passes through the filter with the signal, which is why
 * narrowing the filter genuinely helps rather than merely sounding different.
 */

import { normalise, type BandSettings } from './band';
import { crashIn, fadeAt } from './band';

/** How often the conditions are updated, in seconds. */
const TICK_S = 0.05;

export class BandChain {
  private readonly ctx: AudioContext;

  /** Feed the wanted station in here. */
  readonly input: GainNode;
  /** Feed an interfering station in here; it bypasses the fade. */
  readonly qrmInput: GainNode;
  /**
   * Feed a LIVE station in here (§7). It fades with the band like the wanted
   * station but bypasses the filter: a live station's level from where the
   * dial sits is already the receiver model in tuning.ts, and filtering it
   * again would make the Heard list and the ear disagree. The noise still
   * goes through the filter, so narrowing it still helps.
   */
  readonly liveInput: GainNode;
  /** Take the result from here. */
  readonly output: GainNode;

  private readonly fade: GainNode;
  private readonly liveFade: GainNode;
  private readonly qrmGain: GainNode;
  private readonly noiseGain: GainNode;
  private readonly crashGain: GainNode;
  private readonly filter: BiquadFilterNode;
  private noiseSource: AudioBufferSourceNode | null = null;
  private crashSource: AudioBufferSourceNode | null = null;

  private settings: BandSettings;
  private startedAt = 0;
  private nextTickAt = 0;
  private running = false;
  private readonly random: () => number;

  constructor(ctx: AudioContext, settings: BandSettings, random: () => number = Math.random) {
    this.ctx = ctx;
    this.settings = normalise(settings);
    this.random = random;

    this.input = ctx.createGain();
    this.qrmInput = ctx.createGain();
    this.output = ctx.createGain();
    this.fade = ctx.createGain();
    this.liveInput = ctx.createGain();
    this.liveFade = ctx.createGain();
    this.qrmGain = ctx.createGain();
    this.noiseGain = ctx.createGain();
    this.crashGain = ctx.createGain();

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.frequency.value = 600;

    this.input.connect(this.fade).connect(this.filter);
    this.liveInput.connect(this.liveFade).connect(this.output);
    this.qrmInput.connect(this.qrmGain).connect(this.filter);
    this.noiseGain.connect(this.filter);
    // Crashes bypass the filter's narrow passband the way real static does:
    // a lightning discharge is broadband and you hear it whatever your filter.
    this.crashGain.connect(this.output);
    this.filter.connect(this.output);

    this.fade.gain.value = 1;
    this.liveFade.gain.value = 1;
    this.qrmGain.gain.value = 0;
    this.noiseGain.gain.value = 0;
    this.crashGain.gain.value = 0;
  }

  /** Centre the receiver on the sidetone pitch the member has chosen. */
  setCentreHz(hz: number): void {
    this.filter.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.02);
    this.applyFilter();
  }

  update(settings: BandSettings): void {
    this.settings = normalise(settings);
    this.applyFilter();
    const now = this.ctx.currentTime;
    this.noiseGain.gain.setTargetAtTime(this.settings.noise * 0.22, now, 0.05);
    this.qrmGain.gain.setTargetAtTime(this.settings.qrm * 0.5, now, 0.05);
  }

  private applyFilter(): void {
    // Q is centre frequency over bandwidth; that is what makes the filter
    // control a bandwidth in Hz rather than an abstract number.
    const centre = this.filter.frequency.value;
    const q = Math.max(0.3, centre / Math.max(50, this.settings.filterHz));
    this.filter.Q.setTargetAtTime(q, this.ctx.currentTime, 0.02);
  }

  get current(): Readonly<BandSettings> {
    return this.settings;
  }

  /** Begin generating noise and fading. Call once, from a user gesture. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = this.ctx.currentTime;
    this.nextTickAt = this.startedAt;

    this.noiseSource = this.makeNoiseSource(2);
    this.noiseSource.connect(this.noiseGain);
    this.noiseSource.start();

    this.crashSource = this.makeNoiseSource(1);
    this.crashSource.connect(this.crashGain);
    this.crashSource.start();

    this.update(this.settings);
  }

  /**
   * Advance the conditions. Driven by the same lookahead scheduler the keyer
   * uses: the timer only wakes this up, every value below is placed against
   * the audio clock.
   */
  tick(): void {
    if (!this.running) return;
    const now = this.ctx.currentTime;
    while (this.nextTickAt < now + 0.1) {
      const at = this.nextTickAt;
      const elapsed = at - this.startedAt;

      const fade = fadeAt(elapsed, this.settings);
      this.fade.gain.setTargetAtTime(fade, at, TICK_S / 2);
      this.liveFade.gain.setTargetAtTime(fade, at, TICK_S / 2);

      const { hit, level } = crashIn(TICK_S, this.settings, this.random);
      if (hit) {
        // A crash is a short burst with a fast attack and a quick decay.
        const g = this.crashGain.gain;
        g.setValueAtTime(0, at);
        g.linearRampToValueAtTime(level * 0.5, at + 0.004);
        g.exponentialRampToValueAtTime(0.0001, at + 0.06 + this.random() * 0.12);
        g.setValueAtTime(0, at + 0.2);
      }
      this.nextTickAt += TICK_S;
    }
  }

  /**
   * Stop generating. Fades rather than cutting: silencing a noise floor
   * instantly produces an audible click, which is exactly the artefact the
   * envelope work elsewhere exists to avoid.
   */
  stop(): void {
    if (!this.running && this.noiseSource === null) return;
    this.running = false;
    const now = this.ctx.currentTime;
    const fadeS = 0.08;

    for (const gain of [this.noiseGain, this.crashGain, this.qrmGain]) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeS);
    }

    for (const source of [this.noiseSource, this.crashSource]) {
      if (source === null) continue;
      try {
        source.stop(now + fadeS + 0.02);
      } catch {
        /* already stopped */
      }
    }
    this.noiseSource = null;
    this.crashSource = null;
  }

  /**
   * A looping buffer of pink-ish noise.
   *
   * White noise sounds like a hiss from a television; band noise has more
   * low end. A one-pole filter on white noise is a cheap approximation and
   * close enough to sound like a receiver rather than a synthesiser.
   */
  private makeNoiseSource(seconds: number): AudioBufferSourceNode {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = this.random() * 2 - 1;
      last = 0.97 * last + 0.03 * white;
      data[i] = last * 3.2;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }
}
