/**
 * The final exam, server-side (RFD A25).
 *
 * The first test is the one the whole design rests on: the response that
 * starts an exam must not contain the answers. Everything else is ordinary
 * care — an exam is marked once, is not somebody else's to submit, and
 * expires.
 */

import { describe, expect, it } from 'vitest';
import { decode } from '../../src/core/decoder';
import { KOCH_ORDER } from '../../src/core/morse';
import { world } from './helpers';

const post = (path: string, body: unknown, token: string | null = null) =>
  ({ method: 'POST', path, token, body });
const get = (path: string, token: string | null) => ({ method: 'GET', path, token, body: null });

interface StartBody {
  examId: number;
  count: number;
  characterWpm: number;
  effectiveWpm: number;
  groupSize: number;
  groups: { tones: { atMs: number; durationMs: number }[] }[];
}

async function start(w: ReturnType<typeof world>, token: string, body: unknown = {}) {
  const res = await w.api.handle(post('/api/exam/start', body, token));
  expect(res.status).toBe(200);
  return res.body as StartBody;
}

describe('starting an exam', () => {
  it('sends the timing and nothing that spells out the answers', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const body = await start(w, anna.token);

    // The exam itself: the whole course, four times each.
    expect(body.count).toBe(KOCH_ORDER.length * 4);

    const asText = JSON.stringify(body);
    const allTones = body.groups.flatMap((g) => g.tones);
    for (const key of Object.keys(allTones[0] ?? {})) {
      expect(['atMs', 'durationMs']).toContain(key);
    }
    expect(asText).not.toContain('"element"');
    expect(asText).not.toContain('"tokenIndex"');
    expect(asText).not.toContain('"characters"');
    expect(asText).not.toContain('dit');
    expect(asText).not.toContain('dah');

    // And the durations are real Morse, not noise: the tone count matches
    // the elements of what was actually stored.
    const stored = (await w.store.examById(body.examId))?.characters ?? '';
    expect(stored).toHaveLength(body.count);
    expect(allTones.length).toBeGreaterThan(body.count);
    expect(body.groups).toHaveLength(body.count / body.groupSize);
  });

  it('plays back as exactly what the server stored', async () => {
    // A timing bug here would fail every member at once and look like a
    // sudden epidemic of bad copying, so the stream is decoded back.
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const body = await start(w, anna.token, { characterWpm: 20, effectiveWpm: 20 });
    const stored = (await w.store.examById(body.examId))?.characters ?? '';

    let heard = '';
    for (const group of body.groups) {
      const transitions: { down: boolean; t: number }[] = [];
      for (const tone of group.tones) {
        transitions.push({ down: true, t: tone.atMs });
        transitions.push({ down: false, t: tone.atMs + tone.durationMs });
      }
      heard += decode(transitions, { tolerance: 0.3, referenceWpm: 20 }).text.replace(/\s+/g, '');
    }
    expect(heard).toBe(stored);
  });

  it('refuses an anonymous caller', async () => {
    const w = world();
    expect((await w.api.handle(post('/api/exam/start', {}, null))).status).toBe(401);
  });

  it('honours the speed asked for, within sane bounds', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const fast = await start(w, anna.token, { characterWpm: 30, effectiveWpm: 25 });
    expect(fast.characterWpm).toBe(30);
    expect(fast.effectiveWpm).toBe(25);
    const silly = await start(w, anna.token, { characterWpm: 900, effectiveWpm: 0 });
    expect(silly.characterWpm).toBe(40);
    expect(silly.effectiveWpm).toBe(5);
    // Farnsworth cannot run faster than the characters themselves.
    const odd = await start(w, anna.token, { characterWpm: 12, effectiveWpm: 35 });
    expect(odd.effectiveWpm).toBe(12);
  });
});

