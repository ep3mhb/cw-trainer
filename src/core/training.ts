/**
 * Training records kept on the server (RFD A37).
 *
 * Everything here is a pure function over what the browser already holds,
 * so the decisions — what to send, what to keep, where a member is in the
 * course — can be tested without a network or a database. The parts that
 * talk to either live in `net/training.ts`.
 *
 * Design: docs/PHASE4-TRAINING-RECORDS.md.
 */

import type { ConditionLevel } from './conditions';
import type { Attempt, SessionRecord } from './stats';

/** Per character within one session. No keystrokes, by design. */
export interface TrainingCharacter {
  character: string;
  attempted: number;
  correct: number;
  /** Summed, so a mean survives aggregation. */
  responseMsTotal: number;
}

export interface TrainingUpload {
  id: string;
  startedAt: number;
  endedAt: number;
  lessonType: string;
  characterWpm: number;
  effectiveWpm: number;
  attempted: number;
  correct: number;
  unlockedCount: number;
  characters: TrainingCharacter[];
  /** The conditions this session was worked at (A39). */
  conditions: ConditionLevel;
}

/**
 * Which sessions the server has not acknowledged.
 *
 * The server ignores a session it already holds, so this list is an
 * optimisation rather than a correctness requirement — sending a duplicate
 * costs a little bandwidth and changes nothing. That is deliberate: the
 * cheap failure is sending twice, and the expensive one is never sending at
 * all, so anything uncertain is sent.
 */
export function pendingSessions(
  sessions: readonly SessionRecord[],
  uploaded: readonly string[],
): SessionRecord[] {
  const done = new Set(uploaded);
  return sessions.filter((s) => !done.has(s.id)).sort((a, b) => a.endedAt - b.endedAt);
}

/**
 * The per-character counts for one session, from the raw attempts.
 *
 * Attempts carry a timestamp but not a session id, so the session's own
 * window is what selects them. The boundaries are inclusive at the start
 * and the end because a session's first and last attempts land exactly on
 * them often enough to matter over a year of practice.
 *
 * **Attempts are pruned after thirty days** (RFP §4). A session older than
 * that uploads with an empty character list rather than a wrong one — the
 * summary is still true, and the detail is honestly absent. In practice
 * this only happens to a member who opted in long after the practice, since
 * a finished session is normally sent within seconds of ending.
 */
export function charactersForSession(
  attempts: readonly Attempt[],
  session: Pick<SessionRecord, 'startedAt' | 'endedAt'>,
): TrainingCharacter[] {
  const byCharacter = new Map<string, TrainingCharacter>();
  for (const a of attempts) {
    if (a.at < session.startedAt || a.at > session.endedAt) continue;
    const got = byCharacter.get(a.sent)
      ?? { character: a.sent, attempted: 0, correct: 0, responseMsTotal: 0 };
    got.attempted += 1;
    if (a.typed === a.sent) got.correct += 1;
    // Only a correct answer has a meaningful response time: the delay
    // before a wrong key, or before no key at all, measures hesitation and
    // the timeout rather than how fast the character was recognised.
    if (a.typed === a.sent) got.responseMsTotal += Math.max(0, Math.round(a.responseMs));
    byCharacter.set(a.sent, got);
  }
  return [...byCharacter.values()].sort((a, b) => a.character.localeCompare(b.character));
}

/** One session, ready to post. */
export function toUpload(session: SessionRecord, characters: TrainingCharacter[]): TrainingUpload {
  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    lessonType: session.lessonType,
    characterWpm: session.characterWpm,
    effectiveWpm: session.effectiveWpm,
    attempted: session.attempted,
    correct: session.correct,
    unlockedCount: session.unlockedCount,
    // RFD A39. Absent on every session recorded before 0.10.0, and those
    // were all worked clean, so 'off' is the truthful default rather than
    // a convenient one.
    conditions: session.conditions ?? 'off',
    characters,
  };
}

/**
 * Where the member actually is, given what this browser knows and what the
 * server knows.
 *
 * The higher of the two, always. A character is unlocked by passing an exam
 * and is never taken back, so the maximum is the true position whichever
 * device earned it. No merge, no conflict, and no clock to trust — which is
 * the whole reason this is a maximum rather than a sync.
 */
export function mergeUnlocked(local: number, server: number): number {
  return Math.max(local, server);
}

/**
 * The characters to over-sample, from both sides.
 *
 * A weakness found on the phone should steer the drills on the desktop, so
 * these are unioned rather than replaced. Being dropped from the list is
 * something a member earns by getting the character right, and that happens
 * locally; an upload from a device that had already forgotten the weakness
 * must not un-learn it here.
 */
export function mergeFailed(local: readonly string[], server: readonly string[]): string[] {
  return [...new Set([...local, ...server])].sort();
}

