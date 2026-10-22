import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ONSET,
  describeMeasurement,
  doubtReason,
  findOnset,
  MIN_ROOM_LEVEL,
  clippedRuns,
  levelsOf,
  measurementOverloaded,
  measurementRemoved,
  runIsJudgeable,
  runLevelsOf,
  soundArrivedLoudly,
  unusableRuns,
  type RunLevel,
  median,
  rms,
  spread,
  summarise,
  type Measurement,
} from '../src/core/onset';

/**
 * A measurement carrying the levels the probe saw, as measureRoundTrip
 * returns one.
 */
function withLevels(samplesMs: number[], noiseFloor: number, peak: number): Measurement {
  return { ...summarise(samplesMs), diagnostics: { noiseFloor, peak, sampleRate: 48000 } };
}

/**
 * The six Safari runs of 13 October 2026, as the probe saw them: exactly
 * MIN_READINGS readings every time, and a room the clicks never cleared.
 * Run five agreed with itself to 12.1 ms against a limit of 15.
 */
const SAFARI_RUN_FIVE = (): Measurement => withLevels([98.4, 106.7, 115.0], 0.0034, 0.0035);

/** Quiet room noise, then a click at `at`, then decaying ring. */
function recording(length: number, at: number, clickAmplitude = 0.5, noise = 0.001): Float32Array {
  const buffer = new Float32Array(length);
  let seed = 1;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };
  for (let i = 0; i < length; i += 1) buffer[i] = rand() * noise;
  for (let i = at; i < Math.min(length, at + 400); i += 1) {
    buffer[i] = (buffer[i] as number) + clickAmplitude * Math.exp(-(i - at) / 120) * Math.sin(i * 0.4);
  }
  return buffer;
}

describe('noise floor', () => {
  it('measures RMS over a window, not the peak', () => {
    const flat = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    expect(rms(flat)).toBeCloseTo(0.5, 6);
  });

  it('returns zero for an empty or inverted range', () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(new Float32Array([1, 2, 3]), 3, 1)).toBe(0);
  });
});

describe('onset detection', () => {
  it('finds the click close to where it was put', () => {
    const { index } = findOnset(recording(20000, 8000));
    expect(index).not.toBeNull();
    expect(Math.abs((index as number) - 8000)).toBeLessThan(120);
  });

  it('returns null rather than guessing when nothing was heard', () => {
    const silence = new Float32Array(10000);
    expect(findOnset(silence).index).toBeNull();
  });

  it('is not fooled by room noise alone', () => {
    const noisy = recording(20000, 19999, 0, 0.002);
    expect(findOnset(noisy).index).toBeNull();
  });

  it('still finds a quiet return above a quiet floor', () => {
    const faint = recording(20000, 6000, 0.03, 0.0005);
    const { index } = findOnset(faint);
    expect(index).not.toBeNull();
    expect(Math.abs((index as number) - 6000)).toBeLessThan(200);
  });

  it('ignores anything before searchFrom', () => {
    const buffer = recording(20000, 3000);
    const { index } = findOnset(buffer, { ...DEFAULT_ONSET, searchFrom: 9000 });
    expect(index === null || index >= 9000).toBe(true);
  });

  it('uses an absolute floor when the recording is digital silence before the click', () => {
    const buffer = new Float32Array(10000);
    buffer[5000] = 0.4;
    expect(findOnset(buffer).index).toBe(5000);
  });
});

