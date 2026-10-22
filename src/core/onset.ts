/**
 * Onset detection for the loopback latency probe.
 *
 * Pure array arithmetic, kept out of the Web Audio code so it can be tested
 * properly: this is the part that decides the measurement, and a subtly wrong
 * threshold would produce a confident wrong number, which is worse than no
 * number at all.
 */

export interface OnsetOptions {
  /**
   * How many times above the noise floor a sample must be to count as the
   * click arriving. Low values trigger on room noise; high values miss a
   * quiet return and over-report the delay.
   */
  thresholdRatio: number;
  /** Samples at the start used to establish the noise floor. */
  noiseWindow: number;
  /** Ignore anything before this sample (the click cannot arrive early). */
  searchFrom: number;
}

export const DEFAULT_ONSET: Readonly<OnsetOptions> = Object.freeze({
  thresholdRatio: 8,
  noiseWindow: 2048,
  searchFrom: 0,
});

/** Root-mean-square of a slice — the noise floor, not the peak. */
export function rms(samples: Float32Array | readonly number[], from = 0, to?: number): number {
  const end = Math.min(to ?? samples.length, samples.length);
  const start = Math.max(0, Math.min(from, end));
  const count = end - start;
  if (count <= 0) return 0;
  let sum = 0;
  for (let i = start; i < end; i += 1) {
    const v = samples[i] as number;
    sum += v * v;
  }
  return Math.sqrt(sum / count);
}

export interface Onset {
  /** Index of the first sample above the threshold, or null if never. */
  index: number | null;
  noiseFloor: number;
  threshold: number;
  /** Loudest sample found in the search region — the click, if there is one. */
  peak: number;
  peakIndex: number;
}

export interface OnsetOptionsFull extends OnsetOptions {
  /**
   * How far above the noise floor the loudest sample must be before we accept
   * that anything happened at all. Below this, the recording is just a room.
   */
  minPeakRatio: number;
  /**
   * Once a peak is accepted, the onset is the first sample reaching this
   * fraction of it. Anchoring to the peak rather than to an absolute level is
   * what makes the probe work at any volume.
   */
  onsetFraction: number;
}

export const DEFAULT_ONSET_FULL: Readonly<OnsetOptionsFull> = Object.freeze({
  ...DEFAULT_ONSET,
  minPeakRatio: 4,
  onsetFraction: 0.3,
});

/**
 * Find where the click arrives.
 *
 * Two stages, deliberately: first decide whether anything happened at all by
 * comparing the loudest sample against the room, then find where that event
 * began. Anchoring the onset to the peak means the probe does not depend on
 * the member's volume setting — only on the click being audible above the
 * room, which is the thing we can honestly ask of them.
 *
 * Returns index null rather than guessing when nothing rose above the floor.
 * A silent recording means the microphone heard nothing, and reporting "0 ms"
 * there would be a lie.
 */
export function findOnset(
  samples: Float32Array | readonly number[],
  options: Partial<OnsetOptionsFull> = {},
): Onset {
  const opts: OnsetOptionsFull = { ...DEFAULT_ONSET_FULL, ...options };
  const noiseFloor = rms(samples, 0, opts.noiseWindow);
  const from = Math.max(0, opts.searchFrom);

  let peak = 0;
  let peakIndex = -1;
  for (let i = from; i < samples.length; i += 1) {
    const v = Math.abs(samples[i] as number);
    if (v > peak) {
      peak = v;
      peakIndex = i;
    }
  }

  // Did anything happen? An absolute floor covers a digitally silent room,
  // where any real signal should still count.
  const somethingHappened = peak >= Math.max(noiseFloor * opts.minPeakRatio, 1e-4);
  const threshold = Math.max(noiseFloor * opts.thresholdRatio, peak * opts.onsetFraction);
  if (!somethingHappened) {
    return { index: null, noiseFloor, threshold, peak, peakIndex };
  }

  for (let i = from; i < samples.length; i += 1) {
    if (Math.abs(samples[i] as number) >= threshold) {
      return { index: i, noiseFloor, threshold, peak, peakIndex };
    }
  }
  return { index: null, noiseFloor, threshold, peak, peakIndex };
}

