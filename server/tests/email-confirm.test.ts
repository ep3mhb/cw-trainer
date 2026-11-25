/**
 * RFD A55: the member confirms their address; the administrator is told by
 * mail when someone registers and again when they have confirmed.
 */
import { describe, expect, it } from 'vitest';
import { world } from './helpers';
import { adminMemberView } from '../src/api';

const post = (path: string, body: unknown, token: string | null = null) => ({ method: 'POST', path, token, body });
const get = (path: string, token: string | null = null) => ({ method: 'GET', path, token, body: null });
const linkIn = (text: string): string => /#confirm-email=([A-Za-z0-9_-]+)/.exec(text)![1]!;

describe('email confirmation (A55)', () => {
  it('mails the member a link and the administrator a notice on registration (manual approval)', async () => {
    const w = world({ autoApprove: false });
    w.confirmEmails = false;
    await w.member('Mo', 'mo@example.com', 'EP2MHB');
    expect(w.mailer.sent.map((m) => m.to)).toEqual(['mo@example.com']); // the administrator is not told about himself
    w.mailer.sent.length = 0;

    const res = await w.api.handle(post('/api/register', {
      name: 'Anna', email: 'anna@example.com', password: 'a-good-long-password', callsign: 'G4ABC',
    }));
    expect(res.status).toBe(201);
    const body = res.body as { confirmationSent: boolean; member: { emailConfirmed: boolean } };
    expect(body.confirmationSent).toBe(true);
    expect(body.member.emailConfirmed).toBe(false);

    const [toMember, toAdmin] = w.mailer.sent;
    expect(toMember!.to).toBe('anna@example.com');
    expect(toMember!.subject).toBe('RESONIK CW Trainer: please confirm your email address');
    expect(toMember!.text).toContain('https://cw.example/#confirm-email=');
    expect(toMember!.text).toContain('confirm your membership');
    expect(toAdmin!.to).toBe('mo@example.com');
    expect(toAdmin!.subject).toBe('RESONIK CW Trainer: G4ABC has registered and awaits your approval');
    expect(toAdmin!.text).toContain('anna@example.com');
    expect(toAdmin!.text).toContain('https://cw.example/#admin');
  });

  it('confirms once, marks the account, and tells the administrator the callsign awaits approval (manual approval)', async () => {
    const w = world({ autoApprove: false });
    w.confirmEmails = false;
    await w.member('Mo', 'mo@example.com', 'EP2MHB');
    const anna = await w.member('Anna', 'anna@example.com', 'G4ABC');
    const token = linkIn(w.mailer.sent.find((m) => m.to === 'anna@example.com')!.text);
    w.mailer.sent.length = 0;

    const done = await w.api.handle(post('/api/email/confirm', { token }));
    expect(done.status).toBe(200);
    const me = (await w.api.handle(get('/api/me', anna.token))).body as { member: { emailConfirmed: boolean } };
    expect(me.member.emailConfirmed).toBe(true);

    expect(w.mailer.sent).toHaveLength(1);
    expect(w.mailer.sent[0]!.to).toBe('mo@example.com');
    expect(w.mailer.sent[0]!.subject).toBe('RESONIK CW Trainer: G4ABC confirmed their email — please approve the membership');
    expect(w.mailer.sent[0]!.text).toContain('Confirm callsign');

    expect((await w.api.handle(post('/api/email/confirm', { token }))).status).toBe(400);
  });

  it('needs no approval for a training identifier, but still tells the administrator', async () => {
    const w = world();
    w.confirmEmails = false;
    await w.member('Mo', 'mo@example.com', 'EP2MHB');
    await w.member('Bob Student', 'bob@example.com');
    const admin1 = w.mailer.sent.find((m) => m.to === 'mo@example.com' && m.subject.includes('new student'));
    expect(admin1).toBeDefined();
    const token = linkIn(w.mailer.sent.find((m) => m.to === 'bob@example.com')!.text);
    expect(w.mailer.sent.find((m) => m.to === 'bob@example.com')!.text).not.toContain('confirm your membership');
    w.mailer.sent.length = 0;
    await w.api.handle(post('/api/email/confirm', { token }));
    expect(w.mailer.sent[0]!.subject).toMatch(/confirmed their email$/);
    expect(w.mailer.sent[0]!.text).toContain('nothing to do');
  });

  it('sends ADMIN_EMAIL the notices when it is set', async () => {
    const w = world({ adminEmail: 'info@example.org', autoApprove: false });
    w.confirmEmails = false;
    await w.member('Mo', 'mo@example.com', 'EP2MHB');
    await w.member('Anna', 'anna@example.com', 'G4ABC');
    expect(w.mailer.sent.some((m) => m.to === 'info@example.org' && m.subject.includes('awaits your approval'))).toBe(true);
  });

  it('logs and carries on when there is no administrator to tell', async () => {
    const w = world();
    w.confirmEmails = false;
    const res = await w.api.handle(post('/api/register', {
      name: 'Anna', email: 'anna@example.com', password: 'a-good-long-password', callsign: 'G4ABC',
    }));
    expect(res.status).toBe(201);
    expect(w.logged.some((l) => l.startsWith('admin notice not sent'))).toBe(true);
  });

  it('keeps the registration when the mail fails, and says so', async () => {
    const w = world();
    w.confirmEmails = false;
    w.mailer.send = async () => { throw new Error('ECONNREFUSED'); };
    const res = await w.api.handle(post('/api/register', {
      name: 'Anna', email: 'anna@example.com', password: 'a-good-long-password', callsign: 'G4ABC',
    }));
    expect(res.status).toBe(201);
    expect((res.body as { confirmationSent: boolean }).confirmationSent).toBe(false);
    expect(w.logged.some((l) => l.includes('confirmation mail') && l.includes('ECONNREFUSED'))).toBe(true);
  });

  it('lets a link expire after 48 hours', async () => {
    const w = world();
    w.confirmEmails = false;
    await w.member('Anna', 'anna@example.com', 'G4ABC');
    const token = linkIn(w.mailer.sent[0]!.text);
    w.clock.now += 48 * 3600 * 1000 + 1;
    expect((await w.api.handle(post('/api/email/confirm', { token }))).status).toBe(400);
  });

  it('sends a new link on request, retires the old one, and refuses a second request within a minute', async () => {
    const w = world();
    w.confirmEmails = false;
    const anna = await w.member('Anna', 'anna@example.com', 'G4ABC');
    const old = linkIn(w.mailer.sent[0]!.text);
    expect((await w.api.handle(post('/api/me/email/resend', {}, anna.token))).status).toBe(429);
    w.clock.now += 61 * 1000;
    w.mailer.sent.length = 0;
    expect((await w.api.handle(post('/api/me/email/resend', {}, anna.token))).status).toBe(200);
    const fresh = linkIn(w.mailer.sent[0]!.text);
    expect((await w.api.handle(post('/api/email/confirm', { token: old }))).status).toBe(400);
    expect((await w.api.handle(post('/api/email/confirm', { token: fresh }))).status).toBe(200);
    expect((await w.api.handle(post('/api/me/email/resend', {}, anna.token))).status).toBe(400);
    expect((await w.api.handle(post('/api/me/email/resend', {}, null))).status).toBe(401);
  });

  it('lets a member registered before A55 ask for a link', async () => {
    const w = world();
    w.confirmEmails = false;
    const anna = await w.member('Anna', 'anna@example.com', 'G4ABC');
    const id = ((await w.api.handle(get('/api/me', anna.token))).body as { member: { id: number } }).member.id;
    w.store.setEmailConfirmedForTest(id, false);
    w.clock.now += 61 * 1000;
    expect((await w.api.handle(post('/api/me/email/resend', {}, anna.token))).status).toBe(200);
  });

  it('refuses a link for a deleted account', async () => {
    const w = world();
    w.confirmEmails = false;
    const admin = await w.member('Mo', 'mo@example.com', 'EP2MHB');
    await w.member('Anna', 'anna@example.com', 'G4ABC');
    const token = linkIn(w.mailer.sent.find((m) => m.to === 'anna@example.com')!.text);
    const list = (await w.api.handle(get('/api/admin/members', admin.token))).body as { members: { id: number; callsign: string }[] };
    const id = list.members.find((m) => m.callsign === 'G4ABC')!.id;
    await w.api.handle(post(`/api/admin/members/${String(id)}/delete`, { reason: 'test' }, admin.token));
    expect((await w.api.handle(post('/api/email/confirm', { token }))).status).toBe(400);
  });

  it('approves the callsign with the email address by default, and says so to both', async () => {
    const w = world();
    w.confirmEmails = false;
    await w.member('Mo', 'mo@example.com', 'EP2MHB');
    const anna = await w.member('Anna', 'anna@example.com', 'G4ABC');
    const toAnna = w.mailer.sent.find((m) => m.to === 'anna@example.com')!;
    expect(toAnna.text).toContain('also confirms your callsign');
    expect(w.mailer.sent.some((m) => m.to === 'mo@example.com' && m.subject === 'RESONIK CW Trainer: new member G4ABC has registered')).toBe(true);
    const token = linkIn(toAnna.text);
    w.mailer.sent.length = 0;

    const done = await w.api.handle(post('/api/email/confirm', { token }));
    expect((done.body as { member: { verified: boolean } }).member.verified).toBe(true);
    const me = (await w.api.handle(get('/api/me', anna.token))).body as { member: { verified: boolean; emailConfirmed: boolean } };
    expect(me.member).toMatchObject({ verified: true, emailConfirmed: true });
    expect(w.mailer.sent[0]!.subject).toBe('RESONIK CW Trainer: G4ABC confirmed their email and is now a member');
    expect(w.mailer.sent[0]!.text).toContain('Withdraw confirmation');
  });

  it('does not approve anything before the address is confirmed', async () => {
    const w = world();
    w.confirmEmails = false;
    const anna = await w.member('Anna', 'anna@example.com', 'G4ABC');
    const me = (await w.api.handle(get('/api/me', anna.token))).body as { member: { verified: boolean } };
    expect(me.member.verified).toBe(false);
  });
});

