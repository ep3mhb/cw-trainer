/**
 * Sending practice, decoder and latency meter (RFP §5).
 *
 * The keying surface itself — every input source, the iambic keyer and its
 * lookahead scheduler — lives in ./keyinput, because the QSO tab keys into a
 * contact with the same hardware. What is left here is the part that is
 * about practice: the target, the decode, the timing report and the latency
 * meter.
 */

import {
  analyse,
  compareToIdeal,
  decode,
  timingReport,
  type DecodeResult,
  type KeyEvent,
  type TimingRow,
} from '../core/decoder';
import { generate } from '../core/generators';
import { practiceSet } from '../core/koch';
import { type IambicMode } from '../core/keyer';
import { type TimingSettings } from '../core/timing';
import { badge, clear, el, radioGroup, slider } from './dom';
import { keyInput } from './keyinput';
import { DEFAULT_PROBE, ProbeError, measureRoundTrip } from '../core/latency-probe';
import {
  FULL_SCALE,
  clippedRuns,
  describeMeasurement,
  doubtReason,
  latencyTone,
  levelsOf,
  runLevelsOf,
  soundArrivedLoudly,
  type Measurement,
} from '../core/onset';
import type { SendingRecord } from '../storage/schema';
import type { Ctx, View } from './context';

/**
 * The levels the probe actually saw, rendered small.
 *
 * The probe has always collected these, but they were shown only when it
 * failed outright — so the common case, a run that heard one click in seven,
 * gave nobody anything to diagnose from. They are the difference between
 * "it did not work" and "the room is at 0.0012 and the click peaked at
 * 0.0013", which says the click is too quiet rather than the microphone dead.
 *
 * 0.8.8 put them beside two of the three warnings. The third — readings
 * disagree — is where Safari actually lands, so the one branch a member was
 * most likely to see was the one that showed nothing to diagnose from, and
 * six screenshots of it on 13 October could not answer whether the sound had
 * been removed. Every statement the Send tab makes about a measurement now
 * carries the levels it was made from, the confident ones included.
 */
function probeLevels(m: Measurement): HTMLElement | null {
  const levels = levelsOf(m);
  if (levels === null) return null;
  /*
   * Which runs survived, not just how many.
   *
   * Six consecutive Safari runs on 13 October 2026 each returned exactly
   * three readings out of seven. A count that steady is a mechanism rather
   * than chance, and the obvious candidate — an echo canceller that
   * converges after the first few clicks, so only early runs survive — is
   * decidable from the run numbers and from nothing else the probe keeps.
   * It is a hypothesis; printing the indexes is what lets it be tested
   * instead of believed.
   */
  /*
   * Per run, not aggregated.
   *
   * 0.8.12 printed the maximum room level and the maximum peak across all
   * seven runs. On 13 October 2026 that gave Chrome 0.0115 / 0.5477 having
   * heard seven clicks and Safari 0.0071 / 0.4881 having heard two — figures
   * within twelve per cent of one another describing opposite outcomes,
   * because a maximum over seven runs is the peak of whichever run worked.
   * The rows below are what the aggregate was hiding, and they are what
   * decides whether the missing clicks were removed before the microphone
   * heard them or arrived loudly and were not recognised.
   */
  const perRun = runLevelsOf(m);
  if (perRun !== null) {
    const rows = perRun
      .map((r) =>
        `${String(r.run)} ${r.usable === false ? 'unusable' : r.heard ? 'heard' : 'missed'} ` +
        `${r.noiseFloor.toFixed(4)}/${r.peak.toFixed(4)}` +
        (r.peak >= FULL_SCALE ? ' CLIPPED' : ''))
      .join(', ');
    return el('span', { class: 'hint' },
      ` (${String(Math.round(levels.sampleRate))} Hz; per run, room/loudest — ${rows})`);
  }

  const runs = m.runIndexes === undefined || m.runIndexes.length === 0
    ? ''
    : `, from ${m.runIndexes.length === 1 ? 'run' : 'runs'} ${m.runIndexes.join(', ')} ` +
      `of ${String(DEFAULT_PROBE.runs)}`;
  return el('span', { class: 'hint' },
    ` (room level ${levels.noiseFloor.toFixed(4)}, loudest ${levels.peak.toFixed(4)}, ` +
    `${String(Math.round(levels.sampleRate))} Hz${runs})`);
}

