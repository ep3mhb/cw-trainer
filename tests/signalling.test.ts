/**
 * The signalling protocol (RFP §7).
 *
 * The collision case is why this module is pure. Two members pressing call
 * within the same round trip is rare enough to survive a demo and common
 * enough to plague a group of forty, and it cannot be provoked on demand
 * against a live server. Here it is four lines.
 */

import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION, decodeServerMessage, describePhase, encode, negotiate, newPeer,
  parseClientMessage, parseServerMessage, parseSignal, politeToward,
  type Action, type NegotiationEvent, type PeerState,
} from '../src/core/signalling';

const OFFER = { kind: 'offer', sdp: 'v=0 theirs' } as const;
const ANSWER = { kind: 'answer', sdp: 'v=0 theirs' } as const;
const ICE = {
  kind: 'ice',
  candidate: { candidate: 'candidate:1 1 udp', sdpMid: '0', sdpMLineIndex: 0 },
} as const;

const run = (state: PeerState, events: NegotiationEvent[]): { state: PeerState; actions: Action[] } => {
  let current = state;
  const actions: Action[] = [];
  for (const event of events) {
    const step = negotiate(current, event);
    current = step.state;
    actions.push(...step.actions);
  }
  return { state: current, actions };
};

const dos = (actions: Action[]): string[] => actions.map((a) => a.do);

