/**
 * A tuning knob (RFP §7: "a tuning interface, not a list of available
 * users"). Asked for by the project on 21 September 2026, once the panel look
 * was in: a VFO you turn.
 *
 * One full turn is 1 kHz — a hundred 10 Hz detents — which is the feel of a
 * modern rig at its fine step. Drag around the knob's centre and the dial
 * follows the angle; the mouse wheel and the arrow keys step it; Shift makes
 * every movement ten times coarser. The knob is drawn in CSS (a brushed cap
 * with a finger dimple that turns with the frequency), so it needs no image
 * and works offline like everything else.
 *
 * Accessible as a slider: it carries the frequency as aria-valuenow and
 * takes the arrow keys, which is how a screen-reader user would expect a
 * knob to behave.
 */

import { el } from './dom';

export interface KnobOptions {
  label: string;
  /** Called with the number of detents to move, negative for down. */
  onStep: (detents: number) => void;
  /** Hz per detent, for the wheel and the visual rotation. */
  stepHz: number;
  min: number;
  max: number;
}

export interface Knob {
  readonly node: HTMLElement;
  /** Turn the dimple to the position for this frequency. */
  setValue: (hz: number) => void;
}

/** Detents per full revolution: a hundred, so 10 Hz steps give 1 kHz a turn. */
export const DETENTS_PER_TURN = 100;

export function tuningKnob(options: KnobOptions): Knob {
  const dimple = el('span', { class: 'knob-dimple', 'aria-hidden': 'true' });
  const cap = el('span', { class: 'knob-cap', 'aria-hidden': 'true' }, dimple);
  const node = el('div', {
    class: 'knob', tabindex: 0, role: 'slider', 'aria-label': options.label,
    'aria-valuemin': options.min, 'aria-valuemax': options.max, 'aria-valuenow': options.min,
    title: 'Turn to tune — one turn is 1 kHz; hold Shift for 100 Hz steps',
  }, el('span', { class: 'knob-ring', 'aria-hidden': 'true' }), cap, el('span', { class: 'knob-legend', text: 'TUNE', 'aria-hidden': 'true' }));

  const degreesPerDetent = 360 / DETENTS_PER_TURN;

  // Drag: the angle of the pointer about the centre, accumulated as it goes
  // round, so a slow drag gives 10 Hz resolution and a fast one still tracks.
  let dragging = false;
  let lastAngle = 0;
  let carry = 0;
  const angleOf = (e: PointerEvent): number => {
    const box = node.getBoundingClientRect();
    return Math.atan2(e.clientY - (box.top + box.height / 2), e.clientX - (box.left + box.width / 2)) * 180 / Math.PI;
  };
  node.addEventListener('pointerdown', (e) => {
    dragging = true;
    carry = 0;
    lastAngle = angleOf(e);
    node.setPointerCapture(e.pointerId);
    node.classList.add('turning');
    node.focus();
    e.preventDefault();
  });
  node.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const a = angleOf(e);
    let delta = a - lastAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    lastAngle = a;
    carry += delta / degreesPerDetent;
    const whole = Math.trunc(carry);
    if (whole !== 0) {
      carry -= whole;
      options.onStep(whole * (e.shiftKey ? 10 : 1));
    }
  });
  const stop = (): void => { dragging = false; node.classList.remove('turning'); };
  node.addEventListener('pointerup', stop);
  node.addEventListener('pointercancel', stop);

  node.addEventListener('wheel', (e) => {
    e.preventDefault();
    options.onStep((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1));
  }, { passive: false });

  node.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { options.onStep(big); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { options.onStep(-big); e.preventDefault(); }
    else if (e.key === 'PageUp') { options.onStep(100); e.preventDefault(); }
    else if (e.key === 'PageDown') { options.onStep(-100); e.preventDefault(); }
  });

  return {
    node,
    setValue(hz: number): void {
      node.setAttribute('aria-valuenow', String(hz));
      const detents = Math.round((hz - options.min) / options.stepHz);
      cap.style.transform = `rotate(${String((detents % DETENTS_PER_TURN) * degreesPerDetent)}deg)`;
    },
  };
}
