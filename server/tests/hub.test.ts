/**
 * The band (RFP §7) against fake sockets.
 *
 * Every message the hub sends is run through the CLIENT's parser first
 * (FakeSocket does that), so a server message the browser could not read
 * fails here rather than in a member's console.
 */

import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../src/core/signalling';
import { MUTE_MS } from '../src/hub';
import { FakeSocket, world } from './helpers';

const SDP = { kind: 'offer', sdp: 'v=0' };
const ANSWER = { kind: 'answer', sdp: 'v=0' };

describe('admission', () => {
  it('welcomes a signed-in member with TURN credentials and the relay policy', async () => {
    const w = world();
    const m = await w.member('Mohammad', 'm@example.com', 'EP2MHB');
    const { socket } = await w.join(m.token);
    const welcome = socket.last('welcome');
    expect(welcome).toMatchObject({ callsign: 'EP2MHB', role: 'admin', training: false, icePolicy: 'relay' });
    expect(welcome?.ice[0]).toMatchObject({ urls: ['turn:sig.example:3478'] });
    expect(welcome?.ice[0]?.username).toMatch(/^\d+:EP2MHB$/);
    expect(welcome?.ice[0]?.credential).toBeTruthy();
    expect(socket.last('band')?.stations).toEqual([]);
  });

  it('refuses a bad token, a stale protocol, and anything before hello', async () => {
    const w = world();
    const bad = new FakeSocket();
    const conn = w.hub.attach(bad);
    await conn.receive(JSON.stringify({ kind: 'spot', frequencyHz: 7_010_000, calling: true }));
    expect(bad.last('error')?.code).toBe('not-authorised');
    expect(bad.closed).not.toBeNull();

    const stale = new FakeSocket();
    await w.hub.attach(stale).receive(JSON.stringify({ kind: 'hello', v: PROTOCOL_VERSION + 1, token: 'x' }));
    expect(stale.last('error')?.code).toBe('version');

    const forged = new FakeSocket();
    await w.hub.attach(forged).receive(JSON.stringify({ kind: 'hello', v: PROTOCOL_VERSION, token: 'not-a-session' }));
    expect(forged.last('error')?.code).toBe('not-authorised');
    expect(forged.closed).not.toBeNull();
  });

  it('answers a ping with a pong carrying the same stamp', async () => {
    const w = world();
    const m = await w.member('Anna', 'a@example.com', 'G4ABC');
    const { socket, send } = await w.join(m.token);
    await send({ kind: 'ping', t: 12345.5 });
    expect(socket.last('pong')).toEqual({ kind: 'pong', t: 12345.5 });
  });

  it('answers rubbish with bad-message and stays connected', async () => {
    const w = world();
    const m = await w.member('Anna', 'a@example.com', 'G4ABC');
    const { socket, send } = await w.join(m.token);
    await send({ kind: 'whatever' });
    expect(socket.last('error')?.code).toBe('bad-message');
    expect(socket.closed).toBeNull();
  });

  it('lets a second login replace the first rather than refusing it', async () => {
    const w = world();
    const m = await w.member('Anna', 'a@example.com', 'G4ABC');
    const first = await w.join(m.token);
    const second = await w.join(m.token);
    expect(first.socket.closed?.reason).toBe('signed in elsewhere');
    expect(second.socket.last('welcome')).toBeDefined();
    expect(w.hub.size).toBe(1);
  });
});

