/**
 * Training records kept on the server (RFD A37).
 *
 * Every test here is about a promise made to a member in the privacy
 * notice, so they are written as those promises rather than as the code's
 * shape: nothing is stored unless you asked, off means deleted, closing the
 * account takes it with you, and nobody else can read any of it.
 *
 * The account-closure test is the one that matters most. Closing an account
 * tombstones the member row instead of deleting it, so ON DELETE CASCADE
 * never fires — exactly the trap that already made deleteMember() remove
 * exams and certificates by hand. Without this test a member could be told
 * their practice history was gone while every row sat there.
 */

import { describe, expect, it } from 'vitest';
import { world } from './helpers';

const post = (path: string, body: unknown, token: string | null = null) =>
  ({ method: 'POST', path, token, body });
const put = (path: string, body: unknown, token: string | null) =>
  ({ method: 'PUT', path, token, body });
const get = (path: string, token: string | null) =>
  ({ method: 'GET', path, token, body: null });

interface Report {
  keepRecords: boolean;
  sessions: { sessionId: string; unlockedCount: number; conditions: string }[];
  characters: { character: string; attempted: number; correct: number; responseMsTotal: number }[];
  unlocked: number;
  weights: Record<string, number>;
  open: OpenSeries | null;
}

interface OpenSeries {
  sessionId: string;
  drillsDone: number;
  attempted: number;
  correct: number;
  unlockedCount: number;
}

/** A series part of the way through, as a device would send it (A42). */
const openSeries = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  startedAt: 1_700_000_000_000,
  lessonType: 'groups',
  characterWpm: 18,
  effectiveWpm: 8,
  drillsDone: 2,
  attempted: 10,
  correct: 10,
  unlockedCount: 6,
  ...over,
});

const session = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_060_000,
  lessonType: 'groups',
  characterWpm: 18,
  effectiveWpm: 8,
  attempted: 25,
  correct: 23,
  unlockedCount: 5,
  conditions: 'off',
  characters: [
    { character: 'K', attempted: 13, correct: 12, responseMsTotal: 9100 },
    { character: 'M', attempted: 12, correct: 11, responseMsTotal: 8800 },
  ],
  ...over,
});

describe('nothing is stored unless the member asked', () => {
  it('refuses an upload from an account that never opted in', async () => {
    const w = world();
    const me = await w.member('Nada', 'nada@example.com');
    const res = await w.api.handle(post('/api/me/training', { sessions: [session('s-1')] }, me.token));
    expect(res.status).toBe(403);
  });

  it('is off for a member who registered without asking for it', async () => {
    const w = world();
    const me = await w.member('Plain', 'plain@example.com');
    const res = await w.api.handle(get('/api/me', me.token));
    expect((res.body as { member: { keepRecords: boolean } }).member.keepRecords).toBe(false);
  });

  it('is on for a member who ticked the box at registration', async () => {
    const w = world();
    const res = await w.api.handle(post('/api/register', {
      name: 'Keen', email: 'keen@example.com', password: 'a-good-long-password', keepRecords: true,
    }));
    expect((res.body as { member: { keepRecords: boolean } }).member.keepRecords).toBe(true);
  });

  it('reports empty rather than failing for a member who has not switched it on', async () => {
    const w = world();
    const me = await w.member('Quiet', 'quiet@example.com');
    const res = await w.api.handle(get('/api/me/training', me.token));
    expect(res.status).toBe(200);
    expect((res.body as Report).keepRecords).toBe(false);
    expect((res.body as Report).sessions).toEqual([]);
  });

  it('refuses everything to someone not signed in', async () => {
    const w = world();
    expect((await w.api.handle(get('/api/me/training', null))).status).toBe(401);
    expect((await w.api.handle(post('/api/me/training', { sessions: [] }, null))).status).toBe(401);
    expect((await w.api.handle(put('/api/me/keep-records', { enabled: true }, null))).status).toBe(401);
  });
});

