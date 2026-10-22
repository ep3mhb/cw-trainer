/**
 * The panadapter (RFP §7, the tuning interface): one row of a spectrum for
 * the band scope's display, synthesised from what the receiver knows.
 *
 * There is no RF here to analyse. What the application knows is exactly
 * what a real panadapter would show: where each station is, how strong it
 * is at this receiver, whether its key is down at this instant, and how
 * noisy the band is. So the spectrum is drawn from those facts: a noise
 * floor whose level follows the band-conditions preset, and a peak for each
 * station that is keying — narrow, because CW is narrow, and gone the
 * moment the key comes up. Rows stacked over time make the waterfall, on
 * which a CW signal appears as its own dits and dahs: a display that shows
 * the code being sent is the point, and a fake carrier that never moves
 * would teach a member to trust a picture over their ears.
 *
 * Pure: bins in, levels out (0..1). The canvas is the caller's.
 */

export interface SpectrumStation {
  /** Position across the band, 0..1. */
  frac: number;
  /** Strength at this receiver, 0..1 (before the receiver's filter). */
  level: number;
  /** Key down at this instant. */
  on: boolean;
}

export interface SpectrumInput {
  bins: number;
  stations: readonly SpectrumStation[];
  /** Band noise, 0..1, from the conditions preset. */
  noise: number;
  /** Uniform random in [0, 1). Injected so a frame is reproducible. */
  random: () => number;
  /**
   * How wide a signal is drawn, as a fraction of the display. Defaults to
   * CW_WIDTH_FRAC, which is the true width of CW across a whole band and
   * right for the band tab. The landing view (A38) shows a hand's breadth
   * of band blown up to fill a hero, where the true width is a hairline,
   * so it passes a wider one. Nothing about the signal changes — only how
   * many pixels it is painted across.
   */
  widthFrac?: number;
}

/** How wide a CW signal is on the display, as a fraction of the band. */
export const CW_WIDTH_FRAC = 0.0022;

/**
 * One row. Each bin is the noise floor plus the strongest peak covering it;
 * peaks are Gaussian about the station and only present while it keys.
 */
export function spectrumRow(input: SpectrumInput): Float32Array {
  const row = new Float32Array(input.bins);
  // A quiet band still shows a floor — a real receiver is never silent —
  // and the preset raises it. 0.06 (quiet) → ~0.10; 0.45 (poor) → ~0.30.
  const floor = 0.06 + input.noise * 0.5;
  for (let i = 0; i < input.bins; i += 1) {
    // Noise: floor with a spread that grows with the noise itself.
    const n = floor * (0.55 + input.random() * 0.9) * (0.8 + input.noise * 0.6);
    row[i] = Math.min(1, n);
  }
  const sigma = (input.widthFrac ?? CW_WIDTH_FRAC) * input.bins;
  for (const s of input.stations) {
    if (!s.on || s.level <= 0) continue;
    const centre = s.frac * input.bins;
    const reach = Math.ceil(sigma * 4);
    const from = Math.max(0, Math.floor(centre - reach));
    const to = Math.min(input.bins - 1, Math.ceil(centre + reach));
    // Peak height: the floor plus the station above it, so a weak station
    // sits just over the noise and a strong one stands well clear.
    const height = Math.min(1, 0.25 + s.level * 0.75);
    for (let i = from; i <= to; i += 1) {
      // Distance from the bin's nearest edge, so the bin holding the carrier
      // is at full height whether the carrier sits at its centre or its edge.
      const d = Math.max(0, Math.abs(i + 0.5 - centre) - 0.5) / sigma;
      const v = height * Math.exp(-0.5 * d * d);
      if (v > (row[i] as number)) row[i] = v;
    }
  }
  return row;
}

/**
 * The waterfall's colour for a level, as RGB 0..255. The ramp is the one
 * SDR displays have made familiar: black, deep blue, cyan, then white and
 * yellow at the top, so a strong CW signal reads as a bright line and the
 * noise as a blue haze.
 */
export function waterfallColour(level: number): [number, number, number] {
  const v = Math.min(1, Math.max(0, level));
  if (v < 0.25) { const t = v / 0.25; return [0, Math.round(10 * t), Math.round(40 + 120 * t)]; }
  if (v < 0.5) { const t = (v - 0.25) / 0.25; return [0, Math.round(10 + 190 * t), Math.round(160 + 80 * t)]; }
  if (v < 0.75) { const t = (v - 0.5) / 0.25; return [Math.round(255 * t), Math.round(200 + 55 * t), 240]; }
  const t = (v - 0.75) / 0.25;
  return [255, 255, Math.round(240 - 200 * t)];
}

/**
 * Where a key IS at a given instant, from transitions that were scheduled
 * ahead of time. Both our own keyer and a remote station's transitions are
 * known before they sound — the keyer emits whole elements, the link
 * schedules play-out a buffer ahead — so asking "is the key down now?" of
 * the last transition would show the display early. This keeps the queue
 * and answers for the clock time the caller passes.
 */
export class KeyTrace {
  private readonly queue: { atMs: number; down: boolean }[] = [];
  private state = false;

  push(atMs: number, down: boolean): void {
    this.queue.push({ atMs, down });
    if (this.queue.length > 512) this.queue.splice(0, this.queue.length - 512);
  }

  /** The key state at `nowMs`, consuming what has already happened. */
  at(nowMs: number): boolean {
    while (this.queue.length > 0 && (this.queue[0] as { atMs: number }).atMs <= nowMs) {
      this.state = (this.queue.shift() as { down: boolean }).down;
    }
    return this.state;
  }
}
