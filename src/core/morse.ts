/**
 * Morse character tables, prosigns and the Koch learning order.
 *
 * Pure data and pure functions only — no audio, no DOM. This module is
 * imported by the timing engine, the generators and the decoder.
 */

/** Letters, digits and punctuation required by RFP §4. */
export const MORSE: Readonly<Record<string, string>> = Object.freeze({
  A: '.-',    B: '-...',  C: '-.-.',  D: '-..',   E: '.',
  F: '..-.',  G: '--.',   H: '....',  I: '..',    J: '.---',
  K: '-.-',   L: '.-..',  M: '--',    N: '-.',    O: '---',
  P: '.--.',  Q: '--.-',  R: '.-.',   S: '...',   T: '-',
  U: '..-',   V: '...-',  W: '.--',   X: '-..-',  Y: '-.--',
  Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.',
  '!': '-.-.--', '/': '-..-.',  '(': '-.--.',  ')': '-.--.-',
  '&': '.-...',  ':': '---...', ';': '-.-.-.', '=': '-...-',
  '+': '.-.-.',  '-': '-....-', '_': '..--.-', '"': '.-..-.',
  '$': '...-..-', '@': '.--.-.',
});

/**
 * Prosigns (RFP §4). Sent as a single character with no inter-character
 * gap inside them, which is why they are held separately from MORSE and
 * keyed by an angle-bracket token.
 */
export const PROSIGNS: Readonly<Record<string, string>> = Object.freeze({
  '<AR>': '.-.-.',    // end of message
  '<BT>': '-...-',    // break / new paragraph
  '<SK>': '...-.-',   // end of contact
  '<KN>': '-.--.',    // go ahead, named station only
  '<AS>': '.-...',    // wait
  '<VE>': '...-.',    // understood
  '<SOS>': '...---...',
});

/**
 * Standard Koch order (RFP §4: "Standard Koch order, overridable from a
 * configuration file"). This is the LCWO/Koch 40-character sequence.
 */
export const KOCH_ORDER: readonly string[] = Object.freeze([
  'K', 'M', 'R', 'S', 'U', 'A', 'P', 'T', 'L', 'O',
  'W', 'I', '.', 'N', 'J', 'E', 'F', '0', 'Y', ',',
  'V', 'G', '5', '/', 'Q', '9', 'Z', 'H', '3', '8',
  'B', '?', '4', '2', '7', 'C', '1', 'D', '6', 'X',
]);

/**
 * Reverse lookup: pattern -> character. Plain characters win over prosigns
 * where the patterns collide (<AR> and '+' are the same pattern, for
 * example), so a decoder returns the character a student typed.
 */
const FROM_PATTERN: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {};
  for (const [token, pattern] of Object.entries(PROSIGNS)) map[pattern] = token;
  for (const [ch, pattern] of Object.entries(MORSE)) map[pattern] = ch;
  return Object.freeze(map);
})();

/** Look up the dot/dash pattern for one character or prosign token. */
export function patternFor(token: string): string | undefined {
  const upper = token.toUpperCase();
  return PROSIGNS[upper] ?? MORSE[upper];
}

/** Look up the character for a dot/dash pattern, or undefined if unknown. */
export function characterFor(pattern: string): string | undefined {
  return FROM_PATTERN[pattern];
}

/** True if this character or prosign token can be sent. */
export function isSendable(token: string): boolean {
  return patternFor(token) !== undefined;
}

/**
 * Split a message into sendable tokens: prosigns in angle brackets stay
 * whole, everything else is one character per token. Spaces become ' '.
 */
export function tokenize(message: string): string[] {
  const tokens: string[] = [];
  const text = message.toUpperCase();
  let i = 0;
  while (i < text.length) {
    if (text[i] === '<') {
      const close = text.indexOf('>', i);
      if (close !== -1) {
        const token = text.slice(i, close + 1);
        if (token in PROSIGNS) {
          tokens.push(token);
          i = close + 1;
          continue;
        }
      }
    }
    const ch = text[i] as string;
    if (ch === ' ' || ch === '\n' || ch === '\t') {
      if (tokens[tokens.length - 1] !== ' ') tokens.push(' ');
    } else if (isSendable(ch)) {
      tokens.push(ch);
    }
    // Unsendable characters are dropped rather than throwing, so pasted
    // text does not break a lesson.
    i += 1;
  }
  return tokens;
}

/** The first `count` characters of a Koch course, optionally reordered. */
export function kochSet(count: number, order: readonly string[] = KOCH_ORDER): string[] {
  const n = Math.max(0, Math.min(count, order.length));
  return order.slice(0, n) as string[];
}
