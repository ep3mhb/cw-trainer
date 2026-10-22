/**
 * The client half of training records on the server (RFD A37).
 *
 * These are the decisions that have to be right whatever the network does:
 * what gets sent, what the per-character counts come to, and where a member
 * is in the course when two devices disagree.
 */

import { describe, expect, it } from 'vitest';
import {
  charactersForSession,
  hasSomethingToSend,
  failedToWeights,
  mergeFailed,
  mergeUnlocked,
  pendingSessions,
  toUpload,
  weightsToFailed,
  chooseSeries,
  openSeriesExpired,
  OPEN_SERIES_TTL_MS,
  type OpenSeries,
} from '../src/core/training';
import type { Attempt, SessionRecord } from '../src/core/stats';

const session = (id: string, over: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  startedAt: 1_000,
  endedAt: 2_000,
  lessonType: 'groups',
  characterWpm: 18,
  effectiveWpm: 8,
  attempted: 25,
  correct: 23,
  unlockedCount: 5,
  ...over,
});

const attempt = (sent: string, typed: string, at: number, responseMs = 500): Attempt =>
  ({ sent, typed, responseMs, at });

describe('deciding what still needs sending', () => {
  it('sends what the server has not acknowledged, oldest first', () => {
    const all = [session('s-3', { endedAt: 3_000 }), session('s-1', { endedAt: 1_500 }), session('s-2', { endedAt: 2_000 })];
    expect(pendingSessions(all, ['s-2']).map((s) => s.id)).toEqual(['s-1', 's-3']);
  });

  it('sends everything when nothing has been acknowledged', () => {
    expect(pendingSessions([session('s-1')], [])).toHaveLength(1);
  });

  /*
   * The asymmetry is deliberate. A duplicate costs a little bandwidth and
   * the server ignores it; a session never sent is a hole in a member's
   * history that nothing later repairs.
   */
  it('has nothing to do once everything is acknowledged', () => {
    expect(pendingSessions([session('s-1')], ['s-1'])).toEqual([]);
  });
});

describe('per-character counts for one session', () => {
  it('counts only the attempts inside the session window, boundaries included', () => {
    const attempts = [
      attempt('K', 'K', 999),    // before
      attempt('K', 'K', 1_000),  // exactly at the start
      attempt('M', 'M', 1_500),
      attempt('K', 'M', 2_000),  // exactly at the end
      attempt('M', 'M', 2_001),  // after
    ];
    const chars = charactersForSession(attempts, { startedAt: 1_000, endedAt: 2_000 });
    expect(chars.find((c) => c.character === 'K')?.attempted).toBe(2);
    expect(chars.find((c) => c.character === 'M')?.attempted).toBe(1);
  });

  it('counts a wrong answer as attempted but not correct', () => {
    const chars = charactersForSession(
      [attempt('K', 'M', 1_500), attempt('K', 'K', 1_600)],
      { startedAt: 1_000, endedAt: 2_000 },
    );
    expect(chars[0]).toMatchObject({ character: 'K', attempted: 2, correct: 1 });
  });

  /*
   * The delay before a wrong key, or before no key at all, measures
   * hesitation and the timeout rather than how fast the character was
   * recognised. Including it would make the mean response time of a
   * character a member struggles with look better the worse they do.
   */
  it('times only the answers that were right', () => {
    const chars = charactersForSession(
      [attempt('K', 'K', 1_100, 400), attempt('K', 'M', 1_200, 3_000), attempt('K', '', 1_300, 5_000)],
      { startedAt: 1_000, endedAt: 2_000 },
    );
    expect(chars[0]?.responseMsTotal).toBe(400);
  });

  it('gives an empty list rather than a wrong one when the attempts have been pruned', () => {
    // RFP §4 discards raw attempts after thirty days. The summary is still
    // true; the detail is honestly absent.
    expect(charactersForSession([], { startedAt: 1_000, endedAt: 2_000 })).toEqual([]);
  });

  it('carries the session summary through unchanged', () => {
    const up = toUpload(session('s-1', { attempted: 25, correct: 23, unlockedCount: 7 }), []);
    expect(up).toMatchObject({ id: 's-1', attempted: 25, correct: 23, unlockedCount: 7 });
  });
});