describe('uploading is append-only and safe to retry', () => {
  const opted = async () => {
    const w = world();
    const me = await w.member('Sender', 'sender@example.com');
    await w.api.handle(put('/api/me/keep-records', { enabled: true }, me.token));
    return { w, me };
  };

  it('accepts a session and gives it back in the report', async () => {
    const { w, me } = await opted();
    const res = await w.api.handle(post('/api/me/training', { sessions: [session('s-1')] }, me.token));
    expect(res.status).toBe(200);
    expect((res.body as { added: number }).added).toBe(1);

    const report = (await w.api.handle(get('/api/me/training', me.token))).body as Report;
    expect(report.sessions).toHaveLength(1);
    expect(report.characters.map((c) => c.character)).toEqual(['K', 'M']);
  });

  /*
   * The whole reason the primary key is (member_id, session_id). A client
   * that cannot remember what it sent — a phone that lost its connection
   * mid-upload — must be able to send the lot again without consequence.
   */
  it('ignores a session it already holds, and says so without complaining', async () => {
    const { w, me } = await opted();
    await w.api.handle(post('/api/me/training', { sessions: [session('s-1')] }, me.token));
    const again = await w.api.handle(post('/api/me/training', { sessions: [session('s-1')] }, me.token));
    expect(again.status).toBe(200);
    expect((again.body as { added: number; received: number }).added).toBe(0);
    expect((again.body as { received: number }).received).toBe(1);

    const report = (await w.api.handle(get('/api/me/training', me.token))).body as Report;
    expect(report.sessions).toHaveLength(1);
    // And the counts did not double.
    expect(report.characters.find((c) => c.character === 'K')?.attempted).toBe(13);
  });

  it('rolls per-character counts up across sessions', async () => {
    const { w, me } = await opted();
    await w.api.handle(post('/api/me/training', {
      sessions: [session('s-1'), session('s-2')],
    }, me.token));
    const report = (await w.api.handle(get('/api/me/training', me.token))).body as Report;
    expect(report.characters.find((c) => c.character === 'K')?.attempted).toBe(26);
    expect(report.characters.find((c) => c.character === 'K')?.responseMsTotal).toBe(18_200);
  });

  /*
   * A member drills on the desktop and reaches lesson 12, then opens the
   * phone, which was last used at lesson 5, and finishes a session there.
   * The phone's session is newer and says 5. Taking the latest would move
   * the member backwards and make them re-sit exams they have passed.
   */
  it('takes the highest position reached, not the most recent one', async () => {
    const { w, me } = await opted();
    await w.api.handle(post('/api/me/training', {
      sessions: [
        session('s-desktop', { unlockedCount: 12, endedAt: 1_700_000_060_000 }),
        session('s-phone', { unlockedCount: 5, startedAt: 1_700_000_900_000, endedAt: 1_700_000_960_000 }),
      ],
    }, me.token));
    const report = (await w.api.handle(get('/api/me/training', me.token))).body as Report;
    expect(report.unlocked).toBe(12);
  });

  it('carries the failed-character weights, last upload winning', async () => {
    const { w, me } = await opted();
    await w.api.handle(post('/api/me/training', { sessions: [session('s-1')], weights: { K: 3 } }, me.token));
    await w.api.handle(post('/api/me/training', { sessions: [session('s-2')], weights: { K: 1, M: 4 } }, me.token));
    const report = (await w.api.handle(get('/api/me/training', me.token))).body as Report;
    expect(report.weights).toEqual({ K: 1, M: 4 });
  });

  it('refuses a batch containing nonsense rather than storing part of it', async () => {
    const { w, me } = await opted();
    const cases: Record<string, unknown>[] = [
      session('s-bad', { endedAt: 1_600_000_000_000 }),       // ended before it began
      session('s-bad', { correct: 99 }),                      // more right than asked
      session('s-bad', { attempted: -1 }),                    // negative
      session('s-bad', { id: '' }),                           // no id
    ];
    for (const bad of cases) {
      const res = await w.api.handle(post('/api/me/training', { sessions: [session('s-good'), bad] }, me.token));
      expect(res.status).toBe(400);
    }
    const report = (await w.api.handle(get('/api/me/training', me.token))).body as Report;
    expect(report.sessions).toEqual([]);
  });
});

