/**
 * The signalling protocol for live contacts (RFP §7), as a pure module.
 *
 * §7 asks for a "signalling server for peer setup". What that server carries
 * is small — a few hundred bytes to introduce two browsers, after which the
 * keying goes peer to peer over the data channel `link.ts` receives — but
 * getting it wrong is expensive in a way that does not show up in testing:
 * the failure mode of a botched negotiation is not an error message, it is a
 * contact that connects one time in three and leaves two members blaming
 * their own network.
 *
 * Two decisions are encoded here rather than left to the WebRTC wrapper.
 *
 * FIRST, the protocol is parsed, not trusted. Every message on this socket
 * comes from another member, relayed by a server the operator will run on a
 * EUR 5 VPS. `parseServerMessage` and `parseClientMessage` return null on
 * anything they do not recognise, and the transport drops it. An SDP is
 * handed to the browser's own parser and nothing here inspects it, but the
 * envelope around it — who it claims to be from, what kind it claims to be —
 * is checked before it reaches any state machine.
 *
 * SECOND, negotiation follows the "perfect negotiation" pattern, and the
 * reason is glare. Two members who tune onto each other and both press the
 * call button within the same round trip each send an offer; if both then try
 * to answer, both connections fail. The fix is to make the roles asymmetric
 * in a way both sides compute identically: the peer with the lower id is
 * POLITE and gives way, rolling back its own offer and answering; the impolite
 * one ignores the colliding offer and carries on. No coordination, no race,
 * and — because the rule is arithmetic on two strings — it is testable here
 * without a browser, a server, or a network.
 *
 * Pure: no RTCPeerConnection, no WebSocket, no timers. `negotiate()` takes a
 * state and an event and returns a new state plus a list of actions for the
 * wrapper to carry out. That keeps the part with the race conditions in it
 * under unit test, and leaves the wrapper as a thin layer that does what it
 * is told.
 */

import type { Station, StationAbout } from './tuning';

/** Bumped whenever a message shape changes. The server refuses a mismatch. */
export const PROTOCOL_VERSION = 1;

export type PeerId = string;

export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export interface SessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

/** What one peer sends another, relayed verbatim by the server. */
export type Signal =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: IceCandidate }
  | { kind: 'bye'; reason: string };

/** Member to server. */
export type ClientMessage =
  /** `token` is the session from the accounts API; the callsign is what the server tells us it is. */
  | { kind: 'hello'; v: number; token: string }
  | { kind: 'spot'; frequencyHz: number; calling: boolean }
  /**
   * One key transition, as link.ts's KeyPacket. The server fans it out to
   * everyone else on the band (`keying`), so a member tuning across hears a
   * CQ before deciding to answer — the "hear signals arrive and fade" of §7.
   * The contact itself, once answered, runs over the data channel.
   */
  | { kind: 'key'; seq: number; t: number; down: boolean }
  | { kind: 'signal'; to: PeerId; payload: Signal }
  | { kind: 'report'; about: PeerId; reason: string; transcript: string }
  /**
   * What this receiver's link to one station has been doing (link.ts stats),
   * sent every few seconds and on leaving, so the server's journal holds the
   * quality of every contact anyone has had — reviewable after the fact,
   * without asking a member to read numbers off a screen mid-QSO.
   */
  | {
      kind: 'link'; peer: PeerId;
      received: number; latePlayed: number; lateDropped: number; missing: number;
      offsetMs: number; resyncs: number; playingHz: number;
      /** The play-out delay the receiver has settled on, in ms (0 if unknown). */
      bufferMs: number;
      /** navigator.userAgent, trimmed: which browser heard this. */
      agent: string;
    }
  /** §7 moderation: administrators only; the server checks the role. */
  | { kind: 'moderate'; peer: PeerId; action: 'mute' | 'remove'; reason: string }
  | { kind: 'leave' }
  /**
   * Heartbeat. A browser cannot see WebSocket protocol pings, and a phone
   * whose radio has gone quiet keeps a socket that looks open for a minute
   * or more. The client sends this every PING_MS and expects `pong`; silence
   * for longer than DEAD_MS means the connection is gone, whatever the
   * socket says, and the client reconnects.
   */
  | { kind: 'ping'; t: number };

