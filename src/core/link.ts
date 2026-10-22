/**
 * The transport for live contacts (RFP §7), as a pure module.
 *
 * §7 settles the shape of it: "send keying events, not audio. The client
 * transmits key-down and key-up timestamps over a WebRTC data channel. Each
 * receiving browser generates the tone locally." What it leaves open is
 * whether the result is copyable, and that is the question Phase 2 turns on.
 * A contact where the network chews the element ratios is not a contact: the
 * member copies a fist wrecked in transit rather than the one that was sent,
 * and every habit the course builds is being taught against.
 *
 * The answer has a shape worth stating plainly, because it is not obvious and
 * it decides the whole design:
 *
 *   Jitter does not damage timing. Lateness does.
 *
 * Every transition carries the SENDER'S clock reading. The receiver works out
 * the offset between the two clocks, adds a fixed play-out delay, and
 * schedules each tone on its own audio clock at sender-time plus offset plus
 * delay. A packet that arrives early, or varies by 40 ms from the one before,
 * still plays at exactly the right instant: the buffer absorbs the variance
 * entirely, and the element is reconstructed to the millisecond. The only
 * packet that can hurt is one that arrives AFTER the moment it should have
 * been played. So the design question is not "how much jitter can we stand"
 * but "how large must the buffer be for late arrivals to be rare", and that
 * is a question with a number for an answer.
 *
 * §7 concedes 150 to 250 ms and that this rules out true QSK break-in. This
 * module is where that concession gets tested rather than assumed.
 *
 * Measured, 20 September 2026, over synthetic traces — a 78-element contact,
 * 20 runs per row, worst element error against the fist that was sent:
 *
 *   RELIABLE data channel, 200 ms buffer
 *     same city, wired      0.0 ms    0 late    0 lost    0/20 runs wrong
 *     home wifi             0.0 ms    0 late    0 lost    0/20
 *     across Europe         0.0 ms    0 late    0 lost    0/20
 *     mobile, moving      666.7 ms  116 late    0 lost   20/20
 *     hotel wifi, evening 800.0 ms  456 late    0 lost   20/20
 *
 * Two findings, and both cut against the obvious design.
 *
 * FIRST: the data channel must be RELIABLE and ORDERED, which is SCTP's
 * default and the opposite of what real-time media usually wants. On an
 * unreliable channel the same home-wifi trace broke 7 runs in 20 — not from
 * jitter, which the buffer absorbs entirely, but from the handful of packets
 * that never arrived. Losing one key-up leaves a tone running until the next
 * key-down: a 667 ms element where 67 ms was sent, and a character destroyed.
 * A retransmission arrives about one round trip later, which a 200 ms buffer
 * swallows without trace, and CW is a few bytes a second, so reliability
 * costs nothing here. Audio codecs drop packets because a 20 ms gap in speech
 * is inaudible; a 20 ms gap in Morse is a different letter.
 *
 * SECOND: past a point, a bigger buffer buys nothing. 200 ms and 250 ms are
 * indistinguishable on a good link because neither has anything to fix, and
 * indistinguishable on a bad one because the congestion spikes there run to
 * 300–450 ms and no buffer in the 150–250 range §7 allows can cover them. A
 * member on hotel wifi does not have a contact that needs tuning; they have a
 * contact that cannot work, and the application should say so rather than let
 * them conclude their sending is at fault.
 *
 * THIRD, and this one came from the air rather than a trace. The first
 * contacts between members, 21 September 2026, Dubai to Dubai through the
 * Falkenstein relay: a phone on home wifi reported `received=98 late=8
 * dropped=34 missing=12`. A third of the key transitions arrived after their
 * play-out moment and were thrown away by the 30 ms tolerance above — heard
 * as clicks where tones should be, and as silence where a whole character
 * fell inside one congestion spike. Two things were wrong with the policy the
 * traces had settled, and both are fixed here.
 *
 *   - The buffer was FIXED. §7's 150–250 ms is a fine opening bid but a phone
 *     on wifi behind a relay needs more, and nothing can know how much in
 *     advance. The buffer now ADAPTS: it starts at `bufferMs`, grows on the
 *     spot whenever a transition arrives late (by the lateness plus a margin,
 *     so the ones behind it are on time), and shrinks back towards the floor
 *     between overs when the recent delays say it can. Growing mid-element is
 *     safe in a way that resyncing the clock is not: the late transition has
 *     already played late, and shifting everything after it by the same
 *     amount keeps the fist intact; only the margin is added to one gap.
 *
 *   - Late transitions were DROPPED. A dropped key-up leaves a tone running,
 *     a dropped key-down deletes an element, and the member cannot tell
 *     either from a bad fist. Nothing is dropped now. A late transition plays
 *     the moment it arrives, however late; the distortion is audible but the
 *     element count is right, and the buffer growth means it does not recur.
 *     The one exception is a key-down so late (`dropAfterMs`) that playing it
 *     would only make a click: it is skipped, and its key-up finds the key
 *     already up. A key-up is never skipped.
 *
 * Measured, 21 September 2026, the same synthetic traces over a reliable
 * channel, four overs of the 78-element contact with 6 s pauses, 20 runs per
 * row. "Late" is transitions per over that played late; "wrong" is runs in
 * 20 where that over decoded to something other than what was sent.
 *
 *   ADAPTIVE buffer from 200 ms      over 1   over 2   over 3   over 4   settled
 *     same city, wired          late  0.0      0.0      0.0      0.0     200 ms
 *     home wifi                       0.0      0.0      0.0      0.0     200 ms
 *     across Europe                   0.0      0.0      0.0      0.0     200 ms
 *     mobile, moving                  1.3      0.7      0.4      0.8     355 ms
 *                              wrong 11/20     3/20     1/20     1/20
 *     hotel wifi, evening             2.4      0.9      0.6      0.4     517 ms
 *                              wrong 18/20     5/20     2/20     1/20
 *     phone on wifi via relay         2.9      1.0      0.6      0.3     724 ms
 *                              wrong 20/20     4/20     3/20     0/20
 *
 * Nothing dropped in any row. The good connections never leave 200 ms. The
 * bad ones lose most of the first over — the same over the fixed buffer lost
 * entirely — and are nearly clean by the third, at a delay the member will
 * notice as a slow turn-round and nothing worse. The link line in the app
 * shows the buffer in use, so a member can see why an exchange feels slow.
 *
 * Pure: no WebRTC, no audio, no timers. A data channel hands packets to
 * receive(); a caller schedules what it returns. That keeps the part that
 * decides timing testable against synthetic network traces, which is the only
 * honest way to measure a range of conditions that a live test cannot
 * reproduce on demand.
 */