/** What the server stores as weights: today, each over-sampled character once. */
export function failedToWeights(failed: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of failed) out[c] = 1;
  return out;
}

/** And back again. */
export function weightsToFailed(weights: Record<string, number>): string[] {
  return Object.keys(weights).sort();
}

/**
 * Whether this browser has anything to tell the server (RFD A40).
 *
 * Before 0.9.1 the answer was simply "is a session waiting", and the course
 * position had no way of travelling on its own. That made it invisible at
 * the one moment it changes: a member passes the examination for a new
 * character, the position moves locally, and nothing reaches the server
 * until the next session happens to end. A member who unlocked a character
 * on a telephone and then opened a different browser was told, correctly
 * and uselessly, where they had been before.
 *
 * So a position the server has not been given is reason enough to send,
 * with no sessions attached. A browser with neither stays quiet, which is
 * what keeps a page load from becoming a request.
 */
export function hasSomethingToSend(
  pendingSessionCount: number,
  unlocked: number,
  lastSentUnlocked: number,
  serverUnlocked: number | null = null,
): boolean {
  if (pendingSessionCount > 0) return true;
  /*
   * When the server has just told us where it thinks we are, believe it over
   * our own note (A41). The note records that a request succeeded, which is
   * not the same as the server having stored what was in it: 0.9.1 shipped
   * before the server that understood the field, every upload came back 200
   * with the position quietly dropped, and the browser wrote down that it had
   * said something it had not. It then stayed silent for ever, because as far
   * as it knew there was nothing left to say.
   */
  if (serverUnlocked !== null) return unlocked > serverUnlocked;
  return unlocked !== lastSentUnlocked;
}

/**
 * A series of drills the member is part of the way through (RFD A42).
 *
 * Held in this browser as it goes, so that a reload, a closed tab or a
 * telephone discarding the page resumes where the member was rather than at
 * the first drill. Uploaded, for a member who asked for records on the
 * server, so that the series follows them to another device.
 */
export interface OpenSeries {
  /** The same `s-<timestamp>` a finished session uses. */
  id: string;
  startedAt: number;
  lessonType: string;
  characterWpm: number;
  effectiveWpm: number;
  /** How far through the ten. */
  drillsDone: number;
  attempted: number;
  correct: number;
  unlockedCount: number;
}

/**
 * How long a part-finished series may sit before it stops being a series
 * somebody is in the middle of and becomes a session they abandoned.
 *
 * Twelve hours, which is long enough to cover a night's sleep — the common
 * case is a member who stops mid-series and comes back the next morning
 * expecting to carry on — and short enough that a series abandoned in March
 * is not still offered in April. A42 requires that such a series be "in due
 * course closed and counted honestly as the short session it was" rather
 * than lingering for ever.
 */
export const OPEN_SERIES_TTL_MS = 12 * 60 * 60 * 1000;

export function openSeriesExpired(series: OpenSeries, now: number): boolean {
  return now - series.startedAt > OPEN_SERIES_TTL_MS;
}

/**
 * Which of two copies of a series stands: this browser's, or the server's.
 *
 * Three cases, and the awkward one is the third.
 *
 * Nothing here and something there — adopt it; that is the whole point of
 * the amendment, and it is the Mac-after-the-iPhone case that was reported.
 *
 * The same series in both — take whichever has more drills done. The member
 * did that work, and the shorter copy is a device that has been away. This
 * matches the rule the server applies to the upload, deliberately: a client
 * that disagreed with the server about who wins would push the two copies
 * back and forth for ever.
 *
 * DIFFERENT series in each — the member began something here and something
 * else elsewhere. The longer one is adopted and the other is NOT discarded:
 * the caller closes it as a finished session of its own, so no practice is
 * thrown away to resolve a disagreement. `closeLocal` says when that is
 * needed, and it is the only case where it is true.
 */
export interface SeriesChoice {
  /** The series to carry on with, or null to carry on with neither. */
  adopt: OpenSeries | null;
  /** Whether the local series must first be written out as a short session. */
  closeLocal: boolean;
}

export function chooseSeries(
  local: OpenSeries | null,
  server: OpenSeries | null,
): SeriesChoice {
  if (server === null) return { adopt: local, closeLocal: false };
  if (local === null) return { adopt: server, closeLocal: false };
  if (local.id === server.id) {
    return {
      adopt: server.drillsDone > local.drillsDone ? server : local,
      closeLocal: false,
    };
  }
  // Two different series. Keep the one with more work in it, and the other
  // becomes a session in its own right rather than being lost.
  if (server.drillsDone > local.drillsDone) return { adopt: server, closeLocal: true };
  return { adopt: local, closeLocal: false };
}