/** How often the client pings, and how long without ANY message means dead. */
export const PING_MS = 15_000;
export const DEAD_MS = 40_000;

export type ErrorCode =
  | 'version'
  | 'callsign-taken'
  | 'not-authorised'
  | 'no-such-peer'
  | 'band-full'
  | 'rate-limited'
  | 'muted'
  | 'bad-message';

/** One entry for RTCPeerConnection's iceServers, as the server hands it out. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export type IcePolicy = 'all' | 'relay';

export type Role = 'student' | 'member' | 'instructor' | 'admin';

/** Server to member. */
export type ServerMessage =
  | {
      kind: 'welcome'; v: number; you: PeerId; callsign: string; role: Role;
      /** Whether `callsign` is a training identifier (see callsign.ts). */
      training: boolean;
      /** TURN credentials, minted for this session and expiring with it. */
      ice: IceServer[];
      icePolicy: IcePolicy;
    }
  | { kind: 'band'; stations: Station[] }
  /** Another station's key moved. Play it at the pitch tuning.ts gives it. */
  | { kind: 'keying'; peer: PeerId; seq: number; t: number; down: boolean }
  | { kind: 'signal'; from: PeerId; payload: Signal }
  | { kind: 'gone'; peer: PeerId }
  | { kind: 'pong'; t: number }
  /** §7 moderation: an administrator has silenced or removed someone. */
  | { kind: 'moderated'; peer: PeerId; action: 'muted' | 'removed'; by: string }
  | { kind: 'error'; code: ErrorCode; detail: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const bool = (v: unknown): v is boolean => typeof v === 'boolean';

/** A cap on relayed text so a member cannot paste a novel into an abuse report. */
export const MAX_REASON = 280;
/** A contact's decoded transcript, attached to a report so a moderator can read it. */
export const MAX_TRANSCRIPT = 8000;

function parseIce(value: unknown): IceCandidate | null {
  if (!isObject(value) || !str(value.candidate)) return null;
  const sdpMid = value.sdpMid === null || str(value.sdpMid) ? value.sdpMid : null;
  const sdpMLineIndex = value.sdpMLineIndex === null || num(value.sdpMLineIndex)
    ? value.sdpMLineIndex
    : null;
  return { candidate: value.candidate, sdpMid, sdpMLineIndex };
}

export function parseSignal(value: unknown): Signal | null {
  if (!isObject(value) || !str(value.kind)) return null;
  switch (value.kind) {
    case 'offer':
      return str(value.sdp) ? { kind: 'offer', sdp: value.sdp } : null;
    case 'answer':
      return str(value.sdp) ? { kind: 'answer', sdp: value.sdp } : null;
    case 'ice': {
      const candidate = parseIce(value.candidate);
      return candidate ? { kind: 'ice', candidate } : null;
    }
    case 'bye':
      return { kind: 'bye', reason: str(value.reason) ? value.reason.slice(0, MAX_REASON) : '' };
    default:
      return null;
  }
}

function parseStation(value: unknown): Station | null {
  if (!isObject(value)) return null;
  if (!str(value.id) || !str(value.callsign) || !num(value.frequencyHz)) return null;
  if (!num(value.strength)) return null;
  return {
    id: value.id,
    callsign: value.callsign.toUpperCase().slice(0, 12),
    frequencyHz: value.frequencyHz,
    strength: Math.min(1, Math.max(0, value.strength)),
    transmitting: bool(value.transmitting) ? value.transmitting : false,
    calling: bool(value.calling) ? value.calling : false,
    ...(value.unconfirmed === true ? { unconfirmed: true } : {}),
    ...(isObject(value.about) ? { about: parseAbout(value.about) } : {}),
  };
}

const ABOUT_KEYS = ['name', 'qth', 'grid', 'rig', 'antenna', 'licence'] as const;
function parseAbout(value: Record<string, unknown>): StationAbout {
  const about: StationAbout = {};
  for (const k of ABOUT_KEYS) {
    const v = value[k];
    if (str(v) && v.trim() !== '') about[k] = v.trim().slice(0, 80);
  }
  return about;
}

export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isObject(value) || !str(value.kind)) return null;
  switch (value.kind) {
    case 'welcome': {
      if (!num(value.v) || !str(value.you) || !str(value.callsign)) return null;
      const role: Role = value.role === 'admin' || value.role === 'instructor' || value.role === 'member'
        ? value.role : 'student';
      const ice = Array.isArray(value.ice)
        ? value.ice.flatMap((entry): IceServer[] => {
            if (!isObject(entry) || !Array.isArray(entry.urls)) return [];
            const urls = entry.urls.filter(str);
            const server: IceServer = { urls };
            if (str(entry.username)) server.username = entry.username;
            if (str(entry.credential)) server.credential = entry.credential;
            return urls.length > 0 ? [server] : [];
          })
        : [];
      return {
        kind: 'welcome', v: value.v, you: value.you, callsign: value.callsign, role,
        training: bool(value.training) ? value.training : false,
        ice,
        icePolicy: value.icePolicy === 'all' ? 'all' : 'relay',
      };
    }
    case 'band': {
      if (!Array.isArray(value.stations)) return null;
      const stations = value.stations.map(parseStation).filter((s): s is Station => s !== null);
      return { kind: 'band', stations };
    }
    case 'signal': {
      const payload = parseSignal(value.payload);
      return str(value.from) && payload ? { kind: 'signal', from: value.from, payload } : null;
    }
    case 'keying':
      return str(value.peer) && num(value.seq) && num(value.t) && bool(value.down)
        ? { kind: 'keying', peer: value.peer, seq: value.seq, t: value.t, down: value.down }
        : null;
    case 'gone':
      return str(value.peer) ? { kind: 'gone', peer: value.peer } : null;
    case 'pong':
      return num(value.t) ? { kind: 'pong', t: value.t } : null;
    case 'moderated':
      return str(value.peer) && (value.action === 'muted' || value.action === 'removed')
        ? { kind: 'moderated', peer: value.peer, action: value.action, by: str(value.by) ? value.by : '' }
        : null;
    case 'error':
      return str(value.code)
        ? {
            kind: 'error',
            code: value.code as ErrorCode,
            detail: str(value.detail) ? value.detail.slice(0, MAX_REASON) : '',
          }
        : null;
    default:
      return null;
  }
}