describe('off means deleted', () => {
  it('removes everything already uploaded when the member switches it off', async () => {
    const w = world();
    const me = await w.member('Changed', 'changed@example.com');
    await w.api.handle(put('/api/me/keep-records', { enabled: true }, me.token));
    await w.api.handle(post('/api/me/training', { sessions: [session('s-1')], weights: { K: 2 } }, me.token));

    await w.api.handle(put('/api/me/keep-records', { enabled: false }, me.token));

    const report = (await w.api.handle(get('/api/me/training', me.token))).body as Report;
    expect(report.keepRecords).toBe(false);
    expect(report.sessions).toEqual([]);
    expect(report.characters).toEqual([]);
    expect(report.weights).toEqual({});
    // And they can still sign in: this empties a service, not an account.
    expect((await w.api.handle(get('/api/me', me.token))).status).toBe(200);
  });

  it('starts empty if they switch it on again', async () => {
    const w = world();
    const me = await w.member('Returned', 'returned@example.com');
    await w.api.handle(put('/api/me/keep-records', { enabled: true }, me.token));
    await w.api.handle(post('/api/me/training', { sessions: [session('s-1')] }, me.token));
    await w.api.handle(put('/api/me/keep-records', { enabled: false }, me.token));
    await w.api.handle(put('/api/me/keep-records', { enabled: true }, me.token));

    const report = (await w.api.handle(get('/api/me/training', me.token))).body as Report;
    expect(report.sessions).toEqual([]);
  });

  /*
   * The trap. The member row is tombstoned rather than deleted so that
   * contacts keep pointing somewhere, which means ON DELETE CASCADE never
   * fires and the rows have to be removed by hand. This test is what stops
   * the privacy notice promising a deletion that does not happen.
   */
  it('takes the records with the account when a member closes it', async () => {
    const w = world();
    const me = await w.member('Leaving', 'leaving@example.com');
    await w.api.handle(put('/api/me/keep-records', { enabled: true }, me.token));
    await w.api.handle(post('/api/me/training', { sessions: [session('s-1')], weights: { K: 2 } }, me.token));

    const before = await w.store.trainingReport(1);
    expect(before.sessions).toHaveLength(1);

    const closed = await w.api.handle(post('/api/me/delete', { password: 'a-good-long-password' }, me.token));
    expect(closed.status).toBe(200);

    const after = await w.store.trainingReport(1);
    expect(after.sessions).toEqual([]);
    expect(after.characters).toEqual([]);
    expect(after.weights).toEqual({});
  });
});

describe('nobody reads anybody else', () => {
  it('gives each member only their own records', async () => {
    const w = world();
    const a = await w.member('Ann', 'ann@example.com');
    const b = await w.member('Bob', 'bob@example.com');
    for (const who of [a, b]) await w.api.handle(put('/api/me/keep-records', { enabled: true }, who.token));
    await w.api.handle(post('/api/me/training', { sessions: [session('s-ann')] }, a.token));

    const bobs = (await w.api.handle(get('/api/me/training', b.token))).body as Report;
    expect(bobs.sessions).toEqual([]);

    const anns = (await w.api.handle(get('/api/me/training', a.token))).body as Report;
    expect(anns.sessions.map((s) => s.sessionId)).toEqual(['s-ann']);
  });
});

/*
 * RFD A40. Until 0.9.1 the position reached the server only as a property
 * of an uploaded session, so passing an examination — the one moment it
 * changes — told the server nothing until the next session ended. Found by
 * a member on 16 October 2026, not by any of the ninety-two tests above.
 */
describe('where a member is in the course travels on its own', () => {
  const opted = async () => {
    const w = world();
    const r = await w.api.handle(post('/api/register', {
      name: 'Moved', email: `moved-${String(Math.random()).slice(2)}@example.com`,
      password: 'a-good-long-password', keepRecords: true,
    }));
    return { w, token: (r.body as { token: string }).token };
  };
  const report = async (w: ReturnType<typeof world>, token: string) =>
    (await w.api.handle(get('/api/me/training', token))).body as Report;

  it('accepts a position with no sessions attached', async () => {
    const { w, token } = await opted();
    const res = await w.api.handle(post('/api/me/training', { sessions: [], unlocked: 6 }, token));
    expect(res.status).toBe(200);
    expect((await report(w, token)).unlocked).toBe(6);
  });

  it('carries a character unlocked on one device to the next', async () => {
    // The member's own case: a session finished at five, then the exam for
    // the sixth character passed, which ends no session.
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', { sessions: [session('s-1')], unlocked: 5 }, token));
    expect((await report(w, token)).unlocked).toBe(5);
    await w.api.handle(post('/api/me/training', { sessions: [], unlocked: 6 }, token));
    expect((await report(w, token)).unlocked).toBe(6);
  });

  it('never moves a member backwards from a device that is behind', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', { sessions: [], unlocked: 9 }, token));
    await w.api.handle(post('/api/me/training', { sessions: [], unlocked: 3 }, token));
    expect((await report(w, token)).unlocked).toBe(9);
  });

  it('still takes the position from the sessions when that is further on', async () => {
    // A client too old to send a position, or one that has nothing to add.
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', {
      sessions: [session('s-1', { unlockedCount: 12 })], unlocked: 4,
    }, token));
    expect((await report(w, token)).unlocked).toBe(12);
  });

  it('treats a missing position as no opinion rather than as zero', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', { sessions: [], unlocked: 7 }, token));
    await w.api.handle(post('/api/me/training', { sessions: [session('s-2')] }, token));
    expect((await report(w, token)).unlocked).toBe(7);
  });

  it('forgets the position when the member switches the service off', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', { sessions: [], unlocked: 8 }, token));
    await w.api.handle(put('/api/me/keep-records', { enabled: false }, token));
    await w.api.handle(put('/api/me/keep-records', { enabled: true }, token));
    expect((await report(w, token)).unlocked).toBe(0);
  });
});

