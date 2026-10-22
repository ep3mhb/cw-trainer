/**
 * Koch course progression (RFP §4).
 *
 * "begin with two characters, add the next after 90% accuracy over a
 * session. Standard Koch order, overridable from a configuration file."
 *
 * The order lives in KOCH_ORDER (src/core/morse.ts) and can be replaced by
 * an operator configuration at runtime — see courseConfig below.
 */

import { KOCH_ORDER, PROSIGNS, isSendable, kochSet } from './morse';
import { systemRandom, type Random } from './random';

export interface CourseConfig {
  order: readonly string[];
  /** Characters in the first lesson. Koch starts with two. */
  startingCount: number;
  /** Session accuracy needed to unlock the next character, 0..1. */
  promotionAccuracy: number;
  /** Minimum characters attempted before a promotion can happen. */
  minimumAttempts: number;
}

export const DEFAULT_COURSE: Readonly<CourseConfig> = Object.freeze({
  order: KOCH_ORDER,
  startingCount: 2,
  promotionAccuracy: 0.9,
  minimumAttempts: 50,
});

export interface CourseProgress {
  /** How many characters of the order have been unlocked. */
  unlocked: number;
  /**
   * Characters a failed exam named, over-sampled in later practice until
   * they are passed. Optional because progress saved before RFD A25 has no
   * such field, and an old export must still import.
   */
  failed?: string[];
}

export function initialProgress(config: CourseConfig = DEFAULT_COURSE): CourseProgress {
  return { unlocked: Math.max(1, config.startingCount), failed: [] };
}

/** The characters the student is currently working with. */
export function activeSet(progress: CourseProgress, config: CourseConfig = DEFAULT_COURSE): string[] {
  return kochSet(progress.unlocked, config.order);
}

/** The character that a promotion would add next, or null at the end. */
export function nextCharacter(progress: CourseProgress, config: CourseConfig = DEFAULT_COURSE): string | null {
  return config.order[progress.unlocked] ?? null;
}

export interface SessionOutcome {
  attempted: number;
  correct: number;
}

export interface PromotionDecision {
  promote: boolean;
  accuracy: number;
  reason: 'promoted' | 'below-threshold' | 'too-few-attempts' | 'course-complete';
}

/**
 * Decide whether a finished session earns the next character.
 *
 * Kept pure and separate from the UI so the rule is visible in one place
 * and covered by a test — a silently wrong promotion rule would quietly
 * ruin a student's progress.
 */
export function evaluateSession(
  outcome: SessionOutcome,
  progress: CourseProgress,
  config: CourseConfig = DEFAULT_COURSE,
): PromotionDecision {
  const accuracy = outcome.attempted === 0 ? 0 : outcome.correct / outcome.attempted;
  if (progress.unlocked >= config.order.length) {
    return { promote: false, accuracy, reason: 'course-complete' };
  }
  if (outcome.attempted < config.minimumAttempts) {
    return { promote: false, accuracy, reason: 'too-few-attempts' };
  }
  if (accuracy >= config.promotionAccuracy) {
    return { promote: true, accuracy, reason: 'promoted' };
  }
  return { promote: false, accuracy, reason: 'below-threshold' };
}

/**
 * Apply a promotion, never going past the end of the order.
 *
 * The failed-character weighting is cleared: a promotion only happens after
 * an exam in which every character stood on its own, so whatever was weak
 * before is not weak now, and carrying the weighting forward would quietly
 * distort every later drill.
 */
export function promote(progress: CourseProgress, config: CourseConfig = DEFAULT_COURSE): CourseProgress {
  return { unlocked: Math.min(progress.unlocked + 1, config.order.length), failed: [] };
}

// ---- The promotion exam (RFD A25) ----

/**
 * Why there is an exam at all.
 *
 * Promotion used to need 90% over a session, and 90% is an average, so
 * averages hid. At lesson ten a member has eleven characters: one of them at
 * 40% is about 9% of the stream, so they still scored around 92%, were
 * promoted, and carried that broken character forward for the rest of the
 * course — where every later lesson diluted it further and made it LESS
 * likely to ever be caught. The rule grew weaker exactly where the course
 * grew harder.
 *
 * So the exam has one job, and it is worth stating in a sentence: no
 * character gets to hide behind the others.
 */
export interface ExamConfig {
  /** How many times each unlocked character appears. */
  appearances: number;
  /** How many of those a character must get right to pass on its own. */
  minimumPerCharacter: number;
  /** And the whole exam must still reach this, 0..1. */
  overallAccuracy: number;
  /** Extra copies of a failed character in later practice sets. */
  extraWeight: number;
}