/**
 * Moving-RMS envelope, one value every `hop` samples.
 *
 * Computed with a running sum of squares, so the cost is one pass regardless
 * of the window. The window must span more than one cycle of the click's
 * carrier or the envelope follows the waveform instead of its outline: at
 * 1 kHz that means at least 1 ms.
 */
export function envelope(
  samples: Float32Array | readonly number[],
  windowSamples: number,
  hopSamples: number,
): Float32Array {
  const n = samples.length;
  const w = Math.max(1, Math.floor(windowSamples));
  const hop = Math.max(1, Math.floor(hopSamples));
  const count = n <= 0 ? 0 : Math.floor((n - 1) / hop) + 1;
  const out = new Float32Array(count);
  if (count === 0) return out;

  // Prefix sums of squares: sq[i] is the total up to but not including i.
  const sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    const v = samples[i] as number;
    sq[i + 1] = (sq[i] as number) + v * v;
  }
  for (let k = 0; k < count; k += 1) {
    const start = k * hop;
    const end = Math.min(n, start + w);
    const len = end - start;
    out[k] = len <= 0 ? 0 : Math.sqrt(((sq[end] as number) - (sq[start] as number)) / len);
  }
  return out;
}

/**
 * The room's own level, measured in a way a loud surprise cannot ruin.
 *
 * This was the RMS of the first 2048 samples — about forty milliseconds from
 * the instant the recorder starts — which quietly assumes the recording
 * begins in silence. On Safari it does not. A probe run there reported a
 * room level of 0.1657 against a loudest sample of 0.0387: a floor four
 * times higher than the loudest thing in the recording, which is impossible
 * for a room and obvious once seen. A transient at the start of the capture
 * had been measured as though it were the room, and since the acceptance
 * bar is a multiple of the floor, the bar became 0.66 — a level no click
 * could ever reach. That browser would have rejected every click even if
 * nothing were removing them.
 *
 * Two changes, both about not trusting one sample of anything. The whole
 * stretch before the click is used rather than its first forty
 * milliseconds, which is six times the data and all of it genuinely
 * pre-click. And the figure is the *median* of the envelope rather than the
 * RMS of the waveform, so up to half the stretch can be contaminated
 * without moving the answer — where a single loud moment moves an RMS a
 * long way.
 */
