/**
 * One contact's data channel (RFP §7).
 *
 * Wraps an RTCPeerConnection and does exactly what src/core/signalling.ts's
 * negotiate() tells it, action by action. The decisions — who gives way on a
 * collision, what to do with an ICE candidate that arrived early — are all in
 * that pure module and its tests; this file is the hands.
 *
 * The data channel is RELIABLE and ORDERED, which is SCTP's default and the
 * transport spike's first finding: a lost key-up leaves a tone running, so
 * loss must be repaired, and a retransmission fits inside the play-out buffer.
 */

import {
  negotiate, newPeer, describePhase,
  type Action, type IceServer, type IcePolicy, type NegotiationEvent, type PeerState, type Signal,
} from '../core/signalling';
import type { KeyPacket } from '../core/link';

export interface ContactOptions {
  selfId: string;
  peerId: string;
  ice: IceServer[];
  icePolicy: IcePolicy;
  /** Send a signal to the other side, via the server. */
  signal: (payload: Signal) => void;
  onPacket: (packet: KeyPacket) => void;
  onPhase: (state: PeerState, words: string) => void;
  onLog?: (line: string) => void;
}

const CHANNEL = 'key';

export class Contact {
  private state: PeerState;
  private readonly pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private closed = false;

  constructor(private readonly options: ContactOptions) {
    this.state = newPeer(options.selfId, options.peerId);
    this.pc = new RTCPeerConnection({
      iceServers: options.ice,
      iceTransportPolicy: options.icePolicy,
    });

    this.pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        const c = event.candidate;
        this.step({ kind: 'ice-gathered', candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex } });
      }
    });
    this.pc.addEventListener('connectionstatechange', () => {
      const s = this.pc.connectionState;
      this.options.onLog?.(`connection ${s}`);
      if (s === 'connected') this.step({ kind: 'connected' });
      else if (s === 'failed') this.step({ kind: 'failed', reason: 'the network refused the connection' });
      else if (s === 'disconnected' || s === 'closed') {
        if (!this.closed) this.step({ kind: 'failed', reason: 'the connection dropped' });
      }
    });
    // The answering side receives the channel the caller created.
    this.pc.addEventListener('datachannel', (event) => this.adopt(event.channel));
  }

  /** We are calling them. */
  invite(): void {
    this.adopt(this.pc.createDataChannel(CHANNEL, { ordered: true }));
    this.step({ kind: 'invite' });
  }

  /** Something arrived from them via the server. */
  receive(payload: Signal): void {
    this.step({ kind: 'signal', payload });
  }

  hangUp(): void {
    this.step({ kind: 'hang-up' });
  }

  /**
   * One key transition, on the sender's audio clock. `seq` is the SAME
   * number the transition carries on the server path, so that a receiver
   * fed by both routes sees one stream with duplicates, not two streams
   * whose numbers collide.
   */
  sendKey(seq: number, t: number, down: boolean): boolean {
    if (this.channel === null || this.channel.readyState !== 'open') return false;
    const packet: KeyPacket = { seq, t, down };
    this.channel.send(JSON.stringify(packet));
    return true;
  }

  get phase(): PeerState['phase'] {
    return this.state.phase;
  }

  get open(): boolean {
    return this.channel !== null && this.channel.readyState === 'open' && this.state.phase === 'connected';
  }

  private adopt(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const raw = JSON.parse(event.data) as unknown;
        if (typeof raw === 'object' && raw !== null) {
          const p = raw as Record<string, unknown>;
          if (typeof p['seq'] === 'number' && typeof p['t'] === 'number' && typeof p['down'] === 'boolean') {
            this.options.onPacket({ seq: p['seq'], t: p['t'], down: p['down'] });
          }
        }
      } catch {
        /* not ours; ignore */
      }
    });
  }

  private step(event: NegotiationEvent): void {
    const { state, actions } = negotiate(this.state, event);
    this.state = state;
    this.options.onPhase(state, describePhase(state));
    void this.perform(actions);
  }

  private async perform(actions: Action[]): Promise<void> {
    for (const action of actions) {
      try {
        switch (action.do) {
          case 'create-offer': {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            this.step({ kind: 'local-description', description: { type: 'offer', sdp: offer.sdp ?? '' } });
            break;
          }
          case 'rollback':
            await this.pc.setLocalDescription({ type: 'rollback' });
            break;
          case 'set-remote':
            await this.pc.setRemoteDescription(action.description);
            break;
          case 'create-answer': {
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.step({ kind: 'local-description', description: { type: 'answer', sdp: answer.sdp ?? '' } });
            break;
          }
          case 'add-ice':
            await this.pc.addIceCandidate(action.candidate);
            break;
          case 'send':
            this.options.signal(action.payload);
            break;
          case 'close':
            this.closed = true;
            this.channel?.close();
            this.pc.close();
            break;
          case 'ignore':
            this.options.onLog?.(`ignored: ${action.why}`);
            break;
          default:
            break;
        }
      } catch (error) {
        this.options.onLog?.(`${action.do} failed: ${String(error instanceof Error ? error.message : error)}`);
        if (action.do !== 'add-ice') this.step({ kind: 'failed', reason: 'the browser could not set up the connection' });
      }
    }
  }
}
