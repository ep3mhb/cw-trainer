/**
 * Band conditions (RFP §6).
 *
 * "This is what separates a useful trainer from a metronome." Copying clean
 * tones in a silent room is a different skill from pulling a signal out of
 * noise and fading, and only the second one is the skill members need.
 *
 * This file is the model: the settings, their meaning, and the arithmetic
 * that turns them into levels an audio graph can apply. It is deliberately
 * pure, with no Web Audio, so the behaviour can be tested — and so that the
 * live member-to-member contacts of §7 can drive the same model without
 * dragging the receiving trainer's audio along with them.
 */

export interface BandSettings {
  /** Background hiss, 0 (silent) to 1 (signal buried). */
  noise: number;
  /** Slow fading depth, 0 (steady) to 1 (signal disappears at the troughs). */
  qsb: number;
  /** Seconds per fade cycle. Real QSB runs from a few seconds to a minute. */
  qsbPeriodS: number;
  /** Static crashes, 0 (none) to 1 (frequent). */
  qrn: number;
  /** Interfering station's level, 0 (absent) to 1 (as loud as the wanted one). */
  qrm: number;
  /** How far off frequency the interfering station sits, in Hz. */
  qrmOffsetHz: number;
  /** Receiver passband width in Hz. Narrow rejects more noise and QRM. */
  filterHz: number;
}

export const DEFAULT_BAND: Readonly<BandSettings> = Object.freeze({
  noise: 0,
  qsb: 0,
  qsbPeriodS: 8,
  qrn: 0,
  qrm: 0,
  qrmOffsetHz: 400,
  filterHz: 500,
});

export const FILTER_MIN_HZ = 100;
export const FILTER_MAX_HZ = 2400;

/** Named presets, so a member can pick a band rather than seven sliders. */
export type BandPreset = 'quiet' | 'typical' | 'poor' | 'contest';

export const BAND_PRESETS: Readonly<Record<BandPreset, BandSettings>> = Object.freeze({
  // A strong local station on a quiet evening.
  quiet: { ...DEFAULT_BAND, noise: 0.06, qsb: 0.05, qrn: 0.02, filterHz: 500 },
  // An ordinary contact: some hiss, a gentle fade.
  typical: { ...DEFAULT_BAND, noise: 0.22, qsb: 0.3, qsbPeriodS: 9, qrn: 0.12, filterHz: 500 },
  // Long path, summer static, someone else nearby.
  poor: {
    noise: 0.45, qsb: 0.65, qsbPeriodS: 5, qrn: 0.4,
    qrm: 0.35, qrmOffsetHz: 350, filterHz: 500,
  },
  // A crowded band: the interference is another operator, not weather.
  contest: {
    noise: 0.2, qsb: 0.15, qsbPeriodS: 12, qrn: 0.05,
    qrm: 0.6, qrmOffsetHz: 250, filterHz: 400,
  },
});

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Clamp every field into its supported range. */
export function normalise(settings: BandSettings): BandSettings {
  return {
    noise: clamp01(settings.noise),
    qsb: clamp01(settings.qsb),
    qsbPeriodS: Math.min(60, Math.max(1, settings.qsbPeriodS)),
    qrn: clamp01(settings.qrn),
    qrm: clamp01(settings.qrm),
    qrmOffsetHz: Math.min(2000, Math.max(-2000, settings.qrmOffsetHz)),
    filterHz: Math.min(FILTER_MAX_HZ, Math.max(FILTER_MIN_HZ, settings.filterHz)),
  };
}

/**
 * Signal level at a moment, as a multiplier on the wanted station.
 *
 * QSB is modelled as a slow sine rather than anything random: real fading on
 * a given path has a rhythm to it, and a student learns to ride the peaks and
 * wait out the troughs. Random wobble teaches nothing.
 *
 * Depth 1 takes the signal to zero at the trough; depth 0 leaves it flat.
 */
export function fadeAt(timeS: number, settings: BandSettings): number {
  const { qsb, qsbPeriodS } = normalise(settings);
  if (qsb === 0) return 1;
  const phase = (2 * Math.PI * timeS) / qsbPeriodS;
  // Sine mapped to 0..1, then scaled so depth controls how far it dips.
  const swing = (Math.sin(phase) + 1) / 2;
  return 1 - qsb + qsb * swing;
}

/**
 * How much the receiver's filter attenuates a signal this far off centre.
 *
 * A real filter does not have a wall at its edge, so this is a smooth
 * roll-off: full strength inside the passband, falling away outside it. It
 * is what makes narrowing the filter a usable defence against QRM rather
 * than a switch.
 */
export function filterResponse(offsetHz: number, settings: BandSettings): number {
  const { filterHz } = normalise(settings);
  const halfWidth = filterHz / 2;
  const distance = Math.abs(offsetHz);
  if (distance <= halfWidth) return 1;
  // Down 6 dB (to a half) one half-width beyond the edge, and on from there.
  const beyond = (distance - halfWidth) / halfWidth;
  return 1 / (1 + beyond * beyond * 3);
}

/**
 * Whether a static crash starts in this slice of time, and how loud.
 *
 * QRN is genuinely random, unlike QSB — a lightning discharge has no rhythm.
 * `random` is injected so drills can be reproduced exactly.
 */
export function crashIn(
  sliceS: number,
  settings: BandSettings,
  random: () => number,
): { hit: boolean; level: number } {
  const { qrn } = normalise(settings);
  if (qrn === 0) return { hit: false, level: 0 };
  // At qrn = 1, roughly four crashes a second; at 0.1, one every 2.5 seconds.
  const expected = qrn * 4 * sliceS;
  const hit = random() < expected;
  // Crashes vary in size; most are small, a few are loud.
  const level = hit ? qrn * (0.3 + 0.7 * random() ** 2) : 0;
  return { hit, level };
}

/**
 * A rough signal-to-noise figure for the wanted station, in dB.
 *
 * Shown to the member so "poor conditions" is a number rather than a mood,
 * and so the effect of narrowing the filter is visible rather than folklore.
 */
export function signalToNoiseDb(settings: BandSettings): number {
  const s = normalise(settings);
  // Narrowing the filter cuts the noise that gets through, proportionally.
  const noiseThrough = s.noise * Math.sqrt(s.filterHz / 500);
  if (noiseThrough <= 0) return 40;
  // The wanted signal sits at 1; average the fade rather than taking a peak.
  const meanSignal = 1 - s.qsb / 2;
  const ratio = meanSignal / noiseThrough;
  return Math.max(-10, Math.min(40, 20 * Math.log10(ratio)));
}

/** A one-line description of what the member is about to hear. */
export function describe(settings: BandSettings): string {
  const s = normalise(settings);
  const parts: string[] = [];
  if (s.noise < 0.1) parts.push('quiet band');
  else if (s.noise < 0.3) parts.push('some hiss');
  else parts.push('noisy');
  if (s.qsb > 0.45) parts.push('deep fading');
  else if (s.qsb > 0.15) parts.push('slow fading');
  if (s.qrn > 0.3) parts.push('heavy static');
  else if (s.qrn > 0.08) parts.push('occasional crashes');
  if (s.qrm > 0.45) parts.push('strong interference');
  else if (s.qrm > 0.1) parts.push('another station nearby');
  parts.push(`${String(Math.round(s.filterHz))} Hz filter`);
  return parts.join(', ');
}
