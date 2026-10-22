/**
 * The landing view (RFD A38).
 *
 * The first thing a visitor sees, and only a visitor: it appears on load
 * when this browser holds no practice and nobody is signed in, which is to
 * say only to somebody genuinely new here. Every member who has drilled
 * before, and every member who is signed in, opens where they left off
 * exactly as they did before this existed. It can be reopened from Help, so
 * nothing becomes unreachable by having once been dismissed.
 *
 * ONE REQUIREMENT IS ABSOLUTE AND THE WHOLE FILE IS WRITTEN AROUND IT:
 * opening this view makes no request of any kind. The privacy notice tells
 * a reader that somebody without an account talks to nothing at all, and
 * that sentence was confirmed in a browser on the fifteenth of October. A
 * welcome screen is precisely the sort of page that quietly acquires a
 * typeface from elsewhere, a logo from elsewhere, or a count of its
 * visitors, and any one of those would make the notice false. So: no
 * <img>, no web font, no fetch, no analytics. The one picture here is the
 * band scope, drawn from arithmetic by the application's own code.
 */

import { KOCH_ORDER, MORSE } from '../core/morse';
import { DEFAULT_COURSE } from '../core/koch';
import { spectrumRow, waterfallColour } from '../core/spectrum';
import { clear, el } from './dom';
import { PRIVACY_URL, type View } from './context';

/** What the landing view can send the visitor off to do. */
export interface LandingActions {
  startLesson: () => void;
  listenToBand: () => void;
  dismiss: () => void;
}

/**
 * Whether a browser is new enough here to be shown the view.
 *
 * Decided from what is stored in any case rather than from a flag of its
 * own, as A38 asks: one drill is enough to have a history, and a history is
 * what makes somebody not a first-time visitor. A member signed in on a
 * fresh machine is also not a first-time visitor, which is why the caller
 * passes `signedIn`.
 */
export function shouldShowLanding(
  counts: { sessions: number; attempts: number },
  signedIn: boolean,
  hash = '',
): boolean {
  if (signedIn) return false;
  if (counts.sessions !== 0 || counts.attempts !== 0) return false;
  /*
   * A hash naming a tab is NOT a reason to skip the welcome page for a
   * browser that has never been here.
   *
   * The application writes the current tab into the address bar on every
   * switch, so the address anybody copies and shares is
   * cw.mikroutik.com/#receive rather than the bare domain. Honouring that
   * as "take me straight to Receive" meant the one visitor the page exists
   * for — somebody following a shared link, who has never seen the
   * application — was the one visitor who never saw it. Found by Mohammad
   * testing in a private window on 16 October 2026.
   *
   * A hash that carries real intent still wins: a password reset and a
   * scanned certificate are errands, and interrupting either with a
   * welcome page would be worse than useless. They are handled before this
   * is reached; the guard below is belt and braces, since both are
   * decided by prefix elsewhere and a new one could be added without
   * anybody thinking of this function.
   */
  const errand = hash.startsWith('#reset=') || hash.startsWith('#certificate=');
  return !errand;
}

/*
 * The hero's message. A station calling nobody in particular, so that a
 * visitor who has never heard of any of this watches Morse being sent and
 * read before reading a word of English.
 */
const HERO_MESSAGE = 'CQ CQ DE CW TRAINER K';
const HERO_WPM = 15;
const DIT_MS = 1200 / HERO_WPM;
/**
 * Wider than CW_WIDTH_FRAC, which is the real width of a CW signal across
 * a whole band. This display is a hand's breadth of band blown up to fill a
 * hero, and at that scale the true width is a hairline.
 */
const HERO_WIDTH_FRAC = 0.026;
const PX_PER_MS = 0.115;
const HERO_NOISE = 0.07;
const SELF_FRAC = 0.21;
const OTHER_FRAC = 0.40;

interface Element_ { on: boolean; ms: number; charIndex: number }

/** The message flattened into key-down and key-up intervals. */
function schedule(text: string): Element_[] {
  const out: Element_[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (ch === ' ') { out.push({ on: false, ms: DIT_MS * 4, charIndex: i }); continue; }
    const pattern = MORSE[ch] ?? '';
    for (const mark of pattern) {
      out.push({ on: true, ms: mark === '-' ? DIT_MS * 3 : DIT_MS, charIndex: i });
      out.push({ on: false, ms: DIT_MS, charIndex: i });
    }
    out.push({ on: false, ms: DIT_MS * 2, charIndex: i });
  }
  out.push({ on: false, ms: DIT_MS * 12, charIndex: text.length });
  return out;
}