/** One key transition, as it goes on the wire. */
export interface KeyPacket {
  /** Monotonic sequence number, so losses and reordering are visible. */
  seq: number;
  /** The sender's clock when the key moved, in ms. */
  t: number;
  down: boolean;
}

export interface LinkOptions {
  /**
   * Play-out delay the link starts from and shrinks back to, in ms. §7 asks
   * for 150–250. Larger is safer and more sluggish; this is the whole trade,
   * and the link moves along it as the connection dictates (see maxBufferMs).
   */
  bufferMs: number;
  /**
   * The most the buffer is allowed to grow to, in ms. Past this a contact
   * has stopped being a conversation, and the member is better told the
   * connection is not good enough than given a two-second echo.
   */
  maxBufferMs: number;
  /**
   * Added to the lateness when the buffer grows after a late arrival, in ms,
   * so that a spike slightly larger than the last one is still covered.
   */
  growMarginMs: number;
  /**
   * How many arrivals the clock-offset estimate is drawn from. The estimate
   * takes the minimum of (arrival − sent) across the window: network delay is
   * never negative, so the smallest sample is the one that travelled with the
   * least queuing and sits closest to the true offset. The same window is
   * what the buffer shrinks against between overs.
   */
  offsetWindow: number;
  /**
   * A gap in the sender's keying long enough that re-syncing the clock across
   * it is safe. The offset estimate improves as better samples arrive, but
   * applying an improvement mid-transmission drags the rest of the timeline
   * earlier and shortens whatever element is open across the change. So a new
   * estimate is held back until the key has been quiet this long — between
   * overs, which §7 already concedes the contact is. The buffer only shrinks
   * across the same gaps, for the same reason.
   */
  resyncIdleMs: number;
  /**
   * A KEY-DOWN later than this past its play-out time is skipped rather than
   * played: by then its key-up is due too, and playing both makes a click,
   * not an element. Late key-ups are always played, because a tone left
   * running is worse than any click. Everything less late than this plays
   * the moment it arrives.
   */
  dropAfterMs: number;
}

export const DEFAULT_LINK: Readonly<LinkOptions> = Object.freeze({
  bufferMs: 200,
  maxBufferMs: 1200,
  growMarginMs: 40,
  offsetWindow: 64,
  // Longer than any gap inside a transmission — a word gap at 5 WPM is 1.7 s
  // of dits but the key is not idle across it — and far shorter than the turn
  // of an over.
  resyncIdleMs: 2500,
  dropAfterMs: 2000,
});

/** An offset jump this large is a sender clock reset, not network delay. */
export const CLOCK_RESET_MS = 5000;