describe('where the member is, when two devices disagree', () => {
  /*
   * Desktop reached lesson 12. The phone, last used at lesson 5, finishes a
   * session afterwards. Taking the newer figure would move the member
   * backwards and make them re-sit exams they have already passed.
   */
  it('takes the higher position, never the more recent one', () => {
    expect(mergeUnlocked(12, 5)).toBe(12);
    expect(mergeUnlocked(5, 12)).toBe(12);
    expect(mergeUnlocked(7, 7)).toBe(7);
  });

  it('starts a fresh browser where the server says', () => {
    expect(mergeUnlocked(0, 9)).toBe(9);
  });

  it('unions the characters to over-sample rather than replacing them', () => {
    expect(mergeFailed(['K'], ['M'])).toEqual(['K', 'M']);
    expect(mergeFailed(['K', 'M'], [])).toEqual(['K', 'M']);
    expect(mergeFailed([], ['M'])).toEqual(['M']);
  });

  it('does not let a stale upload un-learn a weakness found here', () => {
    // The server's copy predates this morning's failed exam.
    expect(mergeFailed(['K', 'R'], ['K'])).toEqual(['K', 'R']);
  });

  it('round-trips the weights the server stores', () => {
    expect(weightsToFailed(failedToWeights(['M', 'K']))).toEqual(['K', 'M']);
  });
});

/*
 * RFD A40. The fault these guard against shipped in 0.9.0 and was found by
 * a member, not by a test: unlock a character on a telephone, open another
 * browser, and it still showed the old position, because the position only
 * ever travelled as a property of an uploaded session.
 */
describe('whether there is anything to tell the server', () => {
  it('says nothing when no session waits and the position is already known', () => {
    expect(hasSomethingToSend(0, 5, 5)).toBe(false);
  });

  it('sends a position the server has not been given, with no session attached', () => {
    // Passing an examination moves the position and ends no session. This is
    // the case 0.9.0 got wrong.
    expect(hasSomethingToSend(0, 6, 5)).toBe(true);
  });

  it('sends a waiting session even when the position has not moved', () => {
    expect(hasSomethingToSend(1, 5, 5)).toBe(true);
  });

  it('sends when the browser has told the server nothing at all', () => {
    // A member who has just switched the service on: last sent reads zero.
    expect(hasSomethingToSend(0, 5, 0)).toBe(true);
  });

  it('speaks up when the position came down from the server and differs', () => {
    // A pull can move this browser forward too, and saying so costs one
    // request and keeps the two in agreement.
    expect(hasSomethingToSend(0, 4, 9)).toBe(true);
  });
});

/*
 * RFD A41. 0.9.1's own fault, and a sharper version of the same mistake it
 * was written to fix. The browser noted what it had sent, and treated a 200
 * as proof the server had stored it. Deployed client-first against a server
 * that did not yet know the field, every upload succeeded, the position was
 * dropped, and the browser recorded that it had spoken. It then never spoke
 * again. Found on an iPhone on 16 October 2026.
 */
describe('the server is the authority on what the server knows', () => {
  it('speaks up when the server is behind, whatever this browser wrote down', () => {
    // The stuck iPhone exactly: local 6, note says 6, server actually has 5.
    expect(hasSomethingToSend(0, 6, 6, 5)).toBe(true);
  });

  it('stays quiet when the server already has it, even if the note disagrees', () => {
    expect(hasSomethingToSend(0, 6, 0, 6)).toBe(false);
  });

  it('does not argue with a server that is ahead', () => {
    // A pull will have moved this browser forward; there is nothing to add.
    expect(hasSomethingToSend(0, 4, 4, 9)).toBe(false);
  });

  it('still sends a waiting session when the server is level', () => {
    expect(hasSomethingToSend(2, 6, 6, 6)).toBe(true);
  });

  it('falls back to its own note when no report is to hand', () => {
    // After a session or an examination there is no fresh report; the note
    // is all there is, and it is right often enough to keep a page load quiet.
    expect(hasSomethingToSend(0, 7, 6, null)).toBe(true);
    expect(hasSomethingToSend(0, 6, 6, null)).toBe(false);
  });
});

