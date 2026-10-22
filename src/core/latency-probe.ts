/**
 * Loopback latency probe (RFP §5: "The application must measure round-trip
 * latency from key press to sidetone").
 *
 * Why this exists rather than trusting AudioContext.outputLatency: measured
 * on one MacBook Pro, on the built-in output, with nothing else connected,
 * the three browsers reported wildly different figures for identical
 * hardware — Safari 190 ms, Chrome 24 ms, Firefox 15.7 ms. Safari also
 * reported 8.9 ms for the same machine in an earlier run.
 *
 * The figure also goes stale. Once AirPods have been used, Safari reported
 * 190 ms for the built-in speakers and kept doing so across page reloads and
 * reopened windows; a full quit of the application brought it back to 8.9 ms.
 * The staleness lives in the browser process, so nothing this application can
 * do will reset it — a member who used headphones earlier would be told
 * sending practice was hopeless for the rest of that browser session.
 *
 * This plays a click and listens for it through the microphone, which is the
 * only way to measure the whole path the member actually experiences. It needs
 * microphone permission, so it is opt-in and never runs on its own.
 *
 * The number it returns is a true round trip: output path plus the microphone
 * input path. Input latency is usually small next to a Bluetooth output delay,
 * but it is included, so the figure is an upper bound rather than exact.
 */

import {
  findOnsetMatched,
  measurementOverloaded,
  measurementRemoved,
  runIsJudgeable,
  summarise,
  type Measurement,
  type RunLevel,
} from './onset';

export interface ProbeOptions {
  /** How many clicks to send. The median is reported. */
  runs: number;
  /** Seconds of recording captured per run. */
  captureSeconds: number;
  /** Click frequency in Hz — a short burst, not the sidetone. */
  clickHz: number;
  clickMs: number;
}

export const DEFAULT_PROBE: Readonly<ProbeOptions> = Object.freeze({
  runs: 7,
  captureSeconds: 0.6,
  clickHz: 1000,
  clickMs: 30,
});

export type ProbeFailure =
  | 'no-microphone-permission'
  | 'no-microphone'
  | 'not-supported'
  | 'no-audio-captured'
  | 'microphone-silent'
  | 'click-too-quiet'
  | 'sound-removed'
  | 'readings-unusable';

export class ProbeError extends Error {
  constructor(readonly reason: ProbeFailure, message: string) {
    super(message);
    this.name = 'ProbeError';
  }
}

/**
 * What the probe saw, whether or not it succeeded.
 *
 * Reported on failure as well as success, because "the microphone did not
 * hear the click" is three different faults with three different fixes, and
 * a member cannot tell them apart without these numbers.
 */
export interface ProbeDiagnostics {
  /** Audio frames the recorder actually delivered, across all runs. */
  framesCaptured: number;
  /** Loudest room level of any run, 0..1. Kept for the failure messages. */
  noiseFloor: number;
  /** Loudest thing heard in any run after its click was played. */
  peak: number;
  /**
   * What each run saw, in order.
   *
   * The two fields above are maxima and cannot distinguish seven runs that
   * worked from two that worked and five that heard nothing — on 13 October
   * 2026 Chrome and Safari produced aggregates within twelve per cent of
   * each other while hearing seven clicks and two. Every judgement about
   * what went wrong is made from this array; the maxima are kept only for
   * the outright-failure messages, where there is nothing else.
   */
  runs: RunLevel[];
  sampleRate: number;
}

export interface ProbeProgress {
  run: number;
  of: number;
}

/**
 * Run the probe against an already-running AudioContext, so the figure
 * describes the same output path the sidetone uses.
 */