/**
 * A buffer that has grown to this is a connection the member will feel: the
 * turn-round of an over is half a second slower than the other station's
 * keying. The app and the server's journal both flag it, so a slow exchange
 * is put down to the link and not to either fist.
 */
export const SLOW_BUFFER_MS = 500;

export type Disposition = 'on-time' | 'late-played' | 'late-dropped' | 'duplicate';

export interface Scheduled {
  seq: number;
  down: boolean;
  /** Receiver-clock time to make the sound, in ms. */
  playAtMs: number;
  /** How far past its play-out time it arrived; 0 when it was in time. */
  lateByMs: number;
  disposition: Disposition;
}

export interface LinkStats {
  received: number;
  onTime: number;
  latePlayed: number;
  lateDropped: number;
  duplicates: number;
  /**
   * Gaps in the sequence between the first and the last packet seen: packets
   * that never turned up at all. Counted from the first seen, not from zero,
   * because a member who tunes in mid-transmission has not lost what was sent
   * before they arrived.
   */
  missing: number;
  worstLateMs: number;
  meanLateMs: number;
  /** The offset in use, receiverClock − senderClock, in ms. */
  offsetMs: number;
  /** The best offset seen, which may not be in use yet. */
  bestOffsetMs: number;
  /** How many times the clock was stepped, always between transmissions. */
  resyncs: number;
  /** The play-out delay currently in use, in ms. */
  bufferMs: number;
  /** How many times the buffer grew after a late arrival. */
  grows: number;
  /** How many times the buffer shrank back between overs. */
  shrinks: number;
}

/**
 * The receiving half of a live contact: takes packets as they arrive and says
 * when each tone should sound on the local clock.
 */
export class KeyLink {
  private readonly options: LinkOptions;
  /** (arrival − sent) for the most recent arrivals, receiver-clock ms. */
  private readonly offsets: number[] = [];
  /** The best estimate seen so far; updated on every arrival. */
  private best = Number.POSITIVE_INFINITY;
  /** The estimate actually in use; only ever changed between transmissions. */
  private offset = 0;
  private haveOffset = false;
  /** Sender-clock time of the previous transition, to spot a quiet key. */
  private lastSenderT = Number.NEGATIVE_INFINITY;
  private resyncs = 0;
  private buffer: number;
  private grows = 0;
  private shrinks = 0;
  private lowestSeq = Number.POSITIVE_INFINITY;
  private highestSeq = -1;
  private readonly seen = new Set<number>();
  private lateTotal = 0;

  private counts = {
    received: 0,
    onTime: 0,
    latePlayed: 0,
    lateDropped: 0,
    duplicates: 0,
    worstLateMs: 0,
  };

  constructor(options: Partial<LinkOptions> = {}) {
    this.options = { ...DEFAULT_LINK, ...options };
    this.buffer = Math.min(this.options.bufferMs, this.options.maxBufferMs);
  }

  /**
   * A packet arrived at local time `atMs`. Returns what to do with it, or
   * null in the one case it is skipped (a hopelessly late key-down).
   */
  receive(packet: KeyPacket, atMs: number): Scheduled | null {
    this.counts.received += 1;

    if (this.seen.has(packet.seq)) {
      this.counts.duplicates += 1;
      return { seq: packet.seq, down: packet.down, playAtMs: atMs, lateByMs: 0, disposition: 'duplicate' };
    }
    this.seen.add(packet.seq);
    if (packet.seq > this.highestSeq) this.highestSeq = packet.seq;
    if (packet.seq < this.lowestSeq) this.lowestSeq = packet.seq;

    const quietFor = packet.t - this.lastSenderT;
    this.noteOffset(atMs - packet.t, quietFor);
    if (quietFor >= this.options.resyncIdleMs) this.settleBuffer();
    this.lastSenderT = Math.max(this.lastSenderT, packet.t);

    const playAtMs = packet.t + this.offset + this.buffer;
    const lateByMs = Math.max(0, atMs - playAtMs);

    if (lateByMs === 0) {
      this.counts.onTime += 1;
      return { seq: packet.seq, down: packet.down, playAtMs, lateByMs: 0, disposition: 'on-time' };
    }

    this.lateTotal += lateByMs;
    this.counts.worstLateMs = Math.max(this.counts.worstLateMs, lateByMs);

    // Grow so the transitions behind this one are on time. Everything after
    // moves later by the same amount this one just played late, plus the
    // margin, so the fist keeps its shape and only one gap is stretched.
    const grown = Math.min(this.options.maxBufferMs, this.buffer + lateByMs + this.options.growMarginMs);
    if (grown > this.buffer) {
      this.buffer = grown;
      this.grows += 1;
    }

    if (packet.down && lateByMs > this.options.dropAfterMs) {
      this.counts.lateDropped += 1;
      return null;
    }
    this.counts.latePlayed += 1;
    return { seq: packet.seq, down: packet.down, playAtMs: atMs, lateByMs, disposition: 'late-played' };
  }

