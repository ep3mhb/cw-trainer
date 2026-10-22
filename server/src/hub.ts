/**
 * The band, as the server sees it (RFP §7).
 *
 * One Hub holds every connected member: where they are on the band, whether
 * their key is down, who they are in a contact with. It speaks the protocol
 * in src/core/signalling.ts — the same file the browser uses, so the two ends
 * cannot disagree about a message — and it does four things:
 *
 *   1. Admits a member (hello → welcome, with TURN credentials minted for
 *      this session) and tells everyone the band changed.
 *   2. Fans key transitions out to everyone else, so a member tuning across
 *      the band HEARS a CQ before choosing to answer. This is what makes it a
 *      band rather than a list: the audio of an unanswered call reaches
 *      every receiver in range, at the pitch their own dial gives it. Once
 *      two members connect, their contact runs peer to peer over the data
 *      channel and the fan-out is ambience for everyone else.
 *   3. Relays offer/answer/ICE between two members, and logs the contact
 *      that results — start on the answer, end on bye or disconnect — for
 *      both sides, marked exportable or not by callsign.ts.
 *   4. Enforces: one connection per member, a clear frequency to call CQ on,
 *      a message rate a human could produce, silence for a muted member,
 *      and administrators-only for moderation.
 *
 * Pure with respect to transport: it is handed something with send() and
 * close(), and it never imports ws. That is what lets every branch here be
 * unit-tested against fake sockets, including the ones — a member removed
 * mid-contact, a second login kicking the first — that a live test would
 * struggle to stage.
 */

import { randomBytes } from 'node:crypto';
import {
  PROTOCOL_VERSION, encode, parseClientMessage,
  type ClientMessage, type ErrorCode, type PeerId, type ServerMessage, type Signal,
} from '../../src/core/signalling';
import { DEFAULT_BAND_PLAN, isClear, snap, type BandPlan, type Station } from '../../src/core/tuning';
import { exportableAsQso } from '../../src/core/callsign';
import { SLOW_BUFFER_MS } from '../../src/core/link';
import type { Member, Store } from './store';
import type { Config } from './config';
import { iceServersFor, mintTurnCredential } from './turn';
import { tokenHash } from './auth';

export interface Socket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

export interface HubDeps {
  /** Milliseconds; injected so tests can drive time. */
  now?: () => number;
  /** 0–1; injected so tests are deterministic. */
  random?: () => number;
  plan?: BandPlan;
  log?: (line: string) => void;
}

interface Peer {
  id: PeerId;
  member: Member;
  socket: Socket;
  frequencyHz: number | null;
  calling: boolean;
  transmitting: boolean;
  strength: number;
  /** The peer we are in a contact with, once an answer has been relayed. */
  partner: PeerId | null;
  contactId: number | null;
  /** Arrival times of recent messages, for the rate limit. */
  recent: number[];
  recentKeys: number[];
  /** Per-connection counters, written to the journal when the member leaves. */
  tally: { keys: number; signals: number; ice: number; rateLimited: number; spots: number; joinedAt: number };
}

/** Ordinary messages a second. A human on a keyboard does not reach this. */
const RATE_LIMIT = 20;
/** Key transitions a second. 60 WPM is about 30; this leaves room for a bounce. */
const KEY_RATE_LIMIT = 60;
const RATE_WINDOW_MS = 1000;
/** A muted member stays muted this long. */
export const MUTE_MS = 24 * 3600 * 1000;

export class Hub {
  private readonly peers = new Map<PeerId, Peer>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly plan: BandPlan;
  private readonly log: (line: string) => void;

  constructor(
    private readonly store: Store,
    private readonly config: Config,
    deps: HubDeps = {},
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? Math.random;
    this.plan = deps.plan ?? DEFAULT_BAND_PLAN;
    this.log = deps.log ?? (() => undefined);
  }

  /** How many members are on the band right now. */
  get size(): number {
    return this.peers.size;
  }

  /** The band as a list, for a `band` message. */
  stations(): Station[] {
    const out: Station[] = [];
    for (const p of this.peers.values()) {
      if (p.frequencyHz === null) continue;
      const pr = p.member.profile;
      const about = {
        name: p.member.name,
        ...(pr.qth ? { qth: pr.qth } : {}), ...(pr.grid ? { grid: pr.grid } : {}),
        ...(pr.rig ? { rig: pr.rig } : {}), ...(pr.antenna ? { antenna: pr.antenna } : {}),
        ...(pr.licence ? { licence: pr.licence } : {}),
      };
      out.push({
        id: p.id, callsign: p.member.callsign, frequencyHz: p.frequencyHz,
        strength: p.strength, transmitting: p.transmitting, calling: p.calling,
        ...(p.member.verified ? {} : { unconfirmed: true }),
        about,
      });
    }
    return out.sort((a, b) => a.frequencyHz - b.frequencyHz);
  }

