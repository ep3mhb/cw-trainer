/**
 * The certificate has to look the same wherever it is rendered.
 *
 * On 11 October 2026 the statement paragraph sat 174px left of centre on an
 * 908px sheet, while the title, the name, the seal and the date and serial
 * fields all centred correctly. It looked like a centring bug. It was a
 * specificity one: `.panel p { margin: 0.4rem 0 0.7rem }` is (0,1,1) and
 * `.cert-statement` was (0,1,0), so inside any panel the panel won and set
 * `margin-left: 0; margin-right: 0`, destroying the `auto` that does the
 * centring. "Your account" is `<details class="panel account-details">`, so
 * every certificate a member ever opened was crooked — and the one place it
 * was NOT, a bare preview page with no panel ancestor, is where it was being
 * checked.
 *
 * Nothing measured it, so nothing caught it. This does: any rule that sets a
 * margin on one of the certificate's paragraphs must be scoped under
 * `.certificate`, which outranks `.panel p`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

/** Every `selector { body }` pair, flattened, comments stripped. */
const rules = (): { selector: string; body: string }[] => {
  const out: { selector: string; body: string }[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ selector: (m[1] ?? '').trim().replace(/\s+/g, ' '), body: (m[2] ?? '').trim() });
  }
  return out;
};

const PARAGRAPHS = ['.cert-lead', '.cert-under', '.cert-statement', '.cert-small'];

describe('the certificate is insulated from the page it sits on', () => {
  it('scopes every margin on its paragraphs under .certificate', () => {
    const unscoped = rules().filter((r) =>
      PARAGRAPHS.some((c) => r.selector.includes(c))
      && /(^|[;\s])margin(-left|-right)?\s*:/.test(r.body)
      && !r.selector.split(',').every((s) => s.trim().startsWith('.certificate ')));
    expect(unscoped.map((r) => r.selector)).toEqual([]);
  });

  it('still has the panel rule that outranks an unscoped one', () => {
    // If this ever goes, the test above is guarding nothing and should be
    // reconsidered rather than silently left in place.
    const panel = rules().find((r) => r.selector === '.panel p');
    expect(panel?.body).toMatch(/margin/);
  });

  it('keeps the statement centred by auto margins, not by text-align alone', () => {
    const stmt = rules().find((r) => r.selector === '.certificate .cert-statement');
    expect(stmt?.body).toMatch(/margin:\s*0\s+auto/);
    expect(stmt?.body).toMatch(/max-width/);
  });
});
