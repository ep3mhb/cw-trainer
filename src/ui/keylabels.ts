/**
 * Human labels for keyboard codes and mouse buttons.
 *
 * `KeyboardEvent.code` is what the key map has to store — it is
 * layout-independent, which is the whole point — but "BracketLeft" is not
 * what is printed on the key in front of the member. Everything shown on
 * screen goes through here.
 */

const NAMED: Readonly<Record<string, string>> = Object.freeze({
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Esc',
  Backspace: 'Backspace',
  CapsLock: 'Caps Lock',
  ControlLeft: 'Left Control',
  ControlRight: 'Right Control',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  AltLeft: 'Left Option',
  AltRight: 'Right Option',
  MetaLeft: 'Left Command',
  MetaRight: 'Right Command',
  ArrowLeft: 'Left arrow',
  ArrowRight: 'Right arrow',
  ArrowUp: 'Up arrow',
  ArrowDown: 'Down arrow',
});

/** "BracketLeft" -> "[", "KeyA" -> "A", "Digit7" -> "7". */
export function keyLabel(code: string): string {
  const named = NAMED[code];
  if (named !== undefined) return named;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter !== null) return letter[1] as string;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit !== null) return digit[1] as string;
  const numpad = /^Numpad(.+)$/.exec(code);
  if (numpad !== null) return `Numpad ${(numpad[1] as string).toLowerCase()}`;
  const fkey = /^F([0-9]{1,2})$/.exec(code);
  if (fkey !== null) return code;
  // Unknown code: split the camel case rather than showing it raw.
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** MouseEvent.button -> "left mouse button". */
export function buttonLabel(button: number): string {
  switch (button) {
    case 0: return 'left mouse button';
    case 1: return 'middle mouse button';
    case 2: return 'right mouse button';
    case 3: return 'mouse button 4';
    case 4: return 'mouse button 5';
    default: return `mouse button ${String(button + 1)}`;
  }
}

/** Join several codes for display: "[ or ]". */
export function keyList(codes: readonly string[]): string {
  const labels = codes.map(keyLabel);
  if (labels.length === 0) return 'not set';
  if (labels.length === 1) return labels[0] as string;
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1] as string}`;
}

export function buttonList(buttons: readonly number[]): string {
  const labels = buttons.map(buttonLabel);
  if (labels.length === 0) return 'not set';
  if (labels.length === 1) return labels[0] as string;
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1] as string}`;
}