  /**
   * A socket connected. Returns the handlers the transport should wire up.
   * Nothing is known about who this is until they say hello.
   */
  attach(socket: Socket): { receive: (text: string) => Promise<void>; close: () => Promise<void> } {
    let peer: Peer | null = null;
    return {
      receive: async (text) => {
        const message = parseClientMessage(safeParse(text));
        if (!message) {
          this.send(socket, { kind: 'error', code: 'bad-message', detail: 'not understood' });
          return;
        }
        if (peer === null) {
          if (message.kind !== 'hello') {
            this.send(socket, { kind: 'error', code: 'not-authorised', detail: 'say hello first' });
            socket.close(4001, 'hello first');
            return;
          }
          peer = await this.admit(socket, message);
          return;
        }
        await this.handle(peer, message);
      },
      close: async () => {
        if (peer) await this.depart(peer, 'connection closed');
      },
    };
  }

  private async admit(socket: Socket, hello: Extract<ClientMessage, { kind: 'hello' }>): Promise<Peer | null> {
    if (hello.v !== PROTOCOL_VERSION) {
      this.refuse(socket, 'version', `server speaks v${String(PROTOCOL_VERSION)}`);
      return null;
    }
    const member = await this.store.memberBySession(tokenHash(hello.token), new Date(this.now()));
    if (!member || member.removed) {
      this.refuse(socket, 'not-authorised', 'sign in again');
      return null;
    }

    // One connection per member. The newer one wins: a member whose laptop
    // went to sleep and who reconnects from their phone should not be told
    // they are already here.
    for (const existing of this.peers.values()) {
      if (existing.member.id === member.id) {
        await this.depart(existing, 'signed in elsewhere');
        existing.socket.close(4002, 'signed in elsewhere');
      }
    }

    const peer: Peer = {
      id: randomBytes(8).toString('hex'),
      member, socket,
      frequencyHz: null, calling: false, transmitting: false,
      // Assigned here so both ends of a contact agree how strong each other
      // is; a member is a 5-and-something all evening rather than a coin
      // flip per listener.
      strength: 0.55 + this.random() * 0.45,
      partner: null, contactId: null, recent: [], recentKeys: [],
      tally: { keys: 0, signals: 0, ice: 0, rateLimited: 0, spots: 0, joinedAt: this.now() },
    };
    this.peers.set(peer.id, peer);
    void this.store.touch(member.id);

    const credential = mintTurnCredential(
      this.config.turnSecret, this.config.turnTtlS, Math.floor(this.now() / 1000), member.callsign,
    );
    this.send(socket, {
      kind: 'welcome', v: PROTOCOL_VERSION, you: peer.id, callsign: member.callsign, role: member.role,
      training: member.training,
      ice: iceServersFor(this.config.turnUri, credential),
      icePolicy: this.config.icePolicy,
    });
    this.broadcastBand();
    this.log(`${member.callsign} joined (${peer.id})`);
    return peer;
  }