/*
 * RFD A42. Reported from his own two machines on 16 October 2026, hours
 * after A40 was proved: two drills of ten on a laptop, and the telephone
 * offered a fresh series starting at the first drill. A40 made the course
 * POSITION travel; this is the work a member is part of the way through.
 *
 * These are the server's half. The rule that two devices resolve by the
 * greater number of drills, and the rule that a finished series can never
 * be reopened, are the two that would be expensive to get wrong later: the
 * first decides whose practice counts, and the second is what stops a
 * device that was asleep from resurrecting a closed record.
 */
describe('a series still in progress travels between a member’s devices', () => {
  const opted = async () => {
    const w = world();
    const r = await w.api.handle(post('/api/register', {
      name: 'Partway', email: `partway-${String(Math.random()).slice(2)}@example.com`,
      password: 'a-good-long-password', keepRecords: true,
    }));
    return { w, token: (r.body as { token: string }).token };
  };
  const reportOf = async (w: ReturnType<typeof world>, token: string) =>
    (await w.api.handle(get('/api/me/training', token))).body as Report;

  it('gives back the series the other device was part of the way through', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', {
      sessions: [], unlocked: 6, open: openSeries('s-100'),
    }, token));
    const r = await reportOf(w, token);
    expect(r.open?.sessionId).toBe('s-100');
    expect(r.open?.drillsDone).toBe(2);
    expect(r.open?.attempted).toBe(10);
  });

  it('has no series to give back when none was ever sent', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', { sessions: [], unlocked: 6 }, token));
    expect((await reportOf(w, token)).open).toBeNull();
  });

  it('moves the series on as the member drills', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', { sessions: [], open: openSeries('s-100') }, token));
    await w.api.handle(post('/api/me/training', {
      sessions: [], open: openSeries('s-100', { drillsDone: 7, attempted: 35, correct: 33 }),
    }, token));
    const r = await reportOf(w, token);
    expect(r.open?.drillsDone).toBe(7);
    expect(r.open?.correct).toBe(33);
  });

  /*
   * The rule for two devices on one series: the member did the greater
   * number of drills, so that copy stands. A device that has been away and
   * reports a shorter copy must not drag the series backwards — the same
   * failure as a stale device dragging the course position back, which A40
   * had to guard against for the same reason.
   */
  it('keeps the longer copy when two devices drill the same series', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', {
      sessions: [], open: openSeries('s-100', { drillsDone: 7, attempted: 35, correct: 34 }),
    }, token));
    await w.api.handle(post('/api/me/training', {
      sessions: [], open: openSeries('s-100', { drillsDone: 3, attempted: 15, correct: 9 }),
    }, token));
    const r = await reportOf(w, token);
    expect(r.open?.drillsDone).toBe(7);
    expect(r.open?.correct).toBe(34);
  });

  it('closes the series when it is uploaded as a finished session', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', { sessions: [], open: openSeries('s-100') }, token));
    await w.api.handle(post('/api/me/training', { sessions: [session('s-100')] }, token));
    const r = await reportOf(w, token);
    expect(r.open).toBeNull();
    expect(r.sessions.map((x) => x.sessionId)).toEqual(['s-100']);
  });

  /*
   * The one that would be worst to get wrong. A device that was offline
   * when the series finished comes back and posts the open copy it still
   * holds. If that reopened the record, the member would be handed a
   * half-finished series that they had in fact completed — and the finished
   * session already counted towards a promotion.
   */
  it('refuses to reopen a series that has already been finished', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', { sessions: [session('s-100')] }, token));
    await w.api.handle(post('/api/me/training', {
      sessions: [], open: openSeries('s-100', { drillsDone: 9 }),
    }, token));
    expect((await reportOf(w, token)).open).toBeNull();
  });

  it('leaves the series alone when a device simply has nothing to say about it', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', { sessions: [], open: openSeries('s-100') }, token));
    await w.api.handle(post('/api/me/training', { sessions: [], unlocked: 7 }, token));
    expect((await reportOf(w, token)).open?.drillsDone).toBe(2);
  });

  /*
   * drillsDone decides which device wins, so an unbounded value sent by a
   * broken client would win every disagreement for ever and freeze the
   * member's series. Dropped rather than rejected: a bad open series costs
   * a member nothing, because the next upload restates it, and the finished
   * sessions in the same request must still get through.
   */
  it('drops a nonsense series without failing the sessions beside it', async () => {
    const { w, token } = await opted();
    const res = await w.api.handle(post('/api/me/training', {
      sessions: [session('s-1')], open: openSeries('s-100', { drillsDone: 999_999 }),
    }, token));
    expect(res.status).toBe(200);
    const r = await reportOf(w, token);
    expect(r.open).toBeNull();
    expect(r.sessions).toHaveLength(1);
  });

  it('takes the series with the member when the service is switched off', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', { sessions: [], open: openSeries('s-100') }, token));
    await w.api.handle(put('/api/me/keep-records', { enabled: false }, token));
    await w.api.handle(put('/api/me/keep-records', { enabled: true }, token));
    expect((await reportOf(w, token)).open).toBeNull();
  });
});

