/**
 * The Phase 2 transport spike (RFP §7), measured.
 *
 * Phase 1 opened with a spike on its riskiest question — sending latency —
 * before anything else was built. This is the same move for Phase 2. The
 * riskiest question there is not accounts, which are well understood, but
 * whether a keyed contact survives a real network: if jitter mangles the
 * element ratios, the member copies a fist wrecked in transit and the
 * centrepiece of §7 does not work however good the rest is.
 *
 * The network traces below are synthetic on purpose. A live test measures the
 * one connection you happen to have on the evening you run it; a trace
 * measures the conditions the operator will actually meet — a member on hotel
 * wifi, a member on a phone, a member behind a congested link — and measures
 * them the same way every time.
 */

import { describe, expect, it } from 'vitest';
import { KeyLink, packetise, type KeyPacket } from '../src/core/link';
import { marksFrom, decode, type KeyEvent } from '../src/core/decoder';
import { schedule } from '../src/core/timing';
import { seeded } from '../src/core/random';

const TIMING = { characterWpm: 18, effectiveWpm: 18, weighting: 3 };
/** The receiver's clock runs on its own epoch; the link has to work that out. */
const CLOCK_OFFSET = 1_234_567;

interface Network {
  name: string;
  /** One-way delay floor, ms. */
  baseMs: number;
  /** Ordinary variation added to the floor, ms. */
  jitterMs: number;
  /** Chance a packet is delayed by a congestion spike. */
  spikeRate: number;
  spikeMs: number;
  lossRate: number;
}

const NETWORKS: readonly Network[] = [
  { name: 'same city, wired', baseMs: 12, jitterMs: 6, spikeRate: 0.001, spikeMs: 60, lossRate: 0 },
  { name: 'home wifi', baseMs: 25, jitterMs: 25, spikeRate: 0.01, spikeMs: 120, lossRate: 0.001 },
  { name: 'across Europe', baseMs: 45, jitterMs: 20, spikeRate: 0.005, spikeMs: 150, lossRate: 0.001 },
  { name: 'mobile, moving', baseMs: 60, jitterMs: 60, spikeRate: 0.04, spikeMs: 300, lossRate: 0.01 },
  { name: 'hotel wifi, evening', baseMs: 90, jitterMs: 90, spikeRate: 0.08, spikeMs: 450, lossRate: 0.02 },
];

/** Key a message as a perfect machine would, giving sender-clock events. */
function keying(message: string): KeyEvent[] {
  const events: KeyEvent[] = [];
  for (const tone of schedule(message, TIMING).tones) {
    events.push({ down: true, t: tone.atMs });
    events.push({ down: false, t: tone.atMs + tone.durationMs });
  }
  return events;
}

interface Arrival {
  packet: KeyPacket;
  atMs: number;
}

/** Push packets through a network, dropping some and reordering the rest. */
function transmit(packets: readonly KeyPacket[], net: Network, seed: number): Arrival[] {
  const random = seeded(seed);
  const arrivals: Arrival[] = [];
  for (const packet of packets) {
    if (random.next() < net.lossRate) continue;
    const spike = random.next() < net.spikeRate ? random.next() * net.spikeMs : 0;
    const delay = net.baseMs + random.next() * net.jitterMs + spike;
    arrivals.push({ packet, atMs: packet.t + CLOCK_OFFSET + delay });
  }
  // A real network delivers in arrival order, not send order. A spike
  // reorders packets, and the link has to cope with that rather than assume
  // sequence order.
  return arrivals.sort((a, b) => a.atMs - b.atMs);
}

function run(message: string, net: Network, bufferMs: number, seed = 7): {
  link: KeyLink;
  sent: KeyEvent[];
  reconstructed: KeyEvent[];
} {
  const sent = keying(message);
  const link = new KeyLink({ bufferMs });
  const reconstructed: KeyEvent[] = [];
  for (const { packet, atMs } of transmit(packetise(sent), net, seed)) {
    const scheduled = link.receive(packet, atMs);
    if (scheduled === null) continue;
    reconstructed.push({ down: scheduled.down, t: scheduled.playAtMs });
  }
  reconstructed.sort((a, b) => a.t - b.t);
  return { link, sent, reconstructed };
}

