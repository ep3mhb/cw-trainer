/**
 * Whose over it is (RFP §7): "contacts will be half-duplex, over to over.
 * The project accepts this for training."
 *
 * The transport makes break-in impossible — everything you hear is at least
 * a fifth of a second old — so a member who keys while the other station is
 * still sending is not interrupting them, they are doubling: both transmit,
 * neither hears the other's over intact, and the contact falls apart in a
 * way the transport gets blamed for. On the air an operator learns not to do
 * this by embarrassment. Here the application holds the key instead: while
 * the other station's key has moved recently, yours is held, and the pad
 * says so.
 *
 * "Recently" has to be longer than any gap inside a transmission and shorter
 * than a turn of an over. A word gap at 5 WPM is seven dits of 240 ms — 1.7 s
 * with the key up — and a hesitant beginner pauses longer than that between
 * words. The handover between overs, by contrast, is a pause the sender means
 * and the receiver waits through; the transport already adds 200 ms or more
 * on top. So the hold is 2.5 s, the same figure link.ts uses to recognise a
 * quiet key. It errs towards holding a beginner's key a moment too long
 * rather than letting them double.
 *
 * Pure: times in, a verdict out. The clock is whichever the caller uses for
 * both sides — the receiver's audio clock, in band.ts.
 */

export const TURN_HOLD_MS = 2500;

export type Turn = 'free' | 'theirs' | 'mine';

export class TurnKeeper {
  private theirLastMs = Number.NEGATIVE_INFINITY;
  private theirDown = false;
  private myLastMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly holdMs: number = TURN_HOLD_MS) {}

  /** The other station's key moved (as played, on the local clock). */
  theirKey(atMs: number, down: boolean): void {
    this.theirLastMs = Math.max(this.theirLastMs, atMs);
    this.theirDown = down;
  }

  /** Our own key moved. */
  myKey(atMs: number): void {
    this.myLastMs = Math.max(this.myLastMs, atMs);
  }

  /**
   * Whose over it is at this instant. Theirs while their key is down or has
   * been up for less than the hold; mine while my own key has moved within
   * the hold and theirs has not; free otherwise — either may start.
   */
  at(nowMs: number): Turn {
    if (this.theirDown || nowMs - this.theirLastMs < this.holdMs) return 'theirs';
    if (nowMs - this.myLastMs < this.holdMs) return 'mine';
    return 'free';
  }

  /** Whether our key may be pressed now. */
  mayKey(nowMs: number): boolean {
    return this.at(nowMs) !== 'theirs';
  }

  /** How long until the hold on our key lifts, in ms; 0 if it is not held. */
  heldForMs(nowMs: number): number {
    if (this.theirDown) return this.holdMs;
    return Math.max(0, this.holdMs - (nowMs - this.theirLastMs));
  }

  /** A new contact: nobody has keyed. */
  reset(): void {
    this.theirLastMs = Number.NEGATIVE_INFINITY;
    this.theirDown = false;
    this.myLastMs = Number.NEGATIVE_INFINITY;
  }
}
