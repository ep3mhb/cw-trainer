/**
 * The keying surface, shared by every view that takes a key or paddle.
 *
 * Input sources, all live at once so a member's existing hardware works
 * without configuration:
 *   - keyboard, with a configurable map, defaulting to VBand's [ and ]
 *   - mouse buttons, including buttons beyond left and right
 *   - touch on the on-screen pad: the left half is the dit paddle and the
 *     right half the dah, two fingers at once for squeeze keying; the whole
 *     pad is the key in straight-key mode
 *
 * The iambic keyer runs off a lookahead scheduler: a timer wakes the
 * scheduler, but every tone is placed against AudioContext.currentTime, so
 * no element length is ever decided by a timer (acceptance criterion 3).
 *
 * This lives on its own because two views now need it — sending practice and
 * keying a reply into a contact — and a second copy of timing-critical input
 * handling is the kind of duplication that rots quietly: one copy gets the
 * bug fix and the other does not, and nobody notices until copy accuracy
 * degrades on one tab only.
 */

import { IambicKeyer, StraightKey, type IambicMode, type PaddleSide } from '../core/keyer';
import { durations } from '../core/timing';
import { el } from './dom';
import { buttonList, keyList } from './keylabels';
import type { KeyEvent } from '../core/decoder';
import type { Ctx } from './context';

/** How often the scheduler wakes to look ahead, in ms. */
const TICK_MS = 10;

export interface KeyInputOptions {
  ctx: Ctx;
  /** Every key transition, timestamped in ms since the last arm(). */
  onEvent?: (event: KeyEvent) => void;
  /** How long the browser took to deliver an input event, in ms. */
  onInputDelay?: (delayMs: number) => void;
  /**
   * Fired once when the key has been still this long with something keyed.
   * A contact uses it to know the member has finished their transmission;
   * sending practice leaves it out, because a pause there is just a pause.
   */
  onIdle?: () => void;
  idleMs?: number;
  /**
   * Asked before every press. False holds the key: no sidetone, no event,
   * and onHeld fires instead so the view can say why. A live contact uses it
   * to keep the member from keying over the other station's over (§7).
   */
  gate?: () => boolean;
  onHeld?: () => void;
}

export interface KeyInput {
  /** The keying surface. Place it in the view. */
  readonly pad: HTMLElement;
  /** A lamp that follows the key, for putting in a status row. */
  readonly lamp: HTMLElement;
  readonly armed: boolean;
  /** Key transitions since the last arm() or clear(), oldest first. */
  readonly events: readonly KeyEvent[];
  /**
   * Audio-clock time, in ms, that event.t counts from. event.t + epochMs is
   * the transition on the audio clock itself, which is what a live contact
   * puts on the wire: monotonic for the life of the page, and the same clock
   * the tone is scheduled on.
   */
  readonly epochMs: number;
  arm: () => Promise<boolean>;
  disarm: () => void;
  /** Throw away what was keyed, without disarming. */
  clear: () => void;
  /** Re-read the settings and redraw the pad's instructions. */
  refresh: () => void;
  /** Change the iambic mode of a keyer already armed. */
  setIambicMode: (mode: IambicMode) => void;
  /** Mark the pad as held (the other station's over) or free again. */
  setHeld: (held: boolean, why?: string) => void;
  dispose: () => void;
}