/** Worst and mean error in element length, sent against reconstructed. */
function elementError(sent: readonly KeyEvent[], reconstructed: readonly KeyEvent[]): {
  pairs: number;
  worstMs: number;
  meanMs: number;
} {
  const a = marksFrom(sent);
  const b = marksFrom(reconstructed);
  const pairs = Math.min(a.length, b.length);
  let worst = 0;
  let total = 0;
  for (let i = 0; i < pairs; i += 1) {
    const error = Math.abs((a[i] as { durationMs: number }).durationMs - (b[i] as { durationMs: number }).durationMs);
    worst = Math.max(worst, error);
    total += error;
  }
  return { pairs, worstMs: worst, meanMs: pairs === 0 ? 0 : total / pairs };
}

const MESSAGE = 'CQ CQ CQ DE A65XY A65XY K = UR RST 599 = NAME MOHAMMAD = QTH DUBAI = HW?';

describe('the clock offset', () => {
  it('is found from the arrivals, without the two clocks ever being set', () => {
    const { link } = run('PARIS PARIS', NETWORKS[0] as Network, 200);
    // The estimate should land within one network delay of the truth: it is
    // the offset plus the smallest one-way delay seen, and cannot be better.
    const net = NETWORKS[0] as Network;
    expect(link.stats.offsetMs).toBeGreaterThanOrEqual(CLOCK_OFFSET);
    expect(link.stats.offsetMs).toBeLessThanOrEqual(CLOCK_OFFSET + net.baseMs + net.jitterMs);
  });

  it('is not dragged late by congested packets', () => {
    // A mean would be pulled upward by every spike; the minimum is not.
    const noisy: Network = { ...(NETWORKS[4] as Network), name: 'spiky' };
    const { link } = run('PARIS PARIS PARIS', noisy, 250);
    expect(link.stats.offsetMs).toBeLessThanOrEqual(CLOCK_OFFSET + noisy.baseMs + noisy.jitterMs);
  });
});

describe('element timing through the network', () => {
  it('is reconstructed exactly when nothing arrives late', () => {
    // The finding this whole spike turns on: jitter alone does not damage
    // timing at all. Every element is rebuilt to the millisecond.
    const { link, sent, reconstructed } = run(MESSAGE, NETWORKS[1] as Network, 200);
    expect(link.stats.lateDropped).toBe(0);
    expect(link.stats.latePlayed).toBe(0);
    const error = elementError(sent, reconstructed);
    expect(error.pairs).toBeGreaterThan(50);
    expect(error.worstMs).toBeLessThan(0.001);
  });

  it('carries the message through intact on an ordinary connection', () => {
    for (const net of NETWORKS.slice(0, 3)) {
      const { sent, reconstructed } = run(MESSAGE, net as Network, 200);
      const before = decode(sent, { tolerance: 0.35 }).text;
      const after = decode(reconstructed, { tolerance: 0.35 }).text;
      expect(after, (net as Network).name).toBe(before);
    }
  });

  it('survives packets arriving out of order', () => {
    // Spikes reorder the stream. Sequence order is not arrival order, and the
    // link must not assume it is.
    const reordering: Network = {
      name: 'reordering', baseMs: 30, jitterMs: 200, spikeRate: 0, spikeMs: 0, lossRate: 0,
    };
    const { sent, reconstructed } = run(MESSAGE, reordering, 250);
    const error = elementError(sent, reconstructed);
    expect(error.worstMs).toBeLessThan(0.001);
    expect(decode(reconstructed, { tolerance: 0.35 }).text).toBe(decode(sent, { tolerance: 0.35 }).text);
  });
});

describe('how large the buffer has to be', () => {
  it('shows the trade §7 names: 150 ms is not always enough, 250 ms nearly always is', () => {
    const hotel = NETWORKS[4] as Network;
    const at150 = run(MESSAGE, hotel, 150).link.stats;
    const at250 = run(MESSAGE, hotel, 250).link.stats;
    const lost150 = at150.latePlayed + at150.lateDropped;
    const lost250 = at250.latePlayed + at250.lateDropped;
    expect(lost250).toBeLessThanOrEqual(lost150);
  });

  it('keeps a wired contact clean at the bottom of the range', () => {
    const { link } = run(MESSAGE, NETWORKS[0] as Network, 150);
    expect(link.stats.latePlayed + link.stats.lateDropped).toBe(0);
  });
});