export function roomLevel(
  samples: Float32Array | readonly number[],
  until: number,
  windowSamples = 64,
  hopSamples = 16,
): number {
  const end = Math.max(1, Math.min(Math.floor(until), samples.length));
  const env = envelope(
    samples instanceof Float32Array ? samples.subarray(0, end) : samples.slice(0, end),
    windowSamples,
    hopSamples,
  );
  if (env.length === 0) return 0;
  const sorted = Array.from(env).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

export interface MatchedOnsetOptions {
  /** Length of the click that was played, in samples. The thing we match. */
  clickSamples: number;
  /** Envelope window, in samples. Must exceed one cycle of the carrier. */
  windowSamples: number;
  /** Envelope hop, in samples — the timing resolution of the search. */
  hopSamples: number;
  /** Ignore anything before this sample; the click cannot arrive early. */
  searchFrom: number;
  /** Samples at the start used to establish the noise floor. */
  noiseWindow: number;
  /**
   * How far above the room the click's own RMS must be before we accept that
   * it arrived at all.
   *
   * Deliberately the same value the threshold detector used, even though the
   * integrated statistic below would justify a lower one: averaging the
   * envelope over the whole click cuts the *variance* of the noise by about
   * the square root of the number of points, so a click at twice the room
   * level is already many standard errors clear. Lowering it would very
   * likely recover the clicks Safari is losing — and would also, if those
   * survivors are room reflections rather than the click, turn a measurement
   * the application currently refuses into one it reports with confidence.
   * That trade is not worth making until the tone diagnostic says which.
   */
  minPeakRatio: number;
  /**
   * A correlation peak this far up on the best one is taken as the click,
   * even if a later peak is stronger.
   *
   * The direct sound arrives first and reflections arrive later. Taking the
   * strongest peak would, in a room where the direct path is attenuated more
   * than its echo, time the echo — which is the shape the Safari readings
   * have. A first arrival below about a third of the strongest peak is
   * unusual enough to leave alone; the floor below keeps this from ever
   * reaching down into the noise.
   */
  acceptFraction: number;
}

export const DEFAULT_MATCHED: Readonly<Omit<MatchedOnsetOptions, 'clickSamples'>> = Object.freeze({
  // 1.45 ms at 44.1 kHz — comfortably more than one cycle of a 1 kHz click.
  windowSamples: 64,
  // 0.36 ms at 44.1 kHz. The old recorder quantised timing to a 46 ms block,
  // so this is not the limit on the measurement; it is simply cheap.
  hopSamples: 16,
  searchFrom: 0,
  noiseWindow: 2048,
  minPeakRatio: 4,
  acceptFraction: 0.35,
});

/**
 * Find where the click arrives, by matching the shape we played.
 *
 * `findOnset` above asks "when did a sample first exceed a threshold", which
 * is a decision taken on one sample and is therefore at the mercy of that
 * sample: a chair creak crosses the line and becomes the onset, and a click
 * that merely fails to cross is lost entirely.
 *
 * This asks a different question — "where does the recording most look like a
 * click of the length we played" — and answers it from the whole 30 ms rather
 * than from one instant. Correlating a rectangular envelope against the
 * recording's envelope is a moving average, and the correlation of a box with
 * a box is a triangle whose peak sits exactly on the start of the click, so
 * the argument that maximises it is the answer with no threshold involved.
 *
 * The reference is one envelope window longer than the click, because the
 * moving RMS smears each edge by that much; matching the smeared shape is
 * what keeps the peak on the true start instead of half a window late.
 */
export function findOnsetMatched(
  samples: Float32Array | readonly number[],
  options: Partial<MatchedOnsetOptions> & { clickSamples: number },
): Onset {
  const opts: MatchedOnsetOptions = { ...DEFAULT_MATCHED, ...options };
  const hop = Math.max(1, Math.floor(opts.hopSamples));
  const from = Math.max(0, Math.floor(opts.searchFrom));
  // Everything before the click is, by construction, room — so use all of it
  // rather than the opening 40 ms. With no search offset (a bare call, or a
  // test) fall back to the old window.
  const noiseFloor = roomLevel(
    samples,
    from > opts.noiseWindow ? from : opts.noiseWindow,
    opts.windowSamples,
    hop,
  );

  let peak = 0;
  let peakIndex = -1;
  for (let i = from; i < samples.length; i += 1) {
    const v = Math.abs(samples[i] as number);
    if (v > peak) {
      peak = v;
      peakIndex = i;
    }
  }

  const env = envelope(samples, opts.windowSamples, hop);
  const refLen = Math.max(1, Math.round((opts.clickSamples + opts.windowSamples) / hop));
  const firstK = Math.floor(from / hop);
  const lastK = env.length - refLen;
  const threshold = Math.max(noiseFloor * opts.minPeakRatio, 1e-4);

  if (lastK < firstK) {
    return { index: null, noiseFloor, threshold, peak, peakIndex };
  }

  // The matched filter itself: the mean envelope over a click's length, at
  // every position. A running sum keeps it one pass.
  const score = new Float64Array(lastK - firstK + 1);
  let window = 0;
  for (let i = firstK; i < firstK + refLen; i += 1) window += env[i] as number;
  score[0] = window / refLen;
  for (let k = firstK + 1; k <= lastK; k += 1) {
    window += (env[k + refLen - 1] as number) - (env[k - 1] as number);
    score[k - firstK] = window / refLen;
  }

  let best = 0;
  for (const v of score) if (v > best) best = v;
  if (best < threshold) {
    return { index: null, noiseFloor, threshold, peak, peakIndex };
  }

  // Earliest local maximum worth taking, so an echo cannot outvote the sound
  // that reached the microphone first.
  // Never reach below the bar the whole measurement had to clear, or a lucky
  // bump in the room becomes "the first arrival".
  const wanted = Math.max(best * opts.acceptFraction, threshold);
  let chosen = -1;
  for (let i = 0; i < score.length; i += 1) {
    const v = score[i] as number;
    if (v < wanted) continue;
    const rising = i === 0 || v >= (score[i - 1] as number);
    const falling = i === score.length - 1 || v >= (score[i + 1] as number);
    if (rising && falling) {
      chosen = i;
      break;
    }
  }
  if (chosen < 0) {
    for (let i = 0; i < score.length; i += 1) if ((score[i] as number) === best) { chosen = i; break; }
  }

  /*
   * The envelope window looks forward: env[k] covers [k, k + window), so it
   * starts rising a whole window *before* the click does. The correlation
   * peak therefore sits one window early, and that offset — 1.45 ms at the
   * default settings — is a systematic error in every reading, not noise.
   * It is added back here rather than hidden in the reference length.
   */
  const index = Math.max(from, (firstK + chosen) * hop + Math.floor(opts.windowSamples));
  return { index, noiseFloor, threshold, peak, peakIndex };
}

/**
 * The median of a set of measurements, which is what a latency probe should
 * report: one bad reading from a door slamming must not move the answer.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/** Spread of the measurements, used to decide whether to trust the median. */
export function spread(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

export interface Measurement {
  /** Median round-trip, in ms. */
  roundTripMs: number;
  /** What the probe saw while measuring; absent for a bare summarise(). */
  diagnostics?: unknown;
  /** Standard deviation across the runs, in ms. */
  spreadMs: number;
  samplesMs: number[];
  /**
   * Which run each surviving reading came from, 1-based, parallel to
   * samplesMs. Absent for a bare summarise().
   *
   * Kept because the pattern of WHICH runs survive is evidence the median
   * cannot carry. Safari on an Intel Mac returned exactly three readings on
   * six consecutive attempts — a regularity that wants explaining, and the
   * leading hypothesis (the echo canceller converges after the first few
   * clicks, so only early runs survive) is testable from these indexes and
   * from nothing else the probe keeps.
   */
  runIndexes?: number[];
  /**
   * Whether the readings agree well enough to be worth showing. A wide
   * spread means the room, not the audio path, is what was measured.
   */
  confident: boolean;
}

/** Fewest readings worth taking a median of. */
export const MIN_READINGS = 3;

/** Combine several runs into one answer, with an honest confidence flag. */
export function summarise(
  samplesMs: readonly number[],
  maxSpreadMs = 15,
  runIndexes?: readonly number[],
): Measurement {
  const usable: number[] = [];
  const usableRuns: number[] = [];
  samplesMs.forEach((v, i) => {
    if (!Number.isFinite(v) || v < 0) return;
    usable.push(v);
    usableRuns.push(runIndexes?.[i] ?? i + 1);
  });
  const roundTripMs = median(usable);
  const spreadMs = spread(usable);
  return {
    roundTripMs,
    spreadMs,
    samplesMs: [...usable],
    ...(runIndexes === undefined ? {} : { runIndexes: usableRuns }),
    confident: usable.length >= MIN_READINGS && spreadMs <= maxSpreadMs,
  };
}

/**
 * Why a measurement should not be trusted — and they are not the same fault.
 *
 * Too few readings means the microphone is rarely picking the click out of
 * the room: turn the volume up, use speakers. Disagreement means it is being
 * heard but the room is confusing the timing: go somewhere quieter. Telling
 * a member the second when the truth is the first sends them to fix nothing,
 * which is what the Send tab did until 12 October 2026 — it reported
 * "readings disagreed too much to trust (spread 0 ms)" over a single
 * reading, where a spread of zero is perfect agreement.
 */
export interface ProbeLevels {
  noiseFloor: number;
  peak: number;
  sampleRate: number;
}

/**
 * What one run of the probe saw.
 *
 * 0.8.12 kept only the maximum floor and the maximum peak across all seven
 * runs, which cannot answer the question the levels exist to answer. On
 * 13 October 2026 Chrome reported room 0.0115 / loudest 0.5477 having heard
 * seven clicks of seven, and Safari on the same machine reported room 0.0071
 * / loudest 0.4881 having heard two. The aggregates are within twelve per
 * cent of each other; the behaviour could hardly differ more. A maximum over
 * seven runs is the peak of whichever run worked, so five silent runs leave
 * no trace in it at all.
 */
export interface RunLevel {
  /** 1-based run number. */
  run: number;
  noiseFloor: number;
  peak: number;
  /** Did this run produce a usable reading? */
  heard: boolean;
  /**
   * Was this run in a fit state to be judged at all? Absent means yes.
   *
   * A run with no measured room cannot be judged, because the acceptance bar
   * is a multiple of the room with an absolute floor of 1e-4 beneath it: at a
   * room of zero the bar collapses to that floor and anything at all is
   * accepted. Safari, 13 October 2026, returned `room 0.0000, loudest 0.0255`
   * on its first run and the application called it heard, while the same
   * session's genuine arrivals were at 0.2248 and the other five runs sat at
   * 0.0077. The reading was an artefact of a threshold with nothing behind
   * it, and it is the reason run 1 appeared as a survivor three sessions
   * running.
   */
  usable?: boolean;
}

/**
 * A room quieter than this is not a measured room, it is a recorder that has
 * not started yet. Real rooms on the machines seen so far sit at 0.003-0.012.
 */
export const MIN_ROOM_LEVEL = 1e-5;

/** A sample magnitude at or above this is past full scale: the input clipped. */
export const FULL_SCALE = 1;

/** The levels the probe recorded, if this measurement carries any. */
export function levelsOf(m: Measurement): ProbeLevels | null {
  const d: unknown = m.diagnostics;
  if (typeof d !== 'object' || d === null) return null;
  const { noiseFloor, peak, sampleRate } = d as Record<string, unknown>;
  if (typeof noiseFloor !== 'number' || typeof peak !== 'number' || typeof sampleRate !== 'number') {
    return null;
  }
  return { noiseFloor, peak, sampleRate };
}

/** The per-run levels, if this measurement carries them. */
export function runLevelsOf(m: Measurement): RunLevel[] | null {
  const d: unknown = m.diagnostics;
  if (typeof d !== 'object' || d === null) return null;
  const { runs } = d as Record<string, unknown>;
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const out: RunLevel[] = [];
  for (const r of runs as unknown[]) {
    if (typeof r !== 'object' || r === null) return null;
    const { run, noiseFloor, peak, heard, usable } = r as Record<string, unknown>;
    if (
      typeof run !== 'number' ||
      typeof noiseFloor !== 'number' ||
      typeof peak !== 'number' ||
      typeof heard !== 'boolean'
    ) {
      return null;
    }
    out.push({
      run,
      noiseFloor,
      peak,
      heard,
      ...(typeof usable === 'boolean' ? { usable } : {}),
    });
  }
  return out;
}

/** Runs where the input went past full scale, so the recording is clipped. */
export function clippedRuns(levels: readonly RunLevel[]): RunLevel[] {
  return levels.filter((r) => r.peak >= FULL_SCALE);
}

/** Runs the probe could not judge, so no verdict may rest on them. */
export function unusableRuns(levels: readonly RunLevel[]): RunLevel[] {
  return levels.filter((r) => r.usable === false);
}

/** Did this run measure a room it could set a threshold against? */
export function runIsJudgeable(noiseFloor: number, peak: number): boolean {
  return noiseFloor > MIN_ROOM_LEVEL && peak > 0;
}

/**
 * Was the recording driven past full scale?
 *
 * Samples run -1 to +1 and Web Audio does not clamp what getUserMedia hands
 * over, so a magnitude above 1 is the input overloading. Safari at maximum
 * output on 13 October 2026 returned a peak of 2.0241 — more than double
 * full scale. Clipping flattens the very shape `findOnsetMatched` recognises
 * the click by, so a clipped run is not a run whose timing can be trusted,
 * and more volume is the opposite of the fix.
 */
export function measurementOverloaded(m: Measurement): boolean {
  const runs = runLevelsOf(m);
  if (runs !== null) return clippedRuns(runs).length > 0;
  const levels = levelsOf(m);
  return levels !== null && levels.peak >= FULL_SCALE;
}

/**
 * Did the clicks that went missing go missing because nothing arrived?
 *
 * The question is asked of the runs that produced no reading, which is the
 * only place an answer can live. If most of those runs recorded nothing above
 * their own room, the sound was taken away before the microphone heard it.
 * If they recorded something loud and it still was not timed, that is a
 * detector problem wearing the same clothes, and saying so is the point of
 * separating them.
 *
 * Falls back to the 0.8.12 aggregate test only when per-run levels are
 * absent, which is a bare summarise() or a measurement from an older build.
 */
export function measurementRemoved(m: Measurement): boolean {
  const runs = runLevelsOf(m);
  if (runs === null) {
    const levels = levelsOf(m);
    return levels !== null && looksRemoved(levels.peak, levels.noiseFloor);
  }
  const missed = runs.filter((r) => r.usable !== false && !r.heard && r.peak > 0);
  if (missed.length === 0) return false;
  const stripped = missed.filter((r) => looksRemoved(r.peak, r.noiseFloor));
  return stripped.length * 2 >= missed.length;
}

/**
 * Is the click arriving loudly on at least one run?
 *
 * If it is, telling the member to raise the volume is wrong whatever else is
 * wrong. Safari reached 69 times its own room level on 13 October while
 * hearing two clicks in seven, and the application was still advising more
 * volume.
 */
export function soundArrivedLoudly(m: Measurement): boolean {
  const runs = runLevelsOf(m);
  const pairs =
    runs !== null
      ? runs.filter((r) => r.usable !== false).map((r) => ({ peak: r.peak, floor: r.noiseFloor }))
      : (() => {
          const l = levelsOf(m);
          return l === null ? [] : [{ peak: l.peak, floor: l.noiseFloor }];
        })();
  return pairs.some((p) => p.floor > 0 && p.peak >= p.floor * LOUD_RATIO);
}

/** Loud enough that quietness cannot be the complaint. */
export const LOUD_RATIO = 20;

/**
 * Why a measurement should not be trusted — asked of the levels before the
 * readings, because a removed-sound run can agree with itself.
 *
 * 0.8.11 put the removed-sound test inside the 'too-few' branch, on the
 * assumption that stripped sound shows up as clicks going missing. Six
 * consecutive Safari runs on 13 October 2026 disproved it: every one
 * returned exactly MIN_READINGS readings, so 'too-few' was never reached
 * and the test could not fire on the browser it was written for. One of the
 * six agreed with itself to 12.1 ms against a limit of 15 and was published
 * as "Measured 106.7 ms", 43 ms away from what Chrome measured on the same
 * machine minutes later.
 *
 * Whether the sound was removed is a property of what the microphone
 * received. It cannot be inferred from how many readings survived counting,
 * so it is asked first and it is asked of the levels.
 */
export function doubtReason(
  m: Measurement,
): 'overloaded' | 'removed' | 'too-few' | 'disagree' | null {
  // Clipping comes first: it breaks the detector's premise, so nothing
  // downstream of it — including a tidy set of readings — means anything.
  if (measurementOverloaded(m)) return 'overloaded';
  if (measurementRemoved(m)) return 'removed';
  if (m.confident) return null;
  return m.samplesMs.length < MIN_READINGS ? 'too-few' : 'disagree';
}

/** "1 click", "5 clicks" — a plural that reads as an oversight when it is wrong. */
function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * The one line the Send tab prints under the measure button.
 *
 * It used to be written once, unconditionally, in the voice of a good
 * measurement — "Measured 6.8 ms round trip (spread 0.0 ms over 1 clicks)"
 * — directly beneath a warning saying that figure could not be trusted.
 * Two statements about the same number pointing in opposite directions, and
 * the member reads the one with the number in it. 0.8.8 made the warning
 * honest, which is what made the contradiction visible.
 *
 * It also explained the distance to the browser's own figure in one
 * direction only, assuming the round trip is the larger of the two. When it
 * is not — as on a Safari run that measured 6.8 ms against a reported 8 ms
 * one-way — the explanation described a gap pointing the other way. A round
 * trip contains the one-way path and the whole microphone path besides, so
 * it cannot be the smaller number; whichever of the two is wrong, saying
 * nothing about it is worse than saying so.
 */
export function describeMeasurement(m: Measurement, engineTotalMs: number, runs: number): string {
  const heard = m.samplesMs.length;
  const reason = doubtReason(m);

  if (reason === 'overloaded') {
    return (
      'The microphone input overloaded, so the recording is clipped and nothing in it can be timed. ' +
      'See the note above.'
    );
  }

  if (reason === 'removed') {
    return (
      `${count(heard, 'reading')} of ${String(runs)} came back; on the clicks that went missing ` +
      'nothing rose above the room, so the click was not there to be timed. See the note above.'
    );
  }

  if (reason === 'too-few') {
    return (
      `Only ${String(heard)} of ${String(runs)} clicks ${heard === 1 ? 'was' : 'were'} heard, ` +
      'which is too few to measure from. See the note above.'
    );
  }

  if (reason === 'disagree') {
    return (
      `The ${count(heard, 'reading')} gave a median of ${m.roundTripMs.toFixed(1)} ms but spread ` +
      `${m.spreadMs.toFixed(1)} ms, which is too much to trust. See the note above.`
    );
  }

  const head =
    `Measured ${m.roundTripMs.toFixed(1)} ms round trip (spread ${m.spreadMs.toFixed(1)} ms over ` +
    `${count(heard, 'click')}); the browser reported ${engineTotalMs.toFixed(0)} ms one-way. `;

  return m.roundTripMs > engineTotalMs
    ? head +
        'The gap between them is mostly the microphone\u2019s own input delay plus the sound\u2019s ' +
        'flight time across the room, so the round trip is an upper bound on what you feel at the key.'
    : head +
        'That is below the browser\u2019s own one-way figure, which cannot both be true \u2014 a round ' +
        'trip contains the one-way path and the whole microphone path besides. The browser\u2019s ' +
        'number is the one to distrust; it goes stale.';
}

/**
 * Which colour the headline latency badge should wear.
 *
 * The badge shows one of two quite different quantities and used one scale
 * for both. The threshold is for the ONE-WAY path, key press to sidetone.
 * A measured figure is a ROUND TRIP: out through the speaker, across the
 * room, back through the whole microphone path. It is always the larger,
 * and the note under the badge has always read it as an upper bound in
 * three bands — fine up to the threshold, borderline to twice it, bad
 * beyond. The colour did not follow, so a measured 63.2 ms went red against
 * a one-way limit of 60, directly above a paragraph saying "probably fine".
 */
export function latencyTone(
  shownMs: number,
  warnMs: number,
  isRoundTrip: boolean,
): 'good' | 'warn' | 'bad' {
  const bad = isRoundTrip ? warnMs * 2 : warnMs;
  const warn = isRoundTrip ? warnMs : warnMs * 0.6;
  return shownMs > bad ? 'bad' : shownMs > warn ? 'warn' : 'good';
}

/**
 * Did the click never rise above the room, however loud the speaker?
 *
 * Measured on a Mac, 12 October 2026: a 1 kHz tone audible across the room
 * reached Safari's microphone at 0.0035 against a room of 0.0034, while
 * Chrome and Firefox on the same machine, speaker and volume received it at
 * 0.0507 and 0.0524 — within three per cent of each other. About 23 dB
 * removed. A browser that strips what the machine has just played is doing
 * the right thing for a video call and making this measurement impossible.
 *
 * Judged by the symptom, never by sniffing the browser, so an engine that
 * starts behaving this way tomorrow is covered without a code change.
 */
export function looksRemoved(peak: number, noiseFloor: number): boolean {
  return peak > 0 && peak < noiseFloor * 3;
}