/*
 * RFD A42, the client's decisions.
 *
 * `chooseSeries` is the one that would be expensive to get wrong, because
 * it decides whose practice counts when a member has been drilling in two
 * places. It deliberately applies the SAME rule the server applies to the
 * upload — more drills wins — so that the two cannot disagree and push a
 * pair of copies back and forth for ever.
 */
describe('choosing between this browser’s series and the server’s', () => {
  const series = (id: string, drillsDone: number, over: Partial<OpenSeries> = {}): OpenSeries => ({
    id,
    startedAt: 1_700_000_000_000,
    lessonType: 'groups',
    characterWpm: 18,
    effectiveWpm: 8,
    drillsDone,
    attempted: drillsDone * 5,
    correct: drillsDone * 5,
    unlockedCount: 6,
    ...over,
  });

  it('adopts the server’s when this browser has none', () => {
    // The reported case: two drills on the laptop, nothing on the telephone.
    const choice = chooseSeries(null, series('s-1', 2));
    expect(choice.adopt?.id).toBe('s-1');
    expect(choice.adopt?.drillsDone).toBe(2);
    expect(choice.closeLocal).toBe(false);
  });

  it('keeps this browser’s when the server has none', () => {
    const local = series('s-1', 4);
    expect(chooseSeries(local, null).adopt).toBe(local);
  });

  it('has nothing to carry on with when neither side has one', () => {
    expect(chooseSeries(null, null).adopt).toBeNull();
  });

  it('takes the further-on copy of the same series', () => {
    const choice = chooseSeries(series('s-1', 2), series('s-1', 7));
    expect(choice.adopt?.drillsDone).toBe(7);
    expect(choice.closeLocal).toBe(false);
  });

  it('does not let a server that is behind drag the series backwards', () => {
    // The same failure A40 had to guard against for the course position:
    // a device that has been away must not undo work done since.
    const choice = chooseSeries(series('s-1', 7), series('s-1', 2));
    expect(choice.adopt?.drillsDone).toBe(7);
    expect(choice.closeLocal).toBe(false);
  });

  /*
   * Two DIFFERENT series. A42 promises that no practice is thrown away to
   * resolve a disagreement, so the losing one is not simply dropped: the
   * caller writes it out as a finished session of its own, short but
   * honest, and closeLocal is how it is told to.
   */
  it('closes this browser’s series when a longer different one is adopted', () => {
    const choice = chooseSeries(series('s-local', 3), series('s-other', 8));
    expect(choice.adopt?.id).toBe('s-other');
    expect(choice.closeLocal).toBe(true);
  });

  it('keeps this browser’s different series when it is the longer one', () => {
    const choice = chooseSeries(series('s-local', 8), series('s-other', 3));
    expect(choice.adopt?.id).toBe('s-local');
    // Nothing to close: the one being kept is the one already held here.
    expect(choice.closeLocal).toBe(false);
  });
});

describe('a series stops being one worth resuming', () => {
  const old = (startedAt: number): OpenSeries => ({
    id: 's-1', startedAt, lessonType: 'groups', characterWpm: 18, effectiveWpm: 8,
    drillsDone: 3, attempted: 15, correct: 14, unlockedCount: 6,
  });

  it('resumes one begun a few minutes ago', () => {
    const now = 1_700_000_000_000;
    expect(openSeriesExpired(old(now - 5 * 60 * 1000), now)).toBe(false);
  });

  it('still resumes one begun before a night’s sleep', () => {
    // The common case the window exists for: stop at eleven, carry on at eight.
    const now = 1_700_000_000_000;
    expect(openSeriesExpired(old(now - 9 * 60 * 60 * 1000), now)).toBe(false);
  });

  it('does not offer one begun last month', () => {
    const now = 1_700_000_000_000;
    expect(openSeriesExpired(old(now - 30 * 24 * 60 * 60 * 1000), now)).toBe(true);
  });

  it('expires exactly at the window and not a moment before', () => {
    const now = 1_700_000_000_000;
    expect(openSeriesExpired(old(now - OPEN_SERIES_TTL_MS), now)).toBe(false);
    expect(openSeriesExpired(old(now - OPEN_SERIES_TTL_MS - 1), now)).toBe(true);
  });
});