describe('the band', () => {
  it('puts a member on a frequency and tells everyone', async () => {
    const w = world();
    const a = await w.join((await w.member('Anna', 'a@example.com', 'G4ABC')).token);
    const b = await w.join((await w.member('Bo', 'b@example.com')).token);
    await a.send({ kind: 'spot', frequencyHz: 7_018_004, calling: true });
    const seenByB = b.socket.last('band')?.stations;
    expect(seenByB).toHaveLength(1);
    expect(seenByB?.[0]).toMatchObject({ callsign: 'G4ABC', frequencyHz: 7_018_000, calling: true });
    // §8: the profile rides with the station — name always, the rest only
    // where the member filled it in.
    expect(seenByB?.[0]?.about).toEqual({ name: 'Anna' });
    expect(seenByB?.[0]?.strength).toBeGreaterThan(0.5);
  });

  it('will not let a CQ land on top of someone, but lets an answer tune onto them', async () => {
    const w = world();
    const a = await w.join((await w.member('Anna', 'a@example.com', 'G4ABC')).token);
    const b = await w.join((await w.member('Bo', 'b@example.com', 'I2ABC')).token);
    await a.send({ kind: 'spot', frequencyHz: 7_018_000, calling: true });
    await b.send({ kind: 'spot', frequencyHz: 7_018_100, calling: true });
    expect(b.socket.last('error')?.code).toBe('band-full');
    await b.send({ kind: 'spot', frequencyHz: 7_018_000, calling: false });
    expect(b.socket.last('band')?.stations).toHaveLength(2);
  });

  it('fans a key transition out to everyone else connected, not back to the sender', async () => {
    const w = world();
    const a = await w.join((await w.member('Anna', 'a@example.com', 'G4ABC')).token);
    const b = await w.join((await w.member('Bo', 'b@example.com', 'I2ABC')).token);
    const c = await w.join((await w.member('Cy', 'c@example.com', 'F5ABC')).token);
    await a.send({ kind: 'spot', frequencyHz: 7_018_000, calling: true });
    await b.send({ kind: 'spot', frequencyHz: 7_030_000, calling: false });
    // c never spots — just signed in and listening. They hear the band too;
    // their own dial decides what is audible.
    await a.send({ kind: 'key', seq: 0, t: 1000, down: true });
    await a.send({ kind: 'key', seq: 1, t: 1060, down: false });
    expect(b.socket.ofKind('keying').map((k) => [k.seq, k.t, k.down])).toEqual([[0, 1000, true], [1, 1060, false]]);
    expect(b.socket.ofKind('keying')[0]?.peer).toBe(a.id);
    expect(a.socket.ofKind('keying')).toHaveLength(0);
    expect(c.socket.ofKind('keying')).toHaveLength(2);
    // The band display saw the key go down and come up.
    const flags = b.socket.ofKind('band').map((m) => m.stations.find((s) => s.id === a.id)?.transmitting);
    expect(flags).toContain(true);
    expect(flags[flags.length - 1]).toBe(false);
  });

  it('drops a member who keys faster than a human could', async () => {
    const w = world();
    const a = await w.join((await w.member('Anna', 'a@example.com', 'G4ABC')).token);
    await a.send({ kind: 'spot', frequencyHz: 7_018_000, calling: true });
    for (let i = 0; i < 70; i += 1) await a.send({ kind: 'key', seq: i, t: i, down: i % 2 === 0 });
    expect(a.socket.ofKind('error').some((e) => e.code === 'rate-limited')).toBe(true);
    w.clock.now += 1100;
    a.socket.drain();
    await a.send({ kind: 'key', seq: 99, t: 99, down: true });
    expect(a.socket.ofKind('error')).toHaveLength(0);
  });
});