describe('combining runs', () => {
  it('takes the median so one bad reading cannot move the answer', () => {
    expect(median([40, 41, 42, 43, 900])).toBe(42);
  });

  it('returns zero for no readings', () => {
    expect(median([])).toBe(0);
    expect(spread([])).toBe(0);
  });

  it('is confident when the readings agree', () => {
    const result = summarise([38, 40, 39, 41, 40]);
    expect(result.roundTripMs).toBe(40);
    expect(result.confident).toBe(true);
  });

  it('is not confident when they scatter', () => {
    expect(summarise([10, 60, 35, 200, 5]).confident).toBe(false);
  });

  it('is not confident on fewer than three readings', () => {
    expect(summarise([40, 40]).confident).toBe(false);
  });

  it('discards impossible readings', () => {
    const result = summarise([40, -5, Number.NaN, 42, 41]);
    expect(result.samplesMs).toEqual([40, 42, 41]);
  });

  /*
   * The trap behind "Measured 0.0 ms round trip (spread 0.0 ms over 0
   * clicks)", which the Send tab showed a member on 12 October 2026.
   *
   * Every reading was discarded, median([]) is 0, and the probe's own guard
   * tested the list it was handed rather than the list that survived — so a
   * run that heard nothing usable reported zero milliseconds as an answer.
   * These two cases pin the shape the caller has to check.
   */
  it('keeps nothing when every reading is impossible', () => {
    const result = summarise([-3, -12, Number.NaN]);
    expect(result.samplesMs).toEqual([]);
    expect(result.confident).toBe(false);
  });

  it('reports zero for an empty set, which is why the caller must count the survivors', () => {
    expect(summarise([]).roundTripMs).toBe(0);
    expect(summarise([-3, -12]).roundTripMs).toBe(0);
  });

  it('a single reading has no spread, so spread alone cannot explain the doubt', () => {
    const result = summarise([145]);
    expect(result.spreadMs).toBe(0);
    expect(result.confident).toBe(false);
  });
});

describe('why a measurement is doubted', () => {
  it('says nothing about a measurement worth trusting', () => {
    expect(doubtReason(summarise([38, 40, 39, 41, 40]))).toBeNull();
  });

  /*
   * The bug this exists for: one reading in seven, reported to the member as
   * "readings disagreed too much to trust (spread 0 ms)". A spread of zero
   * over a single reading is perfect agreement, and the advice that followed
   * it — find a quieter room — could not have helped.
   */
  it('blames the count, not the spread, when barely anything was heard', () => {
    expect(doubtReason(summarise([145]))).toBe('too-few');
    expect(doubtReason(summarise([145, 150]))).toBe('too-few');
  });

  it('blames the spread when enough readings were heard and they disagree', () => {
    expect(doubtReason(summarise([10, 60, 35, 200, 5]))).toBe('disagree');
  });

  it('blames the count when every reading was discarded', () => {
    expect(doubtReason(summarise([-3, -12, Number.NaN]))).toBe('too-few');
  });
});

describe('the line printed under the measure button', () => {
  /*
   * The defect: this line was written once, unconditionally, in the voice of
   * a good measurement, and printed directly beneath a warning saying the
   * figure could not be trusted. Safari, 12 October 2026:
   * "Measured 6.8 ms round trip (spread 0.0 ms over 1 clicks)".
   */
  it('makes no claim when too little was heard to make one', () => {
    const line = describeMeasurement(summarise([6.8]), 8, 7);
    expect(line).toBe('Only 1 of 7 clicks was heard, which is too few to measure from. See the note above.');
    expect(line).not.toContain('Measured');
  });

  it('agrees with itself about number', () => {
    expect(describeMeasurement(summarise([6.8]), 8, 7)).toContain('1 of 7 clicks was heard');
    expect(describeMeasurement(summarise([6.8, 7.1]), 8, 7)).toContain('2 of 7 clicks were heard');
  });

  it('reports the spread, not a figure, when the readings disagree', () => {
    const line = describeMeasurement(summarise([10, 60, 35, 200, 5]), 8, 7);
    expect(line).toContain('too much to trust');
    expect(line).toContain('See the note above');
    expect(line).not.toMatch(/^Measured/);
  });

  it('states the figure, and what the gap to the browser means, when it is trustworthy', () => {
    const line = describeMeasurement(summarise([38, 40, 39, 41, 40]), 8, 7);
    expect(line).toContain('Measured 40.0 ms round trip');
    expect(line).toContain('over 5 clicks');
    expect(line).toContain('8 ms one-way');
    expect(line).toContain('upper bound');
  });

  /*
   * A round trip contains the one-way path and the whole microphone path
   * besides, so it cannot be the smaller of the two. The old wording
   * explained the gap in one direction only and so described, in that case,
   * a gap pointing the other way.
   */
  it('does not explain a gap that points the other way', () => {
    const line = describeMeasurement(summarise([6.6, 6.8, 6.9, 6.8]), 8, 7);
    expect(line).toContain('Measured 6.8 ms round trip');
    expect(line).toContain('below the browser');
    expect(line).not.toContain('upper bound');
  });

  it('never says "1 clicks"', () => {
    for (const samples of [[6.8], [6.8, 7], [38, 40, 39, 41, 40], [10, 60, 35, 200, 5]]) {
      expect(describeMeasurement(summarise(samples), 8, 7)).not.toMatch(/\b1 clicks\b/);
    }
  });
});