export function sendView(ctx: Ctx): View {
  const node = el('div');

  let events: KeyEvent[] = [];
  /** Worst input-event handling delay seen this session, in ms. */
  let worstEventDelayMs = 0;
  let eventDelaySamples: number[] = [];
  /** A real loopback measurement, once the member has run one. */
  let measured: Measurement | null = null;
  const measureButton = el('button', { class: 'btn', text: 'Measure for real' });
  const measureStatus = el('p', { class: 'hint', style: 'margin:0.5rem 0 0' });
  const latencyRow = el('div', { class: 'row' });
  const latencyNotice = el('div');
  const decodedOut = el('div', { class: 'readout answer', 'aria-live': 'polite' });
  const showDecodedPlaceholder = (): void => {
    clear(decodedOut);
    decodedOut.append(el('span', { class: 'pending', text: 'Arm the key, send something, then press Analyse.' }));
  };
  const qualityRow = el('div', { class: 'row' });
  const comparison = el('div', { class: 'bars' });
  const targetOut = el('div', { class: 'readout' });

  const key = keyInput({
    ctx,
    onEvent: (event) => {
      events.push(event);
      analyseButton.disabled = events.length < 2;
      clearButton.disabled = events.length === 0;
    },
    onInputDelay: (delayMs) => {
      eventDelaySamples.push(delayMs);
      if (eventDelaySamples.length > 50) eventDelaySamples.shift();
      worstEventDelayMs = Math.max(worstEventDelayMs, delayMs);
      renderLatency();
    },
  });

  const armButton = el('button', { class: 'btn primary', text: 'Arm the key' });
  const analyseButton = el('button', { class: 'btn', text: 'Analyse', disabled: true });
  const clearButton = el('button', { class: 'btn', text: 'Clear', disabled: true });
  const newTargetButton = el('button', { class: 'btn', text: 'New target' });

  let target = '';

  function renderLatency(): void {
    const engine = ctx.audio.latency();
    const meanEventDelay =
      eventDelaySamples.length === 0
        ? 0
        : eventDelaySamples.reduce((a, b) => a + b, 0) / eventDelaySamples.length;
    const reported = engine.totalMs + meanEventDelay;
    // A real measurement always wins over the browser's own figure.
    const haveMeasurement = measured?.confident === true;
    const shown = haveMeasurement ? (measured as Measurement).roundTripMs : reported;

    /*
     * The badge used one colour scale for two different quantities.
     *
     * The threshold is for the ONE-WAY path, key press to sidetone. The
     * moment a real measurement arrives the badge starts showing a ROUND
     * TRIP, which carries the whole microphone path as well and must be read
     * as an upper bound — which is exactly what the note beneath it says, in
     * three bands of its own. The colour did not change with the label, so a
     * measured 63.2 ms went red, against a one-way limit, directly above a
     * paragraph calling it "probably fine".
     *
     * Mohammad read the red as over the limit on 12 October. He wrote the
     * caveat; if the badge misleads its author it will mislead anyone.
     */
    const tone = latencyTone(shown, ctx.settings.latencyWarnMs, haveMeasurement);

    clear(latencyRow);
    latencyRow.append(
      badge(measured?.confident === true ? 'Measured' : 'Press to sidetone', `${shown.toFixed(1)} ms`, tone),
      badge('Audio output', `${engine.outputLatencyMs.toFixed(1)} ms${engine.outputLatencyEstimated ? ' (est)' : ''}`),
      badge('Buffer', `${engine.baseLatencyMs.toFixed(1)} ms`),
      badge('Scheduling', `${engine.schedulingLeadMs.toFixed(1)} ms`),
      badge('Input event', `${meanEventDelay.toFixed(1)} ms`),
    );

    clear(latencyNotice);
    if (!ctx.audio.isRunning) {
      latencyNotice.append(el('p', { class: 'notice', text: 'Arm the key to see the figures for this machine.' }));
    } else if (measured?.confident === true) {
      /*
       * Interpreting a loopback figure needs care, and getting it wrong once
       * already produced a confident, wrong warning.
       *
       * The threshold is for the one-way path: key press to sidetone. The
       * measurement is a round trip — the click leaves the speaker, crosses
       * the room and comes back in through the microphone, so it carries the
       * whole input path as well. It always overstates what the member
       * actually feels, and by an amount we cannot separate out from a single
       * measurement.
       *
       * So it is read as an upper bound, in three bands, rather than compared
       * against the one-way threshold directly.
       */
      const roundTrip = measured.roundTripMs;
      const definitelyFine = ctx.settings.latencyWarnMs;
      const definitelyBad = ctx.settings.latencyWarnMs * 2;
      latencyNotice.append(
        roundTrip <= definitelyFine
          ? el('p', { class: 'notice' },
              `Measured ${roundTrip.toFixed(0)} ms round trip. That is an upper bound — it includes the `,
              'microphone path, which your sidetone does not go through, so what you actually hear is less. ',
              el('b', { text: 'Comfortably usable for sending practice.' }),
              probeLevels(measured))
          : roundTrip <= definitelyBad
            ? el('p', { class: 'notice warn' },
                `Measured ${roundTrip.toFixed(0)} ms round trip, which is borderline. The figure includes `,
                'the microphone\u2019s own input delay and the flight time across the room, neither of which ',
                'is in your sidetone, so the delay you feel is smaller than this. ',
                el('b', { text: 'Probably fine \u2014 but trust your ears over this number.' }),
                ' If the sidetone feels like it is lagging your hand, it is.',
                probeLevels(measured))
            : el('p', { class: 'notice bad' },
                `Measured ${roundTrip.toFixed(0)} ms round trip. Even allowing for the microphone path, that `,
                'is too much for sending practice \u2014 you would be training against a delay that will not ',
                'be there on the air. Wireless output is the usual cause and adds 100\u2013200 ms that no ',
                'software can remove; a wired output or the built-in speakers will fix it. If you are ',
                'already on those, close other audio applications and measure again.',
                probeLevels(measured)),
      );
    } else {
      // No measurement yet. One notice, not two: stating "197 ms is too much"
      // and "do not trust this number" side by side is a contradiction, and
      // the second one is the true statement.
      const suspicious = reported > ctx.settings.latencyWarnMs;
      latencyNotice.append(
        el('p', { class: `notice ${suspicious ? 'warn' : ''}`.trim() },
          `Your browser reports ${reported.toFixed(0)} ms from key press to sidetone`,
          suspicious ? ', which would be too much for sending practice — but ' : ', but ',
          el('b', { text: 'this figure is not a measurement' }),
          '. It is what the browser says about its own buffers, and it goes stale after Bluetooth ' +
          'headphones have been used \u2014 measured on one Mac: 190 ms, then 8.9 ms after quitting the ' +
          'browser completely. ',
          el('b', { text: 'Press "Measure for real"' }),
          ' to find out what you are actually hearing.'),
      );
      if (measured !== null) {
        // Two quite different faults make a measurement untrustworthy, and
        // they need opposite advice. `confident` is false when there are
        // fewer than three usable readings OR when they disagree — and for
        // most of this feature's life both were reported as disagreement,
        // which printed "readings disagreed too much (spread 0 ms)" at a
        // member and sent them to find a quieter room when the real problem
        // was that one click in seven had been heard.
        const heard = measured.samplesMs.length;
        const reason = doubtReason(measured);
        const clipped = (() => {
          const runs = runLevelsOf(measured);
          return runs === null ? [] : clippedRuns(runs);
        })();
        const loudest = (() => {
          const l = levelsOf(measured);
          return l === null ? 0 : l.peak;
        })();
        latencyNotice.append(
          reason === 'overloaded'
            ? el('p', { class: 'notice warn' },
                'The microphone input is overloading. ',
                `The loudest sample reached ${loudest.toFixed(2)}, past the maximum of 1.00, on `,
                `${clipped.length === 1 ? 'one run' : `${String(clipped.length)} runs`}, `,
                'so the recording is clipped and the click has lost the shape the measurement ',
                'recognises it by. ',
                el('b', { text: 'Turn the output volume down and measure again' }),
                ' \u2014 down, not up. Nothing can be timed from a clipped recording, and raising the ',
                'volume further only flattens it more.',
                probeLevels(measured))
            : reason === 'removed'
            ? el('p', { class: 'notice warn' },
                /*
                 * The claim is about the clicks that went missing, never
                 * about the whole recording.
                 *
                 * Safari over twelve runs on 13 October 2026 suppressed the
                 * early clicks and then stopped: the last three arrived at
                 * about 0.45 against a room of 0.008, some sixty-five times
                 * above it. The sentence "nothing in the recording rose
                 * above the room" was printed directly over those three rows.
                 * The verdict was right and the wording overstated it, which
                 * is the 0.8.9 fault in a new place.
                 */
                `${String(heard)} of ${String(DEFAULT_PROBE.runs)} clicks came back with a reading. `,
                'On the ones that went missing the recording never rose above the room, so the click ',
                'was not there to be timed. Something is removing the sound before the microphone ',
                'hears it. ',
                el('b', { text: 'If this is Safari on a Mac, that is what is happening' }),
                ' \u2014 it strips out what the machine has just played, and turning the volume up makes ',
                'it worse rather than better. Run the measurement once in Chrome or Firefox instead; the ',
                'delay it finds belongs to this machine more than to the browser.',
                probeLevels(measured))
            : reason === 'too-few'
              ? soundArrivedLoudly(measured)
                /*
                 * The click is arriving, loudly, on at least one run. Safari
                 * reached 69 times its own room level on 13 October 2026
                 * while hearing two clicks in seven, and the application was
                 * still telling Mohammad to raise the volume — advice he
                 * then followed to maximum, which recovered nothing and
                 * overloaded the input instead. Loudness is not the
                 * complaint, so it must not be the advice.
                 */
                ? el('p', { class: 'notice warn' },
                    `Only ${String(heard)} of ${String(DEFAULT_PROBE.runs)} clicks `,
                    `${heard === 1 ? 'was' : 'were'} heard, which is too few to average. `,
                    el('b', { text: 'This is not a volume problem' }),
                    ' \u2014 on the runs where the click did arrive it was far above the room, so it is ',
                    'loud enough. Something is taking it away on the other runs, or it is arriving in a ',
                    'shape the measurement cannot recognise. Raising the volume will not help and may ',
                    'overload the input; if this is Safari on a Mac, run the measurement once in Chrome ',
                    'or Firefox instead.',
                    probeLevels(measured))
                : el('p', { class: 'notice warn' },
                    `Only ${String(heard)} of ${String(DEFAULT_PROBE.runs)} clicks `,
                    `${heard === 1 ? 'was' : 'were'} heard, which is too few to `,
                    'average, so that figure is not trustworthy. The microphone is picking the click out of the ',
                    'room too rarely: turn the output volume up, use speakers rather than headphones so the ',
                    'microphone can hear them, and try again.',
                    probeLevels(measured))
              : el('p', { class: 'notice warn' },
                  `The ${String(heard)} readings disagreed too much to trust (spread `,
                  `${measured.spreadMs.toFixed(0)} ms). Try again somewhere quieter, with the volume up.`,
                  probeLevels(measured)),
        );
      }
    }
  }

  async function runProbe(): Promise<void> {
    if (!(await ctx.ensureAudio())) return;
    measureButton.disabled = true;
    measureStatus.textContent = 'Listening… you will hear a few short clicks. Keep the room quiet.';
    try {
      const result = await measureRoundTrip(
        ctx.audio.context as AudioContext,
        {},
        ({ run, of }) => {
          measureStatus.textContent = `Click ${String(run)} of ${String(of)}…`;
        },
      );
      measured = result;
      const engineTotal = ctx.audio.latency().totalMs;
      // Written by describeMeasurement, not here, because this line and the
      // notice above it are two statements about the same number and they
      // have to agree. They did not: this used to announce
      // "Measured 6.8 ms round trip (spread 0.0 ms over 1 clicks)" directly
      // beneath a warning that the figure could not be trusted.
      measureStatus.textContent = describeMeasurement(result, engineTotal, DEFAULT_PROBE.runs);
    } catch (error) {
      measured = null;
      measureStatus.textContent =
        error instanceof ProbeError
          ? error.message
          : 'The measurement failed. Check the microphone permission and try again.';
    } finally {
      measureButton.disabled = false;
      renderLatency();
    }
  }

  measureButton.addEventListener('click', () => void runProbe());

  function runAnalysis(): void {
    const result = decode(events, {
      tolerance: ctx.settings.decodeTolerance,
      ...(ctx.settings.keyInput === 'iambic' ? { referenceWpm: ctx.settings.timing.characterWpm } : {}),
    });
    const quality = analyse(result);

    clear(decodedOut);
    if (result.text === '') {
      decodedOut.append(el('span', { class: 'pending', text: 'Nothing decoded yet.' }));
    } else {
      decodedOut.append(el('span', { text: result.text }));
    }

    /*
     * With nothing sent, every figure here is zero — and a zero weighting
     * shown in red reads as "your fist is terrible" rather than "you have
     * not sent anything". An absent measurement is a dash, not a bad score.
     */
    const sentAnything = result.marks.length > 0;
    const weightingKnown = quality.dit.count > 0 && quality.dah.count > 0;
    const consistencyKnown = quality.dit.count + quality.dah.count >= 4;

    clear(qualityRow);
    qualityRow.append(
      badge('Speed', sentAnything ? `${result.estimatedWpm.toFixed(1)} WPM` : '—'),
      badge(
        'Weighting',
        weightingKnown ? `${quality.weighting.toFixed(2)} : 1` : '—',
        weightingKnown
          ? Math.abs(quality.weighting - 3) < 0.25 ? 'good' : Math.abs(quality.weighting - 3) < 0.6 ? 'warn' : 'bad'
          : '',
      ),
      badge(
        'Consistency',
        consistencyKnown ? `${(quality.consistency * 100).toFixed(0)}%` : '—',
        consistencyKnown
          ? quality.consistency > 0.8 ? 'good' : quality.consistency > 0.55 ? 'warn' : 'bad'
          : '',
      ),
      badge('Element gap', quality.elementGap.count === 0 ? '—' : `${quality.elementGap.meanMs.toFixed(0)} ms`),
      badge('Char gap', quality.characterGap.count === 0 ? '—' : `${quality.characterGap.meanMs.toFixed(0)} ms`),
    );

    // Visual display of the student's keying against ideal timing (RFP §5).
    clear(comparison);
    if (!sentAnything) {
      comparison.append(
        el('p', { class: 'hint' },
          'The timing report appears once you have sent something. Arm the key, send the target above, ' +
          'then press Analyse.'),
      );
    } else {
      const targetElements = target === '' ? 0 : compareToIdeal(target, result, ctx.settings.timing).rows.length;
      const { rows, diagnosis } = timingReport(quality, result.ditMs, {
        targetLetters: target.replace(/\s+/g, '').length,
        decodedLetters: result.characters.length,
        targetElements,
        sentElements: result.marks.length,
      });
      comparison.append(
        el('p', { class: 'diagnosis', text: diagnosis }),
        el('p', { class: 'hint', style: 'margin:0 0 0.7rem' },
          `Each part of your sending against what standard Morse asks for at your own speed of ` +
          `${result.estimatedWpm.toFixed(0)} WPM. Sending faster or slower than the drill is not an error ` +
          `in itself \u2014 what matters is that the parts keep their proportions.`),
        timingTable(rows),
      );
      if (target !== '') comparison.append(elementDetail(target, result, ctx.settings.timing));
    }

    // Log it (RFP §4 progress data, and the sending half of the export).
    const accuracy = target === '' ? 0 : scoreAgainstTarget(target, result.text);
    const record: SendingRecord = {
      id: `k-${String(Date.now())}`,
      at: Date.now(),
      target,
      decoded: result.text,
      accuracy,
      estimatedWpm: result.estimatedWpm,
      weighting: quality.weighting,
      consistency: quality.consistency,
      measuredLatencyMs:
        measured?.confident === true
          ? measured.roundTripMs
          : ctx.audio.latency().totalMs + worstEventDelayMs,
    };
    void ctx.store.addSending(record);
  }

  function scoreAgainstTarget(expected: string, actual: string): number {
    const a = expected.replace(/\s+/g, '');
    const b = actual.replace(/\s+/g, '');
    if (a.length === 0) return 0;
    let hits = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) hits += 1;
    return hits / a.length;
  }

  function newTarget(): void {
    const drill = generate({
      type: ctx.settings.lessonType === 'plaintext' ? 'words' : ctx.settings.lessonType,
      activeSet: practiceSet(ctx.settings.practice, ctx.progress).characters,
      length: 15,
    });
    target = drill.answer;
    clear(targetOut);
    targetOut.append(el('span', { text: target }));
  }

  armButton.addEventListener('click', () => {
    if (key.armed) {
      key.disarm();
      armButton.textContent = 'Arm the key';
      armButton.classList.add('primary');
      return;
    }
    void (async () => {
      if (!(await key.arm())) return;
      // Arming throws away the previous run's key events, so the buttons that
      // act on them have to go back to disabled with it. Without this,
      // pressing Analyse after a re-arm ran against nothing at all and
      // reported a 0.00 weighting and a wall of empty timing bars.
      events = [];
      analyseButton.disabled = true;
      clearButton.disabled = true;
      eventDelaySamples = [];
      worstEventDelayMs = 0;
      armButton.textContent = 'Disarm';
      armButton.classList.remove('primary');
      renderLatency();
    })();
  });
  analyseButton.addEventListener('click', runAnalysis);
  clearButton.addEventListener('click', () => {
    events = [];
    key.clear();
    showDecodedPlaceholder();
    clear(comparison);
    clear(qualityRow);
    analyseButton.disabled = true;
    clearButton.disabled = true;
  });
  newTargetButton.addEventListener('click', newTarget);

  node.append(
    el(
      'section',
      { class: 'panel' },
      el('h2', { text: 'Latency check' }),
      el('p', {
        class: 'hint',
        text: 'Sending practice is only usable if the sidetone follows the key closely. Anything over 60 ms '
          + 'from key press to sidetone is distracting; Bluetooth output is hopeless. A measured round trip '
          + 'is a different figure and a larger one \u2014 it includes the microphone path as well.',
      }),
      latencyRow,
      latencyNotice,
      el('div', { class: 'row' }, measureButton),
      measureStatus,
    ),
    el(
      'section',
      { class: 'panel' },
      el('h2', { text: 'Sending' }),
      el('div', { class: 'row' }, armButton, key.lamp, el('span', { class: 'hint', style: 'margin:0', text: 'key state' })),
      el('div', { style: 'height:0.7rem' }),
      key.pad,
      el('div', { style: 'height:0.7rem' }),
      radioGroup<'straight' | 'iambic'>({
        legend: 'Key type',
        name: 'keyinput',
        value: ctx.settings.keyInput,
        choices: [
          { value: 'iambic', label: 'Iambic paddle' },
          { value: 'straight', label: 'Straight key' },
        ],
        onChange: (value) => {
          ctx.settings.keyInput = value;
          void ctx.saveSettings();
          key.refresh();
        },
      }),
      radioGroup<IambicMode>({
        legend: 'Iambic mode',
        name: 'iambicmode',
        value: ctx.settings.iambicMode,
        choices: [
          { value: 'A', label: 'Mode A' },
          { value: 'B', label: 'Mode B' },
        ],
        onChange: (value) => {
          ctx.settings.iambicMode = value;
          void ctx.saveSettings();
          key.setIambicMode(value);
        },
      }),
      slider({
        label: 'Decoder tolerance',
        min: 0, max: 1, step: 0.05, value: ctx.settings.decodeTolerance,
        format: (v) => (v < 0.2 ? `${v.toFixed(2)} strict` : v > 0.6 ? `${v.toFixed(2)} forgiving` : v.toFixed(2)),
        onInput: (value) => {
          ctx.settings.decodeTolerance = value;
          void ctx.saveSettings();
        },
      }),
    ),
    el(
      'section',
      { class: 'panel' },
      el('h2', { text: 'Target' }),
      el('p', { class: 'hint', text: 'Send this on your key, then press Analyse for a report on your timing.' }),
      targetOut,
      el('div', { style: 'height:0.6rem' }),
      el('div', { class: 'row' }, newTargetButton, analyseButton, clearButton),
    ),
    el(
      'section',
      { class: 'panel' },
      el('h2', { text: 'What you sent' }),
      decodedOut,
      el('div', { style: 'height:0.6rem' }),
      qualityRow,
      el('div', { style: 'height:0.9rem' }),
      comparison,
    ),
  );

  newTarget();
  renderLatency();
  showDecodedPlaceholder();

  return {
    node,
    dispose: key.dispose,
    refresh: renderLatency,
  };
}

