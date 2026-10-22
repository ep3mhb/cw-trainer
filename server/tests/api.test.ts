/**
 * Accounts (RFP §8) against the in-memory store.
 */

import { describe, expect, it } from 'vitest';
import { world } from './helpers';

const post = (path: string, body: unknown, token: string | null = null) =>
  ({ method: 'POST', path, token, body });
const get = (path: string, token: string | null) => ({ method: 'GET', path, token, body: null });

describe('registration', () => {
  it('registers a licensed member with their callsign', async () => {
    const w = world();
    const res = await w.api.handle(post('/api/register', {
      name: 'Anna Rossi', email: 'Anna@Example.com', password: 'a-good-long-password', callsign: 'i2abc',
    }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ member: { callsign: 'I2ABC', training: false, role: 'member', email: 'anna@example.com' } });
    expect(JSON.stringify(res.body)).not.toContain('scrypt');
  });

  it('makes the configured callsign an administrator, and nobody else', async () => {
    const w = world();
    const admin = await w.member('Mohammad', 'm@example.com', 'EP2MHB');
    const other = await w.member('Anna', 'a@example.com', 'I2ABC');
    const me = async (t: string) => (await w.api.handle(get('/api/me', t))).body as { member: { role: string } };
    expect((await me(admin.token)).member.role).toBe('admin');
    expect((await me(other.token)).member.role).toBe('member');
  });

  it('issues a training identifier to a member with no callsign', async () => {
    const w = world();
    const res = await w.api.handle(post('/api/register', {
      name: 'Yuki Tanaka', email: 'y@example.com', password: 'a-good-long-password',
    }));
    expect(res.status).toBe(201);
    const call = (res.body as { member: { callsign: string } }).member.callsign;
    expect(call).toMatch(/^A0[A-Z]{3}$/);
    expect(call.startsWith('A0YT')).toBe(true);
  });

  it('refuses an A0 identifier offered as a licensed callsign', async () => {
    const w = world();
    const res = await w.api.handle(post('/api/register', {
      name: 'Xi', email: 'x@example.com', password: 'a-good-long-password', callsign: 'A0XYZ',
    }));
    expect(res.status).toBe(400);
  });

  it('refuses a second account on the same email or callsign, and a short password', async () => {
    const w = world();
    await w.member('Anna', 'a@example.com', 'G4ABC');
    expect((await w.api.handle(post('/api/register', { name: 'Bo', email: 'a@example.com', password: 'a-good-long-password' }))).status).toBe(409);
    expect((await w.api.handle(post('/api/register', { name: 'Bo', email: 'b@example.com', password: 'a-good-long-password', callsign: 'g4abc' }))).status).toBe(409);
    expect((await w.api.handle(post('/api/register', { name: 'Bo', email: 'b@example.com', password: 'short' }))).status).toBe(400);
  });
});

describe('signing in', () => {
  it('gives the same refusal for a wrong password and an unknown address', async () => {
    const w = world();
    await w.member('Anna', 'a@example.com', 'G4ABC');
    const wrong = await w.api.handle(post('/api/login', { email: 'a@example.com', password: 'nope-nope-nope' }));
    const unknown = await w.api.handle(post('/api/login', { email: 'zz@example.com', password: 'a-good-long-password' }));
    expect(wrong.status).toBe(401);
    expect(unknown).toEqual(wrong);
  });

  it('issues a token that /me accepts and /logout revokes', async () => {
    const w = world();
    await w.member('Anna', 'a@example.com', 'G4ABC');
    const login = await w.api.handle(post('/api/login', { email: 'a@example.com', password: 'a-good-long-password' }));
    const token = (login.body as { token: string }).token;
    expect((await w.api.handle(get('/api/me', token))).status).toBe(200);
    await w.api.handle(post('/api/logout', null, token));
    expect((await w.api.handle(get('/api/me', token))).status).toBe(401);
  });

  it('expires a session', async () => {
    const w = world({ sessionTtlS: 10 });
    const { token } = await w.member('Anna', 'a@example.com', 'G4ABC');
    w.clock.now += 11_000;
    expect((await w.api.handle(get('/api/me', token))).status).toBe(401);
  });
});