export const DEFAULT_EXAM: Readonly<ExamConfig> = Object.freeze({
  appearances: 4,
  minimumPerCharacter: 3,
  overallAccuracy: 0.9,
  extraWeight: 2,
});

/**
 * The characters an exam will send, shuffled.
 *
 * Deliberately uncapped: lesson 1 is 8 characters and the last is 160. The
 * cost should grow with how much there is to prove, and it is paid once per
 * promotion rather than once per session. A cap would have to spend its
 * budget on some characters and not others, which reintroduces in miniature
 * the hiding problem the exam exists to remove.
 */
export function buildExam(
  progress: CourseProgress,
  random: Random = systemRandom(),
  config: CourseConfig = DEFAULT_COURSE,
  exam: ExamConfig = DEFAULT_EXAM,
): string[] {
  const deck: string[] = [];
  for (const character of activeSet(progress, config)) {
    for (let i = 0; i < exam.appearances; i += 1) deck.push(character);
  }
  // Fisher-Yates, so every ordering is equally likely and nothing is left in
  // blocks of four — the exam has to feel like an ordinary drill.
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = random.int(i + 1);
    const a = deck[i] as string;
    deck[i] = deck[j] as string;
    deck[j] = a;
  }
  return deck;
}

export interface CharacterScore {
  character: string;
  correct: number;
  of: number;
}

export interface ExamResult {
  pass: boolean;
  accuracy: number;
  /** Characters below the per-character bar, in the order they were taught. */
  failed: string[];
  perCharacter: CharacterScore[];
  reason: 'passed' | 'character-below-bar' | 'below-accuracy';
}

/**
 * Mark an exam. `typed` is what the member entered for each character of
 * `shown`, in the same order and the same length — a submission that does not
 * line up is a bug, not a bad score, and throws rather than quietly scoring
 * somebody zero.
 */
export function gradeExam(
  shown: readonly string[],
  typed: readonly string[],
  config: CourseConfig = DEFAULT_COURSE,
  exam: ExamConfig = DEFAULT_EXAM,
): ExamResult {
  if (shown.length !== typed.length) {
    throw new RangeError(`exam submission has ${String(typed.length)} answers for ${String(shown.length)} characters`);
  }
  const tally = new Map<string, CharacterScore>();
  let correct = 0;
  for (let i = 0; i < shown.length; i += 1) {
    const character = shown[i] as string;
    const row = tally.get(character) ?? { character, correct: 0, of: 0 };
    row.of += 1;
    if ((typed[i] ?? '').trim().toUpperCase() === character.toUpperCase()) {
      row.correct += 1;
      correct += 1;
    }
    tally.set(character, row);
  }

  const order = config.order;
  const perCharacter = [...tally.values()]
    .sort((a, b) => order.indexOf(a.character) - order.indexOf(b.character));
  const failed = perCharacter
    .filter((row) => row.correct < exam.minimumPerCharacter)
    .map((row) => row.character);
  const accuracy = shown.length === 0 ? 0 : correct / shown.length;

  // Order matters here: a named weak character is more useful to a member
  // than "you were a bit under", so it is reported first when both are true.
  if (failed.length > 0) {
    return { pass: false, accuracy, failed, perCharacter, reason: 'character-below-bar' };
  }
  if (accuracy < exam.overallAccuracy) {
    return { pass: false, accuracy, failed, perCharacter, reason: 'below-accuracy' };
  }
  return { pass: true, accuracy, failed, perCharacter, reason: 'passed' };
}

/**
 * A practice set with the characters that failed an exam over-represented.
 *
 * The generators pick uniformly from the array they are given, so repeating a
 * character in it is the whole of the weighting — no generator changes, and a
 * failed exam steers the next drills instead of merely reporting a result.
 */
export function weightedSet(
  characters: readonly string[],
  failed: readonly string[],
  exam: ExamConfig = DEFAULT_EXAM,
): string[] {
  if (failed.length === 0) return [...characters];
  const weak = new Set(failed);
  const out: string[] = [];
  for (const character of characters) {
    out.push(character);
    if (weak.has(character)) {
      for (let i = 0; i < exam.extraWeight; i += 1) out.push(character);
    }
  }
  return out;
}

// ---- Choosing what to practise ----

/**
 * The course is a ladder, but a student is not obliged to stand on the rung
 * the ladder put them on. Someone who already knows the alphabet should be
 * able to drill the letters they keep missing, and someone curious about
 * lesson 20 should be able to hear it. Both were impossible: the receiving
 * drills only ever used the unlocked set.
 */