export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isObject(value) || !str(value.kind)) return null;
  switch (value.kind) {
    case 'hello':
      return num(value.v) && str(value.token) && value.token.length > 0 && value.token.length <= 256
        ? { kind: 'hello', v: value.v, token: value.token }
        : null;
    case 'spot':
      return num(value.frequencyHz)
        ? { kind: 'spot', frequencyHz: value.frequencyHz, calling: bool(value.calling) ? value.calling : false }
        : null;
    case 'key':
      return bool(value.down) && num(value.seq) && num(value.t)
        ? { kind: 'key', seq: value.seq, t: value.t, down: value.down }
        : null;
    case 'signal': {
      const payload = parseSignal(value.payload);
      return str(value.to) && payload ? { kind: 'signal', to: value.to, payload } : null;
    }
    case 'report':
      return str(value.about)
        ? {
            kind: 'report',
            about: value.about,
            reason: str(value.reason) ? value.reason.slice(0, MAX_REASON) : '',
            transcript: str(value.transcript) ? value.transcript.slice(0, MAX_TRANSCRIPT) : '',
          }
        : null;
    case 'link': {
      if (!str(value.peer)) return null;
      const n = (k: string): number => (num(value[k]) ? Math.round(value[k] as number) : 0);
      return {
        kind: 'link', peer: value.peer,
        received: n('received'), latePlayed: n('latePlayed'), lateDropped: n('lateDropped'),
        missing: n('missing'), offsetMs: n('offsetMs'), resyncs: n('resyncs'), playingHz: n('playingHz'),
        bufferMs: n('bufferMs'),
        agent: str(value.agent) ? value.agent.slice(0, 200) : '',
      };
    }
    case 'moderate':
      return str(value.peer) && (value.action === 'mute' || value.action === 'remove')
        ? {
            kind: 'moderate', peer: value.peer, action: value.action,
            reason: str(value.reason) ? value.reason.slice(0, MAX_REASON) : '',
          }
        : null;
    case 'leave':
      return { kind: 'leave' };
    case 'ping':
      return num(value.t) ? { kind: 'ping', t: value.t } : null;
    default:
      return null;
  }
}