describe('profile', () => {
  it('keeps only known fields, trimmed, clamped, and drops blanks', async () => {
    const w = world();
    const { token } = await w.member('Anna', 'a@example.com', 'G4ABC');
    const res = await w.api.handle({
      method: 'PUT', path: '/api/me/profile', token,
      body: { qth: '  Dubai ', grid: 'll75', rig: '', sidetoneHz: 5000, targetWpm: 20, secret: 'x' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { member: { profile: unknown } }).member.profile)
      .toEqual({ qth: 'Dubai', grid: 'LL75', sidetoneHz: 1200, targetWpm: 20 });
  });
});

describe('password reset', () => {
  it('mails a link, accepts it once, and signs every other session out', async () => {
    const w = world();
    const { token: oldToken } = await w.member('Anna', 'a@example.com', 'G4ABC');

    const ask = await w.api.handle(post('/api/reset/request', { email: 'a@example.com' }));
    expect(ask.status).toBe(200);
    expect(w.mailer.sent).toHaveLength(1);
    const link = /#reset=([A-Za-z0-9_-]+)/.exec(w.mailer.sent[0]!.text);
    expect(link).not.toBeNull();
    const resetToken = link![1]!;

    const done = await w.api.handle(post('/api/reset/confirm', { token: resetToken, password: 'another-long-password' }));
    expect(done.status).toBe(200);
    expect((await w.api.handle(get('/api/me', oldToken))).status).toBe(401);

    const again = await w.api.handle(post('/api/reset/confirm', { token: resetToken, password: 'third-long-password' }));
    expect(again.status).toBe(400);

    const login = await w.api.handle(post('/api/login', { email: 'a@example.com', password: 'another-long-password' }));
    expect(login.status).toBe(200);
  });

  it('answers identically for an unknown address, and sends nothing', async () => {
    const w = world();
    await w.member('Anna', 'a@example.com', 'G4ABC');
    const known = await w.api.handle(post('/api/reset/request', { email: 'a@example.com' }));
    const unknown = await w.api.handle(post('/api/reset/request', { email: 'nobody@example.com' }));
    expect(unknown).toEqual(known);
    expect(w.mailer.sent).toHaveLength(1);
  });

  it('retires an earlier link when a newer one is requested', async () => {
    const w = world();
    await w.member('Anna', 'a@example.com', 'G4ABC');
    await w.api.handle(post('/api/reset/request', { email: 'a@example.com' }));
    await w.api.handle(post('/api/reset/request', { email: 'a@example.com' }));
    const first = /#reset=([A-Za-z0-9_-]+)/.exec(w.mailer.sent[0]!.text)![1]!;
    const second = /#reset=([A-Za-z0-9_-]+)/.exec(w.mailer.sent[1]!.text)![1]!;
    expect((await w.api.handle(post('/api/reset/confirm', { token: first, password: 'another-long-password' }))).status).toBe(400);
    expect((await w.api.handle(post('/api/reset/confirm', { token: second, password: 'another-long-password' }))).status).toBe(200);
  });

  it('tells the member in words when the mail cannot be sent, and logs the cause', async () => {
    const w = world();
    await w.member('Anna', 'a@example.com', 'G4ABC');
    w.mailer.send = async () => { throw new Error('ECONNREFUSED 1.2.3.4:587'); };
    const res = await w.api.handle(post('/api/reset/request', { email: 'a@example.com' }));
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'the reset mail could not be sent right now; please contact the administrator' });
    expect(w.logged.some((l) => l.includes('ECONNREFUSED'))).toBe(true);
  });

  it('lets a link expire', async () => {
    const w = world();
    await w.member('Anna', 'a@example.com', 'G4ABC');
    await w.api.handle(post('/api/reset/request', { email: 'a@example.com' }));
    const resetToken = /#reset=([A-Za-z0-9_-]+)/.exec(w.mailer.sent[0]!.text)![1]!;
    w.clock.now += 61 * 60 * 1000;
    expect((await w.api.handle(post('/api/reset/confirm', { token: resetToken, password: 'another-long-password' }))).status).toBe(400);
  });
});