describe('spam and abuse limits (A55)', () => {
  const reg = (email: string, extra: Record<string, unknown> = {}, ip = '1.2.3.4') => ({
    method: 'POST', path: '/api/register', token: null, ip,
    body: { name: 'Some One', email, password: 'a-good-long-password', ...extra },
  });

  it('refuses a filled trap field', async () => {
    const w = world();
    const res = await w.api.handle(reg('bot@example.com', { website: 'http://spam.example' }));
    expect(res.status).toBe(400);
    expect(w.mailer.sent).toHaveLength(0);
  });

  it('allows three registrations an hour from one connection', async () => {
    const w = world();
    for (const n of [1, 2, 3]) expect((await w.api.handle(reg(`p${String(n)}@example.com`))).status).toBe(201);
    expect((await w.api.handle(reg('p4@example.com'))).status).toBe(429);
    expect((await w.api.handle(reg('p5@example.com', {}, '5.6.7.8'))).status).toBe(201);
    w.clock.now += 61 * 60 * 1000;
    expect((await w.api.handle(reg('p6@example.com'))).status).toBe(201);
  });

  it('holds registration for everyone past thirty an hour', async () => {
    const w = world();
    for (let n = 0; n < 30; n++) {
      expect((await w.api.handle(reg(`x${String(n)}@example.com`, {}, `10.0.0.${String(n)}`))).status).toBe(201);
    }
    expect((await w.api.handle(reg('late@example.com', {}, '10.0.1.1'))).status).toBe(429);
  });

  it('stops checking passwords after ten failures for one address', async () => {
    const w = world();
    await w.member('Anna', 'anna@example.com', 'G4ABC');
    const login = (password: string, ip = '1.2.3.4') => w.api.handle({
      method: 'POST', path: '/api/login', token: null, ip, body: { email: 'anna@example.com', password },
    });
    for (let n = 0; n < 10; n++) expect((await login('wrong-password-here')).status).toBe(401);
    expect((await login('a-good-long-password')).status).toBe(429);
    w.clock.now += 16 * 60 * 1000;
    expect((await login('a-good-long-password')).status).toBe(200);
  });

  it('sends at most three reset mails an hour to one address, answering the same each time', async () => {
    const w = world();
    await w.member('Anna', 'anna@example.com', 'G4ABC');
    w.mailer.sent.length = 0;
    const ask = () => w.api.handle({ method: 'POST', path: '/api/reset/request', token: null, ip: '9.9.9.9', body: { email: 'anna@example.com' } });
    const first = await ask();
    for (let n = 0; n < 5; n++) expect(await ask()).toEqual(first);
    expect(w.mailer.sent).toHaveLength(3);
  });

  it('never sends more than the hourly mail ceiling', async () => {
    const w = world();
    for (let n = 0; n < 30; n++) await w.api.handle(reg(`m${String(n)}@example.com`, {}, `10.1.0.${String(n)}`));
    w.clock.now += 61 * 60 * 1000;
    for (let n = 0; n < 30; n++) await w.api.handle(reg(`n${String(n)}@example.com`, {}, `10.2.0.${String(n)}`));
    // No administrator here, so each registration sends one mail: 60 in two hours, under the ceiling.
    expect(w.mailer.sent).toHaveLength(60);
    expect(w.logged.some((l) => l.startsWith('MAIL HELD'))).toBe(false);
  }, 60_000);

  it('keeps an unconfirmed address off the band', async () => {
    const w = world();
    w.confirmEmails = false;
    const anna = await w.member('Anna', 'anna@example.com', 'G4ABC');
    const { socket } = await w.join(anna.token);
    expect(socket.last('error')?.detail).toMatch(/confirm your email/);
    expect(socket.last('welcome')).toBeUndefined();
  });
});

