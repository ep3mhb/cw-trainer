/**
 * Sending finished sessions to the server, and taking back what it
 * knows (RFD A37).
 *
 * Everything in this file is best-effort and silent. A member practising
 * should never be interrupted by the state of their connection: an upload
 * that fails is simply not marked as sent, and the next opportunity tries
 * again. The decisions live in `core/training.ts`; this is the plumbing.
 *
 * Design: docs/PHASE4-TRAINING-RECORDS.md.
 */

import {
  chooseSeries,
  charactersForSession,
  hasSomethingToSend,
  failedToWeights,
  mergeFailed,
  mergeUnlocked,
  pendingSessions,
  toUpload,
  weightsToFailed,
  type OpenSeries,
} from '../core/training';
import type { Store } from '../storage/db';
import { api, type MemberInfo, type TrainingReportBody } from './api';

/**
 * Send whatever this browser holds that the server has not acknowledged.
 *
 * Does nothing at all unless a member is signed in and has asked for the
 * service. That check is made against what the server said, not against a
 * local setting, so a browser whose setting is stale cannot upload.
 */
export async function pushTraining(
  store: Store,
  member: MemberInfo | null,
  serverUnlocked: number | null = null,
): Promise<void> {
  if (!member?.keepRecords) return;
  try {
    const [sessions, uploaded, progress, lastPosition, open] = await Promise.all([
      store.sessions(), store.uploadedSessionIds(), store.progress(), store.uploadedPosition(),
      store.openSeries(),
    ]);
    const pending = pendingSessions(sessions, uploaded);
    /*
     * RFD A40. Until 0.9.1 this returned here whenever no session was
     * waiting, and the course position had no other way to travel — so
     * passing an examination, which is the moment the position changes,
     * told the server nothing at all until the next session happened to
     * end. Reported from a telephone on 16 October 2026.
     *
     * A position this browser has not sent is therefore reason enough to
     * send, with no sessions attached. A browser with neither says nothing.
     */
    /*
     * RFD A42. A series in progress is also reason to speak, and unlike the
     * position there is no note of what was last sent: the series changes
     * after every drill, so sending it whenever there is one costs a request
     * the member was making anyway and saves tracking a third thing. A
     * browser with no series, no pending session and nothing new to say about
     * the position still says nothing at all.
     */
    const haveSeries = open !== null;
    if (
      !haveSeries &&
      !hasSomethingToSend(pending.length, progress.unlocked, lastPosition, serverUnlocked)
    ) return;

    /*
     * Only read the attempts when a finished session actually needs its
     * per-character breakdown built. Since A42 this runs after every drill
     * for a member with a series open, and store.attempts() returns every
     * attempt this browser holds — thousands, after a few weeks — which is
     * a great deal of work to do twenty times a session in order to map
     * over an empty list.
     */
    const uploads = pending.length === 0
      ? []
      : await (async () => {
          const attempts = await store.attempts();
          return pending.map((s) => toUpload(s, charactersForSession(attempts, s)));
        })();

    await api.uploadTraining(
      uploads,
      failedToWeights(progress.failed ?? []),
      progress.unlocked,
      open === null ? null : toOpenUpload(open),
    );
    await store.markPositionUploaded(progress.unlocked);
    // Marked only after the server has answered. A request that times out
    // leaves these pending, and they go again next time — the server
    // ignores the ones it already holds.
    await store.markSessionsUploaded(pending.map((s) => s.id));
  } catch {
    /*
     * Deliberately silent. Offline is the ordinary case for a member
     * practising on a train, and there is nothing for them to do about it:
     * the work is safe locally and will go up when there is a connection.
     * Shouting about it would train people to ignore the one message that
     * does matter.
     */
  }
}

/**
 * Settle this browser's series against the server's, and write the result.
 *
 * The decision itself is `chooseSeries` in core/training, where it is
 * covered by tests; this is the part that touches storage. Where the two
 * are DIFFERENT series, the local one is written out as a finished session
 * before the server's is adopted — A42 promises that no practice is thrown
 * away to resolve a disagreement, and a short session honestly recorded is
 * the only way to keep that promise.
 *
 * Returns the series to carry on with, but only when it is not the one this
 * browser already had: the caller uses it to tell the member, and being
 * told about your own series would be noise.
 */