describe('signalling: parsing', () => {
  it('refuses anything it does not recognise', () => {
    expect(parseServerMessage(null)).toBeNull();
    expect(parseServerMessage('welcome')).toBeNull();
    expect(parseServerMessage({ kind: 'nonsense' })).toBeNull();
    expect(parseServerMessage({ kind: 'welcome', v: 1 })).toBeNull();
    expect(parseSignal({ kind: 'offer' })).toBeNull();
    expect(decodeServerMessage('{not json')).toBeNull();
  });

  it('round-trips the heartbeat both ways', () => {
    expect(parseClientMessage({ kind: 'ping', t: 1234.5 })).toEqual({ kind: 'ping', t: 1234.5 });
    expect(parseClientMessage({ kind: 'ping' })).toBeNull();
    expect(parseServerMessage({ kind: 'pong', t: 1234.5 })).toEqual({ kind: 'pong', t: 1234.5 });
  });

  it('accepts a well-formed welcome and round-trips it', () => {
    const message = {
      kind: 'welcome' as const, v: PROTOCOL_VERSION, you: 'p1', callsign: 'A65XY',
      role: 'member' as const, training: false,
      ice: [{ urls: ['turn:sig.example:3478'], username: '1700000000', credential: 'abc=' }],
      icePolicy: 'relay' as const,
    };
    expect(decodeServerMessage(encode(message))).toEqual(message);
  });

  it('defaults a welcome with no ICE, role or policy to the safe values', () => {
    const parsed = parseServerMessage({ kind: 'welcome', v: 1, you: 'p1', callsign: 'A0MBA', role: 'god' });
    expect(parsed).toMatchObject({ role: 'student', training: false, ice: [], icePolicy: 'relay' });
  });

  it('drops malformed stations from a band update rather than the whole update', () => {
    const parsed = parseServerMessage({
      kind: 'band',
      stations: [
        { id: 'a', callsign: 'g4abc', frequencyHz: 7_018_000, strength: 1.4, transmitting: true },
        { id: 'b', callsign: 'A65XY' },
        'rubbish',
      ],
    });
    expect(parsed?.kind).toBe('band');
    const stations = parsed?.kind === 'band' ? parsed.stations : [];
    expect(stations).toHaveLength(1);
    expect(stations[0]).toMatchObject({ callsign: 'G4ABC', strength: 1, calling: false });
  });

  it('requires a session token in hello and nothing else identifying', () => {
    // The callsign is not something a client gets to claim: the server looks
    // it up from the session. A hello that tries to name one is just ignored
    // on that field.
    expect(parseClientMessage({ kind: 'hello', v: 1, token: 'abc', callsign: 'W1AW' }))
      .toEqual({ kind: 'hello', v: 1, token: 'abc' });
    expect(parseClientMessage({ kind: 'hello', v: 1 })).toBeNull();
    expect(parseClientMessage({ kind: 'hello', v: 1, token: '' })).toBeNull();
    expect(parseClientMessage({ kind: 'hello', v: 1, token: 'x'.repeat(300) })).toBeNull();
  });

  it('carries a key transition both ways in link.ts\u2019s packet shape', () => {
    expect(parseClientMessage({ kind: 'key', seq: 4, t: 1234.5, down: true }))
      .toEqual({ kind: 'key', seq: 4, t: 1234.5, down: true });
    expect(parseClientMessage({ kind: 'key', down: true })).toBeNull();
    expect(parseServerMessage({ kind: 'keying', peer: 'p2', seq: 4, t: 1234.5, down: false }))
      .toEqual({ kind: 'keying', peer: 'p2', seq: 4, t: 1234.5, down: false });
  });

  it('parses a link report, rounding and capping what it carries', () => {
    const parsed = parseClientMessage({
      kind: 'link', peer: 'p2', received: 40.6, latePlayed: 1, lateDropped: 0, missing: 2, bufferMs: 440,
      offsetMs: -123456.7, resyncs: 1, playingHz: 800.2, agent: 'x'.repeat(500),
    });
    expect(parsed).toMatchObject({ kind: 'link', peer: 'p2', received: 41, offsetMs: -123457, playingHz: 800 });
    expect(parsed?.kind === 'link' && parsed.agent.length).toBe(200);
    expect(parseClientMessage({ kind: 'link' })).toBeNull();
  });

  it('parses a moderation order and refuses an unknown action', () => {
    expect(parseClientMessage({ kind: 'moderate', peer: 'p2', action: 'mute', reason: 'language' }))
      .toEqual({ kind: 'moderate', peer: 'p2', action: 'mute', reason: 'language' });
    expect(parseClientMessage({ kind: 'moderate', peer: 'p2', action: 'ban' })).toBeNull();
  });

  it('caps relayed free text so a report cannot carry a novel', () => {
    const long = 'x'.repeat(2000);
    const parsed = parseClientMessage({ kind: 'report', about: 'p2', reason: long, transcript: long.repeat(10) });
    expect(parsed?.kind === 'report' && parsed.reason.length).toBe(280);
    expect(parsed?.kind === 'report' && parsed.transcript.length).toBe(8000);
  });

  it('tolerates an ICE candidate with null mid and index', () => {
    expect(parseSignal({ kind: 'ice', candidate: { candidate: 'x', sdpMid: null, sdpMLineIndex: null } }))
      .toEqual({ kind: 'ice', candidate: { candidate: 'x', sdpMid: null, sdpMLineIndex: null } });
  });
});