describe('submitting an exam', () => {
  const answers = async (w: ReturnType<typeof world>, id: number, spoil?: (c: string[]) => string[]) => {
    const stored = (await w.store.examById(id))?.characters ?? '';
    const typed = [...stored];
    return spoil ? spoil(typed) : typed;
  };

  it('passes a clean run and issues a certificate', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const body = await start(w, anna.token);
    const res = await w.api.handle(post('/api/exam/submit', {
      examId: body.examId, typed: await answers(w, body.examId),
    }, anna.token));
    expect(res.status).toBe(200);
    const out = res.body as { pass: boolean; serial: string; correct: number; of: number };
    expect(out.pass).toBe(true);
    expect(out.correct).toBe(out.of);
    expect(out.serial).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}$/);

    const mine = (await w.api.handle(get('/api/me/certificates', anna.token))).body as
      { certificates: { serial: string; verifiable: boolean }[] };
    expect(mine.certificates).toHaveLength(1);
    // On from the start, because the certificate carries a QR square: a code
    // that scans to "not found" is worse than no code. The member can
    // withdraw it afterwards, and is told so when it is handed over.
    expect(mine.certificates[0]?.verifiable).toBe(true);
  });

  it('fails one weak character hiding behind a high score, and issues nothing', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const body = await start(w, anna.token);
    const stored = (await w.store.examById(body.examId))?.characters ?? '';
    let left = 2;
    const typed = [...stored].map((c) => {
      if (c === 'R' && left > 0) { left -= 1; return '?'; }
      return c;
    });
    const res = await w.api.handle(post('/api/exam/submit', { examId: body.examId, typed }, anna.token));
    const out = res.body as { pass: boolean; accuracy: number; failed: string[]; serial: string | null };
    expect(out.accuracy).toBeGreaterThan(0.98);
    expect(out.pass).toBe(false);
    expect(out.failed).toEqual(['R']);
    expect(out.serial).toBeNull();
    expect((await w.store.certificatesFor(1)).length).toBe(0);
  });

  it('marks an exam once, however many times it is sent', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const body = await start(w, anna.token);
    const typed = await answers(w, body.examId);
    expect((await w.api.handle(post('/api/exam/submit', { examId: body.examId, typed }, anna.token))).status).toBe(200);
    const again = await w.api.handle(post('/api/exam/submit', { examId: body.examId, typed }, anna.token));
    expect(again.status).toBe(409);
    expect((await w.store.certificatesFor(1))).toHaveLength(1);
  });

  it('is not somebody else’s to submit, and does not admit the exam exists', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const bo = await w.member('Bo', 'b@example.com', 'I2ABC');
    const body = await start(w, anna.token);
    const res = await w.api.handle(post('/api/exam/submit', {
      examId: body.examId, typed: await answers(w, body.examId),
    }, bo.token));
    expect(res.status).toBe(404);
    expect((await w.store.examById(body.examId))?.submittedAt).toBeNull();
  });

  it('expires', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const body = await start(w, anna.token);
    w.clock.now += 2 * 60 * 60 * 1000;
    const res = await w.api.handle(post('/api/exam/submit', {
      examId: body.examId, typed: await answers(w, body.examId),
    }, anna.token));
    expect(res.status).toBe(410);
  });

  it('refuses a submission that does not line up with what was sent', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const body = await start(w, anna.token);
    const typed = (await answers(w, body.examId)).slice(1);
    const res = await w.api.handle(post('/api/exam/submit', { examId: body.examId, typed }, anna.token));
    expect(res.status).toBe(400);
  });

  it('never names the member in the certificate log line', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const body = await start(w, anna.token);
    await w.api.handle(post('/api/exam/submit', {
      examId: body.examId, typed: await answers(w, body.examId),
    }, anna.token));
    const line = w.logged.find((l) => l.includes('certificate'));
    expect(line).toBeDefined();
    expect(line).not.toContain('G4ABC');
    expect(line).not.toContain('a@example.com');
  });
});