export type PracticeMode = 'course' | 'lesson' | 'custom';

export interface PracticeSelection {
  mode: PracticeMode;
  /** Which lesson, when the mode is 'lesson'. Lesson 1 is the starting pair. */
  lesson: number;
  /** Characters to drill, as typed, when the mode is 'custom'. */
  custom: string;
}

export const DEFAULT_PRACTICE: Readonly<PracticeSelection> = Object.freeze({
  mode: 'course',
  lesson: 1,
  custom: '',
});

/** How many lessons the course has. Lesson 1 is the starting pair. */
export function lessonCount(config: CourseConfig = DEFAULT_COURSE): number {
  return config.order.length - Math.max(1, config.startingCount) + 1;
}

/** The lesson the student's own progress has reached. */
export function lessonOf(progress: CourseProgress, config: CourseConfig = DEFAULT_COURSE): number {
  return Math.max(1, progress.unlocked - Math.max(1, config.startingCount) + 1);
}

/** The characters a given lesson works with. */
export function lessonSet(lesson: number, config: CourseConfig = DEFAULT_COURSE): string[] {
  const clamped = Math.max(1, Math.min(Math.floor(lesson), lessonCount(config)));
  return kochSet(Math.max(1, config.startingCount) + clamped - 1, config.order);
}

export interface CustomSet {
  characters: string[];
  /** Anything typed that Morse has no pattern for, so the UI can say so. */
  rejected: string[];
}

/**
 * Read a character set the student typed. Letters, digits, punctuation and
 * prosigns in angle brackets, separated however they like: "K M R", "KMR"
 * and "k,m,r" all mean the same three characters.
 *
 * Unknown characters are collected rather than dropped in silence, because a
 * student who types a pound sign deserves to be told why it vanished.
 */
export function parseCustomSet(text: string): CustomSet {
  const characters: string[] = [];
  const rejected: string[] = [];
  const upper = text.toUpperCase();
  let i = 0;
  while (i < upper.length) {
    const ch = upper[i] as string;
    if (ch === '<') {
      const close = upper.indexOf('>', i);
      if (close !== -1) {
        const token = upper.slice(i, close + 1);
        if (token in PROSIGNS) {
          if (!characters.includes(token)) characters.push(token);
        } else if (!rejected.includes(token)) {
          rejected.push(token);
        }
        i = close + 1;
        continue;
      }
    }
    i += 1;
    // Spaces and commas are separators here, not characters to drill.
    if (ch === ' ' || ch === ',' || ch === '\n' || ch === '\t') continue;
    if (isSendable(ch)) {
      if (!characters.includes(ch)) characters.push(ch);
    } else if (!rejected.includes(ch)) {
      rejected.push(ch);
    }
  }
  return { characters, rejected };
}

/** Fewer than this and a drill is not practice, it is a stuck record. */
export const MINIMUM_PRACTICE_CHARACTERS = 2;

export interface PracticeSet {
  characters: string[];
  /** What to call this on screen. */
  label: string;
  /**
   * Whether a session on this set can advance the course. Only the student's
   * own current lesson can: drilling ahead of yourself is practice, and a
   * custom set is not a Koch lesson at all.
   */
  countsTowardCourse: boolean;
  /** Set when the choice could not be honoured and the course was used. */
  warning?: string;
}

/** Work out what the student is actually going to hear. */
export function practiceSet(
  selection: PracticeSelection,
  progress: CourseProgress,
  config: CourseConfig = DEFAULT_COURSE,
): PracticeSet {
  const own = lessonOf(progress, config);
  const courseSet = (): PracticeSet => ({
    characters: activeSet(progress, config),
    label: `Course lesson ${String(own)}`,
    countsTowardCourse: true,
  });

  if (selection.mode === 'lesson') {
    const lesson = Math.max(1, Math.min(Math.floor(selection.lesson), lessonCount(config)));
    return {
      characters: lessonSet(lesson, config),
      label: `Lesson ${String(lesson)}`,
      countsTowardCourse: lesson === own,
    };
  }

  if (selection.mode === 'custom') {
    const { characters } = parseCustomSet(selection.custom);
    if (characters.length < MINIMUM_PRACTICE_CHARACTERS) {
      return {
        ...courseSet(),
        warning: `Choose at least ${String(MINIMUM_PRACTICE_CHARACTERS)} characters for your own set. ` +
          'Using your course lesson instead.',
      };
    }
    return { characters, label: 'Your own set', countsTowardCourse: false };
  }

  return courseSet();
}
