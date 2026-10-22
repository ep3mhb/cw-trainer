import { describe, expect, it } from 'vitest';
import { buttonLabel, buttonList, keyLabel, keyList } from '../src/ui/keylabels';

describe('key labels', () => {
  it('shows the bracket keys as the characters on the keycap', () => {
    expect(keyLabel('BracketLeft')).toBe('[');
    expect(keyLabel('BracketRight')).toBe(']');
  });

  it('unwraps letters and digits', () => {
    expect(keyLabel('KeyA')).toBe('A');
    expect(keyLabel('KeyZ')).toBe('Z');
    expect(keyLabel('Digit7')).toBe('7');
  });

  it('names modifiers the way macOS does', () => {
    expect(keyLabel('ControlLeft')).toBe('Left Control');
    expect(keyLabel('AltRight')).toBe('Right Option');
    expect(keyLabel('MetaLeft')).toBe('Left Command');
  });

  it('keeps function keys as-is', () => {
    expect(keyLabel('F5')).toBe('F5');
  });

  it('splits an unknown code rather than showing camel case', () => {
    expect(keyLabel('MediaPlayPause')).toBe('Media Play Pause');
  });

  it('names mouse buttons in words, not numbers', () => {
    expect(buttonLabel(0)).toBe('left mouse button');
    expect(buttonLabel(2)).toBe('right mouse button');
    expect(buttonLabel(7)).toBe('mouse button 8');
  });

  it('joins lists readably', () => {
    expect(keyList(['BracketLeft'])).toBe('[');
    expect(keyList(['BracketLeft', 'ControlLeft'])).toBe('[ or Left Control');
    expect(keyList([])).toBe('not set');
    expect(buttonList([0, 2])).toBe('left mouse button or right mouse button');
  });
});
