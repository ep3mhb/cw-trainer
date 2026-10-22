/**
 * Callsigns and training identifiers (RFP §8, and open point 14.3, closed
 * 20 September 2026).
 *
 * Two kinds of identifier live in the registry and the difference between
 * them has to be visible in code, not only in a policy document:
 *
 *   A CALLSIGN is issued by an administration to a licensed operator. The
 *   application takes it as given and checks only that it is shaped like one.
 *
 *   A TRAINING IDENTIFIER is issued by this application to a member who is
 *   not yet licensed. It is shaped like a callsign so that copying it is the
 *   same exercise, and it is drawn from a series the ITU can never allocate,
 *   so that no real station anywhere can ever hold it.
 *
 * The series is A0. The ITU does not issue prefixes whose digit is 0 or 1
 * except to nine administrations that already use them, and A is not one of
 * the nine; the exclusion is permanent, not "unallocated for now", which is
 * what makes it safe to build a project's registry on. It also sits beside the
 * UAE's own A6 series, so the shape members practise is the shape they will
 * meet locally, without ever colliding with it. Reasoning and alternatives
 * are in docs/PHASE2-CALLSIGNS.md.
 *
 * Three rules travel with the prefix, and this module is where two of them
 * are enforced: a training identifier is never accepted as a callsign, and a
 * contact under one is never treated as a real contact for export. The third
 * — labelling wherever shown — is the display layer's job, and
 * `describeIdentifier` hands it the words.
 */

import type { Random } from './random';

export const TRAINING_PREFIX = 'A0';

/** Suffix length. Three letters, as an ordinary callsign has. */
const SUFFIX_LENGTH = 3;

/**
 * The shape of a callsign: a prefix of one or two characters — a letter, two
 * letters, digit-letter (2E, 9K) or letter-digit (A6, 4X) — then a digit,
 * then one to four letters, optionally with /P, /M and the like. Permissive
 * on purpose — it is checking shape, not issuing licences.
 */
const CALLSIGN_SHAPE = /^(?:[A-Z0-9]?[A-Z]|[A-Z][0-9])[0-9][A-Z]{1,4}(?:\/[A-Z0-9]{1,3})?$/;

const TRAINING_SHAPE = new RegExp(`^${TRAINING_PREFIX}[A-Z]{${String(SUFFIX_LENGTH)}}$`);

export type IdentifierKind = 'callsign' | 'training';

export interface Identifier {
  text: string;
  kind: IdentifierKind;
}

/** Upper-case and strip what Morse cannot carry. */
export function normalise(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9/]/g, '');
}

export function isTrainingIdentifier(text: string): boolean {
  return TRAINING_SHAPE.test(normalise(text));
}

/**
 * Accept a member's own callsign.
 *
 * Returns null when it is not shaped like one — and, deliberately, when it is
 * shaped like a training identifier. A member cannot register A0XYZ as a
 * licensed call, because nobody holds one, and letting it through would put
 * an unlabelled training identifier in the registry wearing the wrong badge.
 */
export function parseCallsign(input: string): Identifier | null {
  const text = normalise(input);
  if (!CALLSIGN_SHAPE.test(text)) return null;
  if (text.startsWith(TRAINING_PREFIX)) return null;
  return { text, kind: 'callsign' };
}

/** Letters only, in order, from a name — the raw material for initials. */
function lettersOf(name: string): string[] {
  return name
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((word) => word.length > 0);
}

/**
 * Issue a training identifier.
 *
 * Built from the member's initials where those are free, so that they
 * recognise their own identifier the first time they hear it, which is
 * exactly when a beginner most needs to. "Mohammad Bahrololoum" gives A0MB
 * plus the next letter of the surname: A0MBA. If that is taken, or the name
 * gives too little to work with, the suffix is random letters, retried until
 * one is free.
 *
 * `taken` is every identifier already in the registry — callsigns included,
 * though none can collide with A0.
 */
export function issueTrainingIdentifier(
  name: string,
  taken: ReadonlySet<string>,
  random: Random,
): Identifier {
  const words = lettersOf(name);
  let suffix = words.map((word) => word[0] as string).join('').slice(0, SUFFIX_LENGTH);
  // Fewer than three words: fill from the last word so the result still
  // reads as theirs. "Yuki" alone becomes A0YUK.
  const last = words[words.length - 1] ?? '';
  for (let i = 1; suffix.length < SUFFIX_LENGTH && i < last.length; i += 1) {
    suffix += last[i] as string;
  }

  if (suffix.length === SUFFIX_LENGTH && !taken.has(TRAINING_PREFIX + suffix)) {
    return { text: TRAINING_PREFIX + suffix, kind: 'training' };
  }

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let candidate = TRAINING_PREFIX;
    for (let i = 0; i < SUFFIX_LENGTH; i += 1) candidate += letters[random.int(26)] as string;
    if (!taken.has(candidate)) return { text: candidate, kind: 'training' };
  }
  // 17,576 suffixes exist; an operator that exhausts them has other problems.
  throw new RangeError('no training identifiers left');
}

/**
 * Whether a contact between these two identifiers may go into an ADIF export
 * as a real contact.
 *
 * ADIF is read by logging programs that upload to LoTW, eQSL and Club Log. A
 * practice contact reaching one of those, even by accident, is the failure in
 * this whole area that would embarrass the project, so the rule is absolute: if
 * either side is a training identifier, the contact is not exportable as a
 * QSO. It stays in the member's own log, labelled.
 */
export function exportableAsQso(a: string, b: string): boolean {
  return !isTrainingIdentifier(a) && !isTrainingIdentifier(b);
}

/**
 * How to show an identifier, wherever it is shown.
 *
 * `label` is the word to put beside it. Empty for a callsign; a training
 * identifier always carries one, because the third rule is that it is never
 * rendered to look like a licensed station.
 */
export function describeIdentifier(text: string): { text: string; label: string; training: boolean } {
  const normalised = normalise(text);
  const training = isTrainingIdentifier(normalised);
  return { text: normalised, label: training ? 'training' : '', training };
}