  private async handle(peer: Peer, message: ClientMessage): Promise<void> {
    if (!this.withinRate(peer, message.kind === 'key')) {
      peer.tally.rateLimited += 1;
      if (peer.tally.rateLimited === 1 || peer.tally.rateLimited % 100 === 0) {
        this.log(`rate-limited ${peer.member.callsign} (${message.kind}) x${String(peer.tally.rateLimited)}`);
      }
      this.send(peer.socket, { kind: 'error', code: 'rate-limited', detail: 'slow down' });
      return;
    }

    const muted = peer.member.mutedUntil !== null && peer.member.mutedUntil.getTime() > this.now();
    if (muted && (message.kind === 'spot' || message.kind === 'key' || message.kind === 'signal')) {
      this.send(peer.socket, { kind: 'error', code: 'muted', detail: 'an administrator has muted you' });
      return;
    }

    switch (message.kind) {
      case 'hello':
        // Already admitted; a second hello is noise.
        return;

      case 'spot': {
        // An administrator may have confirmed (or disabled) this member since
        // they said hello. Re-read before they go on the band, so the mark on
        // their callsign is current without a sign-out.
        const fresh = await this.store.memberById(peer.member.id);
        if (fresh) peer.member = fresh;
        if (peer.member.removed) {
          this.send(peer.socket, { kind: 'error', code: 'not-authorised', detail: 'your account has been disabled' });
          peer.socket.close(4003, 'disabled');
          return;
        }
        const hz = snap(message.frequencyHz, this.plan);
        // Calling CQ needs a clear spot. Tuning onto someone to ANSWER them is
        // the opposite of that and is always allowed — that is how a contact
        // starts. So the guard applies to callers only, and not against
        // yourself.
        if (message.calling) {
          const others = this.stations().filter((s) => s.id !== peer.id);
          if (!isClear(hz, others, this.plan)) {
            this.send(peer.socket, { kind: 'error', code: 'band-full', detail: 'someone is close to that frequency' });
            return;
          }
        }
        if (peer.frequencyHz === hz && peer.calling === message.calling) return;
        peer.frequencyHz = hz;
        peer.calling = message.calling;
        peer.tally.spots += 1;
        this.log(`spot ${peer.member.callsign} ${String(hz)} Hz${message.calling ? ' calling CQ' : ''}`);
        this.broadcastBand();
        return;
      }

      case 'key': {
        if (peer.frequencyHz === null) return; // not on the band; nobody can hear it
        peer.tally.keys += 1;
        const changed = peer.transmitting !== message.down;
        peer.transmitting = message.down;
        // Everyone else hears it — INCLUDING members who have not announced a
        // frequency of their own. Listening is passive; a member who signs in
        // and turns the dial is on the band as surely as one calling CQ, and
        // their tuning.ts decides what is audible. (Until 21 September 2026
        // this skipped unspotted members, and a listener who had not pressed
        // anything heard nothing while the caller keyed into the void.)
        const out: ServerMessage = { kind: 'keying', peer: peer.id, seq: message.seq, t: message.t, down: message.down };
        for (const other of this.peers.values()) {
          if (other.id !== peer.id) this.send(other.socket, out);
        }
        if (changed) this.broadcastBand();
        return;
      }

      case 'signal': {
        const target = this.peers.get(message.to);
        if (!target) {
          this.send(peer.socket, { kind: 'error', code: 'no-such-peer', detail: 'they have left the band' });
          return;
        }
        const targetMuted = target.member.mutedUntil !== null && target.member.mutedUntil.getTime() > this.now();
        if (targetMuted) {
          this.send(peer.socket, { kind: 'error', code: 'no-such-peer', detail: 'that station is not available' });
          return;
        }
        this.send(target.socket, { kind: 'signal', from: peer.id, payload: message.payload });
        if (message.payload.kind === 'ice') peer.tally.ice += 1;
        else {
          peer.tally.signals += 1;
          this.log(`signal ${message.payload.kind} ${peer.member.callsign} -> ${target.member.callsign}`
            + (message.payload.kind === 'bye' && message.payload.reason ? ` (${message.payload.reason})` : ''));
        }
        await this.trackContact(peer, target, message.payload);
        return;
      }

      case 'link': {
        // The receiver's own account of what it heard. Logged, not stored:
        // the journal is the review tool for now, and it costs nothing.
        const about = this.peers.get(message.peer);
        const who = about ? about.member.callsign : `gone(${message.peer.slice(0, 6)})`;
        // A buffer this large means the connection, not the sending, is
        // what the member is hearing; flag it the same way as a loss.
        const trouble = message.lateDropped + message.missing + (message.bufferMs >= SLOW_BUFFER_MS ? 1 : 0);
        this.log(
          `link ${peer.member.callsign} hears ${who}: received=${String(message.received)}`
          + ` late=${String(message.latePlayed)} skipped=${String(message.lateDropped)} missing=${String(message.missing)}`
          + ` buffer=${String(message.bufferMs)}ms`
          + ` offset=${String(message.offsetMs)}ms resyncs=${String(message.resyncs)} playing=${String(message.playingHz)}Hz`
          + (trouble > 0 ? ' TROUBLE' : '')
          + ` agent="${message.agent}"`,
        );
        return;
      }

      case 'report': {
        const about = this.peers.get(message.about);
        if (!about) return;
        await this.store.addReport({
          byId: peer.member.id, aboutId: about.member.id, reason: message.reason, transcript: message.transcript,
        });
        this.log(`report by ${peer.member.callsign} about ${about.member.callsign}`);
        return;
      }

      case 'moderate': {
        if (peer.member.role !== 'admin') {
          this.send(peer.socket, { kind: 'error', code: 'not-authorised', detail: 'administrators only' });
          return;
        }
        const target = this.peers.get(message.peer);
        if (!target) {
          this.send(peer.socket, { kind: 'error', code: 'no-such-peer', detail: 'they have left the band' });
          return;
        }
        await this.store.logModeration(peer.member.id, target.member.id, message.action, message.reason);
        if (message.action === 'mute') {
          const until = new Date(this.now() + MUTE_MS);
          target.member.mutedUntil = until;
          await this.store.setMuted(target.member.id, until);
          target.transmitting = false;
        } else {
          target.member.removed = true;
          await this.store.setRemoved(target.member.id, true);
          await this.store.deleteSessionsFor(target.member.id);
        }
        this.broadcast({ kind: 'moderated', peer: target.id, action: message.action === 'mute' ? 'muted' : 'removed', by: peer.member.callsign });
        if (message.action === 'remove') {
          await this.depart(target, 'removed by an administrator');
          target.socket.close(4003, 'removed');
        } else {
          this.broadcastBand();
        }
        this.log(`${peer.member.callsign} ${message.action}d ${target.member.callsign}: ${message.reason}`);
        return;
      }

      case 'leave':
        await this.depart(peer, 'left');
        peer.socket.close(1000, 'bye');
        return;

      case 'ping':
        this.send(peer.socket, { kind: 'pong', t: message.t });
        return;

      default:
        return;
    }
  }