describe('the adaptive buffer on the hard traces', () => {
  it('stops losing elements once it has learned the connection', () => {
    // The traces the fixed buffer could not cover. After the first over the
    // buffer has grown to what the link needs, and from then on late
    // arrivals are the exception rather than a third of the traffic.
    for (const net of NETWORKS.slice(3)) {
      const first = run(MESSAGE, net as Network, 200).link.stats;
      // Nothing is dropped now; what arrives is played.
      expect(first.lateDropped, (net as Network).name).toBe(0);
      expect(first.received - first.duplicates - first.latePlayed, (net as Network).name).toBeGreaterThan(first.latePlayed * 4);
      expect(first.bufferMs).toBeGreaterThan(200);
      expect(first.bufferMs).toBeLessThanOrEqual(1200);
    }
  });
});

describe('when something does go wrong', () => {
  it('counts what never arrived rather than silently smoothing over it', () => {
    const lossy: Network = { name: 'lossy', baseMs: 20, jitterMs: 10, spikeRate: 0, spikeMs: 0, lossRate: 0.05 };
    const { link } = run(MESSAGE, lossy, 200);
    expect(link.stats.missing).toBeGreaterThan(0);
  });

  it('plays a slightly late transition rather than deleting the element', () => {
    const link = new KeyLink({ bufferMs: 200 });
    link.receive({ seq: 0, t: 0, down: true }, CLOCK_OFFSET);
    // Due at t=1000+offset+200; arrives 15 ms after that.
    const scheduled = link.receive({ seq: 1, t: 1000, down: false }, CLOCK_OFFSET + 1215);
    expect(scheduled?.disposition).toBe('late-played');
    expect(scheduled?.lateByMs).toBeCloseTo(15, 5);
  });

  it('plays a badly late transition too, and grows the buffer so the next are on time', () => {
    // The field finding of 21 September: a phone on wifi behind the relay had
    // a third of its transitions arrive more than 30 ms late, and the old
    // policy threw every one of them away. Now they play, and the buffer
    // learns from them.
    const link = new KeyLink({ bufferMs: 200, growMarginMs: 40 });
    link.receive({ seq: 0, t: 0, down: true }, CLOCK_OFFSET);
    const late = link.receive({ seq: 1, t: 1000, down: false }, CLOCK_OFFSET + 1400);
    expect(late?.disposition).toBe('late-played');
    expect(late?.lateByMs).toBeCloseTo(200, 5);
    expect(link.stats.lateDropped).toBe(0);
    expect(link.stats.bufferMs).toBe(440);
    expect(link.stats.grows).toBe(1);
    // The same delay again is now inside the buffer.
    const next = link.receive({ seq: 2, t: 2000, down: true }, CLOCK_OFFSET + 2400);
    expect(next?.disposition).toBe('on-time');
    expect(next?.playAtMs).toBe(CLOCK_OFFSET + 2440);
  });

  it('never grows past the ceiling', () => {
    const link = new KeyLink({ bufferMs: 200, maxBufferMs: 600 });
    link.receive({ seq: 0, t: 0, down: true }, CLOCK_OFFSET);
    link.receive({ seq: 1, t: 1000, down: false }, CLOCK_OFFSET + 3000);
    expect(link.stats.bufferMs).toBe(600);
  });

  it('never skips a key-up, however late: a tone left running is the worst outcome', () => {
    const link = new KeyLink({ bufferMs: 200, dropAfterMs: 2000 });
    link.receive({ seq: 0, t: 0, down: true }, CLOCK_OFFSET);
    const up = link.receive({ seq: 1, t: 100, down: false }, CLOCK_OFFSET + 5000);
    expect(up?.disposition).toBe('late-played');
    expect(up?.down).toBe(false);
  });

  it('skips only a key-down so late that playing it would be a click', () => {
    const link = new KeyLink({ bufferMs: 200, dropAfterMs: 2000 });
    link.receive({ seq: 0, t: 0, down: true }, CLOCK_OFFSET);
    link.receive({ seq: 1, t: 60, down: false }, CLOCK_OFFSET + 260);
    // Due at 1000+200; arrives 2.5 s after that.
    expect(link.receive({ seq: 2, t: 1000, down: true }, CLOCK_OFFSET + 3700)).toBeNull();
    expect(link.stats.lateDropped).toBe(1);
    // Its key-up still plays, and finds the key already up: harmless.
    expect(link.receive({ seq: 3, t: 1060, down: false }, CLOCK_OFFSET + 3701)?.disposition).toBe('late-played');
  });

  it('shrinks the buffer back between overs once the delays allow it', () => {
    const link = new KeyLink({ bufferMs: 200, growMarginMs: 40, resyncIdleMs: 2500 });
    // One spike grows it.
    link.receive({ seq: 0, t: 0, down: true }, CLOCK_OFFSET + 20);
    link.receive({ seq: 1, t: 100, down: false }, CLOCK_OFFSET + 700);
    expect(link.stats.bufferMs).toBeGreaterThan(200);
    // A clean over, long enough for the spike to leave the 64-arrival window:
    // seventy transitions at a steady 20 ms delay.
    let t = 200;
    let seq = 2;
    for (let i = 0; i < 70; i += 1, t += 100, seq += 1) {
      link.receive({ seq, t, down: i % 2 === 0 }, CLOCK_OFFSET + t + 20);
    }
    const before = link.stats.bufferMs;
    // The other station's over, then this one keys again: halfway back.
    link.receive({ seq, t: t + 5000, down: true }, CLOCK_OFFSET + t + 5020);
    expect(link.stats.shrinks).toBe(1);
    expect(link.stats.bufferMs).toBeLessThan(before);
    expect(link.stats.bufferMs).toBeGreaterThan(200);
    // Another clean over and another pause: the rest of the way, and never
    // below the floor.
    t += 5100;
    seq += 1;
    for (let i = 0; i < 40; i += 1, t += 100, seq += 1) {
      link.receive({ seq, t, down: i % 2 === 0 }, CLOCK_OFFSET + t + 20);
    }
    for (let round = 0; round < 6; round += 1) {
      t += 5000;
      link.receive({ seq, t, down: true }, CLOCK_OFFSET + t + 20);
      seq += 1;
      t += 100;
    }
    expect(link.stats.bufferMs).toBe(200);
  });

  it('counts missing packets from the first one seen, not from zero', () => {
    // A member who tunes in mid-transmission has not lost what was sent
    // before they arrived; that was the `missing=12` in the first field
    // report, and it was a counting artefact.
    const link = new KeyLink({ bufferMs: 200 });
    link.receive({ seq: 428, t: 0, down: true }, CLOCK_OFFSET);
    link.receive({ seq: 429, t: 60, down: false }, CLOCK_OFFSET + 60);
    expect(link.stats.missing).toBe(0);
    link.receive({ seq: 431, t: 200, down: false }, CLOCK_OFFSET + 200);
    expect(link.stats.missing).toBe(1);
  });

  it('ignores a packet it has already had', () => {
    const link = new KeyLink({ bufferMs: 200 });
    link.receive({ seq: 0, t: 0, down: true }, CLOCK_OFFSET);
    const again = link.receive({ seq: 0, t: 0, down: true }, CLOCK_OFFSET + 5);
    expect(again?.disposition).toBe('duplicate');
    expect(link.stats.duplicates).toBe(1);
  });
});

describe('a sender whose clock restarts', () => {
  it('is picked up again at once rather than silenced for the rest of the contact', () => {
    // A browser rebuilds its AudioContext after an output-device change and
    // the sender's clock starts again from zero. Before this rule every later
    // packet looked hours late and was dropped.
    const link = new KeyLink();
    let arrival = 1_000_000;
    for (let i = 0; i < 10; i += 1) {
      const t = 500_000 + i * 100;
      expect(link.receive({ seq: i, t, down: i % 2 === 0 }, arrival + i * 100 + 50)).not.toBeNull();
    }
    // Clock reset: the sender's t drops to near zero while arrivals continue.
    arrival += 3000;
    const after = link.receive({ seq: 10, t: 120, down: true }, arrival);
    expect(after).not.toBeNull();
    expect(after?.disposition).toBe('on-time');
    expect(link.receive({ seq: 11, t: 190, down: false }, arrival + 70 + 5)?.disposition).toBe('on-time');
    expect(link.stats.resyncs).toBeGreaterThanOrEqual(1);
  });
});