/** JSON in, message out. Bad JSON is a dropped packet, not an exception. */
export function decodeServerMessage(text: string): ServerMessage | null {
  try {
    return parseServerMessage(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

/* ------------------------------------------------------------------ *
 * Negotiation
 * ------------------------------------------------------------------ */

export type Phase =
  /** Nothing in flight. */
  | 'idle'
  /** We offered; waiting for their answer. */
  | 'inviting'
  /** They offered; we owe them an answer. */
  | 'invited'
  /** Descriptions exchanged; ICE is still working. */
  | 'negotiating'
  | 'connected'
  | 'closed'
  | 'failed';

export interface PeerState {
  readonly id: PeerId;
  /** The lower id gives way when both sides offer at once. */
  readonly polite: boolean;
  readonly phase: Phase;
  /** Whether their description has been applied, which ICE waits on. */
  readonly haveRemote: boolean;
  /** Candidates that arrived before the description they belong to. */
  readonly pendingIce: readonly IceCandidate[];
  readonly reason: string;
}

export type NegotiationEvent =
  /** The member pressed call. */
  | { kind: 'invite' }
  /** Something arrived from the other peer. */
  | { kind: 'signal'; payload: Signal }
  /** The browser produced our offer or answer. */
  | { kind: 'local-description'; description: SessionDescription }
  /** The browser found one of our candidates. */
  | { kind: 'ice-gathered'; candidate: IceCandidate }
  | { kind: 'connected' }
  | { kind: 'failed'; reason: string }
  | { kind: 'hang-up' };

export type Action =
  | { do: 'create-offer' }
  | { do: 'create-answer' }
  | { do: 'rollback' }
  | { do: 'set-remote'; description: SessionDescription }
  | { do: 'add-ice'; candidate: IceCandidate }
  | { do: 'send'; payload: Signal }
  | { do: 'close'; reason: string }
  /** An offer we are entitled to ignore. Surfaced so it can be counted. */
  | { do: 'ignore'; why: string };

/**
 * Who gives way. Both ends compute this from the same two strings and always
 * reach opposite answers, which is the whole trick: no negotiation about who
 * negotiates.
 */
export function politeToward(self: PeerId, other: PeerId): boolean {
  return self < other;
}

export function newPeer(self: PeerId, other: PeerId): PeerState {
  return {
    id: other,
    polite: politeToward(self, other),
    phase: 'idle',
    haveRemote: false,
    pendingIce: [],
    reason: '',
  };
}

const done = (phase: Phase): boolean => phase === 'closed' || phase === 'failed';

/** Apply their description and release any candidates that outran it. */
function acceptRemote(
  state: PeerState,
  description: SessionDescription,
  actions: Action[],
): PeerState {
  actions.push({ do: 'set-remote', description });
  for (const candidate of state.pendingIce) actions.push({ do: 'add-ice', candidate });
  return { ...state, haveRemote: true, pendingIce: [] };
}

/**
 * One step of the contact's setup.
 *
 * Returns the new state and what the wrapper should do about it, in order.
 * Nothing here touches a browser API, so every path — including the two-sided
 * collision that is impossible to provoke on demand in a live test — is
 * reachable from a unit test.
 */
export function negotiate(
  state: PeerState,
  event: NegotiationEvent,
): { state: PeerState; actions: Action[] } {
  const actions: Action[] = [];
  if (done(state.phase) && event.kind !== 'invite') return { state, actions };

  switch (event.kind) {
    case 'invite': {
      if (state.phase === 'connected' || state.phase === 'inviting') return { state, actions };
      actions.push({ do: 'create-offer' });
      return {
        state: { ...state, phase: 'inviting', haveRemote: false, pendingIce: [], reason: '' },
        actions,
      };
    }

    case 'local-description': {
      const payload: Signal = event.description.type === 'offer'
        ? { kind: 'offer', sdp: event.description.sdp }
        : { kind: 'answer', sdp: event.description.sdp };
      actions.push({ do: 'send', payload });
      const phase: Phase = event.description.type === 'answer' ? 'negotiating' : state.phase;
      return { state: { ...state, phase }, actions };
    }

    case 'ice-gathered':
      actions.push({ do: 'send', payload: { kind: 'ice', candidate: event.candidate } });
      return { state, actions };

    case 'signal': {
      const payload = event.payload;

      if (payload.kind === 'bye') {
        actions.push({ do: 'close', reason: payload.reason || 'the other station signed off' });
        return { state: { ...state, phase: 'closed', reason: payload.reason }, actions };
      }

      if (payload.kind === 'ice') {
        // A candidate that arrives before the description it belongs to is
        // normal, not an error: they are sent the moment they are found.
        if (!state.haveRemote) {
          return { state: { ...state, pendingIce: [...state.pendingIce, payload.candidate] }, actions };
        }
        actions.push({ do: 'add-ice', candidate: payload.candidate });
        return { state, actions };
      }

      if (payload.kind === 'answer') {
        if (state.phase !== 'inviting') {
          actions.push({ do: 'ignore', why: 'an answer arrived with no offer outstanding' });
          return { state, actions };
        }
        const next = acceptRemote(state, { type: 'answer', sdp: payload.sdp }, actions);
        return { state: { ...next, phase: 'negotiating' }, actions };
      }

      // An offer. The only interesting case in this whole module.
      const collision = state.phase === 'inviting';
      if (collision && !state.polite) {
        actions.push({ do: 'ignore', why: 'their offer collided with ours and we are impolite' });
        return { state, actions };
      }
      if (collision) actions.push({ do: 'rollback' });
      const next = acceptRemote(state, { type: 'offer', sdp: payload.sdp }, actions);
      actions.push({ do: 'create-answer' });
      return { state: { ...next, phase: 'invited' }, actions };
    }

    case 'connected':
      return { state: { ...state, phase: 'connected' }, actions };

    case 'failed':
      actions.push({ do: 'close', reason: event.reason });
      return { state: { ...state, phase: 'failed', reason: event.reason }, actions };

    case 'hang-up':
      actions.push({ do: 'send', payload: { kind: 'bye', reason: '' } });
      actions.push({ do: 'close', reason: 'you ended the contact' });
      return { state: { ...state, phase: 'closed' }, actions };

    default:
      return { state, actions };
  }
}

/**
 * Plain words for what the member should be told while this is happening.
 *
 * §7's transport findings (see `link.ts`) put an obligation on this layer: a
 * bad connection must never be presented as a bad band. Every string here
 * names the network, never the operator's sending.
 */
export function describePhase(state: PeerState): string {
  switch (state.phase) {
    case 'idle': return 'not connected';
    case 'inviting': return 'calling — waiting for them to answer';
    case 'invited': return 'answering their call';
    case 'negotiating': return 'connecting';
    case 'connected': return 'connected';
    case 'closed': return state.reason ? `contact ended: ${state.reason}` : 'contact ended';
    case 'failed': return `could not connect: ${state.reason || 'the network refused'}`;
    default: return '';
  }
}