  /**
   * A contact exists from the moment an answer is relayed until a bye is, or
   * until either side disconnects. The log row is written for both members
   * at once (§7: "both sides receive the contact in their log"), and marked
   * exportable only when neither is a training identifier.
   */
  private async trackContact(from: Peer, to: Peer, payload: Signal): Promise<void> {
    if (payload.kind === 'answer' && from.partner === null && to.partner === null) {
      // In the log, "a" is the station that was calling CQ and "b" the one
      // who answered it — radio roles, not WebRTC roles. Which browser sent
      // the offer is an accident of who clicked first and of glare, and a
      // member reading their log should not have to know that.
      const [a, b] = to.calling && !from.calling ? [to, from]
        : from.calling && !to.calling ? [from, to]
        : [to, from];
      const frequencyHz = a.frequencyHz ?? b.frequencyHz ?? this.plan.startHz;
      const contactId = await this.store.startContact({
        aId: a.member.id, bId: b.member.id,
        aCallsign: a.member.callsign, bCallsign: b.member.callsign,
        frequencyHz,
        // Exportable only when both callsigns are real (not training) and
        // both have been confirmed by an administrator (§8).
        exportable: exportableAsQso(a.member.callsign, b.member.callsign) && a.member.verified && b.member.verified,
      });
      from.partner = to.id; to.partner = from.id;
      from.contactId = contactId; to.contactId = contactId;
      from.calling = false; to.calling = false;
      this.broadcastBand();
      this.log(`contact ${String(contactId)}: ${to.member.callsign} <> ${from.member.callsign}`);
    }
    if (payload.kind === 'bye') await this.endContactOf(from);
  }

  private async endContactOf(peer: Peer): Promise<void> {
    if (peer.contactId === null) return;
    await this.store.endContact(peer.contactId);
    const partner = peer.partner ? this.peers.get(peer.partner) : undefined;
    if (partner) { partner.partner = null; partner.contactId = null; }
    peer.partner = null; peer.contactId = null;
  }

  private async depart(peer: Peer, why: string): Promise<void> {
    if (!this.peers.has(peer.id)) return;
    // Tell the partner first, so their side ends cleanly rather than waiting
    // out an ICE timeout with a tone stuck on.
    const partner = peer.partner ? this.peers.get(peer.partner) : undefined;
    if (partner) this.send(partner.socket, { kind: 'signal', from: peer.id, payload: { kind: 'bye', reason: why } });
    await this.endContactOf(peer);
    this.peers.delete(peer.id);
    this.broadcast({ kind: 'gone', peer: peer.id });
    this.broadcastBand();
    const t = peer.tally;
    const seconds = Math.round((this.now() - t.joinedAt) / 1000);
    this.log(
      `${peer.member.callsign} left: ${why} (on band ${String(seconds)}s, keys=${String(t.keys)}`
      + ` spots=${String(t.spots)} signals=${String(t.signals)} ice=${String(t.ice)} rate-limited=${String(t.rateLimited)})`,
    );
  }

  private withinRate(peer: Peer, isKey: boolean): boolean {
    const now = this.now();
    const bucket = isKey ? peer.recentKeys : peer.recent;
    const limit = isKey ? KEY_RATE_LIMIT : RATE_LIMIT;
    while (bucket.length > 0 && (bucket[0] as number) <= now - RATE_WINDOW_MS) bucket.shift();
    if (bucket.length >= limit) return false;
    bucket.push(now);
    return true;
  }

  private refuse(socket: Socket, code: ErrorCode, detail: string): void {
    this.send(socket, { kind: 'error', code, detail });
    socket.close(4000, code);
  }

  private send(socket: Socket, message: ServerMessage): void {
    try {
      socket.send(encode(message));
    } catch {
      // A socket that is closing throws; the close handler tidies up.
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const p of this.peers.values()) this.send(p.socket, message);
  }

  private broadcastBand(): void {
    this.broadcast({ kind: 'band', stations: this.stations() });
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