describe('sound the platform removed before the microphone heard it', () => {
  /*
   * The defect 0.8.12 exists for.
   *
   * 0.8.11 asked whether the sound had been removed only inside the
   * 'too-few' branch, on the assumption that stripped sound shows up as
   * clicks going missing. Six consecutive Safari runs on an Intel MacBook
   * Pro, 13 October 2026, each returned exactly three readings — exactly
   * MIN_READINGS — so 'too-few' was never reached and the test written for
   * Safari could not execute on Safari.
   *
   * Run five was the one that mattered: three readings agreeing to 12.1 ms
   * against a limit of 15, published as "Measured 106.7 ms round trip,
   * which is borderline… probably fine". Chrome on the same machine, same
   * speaker, same room, measured 63.7 ms with a spread of 0.9 over seven
   * clicks. A confident figure 43 ms wrong is worse than a refusal.
   */
  it('is judged on the levels, not on how many readings survived', () => {
    const m = SAFARI_RUN_FIVE();
    expect(m.samplesMs).toHaveLength(3);
    expect(m.spreadMs).toBeLessThan(15);
    expect(doubtReason(m)).toBe('removed');
  });

  it('is still caught when the readings agree perfectly', () => {
    expect(doubtReason(withLevels([106.7, 106.7, 106.7], 0.0034, 0.0035))).toBe('removed');
  });

  it('asks before the agreement test, so a tidy run cannot slip past', () => {
    // Identical readings, identical count — only the levels differ.
    expect(doubtReason(withLevels([106.7, 106.7, 106.7], 0.0034, 0.051))).not.toBe('removed');
  });

  it('leaves a healthy measurement alone', () => {
    const chrome = withLevels([63.7, 63.2, 64.1, 63.9, 63.5, 63.8, 64.0], 0.0050, 0.0507);
    expect(measurementRemoved(chrome)).toBe(false);
    expect(doubtReason(chrome)).toBeNull();
  });

  it('never prints a figure for a run that timed nothing', () => {
    const line = describeMeasurement(SAFARI_RUN_FIVE(), 16, 7);
    // The claim is about the clicks that went missing, not the whole
    // recording: Safari's late runs arrive at sixty-five times the room.
    expect(line).toContain('on the clicks that went missing');
    expect(line).not.toContain('but nothing rose above the room');
    expect(line).toContain('See the note above');
    expect(line).not.toContain('106.7');
    expect(line).not.toMatch(/^Measured/);
  });

  it('says nothing about removal when the probe kept no levels', () => {
    // A bare summarise() has no diagnostics; absence is not evidence.
    expect(levelsOf(summarise([38, 40, 39]))).toBeNull();
    expect(measurementRemoved(summarise([38, 40, 39]))).toBe(false);
  });

  it('ignores diagnostics that are not levels', () => {
    expect(levelsOf({ ...summarise([38, 40, 39]), diagnostics: 'nothing useful' })).toBeNull();
    expect(levelsOf({ ...summarise([38, 40, 39]), diagnostics: { peak: 0.1 } })).toBeNull();
  });
});