describe('administration', () => {
  it('shows members and reports to an admin and to nobody else', async () => {
    const w = world();
    const admin = await w.member('Mo', 'm@example.com', 'EP2MHB');
    const other = await w.member('Anna', 'a@example.com', 'G4ABC');
    expect((await w.api.handle(get('/api/admin/members', other.token))).status).toBe(403);
    expect((await w.api.handle(get('/api/admin/members', null))).status).toBe(401);
    const res = await w.api.handle(get('/api/admin/members', admin.token));
    expect(res.status).toBe(200);
    expect((res.body as { members: unknown[] }).members).toHaveLength(2);
    expect((await w.api.handle(get('/api/admin/reports', admin.token))).status).toBe(200);
  });

  /**
   * 0.7.3 moved administration to a tab of its own, shown only to an
   * administrator. That is tidiness, not protection: this test is the
   * protection, and it names every administrator's route rather than a
   * sample of them, so a route added later without a guard fails here.
   */
  it('refuses every administrator route to a member, to a stranger and to nobody', async () => {
    const w = world();
    const admin = await w.member('Mo', 'm@example.com', 'EP2MHB');
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const id = ((await w.api.handle(get('/api/me', anna.token))).body as { member: { id: number } }).member.id;
    const reportId = await w.store.addReport({ byId: id, aboutId: id, reason: 'a reason', transcript: '' });

    const actions = ['verify', 'unverify', 'disable', 'enable', 'delete', 'reset', 'unmute'];
    const calls = [
      ...actions.map((a) => (t: string | null) => w.api.handle(post(`/api/admin/members/${String(id)}/${a}`, { reason: 'because' }, t))),
      (t: string | null) => w.api.handle(post(`/api/admin/reports/${String(reportId)}/resolve`, {}, t)),
      (t: string | null) => w.api.handle(get('/api/admin/members', t)),
      (t: string | null) => w.api.handle(get('/api/admin/reports', t)),
    ];

    for (const call of calls) {
      expect((await call(anna.token)).status).toBe(403);
      expect((await call(null)).status).toBe(401);
      expect((await call('not-a-real-token')).status).toBe(401);
    }
    // Nothing got through: the account is untouched and the log is empty.
    expect(w.store.moderation).toHaveLength(0);
    expect(((await w.api.handle(get('/api/me', anna.token))).body as { member: { callsign: string; verified: boolean } }).member)
      .toMatchObject({ callsign: 'G4ABC', verified: false });
    // Control: the same first call from the administrator goes through, so
    // the refusals above are about who is asking and not about the request.
    expect((await w.api.handle(post(`/api/admin/members/${String(id)}/verify`, { reason: 'because' }, admin.token))).status).toBe(200);
  });

  it('registers a claimed callsign unconfirmed, a training identifier confirmed, and the admin confirmed', async () => {
    const w = world();
    const admin = await w.member('Mo', 'm@example.com', 'EP2MHB');
    const licensed = await w.member('Anna', 'a@example.com', 'G4ABC');
    const student = await w.member('Bo', 'b@example.com');
    const me = async (t: string) => ((await w.api.handle(get('/api/me', t))).body as { member: { verified: boolean } }).member;
    expect((await me(admin.token)).verified).toBe(true);
    expect((await me(licensed.token)).verified).toBe(false);
    expect((await me(student.token)).verified).toBe(true);
  });

  it('lets an admin confirm a callsign, and only an admin', async () => {
    const w = world();
    const admin = await w.member('Mo', 'm@example.com', 'EP2MHB');
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const id = ((await w.api.handle(get('/api/me', anna.token))).body as { member: { id: number } }).member.id;
    expect((await w.api.handle(post(`/api/admin/members/${String(id)}/verify`, {}, anna.token))).status).toBe(403);
    const res = await w.api.handle(post(`/api/admin/members/${String(id)}/verify`, { reason: 'checked against the callbook' }, admin.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ member: { callsign: 'G4ABC', verified: true } });
    expect(w.store.moderation.at(-1)).toMatchObject({ action: 'verify', reason: 'checked against the callbook' });
    expect(w.logged.some((l) => /admin EP2MHB verify G4ABC/.test(l))).toBe(true);
  });

  it('disables and re-enables: a disabled member is signed out and cannot sign in', async () => {
    const w = world();
    const admin = await w.member('Mo', 'm@example.com', 'EP2MHB');
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const id = ((await w.api.handle(get('/api/me', anna.token))).body as { member: { id: number } }).member.id;
    expect((await w.api.handle(post(`/api/admin/members/${String(id)}/disable`, {}, admin.token))).status).toBe(200);
    expect((await w.api.handle(get('/api/me', anna.token))).status).toBe(401);
    expect((await w.api.handle(post('/api/login', { email: 'a@example.com', password: 'a-good-long-password' }))).status).toBe(401);
    expect((await w.api.handle(post(`/api/admin/members/${String(id)}/enable`, {}, admin.token))).status).toBe(200);
    expect((await w.api.handle(post('/api/login', { email: 'a@example.com', password: 'a-good-long-password' }))).status).toBe(200);
  });

  it('deletes a member: the account is emptied and the callsign released', async () => {
    const w = world();
    const admin = await w.member('Mo', 'm@example.com', 'EP2MHB');
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const id = ((await w.api.handle(get('/api/me', anna.token))).body as { member: { id: number } }).member.id;
    expect((await w.api.handle(post(`/api/admin/members/${String(id)}/delete`, { reason: 'left the group' }, admin.token))).status).toBe(200);
    expect((await w.api.handle(get('/api/me', anna.token))).status).toBe(401);
    // Someone else may now register the callsign, and the old address is free.
    expect((await w.api.handle(post('/api/register', { name: 'New Anna', email: 'a@example.com', password: 'a-good-long-password', callsign: 'G4ABC' }))).status).toBe(201);
    const list = (await w.api.handle(get('/api/admin/members', admin.token))).body as { members: { callsign: string; disabled: boolean }[] };
    expect(list.members.find((m) => m.callsign.startsWith('DELETED-'))?.disabled).toBe(true);
  });

  it('forces a reset: the member is signed out and mailed a link the admin never sees', async () => {
    const w = world();
    const admin = await w.member('Mo', 'm@example.com', 'EP2MHB');
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const id = ((await w.api.handle(get('/api/me', anna.token))).body as { member: { id: number } }).member.id;
    const res = await w.api.handle(post(`/api/admin/members/${String(id)}/reset`, { reason: 'member asked by phone' }, admin.token));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('#reset=');
    expect((await w.api.handle(get('/api/me', anna.token))).status).toBe(401);
    expect(w.mailer.sent.at(-1)?.to).toBe('a@example.com');
    const link = /#reset=([A-Za-z0-9_-]+)/.exec(w.mailer.sent.at(-1)!.text);
    expect(link).not.toBeNull();
    expect((await w.api.handle(post('/api/reset/confirm', { token: link![1]!, password: 'another-long-password' }))).status).toBe(200);
  });

  it('lifts a mute early', async () => {
    const w = world();
    const admin = await w.member('Mo', 'm@example.com', 'EP2MHB');
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const id = ((await w.api.handle(get('/api/me', anna.token))).body as { member: { id: number } }).member.id;
    await w.store.setMuted(id, new Date(Date.now() + 3600_000));
    expect(((await w.api.handle(get('/api/me', anna.token))).body as { member: { muted: boolean } }).member.muted).toBe(true);
    expect((await w.api.handle(post(`/api/admin/members/${String(id)}/unmute`, { reason: 'spoke to them' }, admin.token))).status).toBe(200);
    expect(((await w.api.handle(get('/api/me', anna.token))).body as { member: { muted: boolean } }).member.muted).toBe(false);
  });

  it('refuses to act on the administrator\u2019s own account', async () => {
    const w = world();
    const admin = await w.member('Mo', 'm@example.com', 'EP2MHB');
    const id = ((await w.api.handle(get('/api/me', admin.token))).body as { member: { id: number } }).member.id;
    expect((await w.api.handle(post(`/api/admin/members/${String(id)}/disable`, {}, admin.token))).status).toBe(400);
  });

  it('resolves a report once', async () => {
    const w = world();
    const admin = await w.member('Mo', 'm@example.com', 'EP2MHB');
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const id = ((await w.api.handle(get('/api/me', anna.token))).body as { member: { id: number } }).member.id;
    const reportId = await w.store.addReport({ byId: id, aboutId: id, reason: 'test', transcript: '' });
    expect((await w.api.handle(post(`/api/admin/reports/${String(reportId)}/resolve`, {}, admin.token))).status).toBe(200);
    expect((await w.api.handle(post(`/api/admin/reports/${String(reportId)}/resolve`, {}, admin.token))).status).toBe(404);
    const list = (await w.api.handle(get('/api/admin/reports', admin.token))).body as { reports: { resolved: boolean; byCallsign: string }[] };
    expect(list.reports[0]).toMatchObject({ resolved: true, byCallsign: 'G4ABC' });
  });
});