/**
 * The report itself: one row per kind of element, each drawn twice — what it
 * should be, and what the student sent. Two labelled bars carrying numbers
 * beat fifty anonymous ones; the old chart drew an element per bar with no
 * names on them, and nobody could tell what they were looking at.
 */
function timingTable(rows: readonly TimingRow[]): HTMLElement {
  const known = rows.filter((row) => row.actualMs !== null);
  const longest = Math.max(
    ...known.map((row) => Math.max(row.idealMs, row.actualMs ?? 0)),
    ...rows.map((row) => row.idealMs),
    1,
  );
  const width = (ms: number): string => `${((ms / longest) * 100).toFixed(2)}%`;

  const table = el('div', { class: 'timing-report' });
  for (const row of rows) {
    const verdictText =
      row.verdict === 'unknown'
        ? 'not sent'
        : row.verdict === 'good'
          ? 'about right'
          : row.ratio === null
            ? ''
            : `${row.verdict === 'long' ? 'too long' : 'too short'} by ${Math.abs(Math.round((row.ratio - 1) * 100)).toFixed(0)}%`;
    const tone = row.verdict === 'good' ? 'good' : row.verdict === 'unknown' ? 'muted' : 'bad';

    const bars = el(
      'div',
      { class: 'tr-bars' },
      el(
        'div',
        { class: 'tr-line' },
        el('span', { class: 'tr-key', text: 'should be' }),
        el(
          'div',
          { class: 'tr-meter' },
          el('span', { class: 'tr-bar tr-ideal', style: `width:${width(row.idealMs)}` }),
          el('span', { class: 'tr-num', text: `${row.idealMs.toFixed(0)} ms` }),
        ),
      ),
    );
    if (row.actualMs === null) {
      bars.append(
        el('div', { class: 'tr-line' },
          el('span', { class: 'tr-key', text: 'you sent' }),
          el('span', { class: 'tr-none', text: 'none in this run' })),
      );
    } else {
      bars.append(
        el(
          'div',
          { class: 'tr-line' },
          el('span', { class: 'tr-key', text: 'you sent' }),
          el(
            'div',
            { class: 'tr-meter' },
            el('span', { class: `tr-bar tr-you ${tone}`, style: `width:${width(row.actualMs)}` }),
            el('span', { class: 'tr-num', text: `${row.actualMs.toFixed(0)} ms` }),
          ),
        ),
      );
    }

    table.append(
      el(
        'div',
        { class: 'tr-row' },
        el(
          'div',
          { class: 'tr-head' },
          el('span', { class: 'tr-label', text: `${row.label} (${String(row.units)} dit${row.units === 1 ? '' : 's'})` }),
          el('span', { class: `tr-verdict ${tone}`, text: verdictText }),
        ),
        bars,
      ),
    );
  }
  return table;
}