describe('which run each reading came from', () => {
  /*
   * Six Safari runs returning exactly three readings each is too regular to
   * be chance. The leading explanation — an echo canceller that converges
   * after the first few clicks, so only early runs survive — is decidable
   * from the run numbers and from nothing else the probe keeps. Keeping them
   * is what lets the next Safari run test the hypothesis instead of
   * confirming it.
   */
  it('keeps the indexes in step with the readings that survived', () => {
    const m = summarise([40, -5, Number.NaN, 42, 41], 15, [1, 2, 3, 4, 5]);
    expect(m.samplesMs).toEqual([40, 42, 41]);
    expect(m.runIndexes).toEqual([1, 4, 5]);
  });

  it('leaves them out when the caller kept none', () => {
    expect(summarise([40, 42, 41]).runIndexes).toBeUndefined();
  });

  it('would show a canceller that converges as a run of early indexes', () => {
    // What the hypothesis predicts Safari should produce. Not yet observed.
    const m = summarise([104, 107, 112], 15, [1, 2, 3]);
    expect(m.runIndexes).toEqual([1, 2, 3]);
  });
});

/** A measurement carrying per-run levels, as measureRoundTrip returns one. */
function withRuns(samplesMs: number[], runs: RunLevel[]): Measurement {
  const heardPeak = Math.max(0, ...runs.map((r) => r.peak));
  const heardFloor = Math.max(0, ...runs.map((r) => r.noiseFloor));
  return {
    ...summarise(samplesMs),
    diagnostics: { noiseFloor: heardFloor, peak: heardPeak, runs, sampleRate: 48000 },
  };
}

const run = (n: number, floor: number, peak: number, heard: boolean): RunLevel => ({
  run: n,
  noiseFloor: floor,
  peak,
  heard,
});

/*
 * The matched pair of 13 October 2026. One Intel MacBook Pro, the same
 * speaker, the same room, minutes apart.
 *
 *   Chrome  room 0.0115  loudest 0.5477  heard 7 of 7
 *   Safari  room 0.0071  loudest 0.4881  heard 2 of 7
 *
 * The aggregates are within twelve per cent of each other and Safari's ratio
 * to its own room is the higher of the two. Everything that matters is in
 * the runs the aggregate throws away.
 */
const CHROME_SEVEN = (): Measurement =>
  withRuns(
    [63.7, 63.7, 63.7, 63.7, 63.7, 63.7, 63.7],
    [1, 2, 3, 4, 5, 6, 7].map((n) => run(n, 0.0115, 0.5477, true)),
  );

const SAFARI_TWO = (): Measurement =>
  withRuns(
    [104.0, 109.0],
    [
      run(1, 0.0071, 0.4881, true),
      run(2, 0.0071, 0.0069, false),
      run(3, 0.0070, 0.0074, false),
      run(4, 0.0072, 0.0068, false),
      run(5, 0.0071, 0.0070, false),
      run(6, 0.0070, 0.0073, false),
      run(7, 0.0071, 0.4512, true),
    ],
  );