async function adoptSeries(store: Store, incoming: TrainingReportBody['open']): Promise<OpenSeries | null> {
  const local = await store.openSeries();
  const server: OpenSeries | null = incoming
    ? {
        id: incoming.sessionId,
        startedAt: Date.parse(incoming.startedAt),
        lessonType: incoming.lessonType,
        characterWpm: incoming.characterWpm,
        effectiveWpm: incoming.effectiveWpm,
        drillsDone: incoming.drillsDone,
        attempted: incoming.attempted,
        correct: incoming.correct,
        unlockedCount: incoming.unlockedCount,
      }
    : null;

  const choice = chooseSeries(local, server);
  if (choice.closeLocal && local !== null) {
    await store.addSession({
      id: local.id,
      startedAt: local.startedAt,
      endedAt: Date.now(),
      lessonType: local.lessonType,
      characterWpm: local.characterWpm,
      effectiveWpm: local.effectiveWpm,
      attempted: local.attempted,
      correct: local.correct,
      unlockedCount: local.unlockedCount,
    });
  }
  if (choice.adopt === null) {
    await store.clearOpenSeries();
    return null;
  }
  if (local !== null && choice.adopt.id === local.id && choice.adopt.drillsDone === local.drillsDone) {
    return null;   // this browser was already right; nothing to announce
  }
  await store.saveOpenSeries(choice.adopt);
  return choice.adopt;
}

/** The wire shape: epoch milliseconds, like a finished session's. */
function toOpenUpload(o: OpenSeries): Record<string, unknown> {
  return {
    id: o.id,
    startedAt: o.startedAt,
    lessonType: o.lessonType,
    characterWpm: o.characterWpm,
    effectiveWpm: o.effectiveWpm,
    drillsDone: o.drillsDone,
    attempted: o.attempted,
    correct: o.correct,
    unlockedCount: o.unlockedCount,
  };
}

/**
 * Take the server's position and weaknesses, if they are ahead of this
 * browser's.
 *
 * Returns what changed so the caller can tell the member, or null if
 * nothing did. Never moves a member backwards: see `mergeUnlocked`.
 */
export interface Pulled {
  /** What the server says it holds. The authority on what it has been told. */
  serverUnlocked: number;
  /** What changed here as a result, or null if this browser was already right. */
  moved: { unlocked: number; failed: string[] } | null;
  /**
   * The series this browser should now carry on with, if adopting the
   * server's changed anything (RFD A42). Null when this browser's own
   * series already stands, or when neither side has one.
   */
  adopted: OpenSeries | null;
}

export async function pullTraining(store: Store, member: MemberInfo | null): Promise<Pulled | null> {
  if (!member?.keepRecords) return null;
  try {
    const report = await api.trainingReport();
    if (!report.keepRecords) return null;

    const local = await store.progress();
    const unlocked = mergeUnlocked(local.unlocked, report.unlocked);
    const failed = mergeFailed(local.failed ?? [], weightsToFailed(report.weights));

    /*
     * RFD A42. `open` absent means a server too old to know about series —
     * not "the member has no series". Taking the field's absence for an
     * empty answer is exactly the A41 mistake, and here it would throw away
     * the series the member is in the middle of.
     */
    const adopted = 'open' in report ? await adoptSeries(store, report.open ?? null) : null;

    const movedOn = unlocked !== local.unlocked;
    const changed = movedOn || failed.length !== (local.failed ?? []).length;
    if (!changed) return { serverUnlocked: report.unlocked, moved: null, adopted };

    await store.saveProgress({ unlocked, failed });
    return { serverUnlocked: report.unlocked, moved: { unlocked, failed }, adopted };
  } catch {
    return null; // same reasoning as above
  }
}

/**
 * On signing in: take what the server knows first, then send what it does
 * not have.
 *
 * That order matters on a fresh browser. Pulling first means the member is
 * already at their real position before anything local is posted, so a
 * brand-new install does not briefly upload sessions claiming lesson 2 and
 * leave them in the history looking like a regression.
 */
export async function syncTraining(store: Store, member: MemberInfo | null): Promise<
  { moved: { unlocked: number; failed: string[] } | null; adopted: OpenSeries | null } | null
> {
  const pulled = await pullTraining(store, member);
  // The report we have just read is better evidence of what the server holds
  // than anything this browser wrote down about its own past requests (A41).
  await pushTraining(store, member, pulled?.serverUnlocked ?? null);
  if (!pulled) return null;
  return { moved: pulled.moved, adopted: pulled.adopted };
}

/**
 * Switch the service on or off for this member.
 *
 * Off deletes everything already uploaded — server-side, and the local
 * record of what was acknowledged with it, so that switching on again
 * sends the history afresh rather than assuming the server still has it.
 */
export async function setKeepRecords(store: Store, enabled: boolean): Promise<void> {
  await api.setKeepRecords(enabled);
  await store.forgetUploadedSessions();
}
