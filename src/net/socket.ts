/**
 * The band connection (RFP §7): one WebSocket to the server.
 *
 * Speaks src/core/signalling.ts — the same module the server speaks — so
 * every message in either direction is parsed by the same code. What arrives
 * unparseable is dropped and counted, never acted on.
 *
 * Reconnects by itself with a growing pause, EXCEPT when the server said the
 * session is not authorised or the member was removed: those are answers,
 * not outages, and retrying would only hammer the server with the same
 * refused token.
 */

import {
  DEAD_MS, PING_MS, PROTOCOL_VERSION, decodeServerMessage, encode,
  type ClientMessage, type ServerMessage,
} from '../core/signalling';
import { wsUrl } from './config';

export type SocketState = 'closed' | 'connecting' | 'open' | 'refused';

export interface BandSocketOptions {
  token: string;
  onMessage: (message: ServerMessage) => void;
  onState: (state: SocketState, detail: string) => void;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

export class BandSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: number | null = null;
  private wanted = true;
  private dropped = 0;
  /** Heartbeat: when anything last arrived, and the ping timer. */
  private lastHeardMs = 0;
  private pingTimer: number | null = null;
  /** Round trip of the last answered ping, in ms; 0 until one has. */
  rttMs = 0;
  /** Why we closed the socket ourselves, for the retry message. */
  private closeReason: string | null = null;
  state: SocketState = 'closed';

  constructor(private readonly options: BandSocketOptions) {}

  connect(): void {
    this.wanted = true;
    this.open();
  }

  private open(): void {
    if (this.ws !== null) return;
    this.set('connecting', this.attempt === 0 ? 'connecting' : `reconnecting (try ${String(this.attempt + 1)})`);
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleRetry('could not open a connection');
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.send({ kind: 'hello', v: PROTOCOL_VERSION, token: this.options.token });
    });
    ws.addEventListener('message', (event) => {
      const message = decodeServerMessage(typeof event.data === 'string' ? event.data : '');
      if (!message) {
        this.dropped += 1;
        return;
      }
      this.lastHeardMs = performance.now();
      if (message.kind === 'welcome') {
        this.attempt = 0;
        this.set('open', 'on the band');
        this.startHeartbeat();
      }
      if (message.kind === 'pong') {
        this.rttMs = Math.max(0, Math.round(performance.now() - message.t));
        return;
      }
      if (message.kind === 'error' && (message.code === 'not-authorised' || message.code === 'version')) {
        // An answer, not an outage.
        this.wanted = false;
        this.set('refused', message.detail || message.code);
      }
      this.options.onMessage(message);
    });
    ws.addEventListener('close', (event) => {
      this.ws = null;
      this.stopHeartbeat();
      if (event.code === 4003) {
        this.wanted = false;
        this.set('refused', 'removed by an administrator');
        return;
      }
      if (event.code === 4002) {
        this.wanted = false;
        this.set('refused', 'signed in from another device');
        return;
      }
      const why = this.closeReason ?? (event.reason || 'connection lost');
      this.closeReason = null;
      if (this.wanted) this.scheduleRetry(why);
      else if (this.state !== 'refused') this.set('closed', 'disconnected');
    });
    ws.addEventListener('error', () => {
      // 'close' follows and carries the retry.
    });
  }

  private scheduleRetry(why: string): void {
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] as number;
    this.attempt += 1;
    this.set('closed', `${why} — retrying in ${String(Math.round(delay / 1000))} s`);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.wanted) this.open();
    }, delay);
  }

  /**
   * Every PING_MS send a ping; if nothing at all has arrived for DEAD_MS,
   * the socket is dead whatever readyState says (a phone that lost its
   * radio keeps the object open for a minute or more). Close it so the
   * ordinary retry takes over — and the member sees "reconnecting" within
   * seconds instead of a band that quietly stopped moving.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastHeardMs = performance.now();
    this.pingTimer = window.setInterval(() => {
      if (this.ws === null) return;
      if (performance.now() - this.lastHeardMs > DEAD_MS) {
        // Closing runs the ordinary 'close' handler, which retries; the
        // reason is remembered so the status says what happened.
        this.closeReason = 'the server went quiet';
        this.stopHeartbeat();
        try { this.ws.close(4000, 'no heartbeat'); } catch { /* already gone */ }
        return;
      }
      this.send({ kind: 'ping', t: performance.now() });
    }, PING_MS);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /**
   * Try again now rather than at the end of the backoff. Called when the
   * page comes back to the foreground: a phone that was locked has usually
   * had its socket killed, and the member is looking at the screen again.
   */
  nudge(): void {
    if (!this.wanted || this.ws !== null) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.open();
  }

  send(message: ClientMessage): boolean {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(encode(message));
    return true;
  }

  get droppedMessages(): number {
    return this.dropped;
  }

  close(): void {
    this.wanted = false;
    this.stopHeartbeat();
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.ws !== null) {
      this.send({ kind: 'leave' });
      this.ws.close(1000, 'leaving');
      this.ws = null;
    }
    this.set('closed', 'left the band');
  }

  private set(state: SocketState, detail: string): void {
    this.state = state;
    this.options.onState(state, detail);
  }
}