  /**
   * Track the clock offset as the minimum of (arrival − sent) over a sliding
   * window. Network delay cannot be negative, so the smallest difference seen
   * is the sample that queued least, and the closest available reading of the
   * true offset. A mean would be dragged upward by every congested packet and
   * would drift the whole contact late.
   *
   * Improvements are banked but not applied until the key has been quiet.
   * Measured before that rule existed: a contact over home wifi rebuilt its
   * elements 14 ms wrong, and over a reordering link 114 ms wrong, with not a
   * single packet arriving late. A shrinking offset pulls the timeline
   * earlier under whatever element is open across the change, which is
   * exactly the distortion this transport is meant to avoid.
   */
  private noteOffset(sample: number, quietFor: number): void {
    this.offsets.push(sample);
    if (this.offsets.length > this.options.offsetWindow) this.offsets.shift();
    this.best = Math.min(...this.offsets);

    if (!this.haveOffset) {
      this.offset = this.best;
      this.haveOffset = true;
      return;
    }
    // Only step the clock across a genuine pause, and only downward: a
    // smaller offset is a better one, and a larger one would mean the
    // reference packet was a fluke.
    if (quietFor >= this.options.resyncIdleMs && this.best < this.offset) {
      this.offset = this.best;
      this.resyncs += 1;
      return;
    }
    // One exception to "never upward". The sender's clock is its audio
    // clock, and a browser rebuilds that from zero after an output-device
    // change. Every packet then looks hours late and would be dropped for the
    // rest of the contact. A jump far larger than any buffer is a clock
    // reset, not a fluke, so re-anchor on the spot.
    // Judged on this sample, not the windowed minimum: the window still holds
    // the old clock's samples, which are smaller and would hide the jump.
    if (sample - this.offset > CLOCK_RESET_MS) {
      this.offsets.length = 0;
      this.offsets.push(sample);
      this.best = sample;
      this.offset = sample;
      this.resyncs += 1;
    }
  }

  /**
   * Between overs, let the buffer shrink back towards the floor if the recent
   * delays allow it. The target is the delay that would have covered EVERY
   * arrival in the window (the largest delay above the offset in use) plus
   * the margin, never below the floor. Growth is immediate and shrinking is
   * cautious on purpose: a spike costs the member an element, a too-large
   * buffer only costs them a moment's sluggishness. Measured with the 95th
   * percentile instead: the second over on the mobile trace was still losing
   * 1.4 transitions in 150 to lateness; with the maximum, 0.2.
   */
  private settleBuffer(): void {
    if (this.offsets.length < 8) return;
    let widest = 0;
    for (const sample of this.offsets) widest = Math.max(widest, sample - this.offset);
    const target = Math.max(this.options.bufferMs, Math.min(this.options.maxBufferMs, widest + this.options.growMarginMs));
    if (target < this.buffer) {
      // Halfway per over, not all at once: the spike that grew the buffer
      // may already have left the window, and its like will be back.
      const step = Math.max(10, (this.buffer - target) / 2);
      this.buffer = Math.max(target, Math.round(this.buffer - step));
      this.shrinks += 1;
    }
  }

  get stats(): LinkStats {
    const late = this.counts.latePlayed + this.counts.lateDropped;
    const span = this.highestSeq >= this.lowestSeq ? this.highestSeq - this.lowestSeq + 1 : 0;
    return {
      received: this.counts.received,
      onTime: this.counts.onTime,
      latePlayed: this.counts.latePlayed,
      lateDropped: this.counts.lateDropped,
      duplicates: this.counts.duplicates,
      missing: Math.max(0, span - this.seen.size),
      worstLateMs: this.counts.worstLateMs,
      meanLateMs: late === 0 ? 0 : this.lateTotal / late,
      offsetMs: this.offset,
      bestOffsetMs: Number.isFinite(this.best) ? this.best : this.offset,
      resyncs: this.resyncs,
      bufferMs: this.buffer,
      grows: this.grows,
      shrinks: this.shrinks,
    };
  }
}

/** Turn a stream of key events into packets, as the sending half would. */
export function packetise(events: readonly { down: boolean; t: number }[]): KeyPacket[] {
  return events.map((event, index) => ({ seq: index, t: event.t, down: event.down }));
}