describe('signalling: negotiation', () => {
  it('makes exactly one side polite, whichever way round it is asked', () => {
    expect(politeToward('aaa', 'bbb')).toBe(true);
    expect(politeToward('bbb', 'aaa')).toBe(false);
    expect(newPeer('aaa', 'bbb').polite).not.toBe(newPeer('bbb', 'aaa').polite);
  });

  it('runs a clean call from our side through to connected', () => {
    const { state, actions } = run(newPeer('aaa', 'bbb'), [
      { kind: 'invite' },
      { kind: 'local-description', description: { type: 'offer', sdp: 'v=0 ours' } },
      { kind: 'signal', payload: ANSWER },
      { kind: 'connected' },
    ]);
    expect(dos(actions)).toEqual(['create-offer', 'send', 'set-remote']);
    expect(state.phase).toBe('connected');
  });

  it('runs a clean call from their side through to connected', () => {
    const { state, actions } = run(newPeer('bbb', 'aaa'), [
      { kind: 'signal', payload: OFFER },
      { kind: 'local-description', description: { type: 'answer', sdp: 'v=0 ours' } },
      { kind: 'connected' },
    ]);
    expect(dos(actions)).toEqual(['set-remote', 'create-answer', 'send']);
    expect(state.phase).toBe('connected');
  });

  it('resolves a collision: the polite peer gives way', () => {
    const polite = run(newPeer('aaa', 'bbb'), [
      { kind: 'invite' },
      { kind: 'signal', payload: OFFER },
    ]);
    expect(dos(polite.actions)).toEqual(['create-offer', 'rollback', 'set-remote', 'create-answer']);
    expect(polite.state.phase).toBe('invited');
  });

  it('resolves a collision: the impolite peer carries on', () => {
    const impolite = run(newPeer('bbb', 'aaa'), [
      { kind: 'invite' },
      { kind: 'signal', payload: OFFER },
    ]);
    expect(dos(impolite.actions)).toEqual(['create-offer', 'ignore']);
    expect(impolite.state.phase).toBe('inviting');
  });

  it('leaves a collided pair with one offerer and one answerer', () => {
    const a = run(newPeer('aaa', 'bbb'), [{ kind: 'invite' }, { kind: 'signal', payload: OFFER }]);
    const b = run(newPeer('bbb', 'aaa'), [{ kind: 'invite' }, { kind: 'signal', payload: OFFER }]);
    expect([a.state.phase, b.state.phase].sort()).toEqual(['invited', 'inviting']);
  });

  it('holds candidates that outrun the description they belong to', () => {
    const early = run(newPeer('bbb', 'aaa'), [
      { kind: 'signal', payload: ICE },
      { kind: 'signal', payload: ICE },
    ]);
    expect(dos(early.actions)).toEqual([]);
    expect(early.state.pendingIce).toHaveLength(2);

    const then = negotiate(early.state, { kind: 'signal', payload: OFFER });
    expect(dos(then.actions)).toEqual(['set-remote', 'add-ice', 'add-ice', 'create-answer']);
    expect(then.state.pendingIce).toHaveLength(0);
  });

  it('adds a candidate straight through once the description is in', () => {
    const ready = run(newPeer('bbb', 'aaa'), [{ kind: 'signal', payload: OFFER }]);
    expect(dos(negotiate(ready.state, { kind: 'signal', payload: ICE }).actions)).toEqual(['add-ice']);
  });

  it('ignores an answer with no offer outstanding', () => {
    const stray = negotiate(newPeer('aaa', 'bbb'), { kind: 'signal', payload: ANSWER });
    expect(dos(stray.actions)).toEqual(['ignore']);
    expect(stray.state.phase).toBe('idle');
  });

  it('closes on bye from either end and stops acting afterwards', () => {
    const closed = run(newPeer('aaa', 'bbb'), [
      { kind: 'invite' },
      { kind: 'signal', payload: { kind: 'bye', reason: '73' } },
      { kind: 'signal', payload: ICE },
    ]);
    expect(closed.state.phase).toBe('closed');
    expect(dos(closed.actions)).toEqual(['create-offer', 'close']);
  });

  it('sends bye when the member hangs up', () => {
    const ended = run(newPeer('aaa', 'bbb'), [{ kind: 'invite' }, { kind: 'hang-up' }]);
    expect(dos(ended.actions)).toEqual(['create-offer', 'send', 'close']);
  });

  it('blames the network, never the operator, when it fails', () => {
    const failed = negotiate(newPeer('aaa', 'bbb'), { kind: 'failed', reason: 'no route' });
    expect(describePhase(failed.state)).toBe('could not connect: no route');
    expect(describePhase(newPeer('aaa', 'bbb'))).toBe('not connected');
  });

  it('lets a closed contact be re-invited from scratch', () => {
    const again = run(newPeer('aaa', 'bbb'), [
      { kind: 'signal', payload: OFFER },
      { kind: 'signal', payload: { kind: 'bye', reason: '' } },
      { kind: 'invite' },
    ]);
    expect(again.state.phase).toBe('inviting');
    expect(again.state.haveRemote).toBe(false);
  });
});