describe('administrator sends a confirmation link (A56)', () => {
  it('mails a member registered before A55 a link that explains itself, and logs it', async () => {
    const w = world();
    w.confirmEmails = false;
    const admin = await w.member('Mo', 'mo@example.com', 'EP2MHB');
    await w.member('Old Member', 'old@example.com', 'F4ABC');
    const list = (await w.api.handle({ method: 'GET', path: '/api/admin/members', token: admin.token, body: null })).body as { members: { id: number; callsign: string }[] };
    const id = list.members.find((m) => m.callsign === 'F4ABC')!.id;
    w.mailer.sent.length = 0;
    const res = await w.api.handle({ method: 'POST', path: `/api/admin/members/${String(id)}/confirm-link`, token: admin.token, body: { reason: '' } });
    expect(res.status).toBe(200);
    expect(w.mailer.sent).toHaveLength(1);
    expect(w.mailer.sent[0]!.to).toBe('old@example.com');
    expect(w.mailer.sent[0]!.text).toContain('now asks every member to confirm');
    expect(w.mailer.sent[0]!.text).not.toContain('Thank you for registering');
    expect(w.store.moderation.some((x) => x.action === 'confirm-link')).toBe(true);
    const listed = (await w.api.handle({ method: 'GET', path: '/api/admin/members', token: admin.token, body: null })).body as { members: { callsign: string; confirmationSentAt: string | null; confirmationExpired: boolean }[] };
    const row = listed.members.find((m) => m.callsign === 'F4ABC')!;
    expect(row.confirmationSentAt).toBe(new Date(w.clock.now).toISOString());
    expect(row.confirmationExpired).toBe(false);
    // 48 hours on, the same link reads as expired (checked on the view itself:
    // the test administrator's session would not last that long).
    const member = (await w.store.memberByCallsign('F4ABC'))!;
    const expires = (await w.store.pendingConfirmations()).get(member.id)!;
    expect(adminMemberView(member, expires, expires.getTime() + 1).confirmationExpired).toBe(true);
    const token = /#confirm-email=([A-Za-z0-9_-]+)/.exec(w.mailer.sent[0]!.text)![1]!;
    expect((await w.api.handle({ method: 'POST', path: '/api/email/confirm', token: null, body: { token } })).status).toBe(200);
    const again = await w.api.handle({ method: 'POST', path: `/api/admin/members/${String(id)}/confirm-link`, token: admin.token, body: {} });
    expect(again.status).toBe(400);
  });

  it('is refused to anyone but an administrator', async () => {
    const w = world();
    w.confirmEmails = false;
    await w.member('Mo', 'mo@example.com', 'EP2MHB');
    const other = await w.member('Anna', 'anna@example.com', 'G4ABC');
    const res = await w.api.handle({ method: 'POST', path: '/api/admin/members/1/confirm-link', token: other.token, body: {} });
    expect(res.status).toBe(403);
  });
});