export async function measureRoundTrip(
  ctx: AudioContext,
  options: Partial<ProbeOptions> = {},
  onProgress?: (progress: ProbeProgress) => void,
): Promise<Measurement> {
  const opts: ProbeOptions = { ...DEFAULT_PROBE, ...options };

  if (navigator.mediaDevices?.getUserMedia === undefined) {
    throw new ProbeError('not-supported', 'This browser cannot record from the microphone.');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // All three would distort or suppress the very click we are timing.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new ProbeError('no-microphone-permission', 'Microphone access was refused.');
    }
    if (name === 'NotFoundError') {
      throw new ProbeError('no-microphone', 'No microphone was found.');
    }
    throw new ProbeError('not-supported', 'The microphone could not be opened.');
  }

  const source = ctx.createMediaStreamSource(stream);
  const sampleRate = ctx.sampleRate;

  let capture: Float32Array | null = null;
  let captureWritten = 0;
  /**
   * When each piece of the recording happened, on the audio clock.
   *
   * Timing the onset against the *first* callback was the original mistake:
   * that single estimate is quantised by a whole block and its error lands
   * directly in every measurement. Keeping a timestamp per piece means the
   * onset is timed against the piece that actually contained it.
   */
  let blocks: { sample: number; time: number }[] = [];

  const take = (samples: Float32Array, time: number): void => {
    if (capture === null) return;
    blocks.push({ sample: captureWritten, time });
    const room = capture.length - captureWritten;
    const n = Math.min(room, samples.length);
    if (n > 0) capture.set(samples.subarray(0, n), captureWritten);
    captureWritten += n;
  };

  /*
   * The recorder, on the audio thread if this browser will have it.
   *
   * An AudioWorkletProcessor is handed audio in 128-frame quanta together
   * with `currentFrame`, the exact index of the first of them on the
   * context's own timeline. That is the whole point: the timestamp is not an
   * estimate taken on the main thread after the fact, it is the audio clock
   * itself, so nothing the page happens to be doing can smear it.
   *
   * The comment this replaces said a worklet was impossible because the
   * single-file build cannot carry a second module. A module compiled from a
   * Blob URL is still one file, so it was possible all along — which is worth
   * recording, because that sentence stopped anyone looking for two releases.
   */
  const WORKLET = `
    class ProbeRecorder extends AudioWorkletProcessor {
      constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; this.at = 0; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (!ch) return true;
        let i = 0;
        while (i < ch.length) {
          if (this.n === 0) this.at = currentFrame + i;
          const n = Math.min(this.buf.length - this.n, ch.length - i);
          this.buf.set(ch.subarray(i, i + n), this.n);
          this.n += n; i += n;
          if (this.n === this.buf.length) {
            this.port.postMessage({ at: this.at, samples: this.buf.slice(0) });
            this.n = 0;
          }
        }
        return true;
      }
    }
    registerProcessor('cw-probe-recorder', ProbeRecorder);
  `;

  let node: AudioNode;
  let worklet: AudioWorkletNode | null = null;
  let legacy: ScriptProcessorNode | null = null;
  let moduleUrl: string | null = null;

  try {
    if (ctx.audioWorklet === undefined) throw new Error('no audioWorklet');
    moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(moduleUrl);
    worklet = new AudioWorkletNode(ctx, 'cw-probe-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    worklet.port.onmessage = (event: MessageEvent): void => {
      const msg = event.data as { at: number; samples: Float32Array };
      take(msg.samples, msg.at / sampleRate);
    };
    node = worklet;
  } catch {
    /*
     * A content-security policy that forbids blob: scripts, or a browser
     * without worklets, lands here. The old recorder still works; it is
     * simply coarser, because its timestamps are read on the main thread and
     * quantised by a whole block.
     */
    if (moduleUrl !== null) {
      URL.revokeObjectURL(moduleUrl);
      moduleUrl = null;
    }
    const blockSize = 2048;
    legacy = ctx.createScriptProcessor(blockSize, 1, 1);
    legacy.onaudioprocess = (event): void => {
      const input = event.inputBuffer.getChannelData(0);
      // The block just handed to us finished at about this moment, so it
      // began one block-length earlier.
      take(input, ctx.currentTime - input.length / sampleRate);
    };
    node = legacy;
  }

  const silent = ctx.createGain();
  silent.gain.value = 0; // keep the node pulled without making it audible
  source.connect(node);
  node.connect(silent).connect(ctx.destination);

  /** Audio-clock time of one recorded sample, from its own piece's timestamp. */
  const timeOfSample = (index: number): number | null => {
    let found: { sample: number; time: number } | null = null;
    for (const block of blocks) {
      if (block.sample <= index) found = block;
      else break;
    }
    return found === null ? null : found.time + (index - found.sample) / sampleRate;
  };

  const samplesMs: number[] = [];
  /** Which run each reading came from, 1-based, parallel to samplesMs. */
  const sampleRuns: number[] = [];
  const diagnostics: ProbeDiagnostics = {
    framesCaptured: 0,
    noiseFloor: 0,
    peak: 0,
    runs: [],
    sampleRate,
  };
  try {
    /*
     * Run -1 is a warm-up and is thrown away.
     *
     * The first counted click used to be taken before the recorder had
     * settled, and it was unreliable in both directions. Safari, 13 October
     * 2026: at half output the first run reported a room level of 0.0000,
     * which collapses the acceptance bar to its absolute floor and admits
     * anything; at full output it reported a peak of 0.0000, meaning the
     * search window began past the end of what had been captured. Both were
     * read as data, and the first of them put run 1 among the survivors in
     * three consecutive sessions — a pattern that was an artefact of the
     * recorder starting, not of anything the browser was doing to the sound.
     *
     * One throwaway click costs under a second and removes the whole class.
     */
    for (let run = -1; run < opts.runs; run += 1) {
      const warmUp = run < 0;
      if (!warmUp) onProgress?.({ run: run + 1, of: opts.runs });

      capture = new Float32Array(Math.ceil(opts.captureSeconds * sampleRate));
      captureWritten = 0;
      blocks = [];

      // Let the recorder settle and establish a noise floor before clicking.
      await wait(150);

      const clickAt = ctx.currentTime + 0.12;
      playClick(ctx, clickAt, opts);

      await wait(opts.captureSeconds * 1000 + 120);
      if (warmUp) continue;

      const recorded = capture.subarray(0, captureWritten);
      diagnostics.framesCaptured += captureWritten;
      // Every run leaves a row, including one that recorded nothing. A run
      // missing from the table would be indistinguishable from a run that
      // heard the click, which is the confusion this table exists to end.
      const level: RunLevel = { run: run + 1, noiseFloor: 0, peak: 0, heard: false };
      diagnostics.runs.push(level);
      if (captureWritten === 0 || blocks.length === 0) continue;

      // Do not look for the click before it was played.
      const firstBlock = blocks[0] as { sample: number; time: number };
      const searchFrom = Math.max(0, Math.floor((clickAt - firstBlock.time) * sampleRate));
      const onset = findOnsetMatched(recorded, {
        searchFrom,
        clickSamples: Math.round((opts.clickMs / 1000) * sampleRate),
      });
      level.noiseFloor = onset.noiseFloor;
      level.peak = onset.peak;
      diagnostics.noiseFloor = Math.max(diagnostics.noiseFloor, onset.noiseFloor);
      diagnostics.peak = Math.max(diagnostics.peak, onset.peak);

      /*
       * A run with no measured room cannot be judged, and must not be read
       * as a run that heard the click.
       *
       * `findOnsetMatched` accepts a peak at four times the room or at an
       * absolute 1e-4, whichever is greater. The absolute floor is there for
       * a digitally silent room, where any real signal should count — but at
       * a measured room of zero it becomes the whole test, and a residue
       * thousands of times below the real arrival passes it. A peak of zero
       * means the search window began past the end of the recording and
       * nothing was examined at all. Neither is a reading.
       */
      if (!runIsJudgeable(onset.noiseFloor, onset.peak)) {
        level.usable = false;
        continue;
      }

      if (onset.index === null) continue;

      const heardAt = timeOfSample(onset.index);
      if (heardAt === null) continue;
      level.heard = true;
      samplesMs.push((heardAt - clickAt) * 1000);
      sampleRuns.push(run + 1);
    }
  } finally {
    if (legacy !== null) legacy.onaudioprocess = null;
    if (worklet !== null) worklet.port.onmessage = null;
    capture = null;
    try {
      source.disconnect();
      node.disconnect();
      silent.disconnect();
    } catch {
      /* already torn down */
    }
    if (moduleUrl !== null) URL.revokeObjectURL(moduleUrl);
    for (const track of stream.getTracks()) track.stop();
  }

  // A reading can exist and still be unusable. summarise() drops anything
  // negative or non-finite, and median([]) is 0 — which is how a probe that
  // picked up nothing usable came to report "0.0 ms round trip over 0 clicks"
  // as though it were an answer. Judge emptiness after the filter, not before.
  const summary = summarise(samplesMs, 15, sampleRuns);
  if (summary.samplesMs.length === 0) throw explainSilence(diagnostics, samplesMs.length);

  const measurement: Measurement = { ...summary, diagnostics };

  /*
   * Sound that never rose above the room was not timed, however well the
   * surviving readings happen to agree with one another.
   *
   * Confidence was decided by count and spread alone, and both can be met by
   * readings that are reverberation. Six consecutive Safari runs on an Intel
   * Mac, 13 October 2026, each returned exactly MIN_READINGS readings; one of
   * them agreed to 12.1 ms against a limit of 15 and was published as
   * "Measured 106.7 ms round trip", while Chrome on the same machine, same
   * speaker and same room measured 63.7 ms with a spread of 0.9 over seven
   * clicks. A confident figure 43 ms wrong is worse than a refusal.
   *
   * So the levels get a veto over the agreement test, here rather than in
   * summarise(), because summarise() is given readings and knows nothing
   * about what the microphone received.
   */
  if (measurementRemoved(measurement)) measurement.confident = false;

  /*
   * A clipped recording cannot be timed, however well its readings agree.
   * `findOnsetMatched` recognises the click by its shape, and clipping is
   * precisely the destruction of that shape, so a run driven past full scale
   * is a run whose timing is guesswork. Safari at maximum output on
   * 13 October 2026 returned a peak of 2.0241 against a full scale of 1.
   */
  if (measurementOverloaded(measurement)) measurement.confident = false;

  return measurement;
}