describe('a contact', () => {
  async function pair() {
    const w = world();
    const a = await w.join((await w.member('Anna', 'a@example.com', 'I2ABC')).token);
    const b = await w.join((await w.member('Bo', 'b@example.com')).token); // training identifier
    await a.send({ kind: 'spot', frequencyHz: 7_018_000, calling: true });
    await b.send({ kind: 'spot', frequencyHz: 7_018_000, calling: false });
    return { w, a, b };
  }

  it('relays offer, answer and ice, and logs the contact for both on the answer', async () => {
    const { w, a, b } = await pair();
    await b.send({ kind: 'signal', to: a.id, payload: SDP });
    expect(a.socket.last('signal')).toEqual({ kind: 'signal', from: b.id, payload: SDP });
    await a.send({ kind: 'signal', to: b.id, payload: ANSWER });
    expect(b.socket.last('signal')?.payload).toEqual(ANSWER);
    await a.send({ kind: 'signal', to: b.id, payload: { kind: 'ice', candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 } } });
    expect(b.socket.last('signal')?.payload.kind).toBe('ice');

    const aId = (await w.store.memberByCallsign('I2ABC'))!.id;
    const log = await w.store.contactsFor(aId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ aCallsign: 'I2ABC', frequencyHz: 7_018_000, exportable: false, endedAt: null });
    expect(log[0]?.bCallsign.startsWith('A0')).toBe(true);
    // Neither is calling CQ any more.
    expect(a.socket.last('band')?.stations.every((s) => !s.calling)).toBe(true);
  });

  it('is exportable when both sides are licensed AND both callsigns confirmed by an administrator', async () => {
    const w = world();
    const anna = await w.member('Anna', 'a@example.com', 'I2ABC');
    const bo = await w.member('Bo', 'b@example.com', 'G4ABC');
    // Unconfirmed: on the band marked as such, and the contact does not export.
    let a = await w.join(anna.token);
    let b = await w.join(bo.token);
    await a.send({ kind: 'spot', frequencyHz: 7_018_000, calling: true });
    expect(b.socket.last('band')?.stations[0]).toMatchObject({ callsign: 'I2ABC', unconfirmed: true });
    await b.send({ kind: 'signal', to: a.id, payload: SDP });
    await a.send({ kind: 'signal', to: b.id, payload: ANSWER });
    let log = await w.store.contactsFor((await w.store.memberByCallsign('I2ABC'))!.id);
    expect(log[0]?.exportable).toBe(false);
    await a.close();
    await b.close();
    // Confirmed: the mark goes and the next contact exports.
    await w.store.setVerified((await w.store.memberByCallsign('I2ABC'))!.id, true);
    await w.store.setVerified((await w.store.memberByCallsign('G4ABC'))!.id, true);
    a = await w.join(anna.token);
    b = await w.join(bo.token);
    await a.send({ kind: 'spot', frequencyHz: 7_018_000, calling: true });
    expect(b.socket.last('band')?.stations[0]).not.toHaveProperty('unconfirmed');
    await b.send({ kind: 'signal', to: a.id, payload: SDP });
    await a.send({ kind: 'signal', to: b.id, payload: ANSWER });
    log = await w.store.contactsFor((await w.store.memberByCallsign('I2ABC'))!.id);
    expect(log.some((c) => c.exportable)).toBe(true);
  });

  it('ends on bye, and on a disconnect tells the partner with a bye', async () => {
    const { w, a, b } = await pair();
    await b.send({ kind: 'signal', to: a.id, payload: SDP });
    await a.send({ kind: 'signal', to: b.id, payload: ANSWER });
    await a.close();
    expect(b.socket.last('signal')?.payload).toMatchObject({ kind: 'bye' });
    expect(b.socket.last('gone')?.peer).toBe(a.id);
    const log = await w.store.contactsFor((await w.store.memberByCallsign('I2ABC'))!.id);
    expect(log[0]?.endedAt).not.toBeNull();
  });

  it('tells a caller when the other station has gone', async () => {
    const { a } = await pair();
    await a.send({ kind: 'signal', to: 'nobody', payload: SDP });
    expect(a.socket.last('error')?.code).toBe('no-such-peer');
  });
});