export function landingView(actions: LandingActions): View {
  const ELEMENTS = schedule(HERO_MESSAGE);
  const TOTAL_MS = ELEMENTS.reduce((a, e) => a + e.ms, 0);
  const stateAt = (ms: number): Element_ => {
    let t = ((ms % TOTAL_MS) + TOTAL_MS) % TOTAL_MS;
    for (const e of ELEMENTS) { if (t < e.ms) return e; t -= e.ms; }
    return ELEMENTS[ELEMENTS.length - 1] as Element_;
  };
  /* A second, weaker station idling elsewhere, so the glass reads as a band
     rather than as a demonstration of one. */
  const otherOn = (ms: number): boolean => Math.sin(ms / 430) > 0.55;

  const canvas = el('canvas', { class: 'landing-scope', 'aria-hidden': 'true' });
  const copyLine = el('span', { class: 'copy' });

  const node = el('div', { class: 'landing' });

  // ---- the glass ----
  const hero = el('div', { class: 'landing-hero' },
    canvas,
    el('div', { class: 'landing-decode' },
      el('span', { class: 'cap', text: 'On the band now' }), copyLine),
    el('div', { class: 'landing-words' },
      el('h2', { class: 'landing-wordmark', text: 'CW TRAINER' }),
      el('p', { class: 'landing-tagline', text:
        'Learn Morse code in your browser. Free, nothing to install, and no account needed to start practising.' })),
  );

  // ---- the course, laid out ----
  const chars = el('div', { class: 'landing-chars', 'aria-hidden': 'true' });
  for (const [i, ch] of KOCH_ORDER.entries()) {
    chars.append(el('span', { class: i < DEFAULT_COURSE.startingCount ? 'lit' : '', text: ch }));
  }
  const course = el('div', { class: 'landing-course' },
    el('div', { class: 'cap' },
      el('span', { text: `The course — ${String(KOCH_ORDER.length)} characters` }),
      el('em', { text: `${String(DEFAULT_COURSE.startingCount)} to begin, one at a time after that` })),
    chars,
  );

  // ---- the one action ----
  const startButton = el('button', { class: 'landing-key', type: 'button', text: 'Start lesson 1' });
  startButton.addEventListener('click', () => { actions.startLesson(); });
  const bandButton = el('button', { class: 'landing-key-2', type: 'button', text: 'Listen to the band' });
  bandButton.addEventListener('click', () => { actions.listenToBand(); });
  const actionRow = el('div', { class: 'landing-actions' },
    startButton, bandButton,
    el('span', { class: 'landing-free' }, el('i', { class: 'led' }), ' No account needed'),
  );

  // ---- the three who actually arrive ----
  const door = (caption: string, body: string, go: string, onGo: () => void): HTMLElement => {
    const b = el('button', { class: 'landing-door', type: 'button' },
      el('strong', { text: caption }),
      el('p', { text: body }),
      el('span', { class: 'go', text: go }),
    );
    b.addEventListener('click', onGo);
    return b;
  };
  const doors = el('div', { class: 'landing-who' },
    door('New to Morse',
      'Two characters, sent at full speed and spaced wide apart, until you know them cold.',
      'Start at lesson 1', () => { actions.startLesson(); }),
    door('Coming back',
      'Know some already? Take the exam for a character and skip straight past it.',
      'Sit an exam', () => { actions.startLesson(); }),
    door('Running a class',
      'Share one link. Your students can call each other on the band and hold a real exchange.',
      'See the band', () => { actions.listenToBand(); }),
  );

  // ---- the manuals ----
  const manual = (href: string, name: string, pages: number, lang?: string): HTMLElement =>
    el('a', { class: 'landing-manual', href, ...(lang !== undefined ? { lang } : {}) },
      el('span', { class: 'name', text: name }),
      el('span', { class: 'meta', text: `${String(pages)} pages · PDF` }));
  const manuals = el('div', { class: 'landing-manuals' },
    manual('./manual/CW-Trainer-User-Manual-EN.pdf', 'English', 54),
    manual('./manual/CW-Trainer-User-Manual-FA.pdf', 'فارسی', 47, 'fa'),
    manual('./manual/CW-Trainer-User-Manual-AR.pdf', 'العربية', 47, 'ar'),
  );

  node.append(
    hero, course, actionRow, doors,
    el('p', { class: 'landing-cap', text: 'The beginner’s guide, with a screenshot of every tab' }),
    manuals,
    el('div', { class: 'landing-colophon' },
      el('p', {}, 'Made by Mohammad Bahrololoum (ex EP2MHB) · ',
        el('a', { href: 'https://www.mikroutik.com/', text: 'mikroutik.com' })),
      el('p', {}, 'Runs offline once loaded, and your practice stays in this browser. · ',
        el('a', { href: PRIVACY_URL, text: 'Privacy notice' })),
    ),
  );

  // ---- the band scope ----
  /*
   * Two offscreen canvases that alternate, as in the band tab: drawing a
   * canvas onto ITSELF makes Safari read the pixels back every frame and
   * the page crawls. Found the hour the panadapter shipped, and the same
   * trap is waiting here.
   */
  let wfA = document.createElement('canvas');
  let wfB = document.createElement('canvas');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FRAME_MS = reduce ? 100 : 33;
  let clock = 0;
  let carry = 0;
  let lastFrame = 0;
  let lastTs: number | null = null;
  let onScreen = true;
  let handle: number | null = null;

  const seen = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    for (const e of entries) onScreen = e.isIntersecting;
  });
  seen?.observe(canvas);

  const column = (t: number): ImageData | null => {
    const h = canvas.height;
    if (h < 1) return null;
    const row = spectrumRow({
      bins: h,
      stations: [
        { frac: SELF_FRAC, level: 0.95, on: stateAt(t).on },
        { frac: OTHER_FRAC, level: 0.32, on: otherOn(t) },
      ],
      noise: HERO_NOISE,
      random: Math.random,
      widthFrac: HERO_WIDTH_FRAC,
    });
    const img = new ImageData(1, h);
    for (let y = 0; y < h; y += 1) {
      const [r, g, b] = waterfallColour(row[y] as number);
      const o = y * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    return img;
  };

  const size = (): boolean => {
    const w = Math.max(1, Math.min(1100, Math.round(canvas.clientWidth)));
    const h = Math.max(1, Math.round(canvas.clientHeight));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w; canvas.height = h;
    for (const c of [wfA, wfB]) {
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      if (g) { g.fillStyle = '#000028'; g.fillRect(0, 0, w, h); }
    }
    // Fill the glass with history at once, so the message is already laid
    // across it on the first paint rather than crawling in from the right.
    const g = wfA.getContext('2d');
    if (g) {
      for (let x = 0; x < w; x += 1) {
        const img = column(clock - (w - x) / PX_PER_MS);
        if (img) g.putImageData(img, x, 0);
      }
    }
    return true;
  };

  const paint = (): void => { canvas.getContext('2d')?.drawImage(wfA, 0, 0); };

  const advance = (cols: number): void => {
    const w = canvas.width;
    const shift = Math.min(cols, w);
    const g = wfB.getContext('2d');
    if (!g) return;
    g.drawImage(wfA, -shift, 0);
    for (let i = 0; i < shift; i += 1) {
      const img = column(clock - (shift - 1 - i) / PX_PER_MS);
      if (img) g.putImageData(img, w - shift + i, 0);
    }
    [wfA, wfB] = [wfB, wfA];
    paint();
  };

  const renderCopy = (t: number): void => {
    const upto = Math.min(stateAt(t).charIndex, HERO_MESSAGE.length);
    const sp = (x: string): string => x.replace(/ /g, '  ');
    clear(copyLine);
    copyLine.append(
      el('i', { text: sp(HERO_MESSAGE.slice(0, upto)) }),
      el('b', { text: sp(HERO_MESSAGE[upto] ?? '') }),
      document.createTextNode(sp(HERO_MESSAGE.slice(upto + 1))),
    );
  };

  const frame = (ts: number): void => {
    handle = window.requestAnimationFrame(frame);
    if (!canvas.isConnected) return;
    if (lastTs === null) lastTs = ts;
    if (ts - lastFrame < FRAME_MS) return;
    lastFrame = ts;
    // A backgrounded tab must not lurch forward when it comes back.
    const dt = Math.min(120, ts - lastTs);
    lastTs = ts;
    if (document.visibilityState !== 'visible' || !onScreen) return;
    if (size()) { paint(); return; }
    clock += dt;
    carry += dt * PX_PER_MS;
    const cols = Math.floor(carry);
    if (cols > 0) { carry -= cols; advance(cols); renderCopy(clock); }
  };

  renderCopy(0);
  handle = window.requestAnimationFrame(frame);

  return {
    node,
    dispose: () => {
      if (handle !== null) window.cancelAnimationFrame(handle);
      handle = null;
      seen?.disconnect();
    },
    refresh: () => { size(); paint(); },
  };
}