describe('the QR square and the page it scans to', () => {
  const pass = async (w: ReturnType<typeof world>, token: string) => {
    const body = await start(w, token);
    const stored = (await w.store.examById(body.examId))?.characters ?? '';
    const res = await w.api.handle(post('/api/exam/submit', { examId: body.examId, typed: [...stored] }, token));
    return { ...(res.body as { serial: string; verify: string; qr: string }), examId: body.examId };
  };

  it('gives the certificate a square pointing at this server, not at the app', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const out = await pass(w, anna.token);
    // Whoever scans this is checking the certificate AGAINST the project
    // server, so the page has to come FROM the server. It used to point
    // at the application's hash route, which made a reader load the whole
    // trainer \u2014 service worker, audio, tab bar \u2014 to read six facts.
    expect(out.verify).toBe(`https://sig.example.test/certificate/${out.serial}`);
    expect(out.verify).not.toContain('#');
    expect(out.qr).toContain('<svg');
    // The square really encodes that URL, rather than being decorative.
    expect(out.qr.length).toBeGreaterThan(200);
  });

  it('serves a page a person can read, with no script in it', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const out = await pass(w, anna.token);
    const res = await w.api.handle(get(`/certificate/${out.serial}`, null));
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/html');
    const html = res.body as string;
    expect(html).toContain('Verified');
    expect(html).toContain('G4ABC');
    expect(html).toContain(out.serial);
    // No JavaScript at all: the reader is on a phone in front of a piece of
    // paper, and the answer should not need an application to arrive.
    expect(html).not.toContain('<script');
    // The same restraint as the JSON route \u2014 the name is not on it.
    expect(html).not.toContain('Anna');
    expect(html).not.toContain('a@example.com');
  });

  it('says not found on the page too when a certificate is withdrawn', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const out = await pass(w, anna.token);
    await w.api.handle(post('/api/me/certificates/visibility',
      { serial: out.serial, verifiable: false }, anna.token));
    const res = await w.api.handle(get(`/certificate/${out.serial}`, null));
    expect(res.status).toBe(404);
    expect(res.contentType).toContain('text/html');
    expect(res.body as string).toContain('Not found');
  });

  it('resolves the serial for anyone holding it, with no account', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const out = await pass(w, anna.token);
    const res = await w.api.handle(get(`/api/certificate/${out.serial}`, null));
    expect(res.status).toBe(200);
    const shown = res.body as Record<string, unknown>;
    expect(shown.callsign).toBe('G4ABC');
    expect(shown.correct).toBe(shown.of);
    // Only what is already printed on the paper being shown to you.
    expect(Object.keys(shown)).not.toContain('name');
    expect(Object.keys(shown)).not.toContain('email');
    expect(JSON.stringify(shown)).not.toContain('a@example.com');
    expect(JSON.stringify(shown)).not.toContain('Anna');
  });

  it('is case-insensitive, because serials get read aloud', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const out = await pass(w, anna.token);
    expect((await w.api.handle(get(`/api/certificate/${out.serial.toLowerCase()}`, null))).status).toBe(200);
  });

  it('says nothing about a serial that was never issued', async () => {
    const w = world();
    expect((await w.api.handle(get('/api/certificate/ZZZZ-ZZZ-ZZZ', null))).status).toBe(404);
  });

  it('lets the holder withdraw it, and put it back', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const out = await pass(w, anna.token);
    expect((await w.api.handle(get(`/api/certificate/${out.serial}`, null))).status).toBe(200);

    const off = await w.api.handle(
      post('/api/me/certificates/visibility', { serial: out.serial, verifiable: false }, anna.token),
    );
    expect(off.status).toBe(200);
    expect((off.body as { verifiable: boolean }).verifiable).toBe(false);
    expect((await w.api.handle(get(`/api/certificate/${out.serial}`, null))).status).toBe(404);

    // Listing it still shows it to its owner \u2014 withdrawn, not destroyed.
    const mine = (await w.api.handle(get('/api/me/certificates', anna.token))).body as
      { certificates: { verifiable: boolean }[] };
    expect(mine.certificates[0]?.verifiable).toBe(false);

    await w.api.handle(
      post('/api/me/certificates/visibility', { serial: out.serial, verifiable: true }, anna.token),
    );
    expect((await w.api.handle(get(`/api/certificate/${out.serial}`, null))).status).toBe(200);
  });

  it('will not let one member withdraw another\u2019s certificate', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const bob = await w.member('Bob', 'b@example.com', 'G4XYZ');
    const out = await pass(w, anna.token);
    // Bob knows the serial \u2014 it is printed on the sheet \u2014 and that is not enough.
    const res = await w.api.handle(
      post('/api/me/certificates/visibility', { serial: out.serial, verifiable: false }, bob.token),
    );
    expect(res.status).toBe(404);
    expect((await w.api.handle(get(`/api/certificate/${out.serial}`, null))).status).toBe(200);
  });

  it('refuses the visibility call without a session, or without a flag', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const out = await pass(w, anna.token);
    expect((await w.api.handle(
      post('/api/me/certificates/visibility', { serial: out.serial, verifiable: false }, null),
    )).status).toBe(401);
    expect((await w.api.handle(
      post('/api/me/certificates/visibility', { serial: out.serial }, anna.token),
    )).status).toBe(400);
  });

  it('stops resolving once the member closes their account', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'G4ABC');
    const out = await pass(w, anna.token);
    expect((await w.api.handle(get(`/api/certificate/${out.serial}`, null))).status).toBe(200);
    await w.api.handle(post('/api/me/delete', { password: 'a-good-long-password' }, anna.token));
    expect((await w.api.handle(get(`/api/certificate/${out.serial}`, null))).status).toBe(404);
    // And it is gone, not merely hidden. The member row is tombstoned rather
    // than deleted, so nothing cascades: closing the account has to take the
    // exam \u2014 which holds what was typed \u2014 and the certificate with it.
    expect(await w.store.certificatesFor(1)).toHaveLength(0);
    expect(await w.store.examById(out.examId)).toBeNull();
  });
});