describe('what the aggregate levels were hiding', () => {
  it('tells seven runs that worked from two that did, where the aggregate cannot', () => {
    const chrome = CHROME_SEVEN();
    const safari = SAFARI_TWO();

    // The 0.8.12 test, for the record: one aggregate peak against one
    // aggregate floor. It returns the same answer for both, which is why it
    // could never have answered this.
    const aggregate = (m: Measurement): boolean => {
      const l = levelsOf(m);
      return l !== null && l.peak < l.noiseFloor * 3;
    };
    expect(aggregate(chrome)).toBe(aggregate(safari));

    // Per run, they are not remotely the same measurement.
    expect(doubtReason(chrome)).toBeNull();
    expect(doubtReason(safari)).toBe('removed');
  });

  it('asks only about the runs that produced nothing', () => {
    // Every run heard: there is no missing click to explain.
    expect(measurementRemoved(CHROME_SEVEN())).toBe(false);
  });

  it('does not call it removal when the missing clicks arrived loudly', () => {
    // Five runs recorded something far above the room and still were not
    // timed. That is a detector problem, not a canceller, and saying so is
    // the whole point of separating them.
    const loudMisses = withRuns(
      [104.0, 109.0],
      [
        run(1, 0.0071, 0.4881, true),
        run(2, 0.0071, 0.5102, false),
        run(3, 0.0070, 0.4990, false),
        run(4, 0.0072, 0.5210, false),
        run(5, 0.0071, 0.4772, false),
        run(6, 0.0070, 0.5301, false),
        run(7, 0.0071, 0.4512, true),
      ],
    );
    expect(measurementRemoved(loudMisses)).toBe(false);
    expect(doubtReason(loudMisses)).toBe('too-few');
  });

  it('falls back to the aggregate when a measurement carries no per-run levels', () => {
    expect(runLevelsOf(SAFARI_RUN_FIVE())).toBeNull();
    expect(measurementRemoved(SAFARI_RUN_FIVE())).toBe(true);
  });

  it('ignores a runs array that is not run levels', () => {
    expect(runLevelsOf({ ...summarise([40, 41, 42]), diagnostics: { runs: 'seven' } })).toBeNull();
    expect(runLevelsOf({ ...summarise([40, 41, 42]), diagnostics: { runs: [{ run: 1 }] } })).toBeNull();
  });
});

describe('an input driven past full scale', () => {
  /*
   * Safari at maximum output, 13 October 2026: room 0.0072, loudest 2.0241.
   * Samples run -1 to +1 and Web Audio does not clamp what getUserMedia
   * delivers, so 2.02 is the input overloading by more than double. Clipping
   * destroys the shape findOnsetMatched recognises, and the application was
   * at that moment advising more volume.
   */
  const SAFARI_MAX = (): Measurement =>
    withRuns(
      [103.0, 110.0],
      [
        run(1, 0.0072, 2.0241, true),
        run(2, 0.0072, 0.0070, false),
        run(3, 0.0071, 0.0069, false),
        run(4, 0.0072, 0.0075, false),
        run(5, 0.0072, 0.0071, false),
        run(6, 0.0071, 0.0070, false),
        run(7, 0.0072, 1.8800, true),
      ],
    );

  it('is reported as clipping, ahead of every other complaint', () => {
    const m = SAFARI_MAX();
    expect(measurementOverloaded(m)).toBe(true);
    expect(clippedRuns(runLevelsOf(m) as RunLevel[])).toHaveLength(2);
    // Removal is also true of this measurement; clipping is the one to say,
    // because nothing downstream of a clipped recording means anything.
    expect(measurementRemoved(m)).toBe(true);
    expect(doubtReason(m)).toBe('overloaded');
  });

  it('withdraws a figure even when every reading agrees', () => {
    const clippedButTidy = withRuns(
      [63.7, 63.7, 63.7],
      [1, 2, 3].map((n) => run(n, 0.0100, 1.4000, true)),
    );
    expect(clippedButTidy.confident).toBe(true); // summarise alone is content
    expect(doubtReason(clippedButTidy)).toBe('overloaded');
  });

  it('leaves a healthy level alone', () => {
    expect(measurementOverloaded(CHROME_SEVEN())).toBe(false);
  });

  it('never prints a figure for a clipped recording', () => {
    const line = describeMeasurement(SAFARI_MAX(), 17, 7);
    expect(line).toContain('overloaded');
    expect(line).not.toMatch(/^Measured/);
  });
});

