/**
 * One voice (RFD A59). Every hint, notice and toast in the application is
 * meant to read as the same writer: whole sentences, the member addressed as
 * "you", the application speaking of itself in the third person, no
 * contractions, curly quotes around the names of buttons and choices.
 *
 * The pass that made it so was done by hand; these checks keep it from
 * drifting back one string at a time. They read the source, not the running
 * page, so they cover text a test would never reach.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { failureText, sentence } from '../src/ui/dom';

const ROOT = new URL('../src/', import.meta.url).pathname;
const FILES = [
  ...readdirSync(join(ROOT, 'ui')).filter((f) => f.endsWith('.ts')).map((f) => join(ROOT, 'ui', f)),
  join(ROOT, 'main.ts'),
];

/** Every string literal in a source file, comments skipped, `${…}` folded to {…}. */
function literals(source: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('//', i)) { const j = source.indexOf('\n', i); i = j < 0 ? source.length : j; continue; }
    if (source.startsWith('/*', i)) { i = source.indexOf('*/', i + 2) + 2; continue; }
    const q = source[i]!;
    if (q === '\'' || q === '"' || q === '`') {
      let j = i + 1;
      let text = '';
      while (j < source.length && source[j] !== q) {
        if (source[j] === '\\') { text += source.slice(j, j + 2); j += 2; continue; }
        if (q === '`' && source.startsWith('${', j)) {
          let depth = 1;
          j += 2;
          while (depth > 0 && j < source.length) {
            if (source[j] === '{') depth += 1;
            else if (source[j] === '}') depth -= 1;
            j += 1;
          }
          text += '{…}';
          continue;
        }
        text += source[j];
        j += 1;
      }
      if (q !== '"') out.push(text);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** Prose: words and spaces, and not markup, a selector or a path. */
const isProse = (s: string): boolean =>
  /[A-Za-z]{2,} [A-Za-z]{2,}/.test(s) && !/[<>]|class=|https?:|^[./#]/.test(s);

const prose = FILES.flatMap((file) =>
  literals(readFileSync(file, 'utf8')).filter(isProse).map((text) => ({ file: file.slice(ROOT.length), text })));

describe('sentence()', () => {
  it('capitalises and closes a server fragment', () => {
    expect(sentence('too many failed sign-ins; wait fifteen minutes')).toBe('Too many failed sign-ins; wait fifteen minutes.');
  });
  it('leaves a finished sentence alone', () => {
    expect(sentence('Password changed.')).toBe('Password changed.');
    expect(sentence('Asking the server…')).toBe('Asking the server…');
  });
  it('gives the fallback when an error has no message', () => {
    expect(failureText(new Error(''), 'Could not save.')).toBe('Could not save.');
    expect(failureText('not an Error', 'could not save')).toBe('Could not save.');
    expect(failureText(new Error('the server did not answer in time'), 'x')).toBe('The server did not answer in time.');
  });
});

describe('one voice in the interface text', () => {
  it('finds the interface text at all', () => {
    // A guard on the guard: if the scan silently found nothing, every check below would pass.
    expect(prose.length).toBeGreaterThan(300);
  });

  it('quotes names with curly quotes, not straight ones', () => {
    const straight = prose.filter(({ text }) => /(^|[\s(])"[A-Z{…0-9]/.test(text));
    expect(straight).toEqual([]);
  });

  it('uses no contractions', () => {
    const contracted = prose.filter(({ text }) => /\b\w+(?:n[’']t|[’'](?:ll|re|ve|d))\b/i.test(text));
    expect(contracted).toEqual([]);
  });

  it('never speaks as "we"', () => {
    const we = prose.filter(({ text }) => /\b(?:we|We|us|our)\b/.test(text));
    expect(we).toEqual([]);
  });

  it('shows failures through failureText, not raw error messages', () => {
    const raw = FILES.filter((file) => /error instanceof Error \? error\.message/.test(readFileSync(file, 'utf8')));
    expect(raw.map((f) => f.slice(ROOT.length))).toEqual([]);
  });

  it('starts every literal toast with a capital letter and ends it with a stop', () => {
    const bad: string[] = [];
    for (const file of FILES) {
      for (const m of readFileSync(file, 'utf8').matchAll(/ctx\.toast\(\s*'([^'\\]+)'/g)) {
        const text = m[1]!;
        if (!/^[A-Z]/.test(text) || !/[.…]$/.test(text)) bad.push(text);
      }
    }
    expect(bad).toEqual([]);
  });
});
