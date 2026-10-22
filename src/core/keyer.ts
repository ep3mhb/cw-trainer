/**
 * Iambic keyer state machine — modes A and B (RFP §5).
 *
 * Pure logic with an injected clock: `tick(now)` is called by a lookahead
 * scheduler that passes AudioContext.currentTime, so the element timing
 * comes from the audio clock and never from a timer. The timer only wakes
 * this code up; it does not decide when anything sounds.
 *
 * Mode A: when both paddles are released the keyer finishes the element in
 * progress and stops.
 * Mode B: it finishes the element in progress and then sends one more
 * element of the opposite kind.
 */

export type PaddleSide = 'dit' | 'dah';
export type IambicMode = 'A' | 'B';

export interface KeyerElement {
  kind: PaddleSide;
  /** Clock time the tone starts, in the same unit the clock uses (seconds). */
  startS: number;
  durationS: number;
}

export interface KeyerTimings {
  ditS: number;
  dahS: number;
  /** Gap after every element — one dit. */
  gapS: number;
}

export interface KeyerOptions {
  mode: IambicMode;
  /** Read fresh on every element so a speed change takes effect at once. */
  timings: () => KeyerTimings;
  emit: (element: KeyerElement) => void;
}

export class IambicKeyer {
  private mode: IambicMode;
  private readonly timings: () => KeyerTimings;
  private readonly emit: (element: KeyerElement) => void;

  private ditHeld = false;
  private dahHeld = false;
  /** Set when a paddle is touched during an element; consumed at the next decision. */
  private ditMemory = false;
  private dahMemory = false;

  private lastElement: PaddleSide | null = null;
  /** Clock time at which the keyer is free to start the next element. */
  private freeAtS = 0;

  constructor(options: KeyerOptions) {
    this.mode = options.mode;
    this.timings = options.timings;
    this.emit = options.emit;
  }

  setMode(mode: IambicMode): void {
    this.mode = mode;
  }

  press(side: PaddleSide): void {
    if (side === 'dit') {
      this.ditHeld = true;
      this.ditMemory = true;
    } else {
      this.dahHeld = true;
      this.dahMemory = true;
    }
  }

  release(side: PaddleSide): void {
    if (side === 'dit') this.ditHeld = false;
    else this.dahHeld = false;
  }

  /** True while an element is in progress or queued. */
  get busy(): boolean {
    return this.lastElement !== null;
  }

  /** Drop everything — used when the student stops a session mid-character. */
  reset(): void {
    this.ditHeld = false;
    this.dahHeld = false;
    this.ditMemory = false;
    this.dahMemory = false;
    this.lastElement = null;
    this.freeAtS = 0;
  }

  /**
   * Advance the machine. Call repeatedly with the current clock time; it
   * emits at most one element per call and is safe to call at any rate.
   */
  tick(nowS: number): void {
    if (nowS < this.freeAtS) return;

    const next = this.decide();
    // Memory is consumed by the decision, whatever it was.
    this.ditMemory = false;
    this.dahMemory = false;

    if (next === null) {
      this.lastElement = null;
      return;
    }

    const t = this.timings();
    const durationS = next === 'dit' ? t.ditS : t.dahS;
    const startS = Math.max(nowS, this.freeAtS);
    this.emit({ kind: next, startS, durationS });
    this.freeAtS = startS + durationS + t.gapS;
    this.lastElement = next;
  }

  private decide(): PaddleSide | null {
    if (this.lastElement === null) {
      // Idle: start on whichever paddle is down, dit winning a dead heat.
      if (this.ditHeld || this.ditMemory) return 'dit';
      if (this.dahHeld || this.dahMemory) return 'dah';
      return null;
    }

    const opposite: PaddleSide = this.lastElement === 'dit' ? 'dah' : 'dit';
    const oppositeHeld = opposite === 'dit' ? this.ditHeld : this.dahHeld;
    const oppositeMemory = opposite === 'dit' ? this.ditMemory : this.dahMemory;
    const sameHeld = this.lastElement === 'dit' ? this.ditHeld : this.dahHeld;

    // Mode B honours a paddle touched and released during the element;
    // mode A only honours one still held at the decision point.
    if (this.mode === 'B' ? oppositeHeld || oppositeMemory : oppositeHeld) return opposite;
    if (sameHeld) return this.lastElement;
    return null;
  }
}

/**
 * Straight key: no element generation at all, the operator's own timing is
 * the signal. Kept here so the sending UI has one interface for both.
 */
export class StraightKey {
  private downAtS: number | null = null;

  press(nowS: number): void {
    if (this.downAtS === null) this.downAtS = nowS;
  }

  /** Returns the closure length in seconds, or null if it was not down. */
  release(nowS: number): number | null {
    if (this.downAtS === null) return null;
    const duration = nowS - this.downAtS;
    this.downAtS = null;
    return duration;
  }

  get isDown(): boolean {
    return this.downAtS !== null;
  }

  reset(): void {
    this.downAtS = null;
  }
}
