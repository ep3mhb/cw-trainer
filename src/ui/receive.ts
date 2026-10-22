/**
 * Receiving trainer (RFP §4).
 *
 * A session is a run of drills. Each drill is played once, the student types
 * what they copied, and the answer is aligned character by character so the
 * confusion matrix stays honest when a character is dropped. At the end of
 * the session the Koch promotion rule is applied.
 */

import { LESSON_LABELS, generate, type LessonType } from '../core/generators';
import {
  DEFAULT_COURSE,
  DEFAULT_EXAM,
  buildExam,
  evaluateSession,
  gradeExam,
  lessonCount,
  lessonOf,
  nextCharacter,
  parseCustomSet,
  practiceSet,
  promote,
  weightedSet,
  type PracticeMode,
} from '../core/koch';
import { schedule, scheduleFromTones } from '../core/timing';
import { alignAnswer, type Attempt, type SessionRecord } from '../core/stats';
import { ApiError, api } from '../net/api';
import { pushTraining } from '../net/training';
import { openSeriesExpired } from '../core/training';
import {
  conditionsActive, conditionsAvailable, fadingCurve, handSent, recordedLevel,
  secondStationVoice, staticSamples,
} from '../core/conditions';
import { systemRandom } from '../core/random';
import { certificate, factsFromResult } from './certificate';
import { badge, clear, el, radioGroup, select, slider } from './dom';
import type { Ctx, View } from './context';

const DRILLS_PER_SESSION = 10;
/** The fade curve's resolution. 50 ms is below what the ear hears as a step. */
const FADE_STEP_S = 0.05;
/**
 * How much static is generated, then looped.
 *
 * A drill can run a minute, and the samples are made at the context's own
 * rate — forty-eight thousand a second — so a bed as long as the drill is
 * megabytes on a telephone for nothing the ear can tell from four seconds
 * repeating.
 */
const NOISE_BED_S = 4;