/**
 * The old chart, kept but folded away: element by element is the right view
 * once you already know what you are looking at, and the wrong one to meet
 * first. Each element now carries the letter of the target it belongs to,
 * because a column of bare dots and dashes named nothing.
 *
 * It lines the student's marks up with the target by position, so one extra
 * or missing element shifts everything after it. That is worth saying out
 * loud rather than letting the rows quietly lie.
 */
function elementDetail(target: string, result: DecodeResult, timing: TimingSettings): HTMLElement {
  const { rows } = compareToIdeal(target, result, timing);
  const box = el('details', { class: 'element-detail' });
  box.append(el('summary', { text: 'Element by element' }));

  const sentCount = result.marks.length;
  if (sentCount !== rows.length) {
    box.append(
      el('p', { class: 'hint' },
        `The target has ${String(rows.length)} elements and you sent ${String(sentCount)}. These rows pair them ` +
        'up in order, so from the first extra or missing element onward they compare the wrong pair. ' +
        'Read the report above instead.'),
    );
  }
  box.append(
    el('p', { class: 'hint', style: 'margin:0 0 0.6rem' },
      'One row per element of the target, grouped by letter. The pale bar is the ideal length, the solid ' +
      'bar is what you sent \u2014 green within 15%, amber within 35%, red beyond.'),
  );

  const longest = Math.max(...rows.map((r) => Math.max(r.idealMs, r.actualMs ?? 0)), 1);
  for (const row of rows.slice(0, 60)) {
    const idealWidth = (row.idealMs / longest) * 100;
    const actualWidth = row.actualMs === null ? 0 : (row.actualMs / longest) * 100;
    const off = row.ratio === null ? 1 : Math.abs(row.ratio - 1);
    const cls = row.actualMs === null ? 'missing' : off < 0.15 ? '' : off < 0.35 ? 'off' : 'bad';
    box.append(
      el(
        'div',
        { class: row.firstOfCharacter ? 'bar-row char-start' : 'bar-row' },
        el('span', { class: 'bar-char', text: row.firstOfCharacter ? row.character : '' }),
        el('span', { class: 'bar-element', text: row.element === 'dah' ? '\u2014' : '\u00b7' }),
        el(
          'div',
          { class: 'bar-track' },
          el('div', { class: 'bar-ideal', style: `width:${idealWidth.toFixed(2)}%` }),
          el('div', { class: `bar-actual ${cls}`.trim(), style: `width:${actualWidth.toFixed(2)}%` }),
        ),
      ),
    );
  }
  if (rows.length > 60) {
    box.append(el('p', { class: 'hint', text: `Showing the first 60 of ${String(rows.length)} elements.` }));
  }
  return box;
}