/*
 * RFD A39. Sessions worked against fading, static, another station or a
 * hand at the key score lower than clean ones. Until this field they were
 * counted into the same figures, so a member who switched conditions on
 * would appear, in their own progress report, to be getting worse. The
 * maintainer settled it: "the figures are to be honest rather than
 * convenient".
 */
describe('a session records what it was worked against', () => {
  const opted = async () => {
    const w = world();
    const r = await w.api.handle(post('/api/register', {
      name: 'Noisy', email: `noisy-${String(Math.random()).slice(2)}@example.com`,
      password: 'a-good-long-password', keepRecords: true,
    }));
    return { w, token: (r.body as { token: string }).token };
  };
  const reportOf = async (w: ReturnType<typeof world>, token: string) =>
    (await w.api.handle(get('/api/me/training', token))).body as Report;

  it('keeps the level the session was worked at', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', {
      sessions: [session('s-1', { conditions: 'strong' })],
    }, token));
    expect((await reportOf(w, token)).sessions[0]?.conditions).toBe('strong');
  });

  it('keeps clean and conditioned sessions apart', async () => {
    const { w, token } = await opted();
    await w.api.handle(post('/api/me/training', {
      sessions: [
        session('s-1', { conditions: 'off' }),
        session('s-2', { conditions: 'mild' }),
        session('s-3', { conditions: 'strong' }),
      ],
    }, token));
    const r = await reportOf(w, token);
    expect(r.sessions.map((x) => x.conditions).sort()).toEqual(['mild', 'off', 'strong']);
  });

  /*
   * Every session recorded before 0.10.0 WAS worked clean, because there
   * was no other kind. Reading a missing field as 'off' states a fact
   * rather than guessing at one.
   */
  it('reads a session from an older client as clean', async () => {
    const { w, token } = await opted();
    const old = session('s-old');
    delete (old as Record<string, unknown>)['conditions'];
    await w.api.handle(post('/api/me/training', { sessions: [old] }, token));
    expect((await reportOf(w, token)).sessions[0]?.conditions).toBe('off');
  });

  /*
   * The column has a CHECK for three values. A client sending a fourth is
   * a client from the future, and losing one session's label is a far
   * smaller harm than refusing the session — but it must not reach the
   * database, where the CHECK would refuse the whole upload.
   */
  it('records a level it has never heard of as clean rather than refusing the session', async () => {
    const { w, token } = await opted();
    const res = await w.api.handle(post('/api/me/training', {
      sessions: [session('s-1', { conditions: 'hurricane' })],
    }, token));
    expect(res.status).toBe(200);
    const r = await reportOf(w, token);
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]?.conditions).toBe('off');
  });
});