describe('the exchange in the log', () => {
  it('lets a member write RST and a note on their own contact, as sent on CW', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const bo = await w.member('Bo', 'b@example.com', 'I2ABC');
    const aId = (await w.store.memberByCallsign('G4ABC'))!.id;
    const bId = (await w.store.memberByCallsign('I2ABC'))!.id;
    const cId = await w.store.startContact({ aId, bId, aCallsign: 'G4ABC', bCallsign: 'I2ABC', frequencyHz: 7_018_000, exportable: true });
    const put = (body: unknown, token: string) => ({ method: 'PUT', path: `/api/me/contacts/${String(cId)}`, token, body });
    const res = await w.api.handle(put({ rstSent: '5nn', rstRcvd: '579', note: 'nice fist' }, anna.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rstSent: '599', rstRcvd: '579', note: 'nice fist' });
    const mine = (await w.api.handle(get('/api/me/contacts', anna.token))).body as { contacts: { rstSent: string; note: string }[] };
    expect(mine.contacts[0]).toMatchObject({ rstSent: '599', rstRcvd: '579', note: 'nice fist' });
    // Bo's account of the same contact is his own and still blank.
    const his = (await w.api.handle(get('/api/me/contacts', bo.token))).body as { contacts: { rstSent: string }[] };
    expect(his.contacts[0]?.rstSent).toBe('');
    // A bad report is refused in words; a stranger's contact is not theirs.
    expect((await w.api.handle(put({ rstSent: '59' }, anna.token))).status).toBe(400);
    const cy = await w.member('Cy', 'c@example.com', 'F5ABC');
    expect((await w.api.handle(put({ note: 'x' }, cy.token))).status).toBe(404);
  });
});