describe('moderation', () => {
  it('is for administrators only', async () => {
    const w = world();
    const a = await w.join((await w.member('Anna', 'a@example.com', 'G4ABC')).token);
    const b = await w.join((await w.member('Bo', 'b@example.com', 'I2ABC')).token);
    await a.send({ kind: 'moderate', peer: b.id, action: 'mute', reason: 'x' });
    expect(a.socket.last('error')?.code).toBe('not-authorised');
    expect(b.socket.ofKind('moderated')).toHaveLength(0);
  });

  it('mutes: the member stays but cannot spot, key or signal until it lapses', async () => {
    const w = world();
    const admin = await w.join((await w.member('Mo', 'm@example.com', 'EP2MHB')).token);
    const b = await w.join((await w.member('Bo', 'b@example.com', 'I2ABC')).token);
    await b.send({ kind: 'spot', frequencyHz: 7_018_000, calling: true });
    await admin.send({ kind: 'moderate', peer: b.id, action: 'mute', reason: 'language' });
    expect(b.socket.last('moderated')).toMatchObject({ peer: b.id, action: 'muted', by: 'EP2MHB' });
    await b.send({ kind: 'key', seq: 0, t: 0, down: true });
    expect(b.socket.last('error')?.code).toBe('muted');
    expect(w.store.moderation[0]).toMatchObject({ action: 'mute', reason: 'language' });
    w.clock.now += MUTE_MS + 1;
    b.socket.drain();
    await b.send({ kind: 'key', seq: 1, t: 1, down: true });
    expect(b.socket.ofKind('error')).toHaveLength(0);
  });

  it('removes: the member is disconnected, signed out everywhere, and cannot come back', async () => {
    const w = world();
    const admin = await w.join((await w.member('Mo', 'm@example.com', 'EP2MHB')).token);
    const bm = await w.member('Bo', 'b@example.com', 'I2ABC');
    const b = await w.join(bm.token);
    await admin.send({ kind: 'moderate', peer: b.id, action: 'remove', reason: 'abuse' });
    expect(b.socket.closed?.reason).toBe('removed');
    expect(admin.socket.last('gone')?.peer).toBe(b.id);
    expect(w.hub.size).toBe(1);
    const again = await w.join(bm.token);
    expect(again.socket.last('error')?.code).toBe('not-authorised');
  });

  it('files an abuse report with its transcript', async () => {
    const w = world();
    const a = await w.join((await w.member('Anna', 'a@example.com', 'G4ABC')).token);
    const b = await w.join((await w.member('Bo', 'b@example.com', 'I2ABC')).token);
    await a.send({ kind: 'report', about: b.id, reason: 'rude', transcript: 'CQ CQ ...' });
    const reports = await w.store.listReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ reason: 'rude', transcript: 'CQ CQ ...' });
  });
});

describe('the journal', () => {
  it('records a receiver\u2019s link report against the station it heard, flagging trouble', async () => {
    const w = world();
    const lines: string[] = [];
    // A hub with a log we can read.
    const { Hub } = await import('../src/hub');
    const hub = new Hub(w.store, { ...(await import('./helpers')).CONFIG }, { log: (l) => lines.push(l), now: () => w.clock.now });
    const join = async (token: string) => {
      const socket = new FakeSocket();
      const conn = hub.attach(socket);
      await conn.receive(JSON.stringify({ kind: 'hello', v: 1, token }));
      return { socket, send: (m: object) => conn.receive(JSON.stringify(m)), id: socket.last('welcome')?.you ?? '' };
    };
    const a = await join((await w.member('Anna', 'a@example.com', 'G4ABC')).token);
    const b = await join((await w.member('Bo', 'b@example.com', 'I2ABC')).token);
    await a.send({ kind: 'spot', frequencyHz: 7_018_000, calling: true });
    await b.send({
      kind: 'link', peer: a.id, received: 40, latePlayed: 1, lateDropped: 0, missing: 2, bufferMs: 440,
      offsetMs: -123456, resyncs: 1, playingHz: 800, agent: 'Safari/17 iPhone',
    });
    const line = lines.find((l) => l.startsWith('link '));
    expect(line).toContain('I2ABC hears G4ABC');
    expect(line).toContain('received=40');
    expect(line).toContain('missing=2');
    expect(line).toContain('buffer=440ms');
    expect(line).toContain('TROUBLE');
    expect(line).toContain('agent="Safari/17 iPhone"');
    expect(lines.some((l) => /^spot G4ABC 7018000 Hz calling CQ$/.test(l))).toBe(true);
  });
});