export function receiveView(ctx: Ctx): View {
  const node = el('div');

  let running = false;
  let drillIndex = 0;
  let attempted = 0;
  let correct = 0;
  let sessionStart = 0;
  let currentAnswer = '';
  /** Audio-clock end time of each sent character, for response timing. */
  let charEndTimes: number[] = [];
  let keystrokes: { char: string; at: number }[] = [];
  let playback: { stop: () => void } | null = null;
  /**
   * The exam in progress, or null for an ordinary session.
   *
   * `deck` is what will be sent, in order; `typed` is what the member entered
   * for each of those, filled in as the drills go by. An exam that is stopped
   * part-way is abandoned rather than marked \u2014 half an exam says nothing
   * about whether every character can stand on its own.
   */
  let exam: { deck: string[]; typed: string[] } | null = null;
  /**
   * The fortieth character's exam, which the server sets and marks.
   *
   * It arrives as timing and nothing else, so `groups` is all the browser
   * ever knows about what it is sending \u2014 it plays an exam it cannot read.
   * Only a signed-in member can sit it, because it is the one that earns a
   * certificate and a certificate needs somebody to issue it to.
   */
  let finalExam: { id: number; groups: { tones: { atMs: number; durationMs: number }[] }[]; typed: string[] } | null = null;

  // ---- static controls ----

  const lessonSelect = select<LessonType>({
    label: 'Lesson type',
    value: ctx.settings.lessonType,
    choices: (Object.keys(LESSON_LABELS) as LessonType[]).map((v) => ({ value: v, label: LESSON_LABELS[v] })),
    onChange: (value) => {
      ctx.settings.lessonType = value;
      void ctx.saveSettings();
    },
  });

  const charSpeed = slider({
    label: 'Character speed',
    min: 5, max: 40, step: 1, value: ctx.settings.timing.characterWpm, unit: ' WPM',
    onInput: (value) => {
      ctx.settings.timing.characterWpm = value;
      if (ctx.settings.timing.effectiveWpm > value) ctx.settings.timing.effectiveWpm = value;
      ctx.refreshStatus();
      void ctx.saveSettings();
    },
  });

  const effSpeed = slider({
    label: 'Effective speed',
    min: 3, max: 40, step: 1, value: ctx.settings.timing.effectiveWpm, unit: ' WPM',
    onInput: (value) => {
      ctx.settings.timing.effectiveWpm = Math.min(value, ctx.settings.timing.characterWpm);
      ctx.refreshStatus();
      void ctx.saveSettings();
    },
  });

  const lengthSlider = slider({
    label: 'Drill length',
    min: 5, max: 100, step: 5, value: ctx.settings.drillLength, unit: ' chars',
    onInput: (value) => {
      ctx.settings.drillLength = value;
      void ctx.saveSettings();
    },
  });

  // ---- session area ----

  const courseLine = el('p', { class: 'hint' });
  const progressLine = el('div', { class: 'row' });
  const sent = el('div', { class: 'readout', 'aria-live': 'off' });
  const showSentPlaceholder = (): void => {
    clear(sent);
    sent.append(el('span', { class: 'pending', text: 'Press "Start session" and copy what you hear.' }));
  };
  const answerInput = el('input', {
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    placeholder: 'Type what you copied, then press Enter',
    'aria-label': 'Your copy',
  });
  const feedback = el('div', { class: 'readout answer', 'aria-live': 'polite', hidden: true });
  const startButton = el('button', { class: 'btn primary', text: 'Start session' });
  const replayButton = el('button', { class: 'btn', text: 'Replay', disabled: true });
  const stopButton = el('button', { class: 'btn', text: 'End session', disabled: true });
  const summary = el('div');

  /*
   * Choosing what to practise. The course decides what you are ready for, but
   * a student who already knows the alphabet should not have to climb forty
   * lessons to drill the six characters they keep missing, and a student
   * curious about lesson 20 should be able to hear it. Neither was possible
   * before: every drill came from the unlocked set and nothing else.
   */
  const customInput = el('input', {
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    placeholder: 'e.g. K M R S, or CQ DE 73',
    'aria-label': 'Your own character set',
    value: ctx.settings.practice.custom,
  });
  const customField = el(
    'label',
    { class: 'field' },
    el('span', { class: 'label-row' }, el('span', { text: 'Characters to drill' })),
    el('span', { class: 'control' }, customInput),
  );
  const customNote = el('p', { class: 'hint' });

  const lessonPicker = slider({
    label: 'Lesson',
    min: 1,
    max: lessonCount(),
    step: 1,
    value: Math.min(Math.max(1, ctx.settings.practice.lesson), lessonCount()),
    format: (v) => `${String(v)} of ${String(lessonCount())}`,
    onInput: (value) => {
      ctx.settings.practice.lesson = value;
      void ctx.saveSettings();
      renderCourse();
    },
  });

  const adoptButton = el('button', { class: 'btn', text: 'Start my course here' });

  const modeGroup = radioGroup<PracticeMode>({
    legend: 'What to practise',
    name: 'practice-mode',
    value: ctx.settings.practice.mode,
    choices: [
      { value: 'course', label: 'My course lesson' },
      { value: 'lesson', label: 'Any lesson' },
      { value: 'custom', label: 'My own set' },
    ],
    onChange: (value) => {
      ctx.settings.practice.mode = value;
      void ctx.saveSettings();
      renderCourse();
    },
  });

  customInput.addEventListener('input', () => {
    ctx.settings.practice.custom = customInput.value;
    void ctx.saveSettings();
    renderCourse();
  });

  adoptButton.addEventListener('click', () => {
    const lesson = ctx.settings.practice.lesson;
    ctx.progress = { unlocked: Math.max(1, lesson + 1) };
    void ctx.saveProgress();
    ctx.refreshStatus();
    renderCourse();
    ctx.toast(`Course position moved to lesson ${String(lesson)}.`, 'good');
  });

  /** What the member is working with, as shown on screen. */
  const chosenSet = (): ReturnType<typeof practiceSet> =>
    practiceSet(ctx.settings.practice, ctx.progress);

  /**
   * What the generators actually pick from.
   *
   * Identical to the set above except after a failed exam, when the
   * characters it named appear several times over. The generators pick
   * uniformly from the array they are handed, so repeating a character in it
   * is the whole of the weighting \u2014 a failed exam steers the next drills
   * instead of merely reporting a result.
   */
  const drillCharacters = (): string[] => {
    const chosen = chosenSet();
    if (!chosen.countsTowardCourse) return chosen.characters;
    return weightedSet(chosen.characters, ctx.progress.failed ?? []);
  };

  const renderCourse = (): void => {
    const mode = ctx.settings.practice.mode;
    lessonPicker.hidden = mode !== 'lesson';
    adoptButton.hidden = mode !== 'lesson';
    customField.hidden = mode !== 'custom';
    customNote.hidden = mode !== 'custom';

    if (mode === 'custom') {
      const { rejected } = parseCustomSet(customInput.value);
      customNote.textContent =
        rejected.length === 0
          ? 'Letters, digits, punctuation and prosigns such as <AR>. Separate them however you like.'
          : `No Morse for ${rejected.join(' ')} \u2014 ignored.`;
    }

    const chosen = chosenSet();
    const next = nextCharacter(ctx.progress);
    const own = lessonOf(ctx.progress);
    clear(courseLine);
    courseLine.append(
      `${chosen.label}: `,
      el('b', { text: chosen.characters.join(' ') }),
      ` (${String(chosen.characters.length)} characters). `,
    );
    if (chosen.warning !== undefined) {
      courseLine.append(el('span', { class: 'flag-warn', text: chosen.warning }));
    } else if (chosen.countsTowardCourse) {
      courseLine.append(
        next === null
          ? 'The course is complete.'
          : `Reach 90% over a session to be offered the exam for "${next}".`,
      );
    } else {
      courseLine.append(
        el('span', { class: 'flag-warn', text: 'Practice only \u2014 this does not move your course on.' }),
        ` Your own lesson is ${String(own)}.`,
      );
    }
    if (mode === 'lesson') {
      adoptButton.disabled = running || ctx.settings.practice.lesson === own;
    }
    // Changing the character set halfway through a session would score the
    // first half against one set and the rest against another.
    for (const control of [...modeGroup.querySelectorAll('input'), lessonPicker.querySelector('input'), customInput]) {
      if (control !== null) control.disabled = running;
    }
  };

  /**
   * Write the series down as it stands (RFD A42).
   *
   * An examination is not a series — it has no ten drills to be part of
   * the way through, and it is abandoned rather than resumed if it is
   * interrupted — so neither kind of exam is ever written here.
   */
  const saveSeries = async (): Promise<void> => {
    if (exam !== null || finalExam !== null || !running) return;
    try {
      await ctx.store.saveOpenSeries({
        id: `s-${String(sessionStart)}`,
        startedAt: sessionStart,
        lessonType: ctx.settings.lessonType,
        characterWpm: ctx.settings.timing.characterWpm,
        effectiveWpm: ctx.settings.timing.effectiveWpm,
        drillsDone: Math.min(drillIndex, DRILLS_PER_SESSION),
        attempted,
        correct,
        unlockedCount: ctx.progress.unlocked,
      });
    } catch {
      // Best effort: losing the note costs a resumed series, not any practice.
    }
  };

  /**
   * Pick up a series this browser — or another of the member's devices —
   * was part of the way through.
   *
   * A series older than the window is not resumed but closed, and counted
   * honestly as the short session it was. Offering somebody a series they
   * began last March would be worse than starting again.
   */
  const resumeSeries = async (): Promise<boolean> => {
    let held;
    try {
      held = await ctx.store.openSeries();
    } catch {
      return false;
    }
    if (held === null) return false;
    if (openSeriesExpired(held, Date.now())) {
      if (held.attempted > 0) {
        await ctx.store.addSession({
          id: held.id,
          startedAt: held.startedAt,
          endedAt: held.startedAt,
          lessonType: held.lessonType,
          characterWpm: held.characterWpm,
          effectiveWpm: held.effectiveWpm,
          attempted: held.attempted,
          correct: held.correct,
          unlockedCount: held.unlockedCount,
        });
      }
      await ctx.store.clearOpenSeries();
      return false;
    }
    if (held.drillsDone >= DRILLS_PER_SESSION) {
      await ctx.store.clearOpenSeries();
      return false;
    }
    sessionStart = held.startedAt;
    drillIndex = held.drillsDone;
    attempted = held.attempted;
    correct = held.correct;
    return true;
  };

  /*
   * Leaving the page is the moment that matters most for A42: it is
   * usually the moment somebody picks up their telephone instead. A drill
   * takes twenty or thirty seconds, so without this the last drill or two
   * would not have travelled — and those are exactly the ones the other
   * device needs.
   *
   * `pagehide` rather than `beforeunload`, because Safari on iOS fires
   * beforeunload unreliably and a page put to sleep there never unloads at
   * all. `visibilitychange` catches switching apps without closing
   * anything, which is the commonest case of the lot.
   */
  /**
   * Show a series already under way, before anything is pressed.
   *
   * The counters are only ever filled in while a session runs, so coming
   * back to this tab — from On air, say — left the panel reading
   * "— / 10" with three drills already done and uploaded. The work was
   * safe and resumed correctly the moment Start was pressed, but the panel
   * said it had gone, which is the same thing as having gone as far as the
   * member is concerned. Reported on 17 October 2026: "when pressing on
   * air the drill is resetting to 0/10".
   *
   * So the stored series is read when the tab is built and whenever it
   * comes back into view, the counters show where it stands, and the
   * button says what pressing it will do.
   */
  const showResumable = async (): Promise<void> => {
    if (running) return;
    let held;
    try {
      held = await ctx.store.openSeries();
    } catch {
      return;
    }
    if (held === null || openSeriesExpired(held, Date.now()) || held.drillsDone >= DRILLS_PER_SESSION) {
      startButton.textContent = 'Start session';
      return;
    }
    sessionStart = held.startedAt;
    drillIndex = held.drillsDone;
    attempted = held.attempted;
    correct = held.correct;
    startButton.textContent = `Continue — drill ${String(held.drillsDone + 1)} of ${String(DRILLS_PER_SESSION)}`;
    renderProgress();
  };

  const sendOnLeaving = (): void => {
    if (!running) return;
    void saveSeries().then(() => { void pushTraining(ctx.store, ctx.member); });
  };
  const onHidden = (): void => { if (document.visibilityState === 'hidden') sendOnLeaving(); };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', sendOnLeaving);

  const renderProgress = (): void => {
    clear(progressLine);
    const accuracy = attempted === 0 ? 0 : correct / attempted;
    progressLine.append(
      // drillIndex is already 1 on the first drill, so it is the number to
      // show as-is; adding one again labelled the first drill "2 of 10".
      badge(
        'Drill',
        drillIndex === 0 ? `— / ${String(DRILLS_PER_SESSION)}`
          : `${String(Math.min(drillIndex, DRILLS_PER_SESSION))} / ${String(DRILLS_PER_SESSION)}`,
      ),
      badge('Characters', String(attempted)),
      badge(
        'Accuracy',
        attempted === 0 ? '—' : `${(accuracy * 100).toFixed(0)}%`,
        attempted === 0 ? '' : accuracy >= 0.9 ? 'good' : accuracy >= 0.75 ? 'warn' : 'bad',
      ),
    );
  };

  async function playCurrent(): Promise<void> {
    if (!(await ctx.ensureAudio())) return;
    /*
     * RFD A39, and the rule the maintainer asked to be treated as a
     * condition of the amendment rather than a detail of it: an
     * examination always runs on a clean signal, whatever the member has
     * chosen for practice. A certificate must mean the same thing for
     * everyone who holds one, and it cannot if two members sat different
     * examinations. `conditioned` is false for both kinds of exam, and
     * that is the only place in the application where it is decided.
     */
    const conditioned = exam === null && finalExam === null
      && conditionsActive(ctx.settings.conditions);
    const level = conditioned ? ctx.settings.conditions.level : 'off';
    const chosen = ctx.settings.conditions;

    // One generator for the drill, so the whole of it — the fist, the fade,
    // the crashes and the other station — replays from one seed.
    const rnd = systemRandom();

    const cleanPlan = schedule(currentAnswer, ctx.settings.timing);
    const plan = conditioned && chosen.hand ? handSent(cleanPlan, level, rnd) : cleanPlan;
    charEndTimes = [];
    // One end time per sent character, in order.
    const endByToken = new Map<number, number>();
    for (const tone of plan.tones) {
      endByToken.set(tone.tokenIndex, tone.atMs + tone.durationMs);
    }
    for (const [, endMs] of [...endByToken.entries()].sort((a, b) => a[0] - b[0])) charEndTimes.push(endMs);

    playback?.stop();
    const started = performance.now();
    if (conditioned) {
      const seconds = plan.paddedMs / 1000 + 1;
      const other = chosen.secondStation ? secondStationVoice(ctx.settings.audio.pitchHz, level, rnd) : null;
      playback = ctx.audio.playConditioned(plan, {
        fade: chosen.fading ? fadingCurve(seconds, level, rnd, FADE_STEP_S) : null,
        fadeStepS: FADE_STEP_S,
        // A short bed, looped, rather than a buffer as long as the drill:
        // a drill can run a minute and the samples are the context's own
        // rate, which on a telephone is megabytes for no audible gain.
        noise: chosen.static ? staticSamples(NOISE_BED_S, ctx.audio.sampleRate, level, rnd) : null,
        other: other === null ? null : {
          // Unrelated text, which is the point: a second station is
          // distracting because it is not what you are trying to copy.
          schedule: schedule(
            generate({
              type: 'groups',
              activeSet: drillCharacters(),
              length: Math.max(10, ctx.settings.drillLength * 2),
              random: rnd,
            }).answer,
            { ...ctx.settings.timing, characterWpm: other.wpm, effectiveWpm: other.wpm },
          ),
          pitchHz: other.pitchHz,
          gain: other.gain,
        },
      });
    } else {
      playback = ctx.audio.play(plan);
    }
    replayButton.disabled = false;
    answerInput.focus();
    // Response times are measured from the moment each character finished
    // sounding, so a fast copy scores a short response.
    keystrokes = [];
    answerInput.dataset['startedAt'] = String(started);
  }

  function scoreDrill(): void {
    const typed = answerInput.value;
    if (finalExam !== null) {
      // Nothing to mark here: the browser does not know what was sent. Five
      // answers go up per group, padded if the member typed fewer, so the
      // submission lines up with the deck the server is holding.
      const chars = [...typed.trim().toUpperCase()].filter((c) => c !== ' ');
      for (let i = 0; i < 5; i += 1) finalExam.typed.push(chars[i] ?? '');
      clear(feedback);
      feedback.hidden = false;
      feedback.append(el('div', { class: 'hint', text:
        `Sent up. ${String(finalExam.typed.length)} of ${String(finalExam.groups.length * 5)} characters \u2014 `
        + 'the server marks this one, so there is nothing to show yet.' }));
      return;
    }
    const pairs = alignAnswer(currentAnswer, typed);
    const now = Date.now();
    const startedAt = Number(answerInput.dataset['startedAt'] ?? '0');

    let sentIndex = 0;
    let typedIndex = 0;
    const drillAttempts: Attempt[] = [];
    for (const pair of pairs) {
      if (pair.sent === '') {
        typedIndex += 1;
        continue;
      }
      const charEnd = charEndTimes[sentIndex];
      const stroke = pair.typed === '' ? undefined : keystrokes[typedIndex];
      const responseMs =
        stroke === undefined || charEnd === undefined
          ? 0
          : Math.max(0, stroke.at - startedAt - charEnd);
      drillAttempts.push({ sent: pair.sent, typed: pair.typed, responseMs, at: now });
      // Each sent character of an exam drill is one deck entry, in order.
      if (exam !== null) exam.typed.push(pair.typed);
      sentIndex += 1;
      if (pair.typed !== '') typedIndex += 1;
    }

    // Persisted per drill, not per session: switching tabs, closing the
    // laptop or a browser crash must not lose work already done.
    void ctx.store.addAttempts(drillAttempts);
    attempted += drillAttempts.length;
    correct += drillAttempts.filter((a) => a.typed === a.sent).length;
    /*
     * RFD A42, and the same reasoning one line further. The attempts were
     * already safe; the SERIES was not. Until 0.10.0 the count of drills
     * lived only in `drillIndex` above, so a reload, a closed tab or a
     * telephone discarding the page put the member back at the first drill
     * with the work done but no longer counting towards anything.
     *
     * Not awaited and failure is silent, for the reason the uploads are:
     * a member who has just answered a drill should not be made to wait on
     * a database, and the attempts are the part that matters.
     */
    void saveSeries().then(() => {
      /*
       * RFD A42, and the half I left out. The series was written down after
       * every drill but only UPLOADED when the session ended, so a member
       * three drills into ten had told the server nothing and the next
       * device had nothing to adopt — which is the whole feature. Reported
       * from his Mac and iPhone within the hour: Mac 3 of 10, telephone
       * 0 of 10.
       *
       * Not awaited and silent, as every other upload here is: a member who
       * has just answered a drill waits on nothing, and a request that does
       * not get through is simply sent again after the next drill.
       */
      void pushTraining(ctx.store, ctx.member);
    });

    clear(feedback);
    feedback.hidden = false;
    feedback.append(el('div', { class: 'hint', text: 'Sent, with your copy marked:' }));
    const line = el('div');
    for (const pair of pairs) {
      if (pair.sent === '') {
        line.append(el('span', { class: 'miss', text: pair.typed.toLowerCase() }));
      } else {
        line.append(el('span', { class: pair.typed === pair.sent ? 'hit' : 'miss', text: pair.sent }));
      }
    }
    feedback.append(line);
    const wrong = pairs.filter((p) => p.sent !== '' && p.typed !== p.sent);
    if (wrong.length > 0) {
      feedback.append(
        el('div', { class: 'hint', text: wrong.map((p) => `${p.sent} → ${p.typed === '' ? 'missed' : p.typed}`).join(', ') }),
      );
    }
  }

  async function nextDrill(): Promise<void> {
    drillIndex += 1;
    if (exam === null && drillIndex > DRILLS_PER_SESSION) {
      await endSession();
      return;
    }
    if (finalExam !== null) {
      const index = Math.floor(finalExam.typed.length / 5);
      const group = finalExam.groups[index];
      if (group === undefined) {
        await endSession();
        return;
      }
      // There is no answer to compare against here: the server holds it, and
      // that is the point. currentAnswer stays empty and the group is played
      // from its timing alone.
      currentAnswer = '';
      answerInput.value = '';
      clear(sent);
      sent.append(el('span', { class: 'pending', text: '\u00b7 \u00b7 \u00b7  listening  \u00b7 \u00b7 \u00b7' }));
      renderProgress();
      if (!(await ctx.ensureAudio())) return;
      playback?.stop();
      playback = ctx.audio.play(scheduleFromTones(group.tones));
      replayButton.disabled = false;
      return;
    }
    if (exam !== null) {
      // The exam is sent as ordinary drills cut from the deck, so it looks
      // and sounds like any other session: no grouping by character, no
      // announcement of what is coming.
      const from = exam.typed.length;
      const slice = exam.deck.slice(from, from + ctx.settings.drillLength);
      if (slice.length === 0) {
        await endSession();
        return;
      }
      currentAnswer = slice.join('');
    } else {
      const drill = generate({
        type: ctx.settings.lessonType,
        activeSet: drillCharacters(),
        length: ctx.settings.drillLength,
      });
      currentAnswer = drill.answer;
    }
    answerInput.value = '';
    clear(sent);
    sent.append(el('span', { class: 'pending', text: '· · ·  listening  · · ·' }));
    renderProgress();
    await playCurrent();
  }

  async function startSession(): Promise<void> {
    if (!(await ctx.ensureAudio())) return;
    running = true;
    renderCourse();
    drillIndex = 0;
    attempted = 0;
    correct = 0;
    sessionStart = Date.now();
    // A42: carry on with a series already under way, here or on another of
    // the member's devices, rather than starting a fresh ten. resumeSeries
    // overwrites the four values above when there is one.
    if (exam === null && finalExam === null) await resumeSeries();
    clear(summary);
    clear(feedback);
    feedback.hidden = true;
    startButton.disabled = true;
    startButton.textContent = 'Start session';
    stopButton.disabled = false;
    answerInput.disabled = false;
    await nextDrill();
  }

  /**
   * The offer, as a panel rather than a dialog.
   *
   * It appears at the end of every session good enough to qualify, and
   * declining it costs nothing \u2014 the question simply comes back next time.
   * A member who wants to live on lesson 12 for a month is doing nothing
   * wrong, and should not have to argue with the application about it.
   */
  function offerExam(accuracy: number, over: number): void {
    const next = nextCharacter(ctx.progress);
    if (next === null) {
      summary.append(el('p', { class: 'notice', text:
        `${(accuracy * 100).toFixed(1)}%. The whole course is unlocked \u2014 keep raising the speed.` }));
      return;
    }
    const final = isFinalCharacter();
    const signedIn = ctx.member !== null;
    const take = el('button', { class: 'btn primary', text:
      final ? `Take the final exam for "${next}"` : `Take the exam for "${next}"` });
    const stay = el('button', { class: 'btn', text: 'Stay with these' });
    const deck = buildExam(ctx.progress);
    take.addEventListener('click', () => {
      clear(summary);
      // The last character is the server's to award: its exam is set and
      // marked by the server, and it is what earns the certificate.
      if (final && signedIn) void startFinalExam();
      else void startExam();
    });
    stay.addEventListener('click', () => {
      clear(summary);
      summary.append(el('p', { class: 'hint', text:
        'Staying put. The offer comes back at the end of your next good session.' }));
    });
    summary.append(
      el('div', { class: 'offer' },
        el('p', {}, el('b', { text: `${(accuracy * 100).toFixed(1)}% over ${String(over)} characters.` }),
          ' Ready to add ', el('b', { text: `"${next}"` }), '?'),
        el('p', { class: 'hint', text:
          `The exam sends each of your ${String(chosenSet().characters.length)} characters four times \u2014 `
          + `${String(deck.length)} in all \u2014 and every one of them has to stand on its own. `
          + 'Nothing changes if you would rather carry on practising.' }),
        final && signedIn
          ? el('p', { class: 'hint', text:
              'This is the last one. The server sets and marks this exam, and passing it '
              + 'earns your certificate.' })
          : null,
        final && !signedIn
          ? el('p', { class: 'flag-warn', text:
              'This is the last one. You can sit it here and finish the course, but a certificate '
              + 'is issued to a member, so it needs an account on the server \u2014 sign in on '
              + 'the On air tab first if you would like one.' })
          : null,
        el('div', { class: 'row' }, take, stay),
      ),
    );
  }

  /** The last character of the course needs the server, not this browser. */
  const isFinalCharacter = (): boolean =>
    ctx.progress.unlocked === DEFAULT_COURSE.order.length - 1;

  /**
   * Sit the fortieth exam.
   *
   * The server sets it, marks it and issues the certificate, so this browser
   * never learns what it is sending \u2014 only its timing. Sitting it needs an
   * account, which is said plainly in the offer rather than discovered here.
   */
  async function startFinalExam(): Promise<void> {
    clear(summary);
    summary.append(el('p', { class: 'hint', text: 'Asking the server to set your exam\u2026' }));
    try {
      const started = await api.examStart(
        ctx.settings.timing.characterWpm,
        ctx.settings.timing.effectiveWpm,
      );
      finalExam = { id: started.examId, groups: started.groups, typed: [] };
      clear(summary);
      await startSession();
    } catch (error) {
      clear(summary);
      summary.append(el('p', { class: 'notice bad', text:
        error instanceof ApiError
          ? `The server could not set the exam: ${error.message}`
          : 'Could not reach the server. Your course position is unchanged.' }));
    }
  }

  async function submitFinalExam(): Promise<void> {
    const sat = finalExam;
    finalExam = null;
    if (sat === null) return;
    clear(summary);

    const expected = sat.groups.length * 5;
    if (sat.typed.length < expected) {
      summary.append(el('p', { class: 'notice warn', text:
        `Exam stopped after ${String(sat.typed.length)} of ${String(expected)} characters. `
        + 'Nothing has changed \u2014 start it again when you have time for the whole thing.' }));
      return;
    }

    try {
      const result = await api.examSubmit(sat.id, sat.typed);
      const accuracyText = `${(result.accuracy * 100).toFixed(1)}%`;
      if (!result.pass) {
        ctx.progress = { ...ctx.progress, failed: result.failed };
        await ctx.saveProgress();
        renderCourse();
        summary.append(
          el('p', { class: 'notice warn', text: result.failed.length > 0
            ? `Not this time. ${result.failed.join(', ')} came in under three out of four, `
              + `out of ${accuracyText} overall.`
            : `Not this time. ${accuracyText} overall, and the exam needs 90%.` }),
          el('p', { class: 'hint', text: 'Sit it again whenever you like.' }),
        );
        return;
      }

      ctx.progress = promote(ctx.progress);
      await ctx.saveProgress();
      // A40: the position has just changed, and nothing else would tell the
      // server until the next session ended.
      void pushTraining(ctx.store, ctx.member);
      renderCourse();
      ctx.refreshStatus();
      summary.append(el('p', { class: 'notice good', text:
        `Passed \u2014 ${accuracyText}, every one of the forty characters standing on its own. `
        + 'The course is complete.' }));
      if (ctx.member !== null) {
        summary.append(
          certificate(factsFromResult(ctx.member, result, new Date())),
          el('p', { class: 'hint', text:
            'The square on it scans to the server\u2019s own copy, so anyone you show it to can check it. '
            + 'That also means anyone holding the code can see your callsign, the date and the speed \u2014 '
            + 'nothing else. You can withdraw it later from "Your account".' }),
        );
      }
    } catch (error) {
      // The exam was sat; only the submission failed. Say so, because the
      // alternative reading is that the work was thrown away.
      summary.append(el('p', { class: 'notice bad', text:
        error instanceof ApiError && error.status !== 0
          ? `The server refused the submission: ${error.message}`
          : 'Could not reach the server to submit the exam. Nothing has changed \u2014 '
            + 'you will have to sit it again.' }));
    }
  }

  async function startExam(): Promise<void> {
    exam = { deck: buildExam(ctx.progress), typed: [] };
    await startSession();
  }

  /**
   * Mark a finished exam.
   *
   * A stopped exam is abandoned, not marked: half an exam says nothing about
   * whether every character can stand on its own, and scoring it would either
   * fail someone unfairly or pass them on a fragment.
   */
  async function finishExam(): Promise<void> {
    const sat = exam;
    exam = null;
    if (sat === null) return;
    clear(summary);

    if (sat.typed.length < sat.deck.length) {
      summary.append(el('p', { class: 'notice warn', text:
        `Exam stopped after ${String(sat.typed.length)} of ${String(sat.deck.length)} characters. `
        + 'Nothing has changed \u2014 start it again when you have time for the whole thing.' }));
      return;
    }

    const result = gradeExam(sat.deck, sat.typed);
    const accuracyText = `${(result.accuracy * 100).toFixed(1)}%`;
    if (result.pass) {
      const added = nextCharacter(ctx.progress);
      ctx.progress = promote(ctx.progress);
      await ctx.saveProgress();
      // A40, as above: this is the moment the position moves.
      void pushTraining(ctx.store, ctx.member);
      renderCourse();
      ctx.refreshStatus();
      summary.append(el('p', { class: 'notice good', text:
        `Passed \u2014 ${accuracyText}, and every character stood on its own. `
        + `"${added ?? ''}" joins the set from your next session.` }));
      return;
    }

    ctx.progress = { ...ctx.progress, failed: result.failed };
    await ctx.saveProgress();
    renderCourse();
    // The "old rule would have passed this" line is only true when the
    // overall score actually was good enough, which is the interesting case
    // and not the usual one. Saying it after a 12% exam reads as nonsense.
    const hidden = result.accuracy >= DEFAULT_EXAM.overallAccuracy;
    const detail = result.reason === 'below-accuracy'
      ? `${accuracyText} overall, and the exam needs 90%. No single character let you down `
        + '\u2014 it was spread across the set.'
      : `${result.failed.join(', ')} came in under three out of four, out of ${accuracyText} overall`
        + (hidden
          ? ' \u2014 which is exactly the sort of result that used to pass unnoticed.'
          : '.');
    summary.append(
      el('p', { class: 'notice warn', text: `Not this time. ${detail}` }),
      el('p', { class: 'hint', text: result.failed.length > 0
        ? 'Those characters will come up more often in your next drills. Sit the exam again whenever you like.'
        : 'Run a few more sessions and sit it again whenever you like.' }),
    );
  }

  async function endSession(): Promise<void> {
    running = false;
    renderCourse();
    playback?.stop();
    playback = null;
    startButton.disabled = false;
    startButton.textContent = 'Start session';
    stopButton.disabled = true;
    replayButton.disabled = true;
    answerInput.disabled = true;
    showSentPlaceholder();

    if (attempted === 0 && finalExam === null) {
      renderProgress();
      return;
    }

    const record: SessionRecord = {
      id: `s-${String(sessionStart)}`,
      startedAt: sessionStart,
      endedAt: Date.now(),
      lessonType: ctx.settings.lessonType,
      characterWpm: ctx.settings.timing.characterWpm,
      effectiveWpm: ctx.settings.timing.effectiveWpm,
      attempted,
      correct,
      unlockedCount: ctx.progress.unlocked,
      /*
       * RFD A39. Sessions worked under conditions score lower than clean
       * ones, and counting them into the same figures would show a member
       * a decline that is an artefact of their own choice. Recorded from
       * recordedLevel rather than from the setting, so that a member who
       * chose "strong" and then switched all four conditions off is
       * recorded honestly as having worked clean.
       */
      conditions: recordedLevel(ctx.settings.conditions),
    };
    await ctx.store.addSession(record);
    // A42: the series is finished, so it stops being one. Cleared before the
    // upload, so that the same request cannot carry both a finished session
    // and an open copy of it.
    await ctx.store.clearOpenSeries();
    /*
     * RFD A37: send it to the server, if the member asked for that.
     *
     * Not awaited, and failure is silent: the session is already saved
     * locally, which is what matters, and an upload that does not get
     * through goes again on the next opportunity. A member who has just
     * finished a drill should not be made to wait on a network, nor told
     * off for being on a train.
     */
    void pushTraining(ctx.store, ctx.member);

    if (finalExam !== null) {
      await submitFinalExam();
      renderProgress();
      return;
    }

    if (exam !== null) {
      await finishExam();
      renderProgress();
      return;
    }

    const chosen = chosenSet();
    const decision = evaluateSession({ attempted, correct }, ctx.progress);
    clear(summary);
    const accuracyText = `${(decision.accuracy * 100).toFixed(1)}%`;
    if (!chosen.countsTowardCourse) {
      // Drilling ahead of yourself, or a set of your own, is practice. Letting
      // it unlock characters would let a student skip the course by accident.
      summary.append(
        el('p', { class: 'notice', text:
          `${accuracyText} on ${chosen.label.toLowerCase()}. This was practice, so your course position is ` +
          'unchanged. Switch to "My course lesson" for a session that counts.' }),
      );
      renderProgress();
      return;
    }
    if (decision.promote) {
      // Not a promotion — an offer. A session good enough to move on used to
      // move the member on without asking, including when they had merely
      // pressed Stop while ahead. The exam decides now, and they decide when
      // to sit it.
      offerExam(decision.accuracy, attempted);
    } else {
      const reason =
        decision.reason === 'too-few-attempts'
          ? `${accuracyText} over ${String(attempted)} characters. A promotion needs at least 50 characters in the session.`
          : decision.reason === 'course-complete'
            ? `${accuracyText}. The whole course is unlocked — keep raising the speed.`
            : `${accuracyText}. 90% unlocks the next character; run it again.`;
      summary.append(el('p', { class: 'notice warn', text: reason }));
    }
    offerConditionsOnce();
    renderProgress();
  }

  /**
   * The invitation to try real conditions (RFD A39).
   *
   * "Offered once, calmly, in the same manner as the present invitation to
   * sit a character examination, and stays off until it is accepted." Once
   * is the operative word: the flag is set when it is SHOWN, not when it is
   * accepted, so declining it is final and the member is never asked twice.
   * An offer that comes back is not calm, whatever it says.
   *
   * Not shown below ten characters at all. Somebody still struggling with K
   * and M is not helped by static.
   */
  function offerConditionsOnce(): void {
    if (ctx.settings.conditionsOffered) return;
    if (!conditionsAvailable(ctx.progress.unlocked)) return;
    ctx.settings.conditionsOffered = true;
    void ctx.saveSettings();

    const panel = el('div', { class: 'offer' });
    panel.append(el('p', { text:
      'You have ten characters now. Everything the application has sent you so far has been a '
      + 'perfect signal — steady, silent behind, and machine-timed. Nothing on the air is. You can '
      + 'practise against fading, static, another station and a hand at the key whenever you like.' }));
    const tryIt = el('button', { class: 'btn primary', text: 'Try mild conditions' });
    const later = el('button', { class: 'btn', text: 'Not now' });
    tryIt.addEventListener('click', () => {
      ctx.settings.conditions = { ...ctx.settings.conditions, level: 'mild' };
      void ctx.saveSettings();
      clear(panel);
      panel.append(el('p', { text:
        'Mild conditions are on. Settings has the four of them separately, and the exams always '
        + 'run on a clean signal whatever you choose here.' }));
    });
    later.addEventListener('click', () => {
      clear(panel);
      panel.append(el('p', { class: 'hint', text: 'Left off. Settings has it when you want it.' }));
    });
    panel.append(el('div', { class: 'row' }, tryIt, later));
    summary.append(panel);
  }

  answerInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!running) return;
      scoreDrill();
      void nextDrill();
      return;
    }
    if (event.key.length === 1) {
      keystrokes.push({ char: event.key.toUpperCase(), at: performance.now() });
    }
  });

  startButton.addEventListener('click', () => void startSession());
  stopButton.addEventListener('click', () => void endSession());
  replayButton.addEventListener('click', () => void playCurrent());

  node.append(
    el(
      'section',
      { class: 'panel' },
      el('h2', { text: 'Receiving' }),
      courseLine,
      progressLine,
      el('div', { style: 'height:0.9rem' }),
      sent,
      el('div', { style: 'height:0.6rem' }),
      answerInput,
      el('div', { style: 'height:0.6rem' }),
      el('div', { class: 'row' }, startButton, replayButton, stopButton),
      el('div', { style: 'height:0.6rem' }),
      feedback,
      summary,
    ),
    el(
      'section',
      { class: 'panel' },
      el('h2', { text: 'Lesson' }),
      modeGroup,
      el('div', { class: 'grid' }, lessonPicker, customField),
      customNote,
      el('div', { class: 'row' }, adoptButton),
      el('div', { style: 'height:0.6rem' }),
      el('p', {
        class: 'hint',
        text: 'Characters are sent at the character speed with the gaps padded out to the effective speed, so you never learn to count elements.',
      }),
      el('div', { class: 'grid' }, lessonSelect, lengthSlider, charSpeed, effSpeed),
      radioGroup<'off' | 'on'>({
        legend: 'Farnsworth',
        name: 'farnsworth',
        value: ctx.settings.timing.effectiveWpm < ctx.settings.timing.characterWpm ? 'on' : 'off',
        choices: [
          { value: 'on', label: 'Padded gaps' },
          { value: 'off', label: 'Standard timing' },
        ],
        onChange: (value) => {
          const next =
            value === 'off' ? ctx.settings.timing.characterWpm : Math.round(ctx.settings.timing.characterWpm / 2);
          ctx.settings.timing.effectiveWpm = next;
          effSpeed.setValue(next);
          void ctx.saveSettings();
          ctx.refreshStatus();
        },
      }),
    ),
  );

  renderCourse();
  renderProgress();
  showSentPlaceholder();
  answerInput.disabled = true;
  void showResumable();

  return {
    node,
    dispose: () => {
      playback?.stop();
      /*
       * RFD A42. This used to finalise the session: `if (running &&
       * attempted > 0) void endSession()`. That was wrong twice over. It
       * only ran on a tab switch WITHIN the application, so closing the
       * browser recorded nothing at all; and when it did run it wrote a
       * part-finished series out as a complete session of two or three
       * drills, which can never earn a promotion because the rule wants
       * fifty characters in one session. A member who moved between
       * devices mid-series therefore lost the series either way.
       *
       * The series is now written down after every drill and left open, so
       * leaving the tab is simply leaving: nothing to finalise, nothing
       * lost, and it resumes when they come back here or anywhere else.
       */
      running = false;
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', sendOnLeaving);
    },
    refresh: () => {
      renderCourse();
      void showResumable();
    },
  };
}