describe('changing a password', () => {
  it('needs the current one, and signs every other device out', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const other = await w.api.handle(post('/api/login', { email: 'a@example.com', password: 'a-good-long-password' }));
    const otherToken = (other.body as { token: string }).token;
    const put = (body: unknown, token: string) => ({ method: 'PUT', path: '/api/me/password', token, body });
    expect((await w.api.handle(put({ current: 'wrong-password-here', password: 'another-long-password' }, anna.token))).status).toBe(403);
    expect((await w.api.handle(put({ current: 'a-good-long-password', password: 'short' }, anna.token))).status).toBe(400);
    const res = await w.api.handle(put({ current: 'a-good-long-password', password: 'another-long-password' }, anna.token));
    expect(res.status).toBe(200);
    const fresh = (res.body as { token: string }).token;
    expect((await w.api.handle(get('/api/me', otherToken))).status).toBe(401);
    expect((await w.api.handle(get('/api/me', anna.token))).status).toBe(401);
    expect((await w.api.handle(get('/api/me', fresh))).status).toBe(200);
    expect((await w.api.handle(post('/api/login', { email: 'a@example.com', password: 'another-long-password' }))).status).toBe(200);
  });
});

describe('closing your own account', () => {
  it('needs the password, and then the account is gone and the callsign free', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const elsewhere = (await w.api.handle(post('/api/login', { email: 'a@example.com', password: 'a-good-long-password' }))).body as { token: string };
    const del = (body: unknown, token: string | null) => post('/api/me/delete', body, token);

    // Not signed in, no password, wrong password: nothing happens.
    expect((await w.api.handle(del({ password: 'a-good-long-password' }, null))).status).toBe(401);
    expect((await w.api.handle(del({}, anna.token))).status).toBe(400);
    expect((await w.api.handle(del({ password: 'wrong-password-here' }, anna.token))).status).toBe(403);
    expect((await w.api.handle(get('/api/me', anna.token))).status).toBe(200);

    expect((await w.api.handle(del({ password: 'a-good-long-password' }, anna.token))).status).toBe(200);

    // Every session ends, here and on the other device, and the old password
    // no longer signs anyone in.
    expect((await w.api.handle(get('/api/me', anna.token))).status).toBe(401);
    expect((await w.api.handle(get('/api/me', elsewhere.token))).status).toBe(401);
    expect((await w.api.handle(post('/api/login', { email: 'a@example.com', password: 'a-good-long-password' }))).status).toBe(401);

    // The callsign and the address are free for someone else to register.
    const bo = await w.api.handle(post('/api/register', {
      name: 'Bo', email: 'a@example.com', password: 'a-good-long-password', callsign: 'G4ABC',
    }));
    expect(bo.status).toBe(201);
  });

  it('leaves the other station’s log saying who they worked', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const bo = await w.member('Bo', 'b@example.com', 'I2ABC');
    const annaId = ((await w.api.handle(get('/api/me', anna.token))).body as { member: { id: number } }).member.id;
    const boId = ((await w.api.handle(get('/api/me', bo.token))).body as { member: { id: number } }).member.id;
    const id = await w.store.startContact({
      aId: annaId, bId: boId, aCallsign: 'G4ABC', bCallsign: 'I2ABC', frequencyHz: 7_030_000, exportable: true,
    });
    await w.store.endContact(id);

    expect((await w.api.handle(post('/api/me/delete', { password: 'a-good-long-password' }, anna.token))).status).toBe(200);

    const his = (await w.api.handle(get('/api/me/contacts', bo.token))).body as { contacts: { aCallsign: string }[] };
    expect(his.contacts[0]?.aCallsign).toBe('G4ABC');
  });

  it('refuses the only administrator, and allows one of two', async () => {
    const w = world();
    const admin = await w.member('Mohammad', 'm@example.com', 'EP2MHB');
    const refused = await w.api.handle(post('/api/me/delete', { password: 'a-good-long-password' }, admin.token));
    expect(refused.status).toBe(409);
    expect((await w.api.handle(get('/api/me', admin.token))).status).toBe(200);

    await w.store.createMember({
      callsign: 'K1ADM', training: false, name: 'Second', email: 's@example.com',
      passwordHash: '!', role: 'admin', verified: true,
    });
    expect((await w.api.handle(post('/api/me/delete', { password: 'a-good-long-password' }, admin.token))).status).toBe(200);
  });

  it('records that someone left, but not who', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    await w.api.handle(post('/api/me/delete', { password: 'a-good-long-password' }, anna.token));
    const line = w.logged.find((l) => l.includes('closed their own account'));
    expect(line).toBeDefined();
    expect(line).not.toContain('G4ABC');
    expect(line).not.toContain('a@example.com');
  });
});