/**
 * Turn a failed probe into the right advice.
 *
 * Three quite different faults produce "no measurement", and telling a member
 * to turn the volume up when their microphone is delivering no audio at all
 * wastes their time.
 */
function explainSilence(d: ProbeDiagnostics, rawReadings = 0): ProbeError {
  const levels =
    ` (room level ${d.noiseFloor.toFixed(4)}, loudest ${d.peak.toFixed(4)}, ` +
    `${String(d.framesCaptured)} frames at ${String(Math.round(d.sampleRate))} Hz)`;

  // Something was timed, but every reading came out negative — the onset was
  // found before the click was played, so the recorder's block timestamps and
  // the audio clock disagree. That is not a room problem and no amount of
  // turning the volume up will fix it, so it must not be reported as one.
  if (rawReadings > 0) {
    return new ProbeError(
      'readings-unusable',
      `The click was timed ${String(rawReadings)} time(s), but every reading placed it before it was ` +
        'played, which means the recorder\u2019s timestamps and the audio clock do not agree on this ' +
        'machine. The press-to-sidetone figure above is still worth reading.' + levels,
    );
  }

  if (d.framesCaptured === 0) {
    return new ProbeError(
      'no-audio-captured',
      'The microphone delivered no audio at all, so nothing could be timed. This usually means the page is ' +
        'not allowed to record here — Safari in particular refuses the microphone on a page opened from a ' +
        'file rather than from a web address.' + levels,
    );
  }
  if (d.noiseFloor < 1e-5 && d.peak < 1e-4) {
    return new ProbeError(
      'microphone-silent',
      'The microphone recorded pure silence. Check which input is selected in your sound settings — if it ' +
        'is still set to a pair of headphones that are disconnected, nothing will ever be heard.' + levels,
    );
  }
  /*
   * The microphone is clearly working \u2014 it is hearing the room \u2014 and yet
   * seven clicks played through the speaker left no mark on it at all. That
   * is not a quiet click; that is the sound being taken out of the capture.
   *
   * Proved on a Mac, 12 October 2026. A 1 kHz tone audible across the room
   * reached Safari's microphone at 0.0035 against a room level of 0.0034,
   * while Chrome and Firefox on the same machine, same speaker, same volume
   * received it at 0.0507 and 0.0524 \u2014 within three per cent of each other.
   * About 23 dB removed. The platform strips what it has just played, which
   * is right for a video call and fatal to a loopback measurement.
   *
   * It is tested as a symptom rather than by sniffing the browser, so a
   * future engine that does the same thing is covered too.
   */
  if (d.peak < d.noiseFloor * 3) {
    return new ProbeError(
      'sound-removed',
      'The microphone is working \u2014 it can hear the room \u2014 but the clicks left no trace in it. ' +
        'Something is removing the sound before it is recorded. If this is Safari on a Mac, that is what ' +
        'is happening: it strips out what the machine has just played, so no amount of volume will help, ' +
        'and more volume makes it worse. Run the measurement once in Chrome or Firefox; the delay belongs ' +
        'to this machine more than to the browser.' + levels,
    );
  }

  return new ProbeError(
    'click-too-quiet',
    'The microphone is working but the test click was not loud enough to pick out from the room. Turn the ' +
      'output volume up, make sure the sound is coming from speakers the microphone can hear, and try ' +
      'again somewhere quiet.' + levels,
  );
}

function playClick(ctx: AudioContext, at: number, opts: ProbeOptions): void {
  const osc = ctx.createOscillator();
  osc.type = 'square'; // a sharper edge than a sine, so the onset is crisp
  osc.frequency.value = opts.clickHz;
  const gain = ctx.createGain();
  const length = opts.clickMs / 1000;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.9, at + 0.001);
  gain.gain.setValueAtTime(0.9, at + length - 0.001);
  gain.gain.linearRampToValueAtTime(0, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