export function keyInput(options: KeyInputOptions): KeyInput {
  const { ctx } = options;

  let armed = false;
  let events: KeyEvent[] = [];
  let sessionStartMs = 0;
  let tickHandle: number | null = null;
  let straight = new StraightKey();
  let keyer: IambicKeyer | null = null;
  /** The element currently sounding, so the lamp follows the keyer. */
  let elementWindow: { startS: number; endS: number } | null = null;
  /** Audio-clock time of the last transition, for the idle timer. */
  let lastEventS = 0;
  let idleFired = false;

  const lamp = el('span', { class: 'keying-lamp', role: 'img', 'aria-label': 'Key state' });
  const pad = el(
    'div',
    { class: 'paddle-pad', tabindex: '0', role: 'application', 'aria-label': 'Keying area' },
    el('div', { class: 'pad-half dit', 'aria-hidden': 'true', text: 'dit' }),
    el('div', { class: 'pad-half dah', 'aria-hidden': 'true', text: 'dah' }),
    el('div', { class: 'pad-title', text: 'Arm the key to start' }),
    el('div', { class: 'hint', style: 'margin:0.4rem 0 0' }),
  );
  const padTitle = pad.querySelector('.pad-title') as HTMLElement;
  const padHint = pad.querySelector('.hint') as HTMLElement;
  const padHalves = { dit: pad.querySelector('.pad-half.dit') as HTMLElement, dah: pad.querySelector('.pad-half.dah') as HTMLElement };
  /** Which side each finger on the pad is holding, by pointer id. */
  const touches = new Map<number, PaddleSide | 'straight'>();

  const keyerTimings = (): { ditS: number; dahS: number; gapS: number } => {
    const d = durations(ctx.settings.timing);
    return { ditS: d.ditMs / 1000, dahS: d.dahMs / 1000, gapS: d.intraCharGapMs / 1000 };
  };

  /** Convert an audio-clock time to ms since the key was armed. */
  const audioToSessionMs = (audioTimeS: number): number => audioTimeS * 1000 - sessionStartMs;

  function record(down: boolean, atAudioS: number): void {
    const event: KeyEvent = { down, t: audioToSessionMs(atAudioS) };
    events.push(event);
    lastEventS = atAudioS;
    idleFired = false;
    options.onEvent?.(event);
  }

  function sideFor(code: string): PaddleSide | 'straight' | null {
    const map = ctx.settings.keyMap;
    if (ctx.settings.keyInput === 'straight') return map.straightKeys.includes(code) ? 'straight' : null;
    if (map.ditKeys.includes(code)) return 'dit';
    if (map.dahKeys.includes(code)) return 'dah';
    return null;
  }

  function sideForButton(button: number): PaddleSide | 'straight' | null {
    const map = ctx.settings.keyMap;
    if (ctx.settings.keyInput === 'straight') return map.straightButtons.includes(button) ? 'straight' : null;
    if (map.ditButtons.includes(button)) return 'dit';
    if (map.dahButtons.includes(button)) return 'dah';
    return null;
  }

  function press(which: PaddleSide | 'straight'): void {
    if (!armed) return;
    if (options.gate && !options.gate()) {
      options.onHeld?.();
      return;
    }
    if (which === 'straight') {
      if (straight.isDown) return;
      const at = ctx.audio.keyDown();
      straight.press(at);
      record(true, at);
      lamp.classList.add('on');
      return;
    }
    keyer?.press(which);
  }

  function release(which: PaddleSide | 'straight'): void {
    if (!armed) return;
    if (which === 'straight') {
      if (!straight.isDown) return;
      const at = ctx.audio.keyUp();
      straight.release(at);
      record(false, at);
      lamp.classList.remove('on');
      return;
    }
    keyer?.release(which);
  }

  function noteEventDelay(event: { timeStamp: number }): void {
    // How long the browser took to hand us the input event. Real, and part
    // of what the member feels.
    const delay = Math.max(0, performance.now() - event.timeStamp);
    if (Number.isFinite(delay) && delay < 500) options.onInputDelay?.(delay);
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!armed || event.repeat) return;
    const which = sideFor(event.code);
    if (which === null) return;
    event.preventDefault();
    noteEventDelay(event);
    press(which);
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (!armed) return;
    const which = sideFor(event.code);
    if (which === null) return;
    event.preventDefault();
    release(which);
  };

  /**
   * A finger on the pad has no buttons, so the pad is split: left half dit,
   * right half dah. Each finger is tracked by its pointer id, so two fingers
   * squeeze exactly as two paddles do, and lifting one releases only its
   * side. A mouse keeps its button mapping.
   */
  const sideForTouch = (event: PointerEvent): PaddleSide | 'straight' => {
    if (ctx.settings.keyInput === 'straight') return 'straight';
    const box = pad.getBoundingClientRect();
    return event.clientX - box.left < box.width / 2 ? 'dit' : 'dah';
  };
  const isTouch = (event: PointerEvent): boolean => event.pointerType === 'touch' || event.pointerType === 'pen';

  const onPointerDown = (event: PointerEvent): void => {
    if (!armed) return;
    if (isTouch(event)) {
      event.preventDefault();
      noteEventDelay(event);
      const which = sideForTouch(event);
      touches.set(event.pointerId, which);
      pad.setPointerCapture(event.pointerId);
      if (which !== 'straight') padHalves[which].classList.add('held');
      press(which);
      return;
    }
    const which = sideForButton(event.button);
    if (which === null) return;
    event.preventDefault();
    noteEventDelay(event);
    pad.setPointerCapture(event.pointerId);
    press(which);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!armed) return;
    const held = touches.get(event.pointerId);
    if (held !== undefined) {
      event.preventDefault();
      touches.delete(event.pointerId);
      if (held !== 'straight') padHalves[held].classList.remove('held');
      release(held);
      return;
    }
    const which = sideForButton(event.button);
    if (which === null) return;
    event.preventDefault();
    release(which);
  };

  // A right-click on the pad is the dah paddle on many adaptors, so the
  // context menu has to stay out of the way.
  const onContextMenu = (event: Event): void => {
    if (armed) event.preventDefault();
  };

  function emitElement(element: { kind: PaddleSide; startS: number; durationS: number }): void {
    // Schedule the tone on the audio clock, and log the equivalent key
    // transitions so the decoder sees what a straight key would have sent.
    ctx.audio.toneAt(element.startS, element.durationS);
    elementWindow = { startS: element.startS, endS: element.startS + element.durationS };
    record(true, element.startS);
    record(false, element.startS + element.durationS);
  }

  function tick(): void {
    if (!armed) return;
    const nowS = ctx.audio.now;
    keyer?.tick(nowS);
    const sounding = elementWindow !== null && nowS >= elementWindow.startS && nowS < elementWindow.endS;
    lamp.classList.toggle('on', sounding || straight.isDown);

    const idleMs = options.idleMs ?? 0;
    if (idleMs > 0 && !idleFired && events.length > 0 && !sounding && !straight.isDown) {
      if ((nowS - lastEventS) * 1000 >= idleMs) {
        idleFired = true;
        options.onIdle?.();
      }
    }
  }

  let heldWhy: string | null = null;
  function renderPadHint(): void {
    const map = ctx.settings.keyMap;
    const straightMode = ctx.settings.keyInput === 'straight';
    pad.classList.toggle('straight', straightMode);
    pad.classList.toggle('held', armed && heldWhy !== null);
    padTitle.textContent = !armed ? 'Arm the key to start' : heldWhy ?? 'Ready — key now';
    padHint.textContent =
      straightMode
        ? `Straight key: press ${keyList(map.straightKeys)}, the ${buttonList(map.straightButtons)}, or touch anywhere here.`
        : `Paddle: ${keyList(map.ditKeys)} is dit, ${keyList(map.dahKeys)} is dah — the VBand convention. ` +
          `The ${buttonList(map.ditButtons)} and ${buttonList(map.dahButtons)} work too; on a touch screen, ` +
          `the left half of this pad is dit and the right half dah. Iambic mode ${ctx.settings.iambicMode}.`;
  }

  async function arm(): Promise<boolean> {
    if (!(await ctx.ensureAudio())) return false;
    armed = true;
    events = [];
    straight = new StraightKey();
    keyer = new IambicKeyer({ mode: ctx.settings.iambicMode, timings: keyerTimings, emit: emitElement });
    elementWindow = null;
    sessionStartMs = ctx.audio.now * 1000;
    lastEventS = ctx.audio.now;
    idleFired = false;
    pad.classList.add('armed');
    renderPadHint();
    pad.focus();
    if (tickHandle === null) tickHandle = window.setInterval(tick, TICK_MS);
    return true;
  }

  function disarm(): void {
    armed = false;
    touches.clear();
    padHalves.dit.classList.remove('held');
    padHalves.dah.classList.remove('held');
    keyer?.reset();
    straight.reset();
    ctx.audio.silenceNow();
    lamp.classList.remove('on');
    pad.classList.remove('armed');
    renderPadHint();
    if (tickHandle !== null) {
      window.clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  pad.addEventListener('pointerdown', onPointerDown);
  pad.addEventListener('pointerup', onPointerUp);
  pad.addEventListener('pointercancel', onPointerUp);
  pad.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  renderPadHint();

  return {
    pad,
    get epochMs() { return sessionStartMs; },
    lamp,
    get armed() { return armed; },
    get events() { return events; },
    arm,
    disarm,
    clear(): void {
      events = [];
      idleFired = false;
      lastEventS = ctx.audio.now;
    },
    refresh: renderPadHint,
    setIambicMode(mode: IambicMode): void {
      keyer?.setMode(mode);
      renderPadHint();
    },
    setHeld(held: boolean, why = 'Their over — wait'): void {
      const next = held ? why : null;
      if (next === heldWhy) return;
      heldWhy = next;
      renderPadHint();
    },
    dispose(): void {
      disarm();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