describe('whether more volume could possibly be the answer', () => {
  it('is no when the click already arrives far above the room', () => {
    // 0.4881 against 0.0071 is 69x. Mohammad was told to turn it up anyway,
    // did so to maximum, recovered nothing and overloaded the input.
    expect(soundArrivedLoudly(SAFARI_TWO())).toBe(true);
  });

  it('is yes when every run was genuinely faint', () => {
    const faint = withRuns(
      [104.0],
      [1, 2, 3, 4, 5, 6, 7].map((n) => run(n, 0.0040, 0.0190, n === 1)),
    );
    expect(soundArrivedLoudly(faint)).toBe(false);
  });
});

describe('a run with no measured room', () => {
  /*
   * Safari, 13 October 2026, half output. The first run reported
   * `room 0.0000, loudest 0.0255` and the application called it heard, while
   * that session's one genuine arrival was 0.2248 and the five removed runs
   * sat at 0.0077. The acceptance bar is four times the room or an absolute
   * 1e-4, whichever is greater; at a room of zero the absolute floor becomes
   * the whole test and a residue two hundred times below the real arrival
   * passes it.
   *
   * The same run at full output reported `peak 0.0000` — the search window
   * began past the end of the recording, so nothing was examined.
   *
   * Three sessions running, run 1 appeared among the survivors. It was the
   * recorder starting, not the browser.
   */
  it('is not judgeable in either direction', () => {
    expect(runIsJudgeable(0, 0.0255)).toBe(false); // no room to measure against
    expect(runIsJudgeable(0.0070, 0)).toBe(false); // nothing examined
    expect(runIsJudgeable(MIN_ROOM_LEVEL, 0.5)).toBe(false);
    expect(runIsJudgeable(0.0070, 0.4881)).toBe(true);
  });

  it('records the real Safari session with the artefact marked as one', () => {
    // 13 October 2026, half output: five runs that received nothing, one real
    // arrival at 0.2248, and the first run with no room to judge against.
    const m = withRuns(
      [109.0],
      [
        { run: 1, noiseFloor: 0, peak: 0.0255, heard: false, usable: false },
        run(2, 0.0071, 0.0077, false),
        run(3, 0.0071, 0.0170, false),
        run(4, 0.0070, 0.0078, false),
        run(5, 0.0070, 0.0077, false),
        run(6, 0.0070, 0.0077, false),
        run(7, 0.0071, 0.2248, true),
      ],
    );
    expect(unusableRuns(runLevelsOf(m) as RunLevel[])).toHaveLength(1);
    expect(measurementRemoved(m)).toBe(true);
    expect(doubtReason(m)).toBe('removed');
  });

  it('is excluded from the count that decides removal', () => {
    // Four runs missed with a room to judge against, half of them stripped.
    // Counting the unjudgeable run as a fifth miss tips the balance and the
    // finding is lost, which is what 0.8.13 did.
    const m = withRuns(
      [63.7, 63.7],
      [
        { run: 1, noiseFloor: 5e-6, peak: 0.9, heard: false, usable: false },
        run(2, 0.0071, 0.0077, false),
        run(3, 0.0071, 0.0078, false),
        run(4, 0.0071, 0.4400, false),
        run(5, 0.0071, 0.4500, false),
        run(6, 0.0071, 0.4450, true),
        run(7, 0.0071, 0.4460, true),
      ],
    );
    expect(measurementRemoved(m)).toBe(true);
  });

  it('cannot make the sound look loud', () => {
    // A huge peak against a room of five millionths is the recorder starting,
    // not a loud arrival, and it must not answer the volume question.
    const m = withRuns(
      [109.0],
      [
        { run: 1, noiseFloor: 5e-6, peak: 0.9, heard: false, usable: false },
        run(2, 0.0071, 0.0077, false),
        run(3, 0.0071, 0.0078, false),
      ],
    );
    expect(soundArrivedLoudly(m)).toBe(false);
  });
});
