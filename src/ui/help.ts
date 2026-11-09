/**
 * Help and About (RFP §12 deliverable: "Member-facing help page").
 *
 * Two audiences at once: a member who has never sent a dit and needs to know
 * what "Farnsworth" means, and an operator who wants the Q-code list to hand
 * during a contact. One page with a contents list rather than a wizard,
 * because the second audience wants to jump, not be walked through.
 *
 * The Morse chart is generated from the same tables the engine sends from, so
 * it cannot drift out of step with what the app actually plays. Clicking a
 * character plays it.
 */

import { KOCH_ORDER, MORSE, PROSIGNS, patternFor } from '../core/morse';
import { schedule } from '../core/timing';
import {
  ABBREVIATIONS, GLOSSARY, HANDOVER_SIGNALS, KEY_TYPES, PROSIGN_MISTAKES, PROSIGN_NOTES, Q_CODES,
} from '../data/reference';
import { el } from './dom';
import { PRIVACY_URL } from './context';
import type { Ctx, View } from './context';

declare const __APP_VERSION__: string;

const visual = (pattern: string): string => pattern.replace(/\./g, '·').replace(/-/g, '–');
const spoken = (pattern: string): string =>
  pattern.replace(/\./g, 'dit ').replace(/-/g, 'dah ').trim();

/** A worked example contact, written out the way it is actually sent. */
const QSO_EXAMPLE = [
  'CQ CQ CQ DE A65XY A65XY K',
  '      calling anyone at all. "DE" means "from".',
  '',
  'A65XY DE G4ABC G4ABC K',
  '      someone answers: your call first, then theirs, then "over".',
  '',
  'G4ABC DE A65XY = GM ES TNX FER CALL = UR RST 579 579 =',
  'NAME HR MOHAMMAD MOHAMMAD = QTH DUBAI DUBAI = HW?',
  'G4ABC DE A65XY KN',
  '      your turn: signal report, name, location. "=" is the BT separator,',
  '      and things are sent twice because conditions are never perfect.',
  '',
  '      ... the other station replies in the same shape ...',
  '',
  'G4ABC DE A65XY = TNX FER QSO = 73 ES CUL =',
  'G4ABC DE A65XY SK',
  '      signing off. 73 is "best regards"; SK ends the contact for good.',
].join('\n');

/**
 * A worked contact with carets pointing at the prosigns.
 *
 * The caret columns are computed from the text rather than typed as runs of
 * spaces, because hand-counted alignment silently rots the first time anyone
 * edits a callsign — and a diagram whose arrows point at the wrong character
 * is worse than no diagram.
 */
export function annotate(line: string, marks: { find: string; nth?: number; note: string }[]): string[] {
  const columns = marks.map((mark) => {
    let index = -1;
    for (let n = 0; n < (mark.nth ?? 1); n += 1) index = line.indexOf(mark.find, index + 1);
    return { column: index, note: mark.note };
  });

  const caretLine = columns.reduce((acc, { column }) => {
    if (column < 0) return acc;
    const padded = acc.padEnd(column, ' ');
    return `${padded.slice(0, column)}\u2191${padded.slice(column + 1)}`;
  }, '');

  const noteLines = columns
    .filter((c) => c.column >= 0 && c.note !== '')
    .map(({ column, note }) => `${' '.repeat(column)}${note}`);

  return [line, caretLine, ...noteLines];
}

const PROSIGN_EXAMPLE = [
  ...annotate('CQ CQ CQ DE A65XY A65XY K', [
    { find: 'K', nth: 1, note: 'K \u2014 anyone may answer' },
  ]),
  '',
  // Note hangs off the first separator: pinned to the last one it would run
  // off the right edge on a narrow screen.
  ...annotate('G4ABC DE A65XY = GM ES TNX FER CALL = UR RST 579 =', [
    { find: '=', nth: 1, note: 'BT separators \u2014 one per idea,' },
    { find: '=', nth: 1, note: 'and somewhere to pause and think' },
    { find: '=', nth: 2, note: '' },
    { find: '=', nth: 3, note: '' },
  ]),
  '',
  ...annotate('NAME HR MOHAMMAD = QTH DUBAI = HW? G4ABC DE A65XY KN', [
    { find: 'KN', note: 'KN \u2014 G4ABC only,' },
    { find: 'KN', note: 'no one else break in' },
  ]),
  '',
  ...annotate('73 ES CUL = G4ABC DE A65XY SK', [
    { find: 'SK', note: 'SK \u2014 the contact is over.' },
    { find: 'SK', note: 'Sent once, at the very end.' },
  ]),
].join('\n');

export function helpView(ctx: Ctx): View {
  const node = el('div');

  /** A character tile that plays itself when clicked. */
  function tile(token: string, label = token): HTMLButtonElement {
    const pattern = patternFor(token) ?? '';
    const button = el(
      'button',
      {
        class: 'morse-tile',
        type: 'button',
        'aria-label': `${label}: ${spoken(pattern)}. Activate to hear it.`,
        title: 'Click to hear it',
      },
      el('span', { class: 'morse-char', text: label }),
      el('span', { class: 'morse-pattern', 'aria-hidden': 'true', text: visual(pattern) }),
    );
    button.addEventListener('click', () => {
      void (async () => {
        if (!(await ctx.ensureAudio())) return;
        ctx.audio.play(schedule(token, ctx.settings.timing));
      })();
    });
    return button;
  }

  const tileGrid = (tokens: readonly string[], label?: (t: string) => string): HTMLElement =>
    el('div', { class: 'morse-grid' }, ...tokens.map((t) => tile(t, label === undefined ? t : label(t))));

  const letters = Object.keys(MORSE).filter((c) => /^[A-Z]$/.test(c));
  const digits = Object.keys(MORSE).filter((c) => /^[0-9]$/.test(c));
  const punctuation = Object.keys(MORSE).filter((c) => !/^[A-Z0-9]$/.test(c));
  const prosignTokens = Object.keys(PROSIGNS);

  const section = (id: string, title: string, ...children: (Node | string)[]): HTMLElement =>
    el('section', { class: 'panel', id }, el('h2', { text: title }), ...children);

  const TOC: [string, string][] = [
    ['about', 'About this application'],
    ['start', 'Getting started in five minutes'],
    ['chart', 'The Morse alphabet'],
    ['course', 'How the course works'],
    ['speed', 'Speed and spacing'],
    ['conditions', 'Practising under real conditions'],
    ['keys', 'Keys and paddles'],
    ['report', 'Reading your sending report'],
    ['qso', 'Making a contact'],
    ['band', 'Working other members on the air'],
    ['codes', 'Q codes, abbreviations and prosigns'],
    ['glossary', 'Glossary'],
    ['trouble', 'When something is not working'],
  ];

  node.append(
    el(
      'nav',
      { class: 'panel', 'aria-label': 'Contents' },
      el('h2', { text: 'On this page' }),
      el('ul', { class: 'toc' },
        ...TOC.map(([id, label]) => el('li', {}, el('a', { href: `#help-${id}`, text: label })))),
    ),

    section(
      'help-about',
      'About this application',
      el('p', {}, 'A training tool for Morse code (CW), made by Mohammad Bahrololoum (ex EP2MHB) '
        + 'and released free for anyone learning Morse code.'),
      el('p', { class: 'hint' },
        'Practice happens in this browser: no account, no server and no network traffic once the page has ' +
        'loaded \u2014 your progress is stored on this device. You can export all of it ' +
        'to a file at any time from the Settings tab, and delete all of it from the same place. The ' +
        '"On air" tab talks to the server once you sign in, and so does the final exam at the ' +
        'very end of the course, which the server sets and marks so that the certificate means something. ' +
        'Nothing else does.'),
      el('p', { class: 'hint' },
        el('span', { text: 'What is held, who else can see it and how long it is kept: ' }),
        el('a', { href: PRIVACY_URL, target: '_blank', rel: 'noopener', text: 'the privacy notice' }),
        el('span', { text: '. You can close your account, and withdraw a certificate, yourself at any '
          + 'time \u2014 both are under "Your account" on the Settings tab.' })),
      el('p', { class: 'hint' },
        el('span', { text: 'New here, or showing somebody else? The welcome page ends with a short guide to how to '
          + 'learn Morse code. ' }),
        (() => {
          const again = el('button', { class: 'btn', type: 'button', text: 'Open the welcome page' });
          again.addEventListener('click', () => {
            // A38: reopenable, so dismissing it once does not make it
            // unreachable. The shell owns the panel, so it owns this.
            (window as unknown as { __cwLanding?: () => void }).__cwLanding?.();
          });
          return again;
        })()),
      el('div', { class: 'row' },
        el('span', { class: 'badge' }, 'Version ',
          el('b', { text: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev' })),
        el('span', { class: 'badge' }, 'Phase ', el('b', { text: '2 — member testing' })),
        el('span', { class: 'badge' }, 'Practice data ', el('b', { text: 'this browser only' }))),
      el('p', { class: 'hint' },
        'Phase 1 (the course, sending practice, the simulated operator) has been in member use since ' +
        '20 September 2026; Phase 2 (accounts and live contacts between members) since 21 September. ' +
        'What each version changed is in the repository\u2019s ROADMAP.'),
      el('p', { class: 'manual-links' },
        el('b', { text: 'The user manual (PDF), with screenshots of every tab: ' }),
        el('a', { href: './manual/CW-Trainer-User-Manual-EN.pdf', target: '_blank', rel: 'noopener', text: 'English' }),
        ' \u00b7 ',
        el('a', { href: './manual/CW-Trainer-User-Manual-FA.pdf', target: '_blank', rel: 'noopener', lang: 'fa', text: '\u0641\u0627\u0631\u0633\u06cc' }),
        el('span', { class: 'hint', text: ' (Persian) \u00b7 ' }),
        el('a', { href: './manual/CW-Trainer-User-Manual-AR.pdf', target: '_blank', rel: 'noopener', lang: 'ar', text: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629' }),
        el('span', { class: 'hint', text: ' (Arabic). This page is the short version; the manual is the long one.' })),
      el('p', { class: 'hint' },
        'Open source under the Apache License 2.0. Copyright 2026 Mohammad Bahrololoum. You may use, ' +
        'modify and share it, including commercially, as long as you keep the copyright notice and say ' +
        'what you changed.'),
    ),

    section(
      'help-start',
      'Getting started in five minutes',
      el('ol', { class: 'steps' },
        el('li', {}, el('b', { text: 'Click "Enable sound".' }),
          ' Every browser blocks audio until you interact with the page. This is that interaction.'),
        el('li', {}, el('b', { text: 'Go to Receive and press "Start session".' }),
          ' You will hear only two characters, K and M, at a realistic speed with long gaps between them. ' +
          'That is deliberate — see below.'),
        el('li', {}, el('b', { text: 'Type what you heard, then press Enter.' }),
          ' Do not try to get all of it. Copy what you catch and let the rest go: chasing a character you ' +
          'missed usually costs you the next three.'),
        el('li', {}, el('b', { text: 'Finish the ten drills.' }),
          ' At 90% or better, a third character unlocks. Below that, run it again.'),
        el('li', {}, el('b', { text: 'Look at Progress.' }),
          ' The confusion matrix shows which characters you are mixing up. That is what to drill next.')),
      el('p', { class: 'hint' },
        'Fifteen minutes a day beats two hours on a Sunday. This is ear training, and ears learn from ' +
        'repetition spread out over days, not from cramming.'),
    ),

    section(
      'help-chart',
      'The Morse alphabet',
      el('p', { class: 'hint' },
        'Click any character to hear it at your current speed. A dot is a dit, a dash is a dah.'),
      el('p', { class: 'notice' },
        'Useful as a reference — but do not learn from this table. Reading Morse off a chart trains your ' +
        'eyes, and your ears then have to start from nothing. Learn each character by its sound, through the ' +
        'course.'),
      el('h3', { text: 'Letters' }),
      tileGrid(letters),
      el('h3', { text: 'Numbers' }),
      tileGrid(digits),
      el('h3', { text: 'Punctuation and symbols' }),
      tileGrid(punctuation),
      el('h3', { text: 'Prosigns' }),
      el('p', { class: 'hint' },
        'Sent as one unbroken run, with no gap inside \u2014 that is what makes them punctuation rather than ' +
        'two letters side by side. Knowing which one to send, and when, is covered under ' +
        '"Q codes, abbreviations and prosigns" below.'),
      tileGrid(prosignTokens, (t) => t.replace(/[<>]/g, '')),
    ),
    section(
      'help-course',
      'How the course works',
      el('h3', { text: 'The Koch method' }),
      el('p', {},
        'You start with two characters sent at full speed, and a third is added only once you are copying at ' +
        '90% or better. By the end you know all forty — and you will never once have heard them slowly.'),
      el('p', {},
        'The obvious alternative, learning all forty at a crawl and then speeding up, fails for a specific ' +
        'reason. Sent slowly, a character is a countable sequence: dit, dit, dit — that is three, that is S. ' +
        'Counting works up to about 10 words per minute and then hits a wall, because there is no longer time ' +
        'to count. Everyone who learns that way has to unlearn it, and unlearning is much harder than learning.'),
      el('p', {},
        'Sent at full speed from the first minute, a character has no countable parts. It is one sound, the ' +
        'way a spoken word is one sound rather than a row of letters. That is the skill you actually need, so ' +
        'this method builds it directly instead of building something else first.'),
      el('h3', { text: 'The 90% rule, and the exam' }),
      el('p', {},
        'A session is ten drills. At the end, if you copied at least 90% of the characters correctly over at ' +
        'least 50 characters, you are offered the exam for the next character. Nothing unlocks on its own: ' +
        'a panel appears, you take the exam or you stay where you are, and if you stay you will be asked ' +
        'again at the end of the next session that qualifies. It never interrupts a drill and it never ' +
        'blocks anything.'),
      el('p', { class: 'hint' },
        'The threshold feels harsh when you land on 88%. It is protecting you: adding a character while two ' +
        'others are still shaky makes every later lesson harder, and the effect compounds.'),
      el('h3', { text: 'Leaving a series part-finished' }),
      el('p', {},
        'You do not have to do the ten in one sitting. A series is written down as you go, so reloading ' +
        'the page, closing the tab, or your phone putting the page to sleep all leave you at the drill ' +
        'you had reached rather than back at the first. Come back within the day and it carries on.'),
      el('p', {},
        'If you have asked for your records to be kept on the server, the series follows you ' +
        'between your own devices as well: two drills on a laptop and eight on a telephone are one ' +
        'series of ten, and earn their promotion exactly as ten in one place would. You will be told ' +
        'when that happens rather than asked \u2014 it is your own work, and being made to approve it ' +
        'would be an irritation rather than a safeguard.'),
      el('p', { class: 'hint' },
        'A series left alone for more than half a day stops being one you are in the middle of. It is ' +
        'closed and counted honestly as the short session it was, and you start fresh.'),
      el('p', {},
        'The exam is why 90% alone is not enough. 90% is an average, and averages hide things. At lesson ' +
        'ten you know eleven characters, so one of them going badly wrong \u2014 two misses out of four \u2014 still ' +
        'leaves you above 95% overall. You would be promoted, carrying a character you cannot read, and ' +
        'every lesson after that dilutes it further and makes it less likely to be caught. The rule gets ' +
        'weaker exactly as the course gets harder.'),
      el('p', {},
        'So the exam sends every character you have learnt ' , el('b', { text: 'four times' }),
        ', shuffled into ordinary mixed groups with no announcement, and asks two things of you: at least ' +
        '90% overall, ' , el('b', { text: 'and' }), ' at least three out of four on every single character. ' +
        'No character can hide behind the others. It is as long as it needs to be \u2014 eight characters at ' +
        'lesson one, a hundred and sixty at the end \u2014 because the cost should grow with how much there is ' +
        'to prove, and you only pay it once per character.'),
      el('p', {},
        'If you fail, nothing is taken away and there is no waiting period. You are told which characters ' +
        'let you down, by name, and your ordinary drills then over-sample exactly those until you pass. A ' +
        'failed exam steers your practice rather than merely reporting on it.'),
      el('h3', { text: 'The final exam, and the certificate' }),
      el('p', {},
        'The fortieth character is different. Passing its exam completes the course, so that one is set and ' +
        'marked by the server rather than by your browser, and it is offered only if you are ' +
        'signed in. A certificate your own computer awarded itself would not be worth printing.'),
      el('p', { class: 'hint' },
        'Your browser is sent the timing of the Morse \u2014 when each tone starts and how long it lasts \u2014 and ' +
        'nothing that spells out what the characters are. It plays the exam without being able to read it. ' +
        'Everything you type goes to the server to be marked there.'),
      el('p', {},
        'Pass, and you get a certificate you can print on a single sheet of A4. It carries your name, your ' +
        'callsign, the date, the score and a serial number, and a QR square that opens a page on the ' +
        'server confirming it \u2014 that page shows the callsign, date, serial and score, and not ' +
        'your name. If you would rather it did not answer at all, withdraw the certificate under ' +
        '"Your account" on the Settings tab; the printed sheet is yours either way.'),
      el('p', {},
        'The certificate is not a one-time offer. It is listed under "Your account" from then on, with a ' +
        '"View and print" button beside it, so you can open it again and print another copy whenever you ' +
        'like \u2014 including one you have withdrawn from the public page. Withdrawing stops the QR square ' +
        'resolving for other people; it does not take your own copy away.'),
      el('p', { class: 'hint' },
        'The page the QR square opens is served by the server itself, as a plain page with no ' +
        'application behind it, so it answers at once on any phone. It is deliberately not a copy of the ' +
        'certificate: it is the server\u2019s own record, saying that this serial is one it issued and that ' +
        'it stands. The sheet is the certificate; that page confirms it.'),
      el('p', { class: 'hint' },
        'It records a course of practice. It is not a licence, and it is not an examination for one.'),
      el('h3', { text: 'Practising something other than your lesson' }),
      el('p', {},
        'The course decides what you are ready for, but it does not have to decide what you practise. Under ' +
        '"What to practise" on the Receive tab there are three choices. "My course lesson" is the normal one ' +
        'and the only one that can unlock a character. "Any lesson" plays any lesson in the course, so you ' +
        'can hear what is coming or go back over an earlier set that still catches you out. "My own set" ' +
        'drills exactly the characters you type in \u2014 letters, digits, punctuation, or prosigns in angle ' +
        'brackets, separated however you like.'),
      el('p', {},
        'Sessions on a lesson that is not your own, or on a set of your own, are practice: they are recorded ' +
        'and they feed the confusion matrix, but they leave your course position alone. Nobody wants to ' +
        'unlock six characters by accident while poking at lesson 30.'),
      el('p', { class: 'hint' },
        'If you already know Morse and the first lesson is wasting your time, set "Any lesson" to where you ' +
        'actually are and press "Start my course here". That moves your course position, and the 90% rule ' +
        'takes over from there.'),
      el('h3', { text: 'Why the characters come in that order' }),
      el('p', { class: 'hint' },
        'Not alphabetical, and not shortest-first. The order deliberately puts easily-confused sounds close ' +
        'together early, so you learn to tell them apart while you have only a handful to think about — ' +
        'rather than meeting them for the first time at character thirty.'),
      el('p', { class: 'order-list', text: KOCH_ORDER.join('   ') }),
    ),

    section(
      'help-speed',
      'Speed and spacing',
      el('h3', { text: 'Two speeds, not one' }),
      el('p', {},
        'Character speed is how fast each character is sent. Effective speed is how fast the whole message ' +
        'goes once the gaps are counted. This app sets them separately, and the difference between them is ' +
        'the most useful single feature in learning to copy.'),
      el('p', {},
        'The default is 18 WPM characters at 8 WPM effective. Each character arrives at the speed you are ' +
        'aiming for, so you learn its true rhythm — but a long silence follows, in which to recognise it ' +
        'and type it. This is Farnsworth spacing.'),
      el('p', { class: 'hint' },
        'As you improve, raise the effective speed and leave the character speed alone. You are shortening ' +
        'your own thinking time, not relearning anything. Once effective catches up with character speed, ' +
        'raise both together.'),
      el('h3', { text: 'Where the numbers come from' }),
      el('p', {},
        'Speed is measured against the word PARIS, which takes exactly 50 dit-lengths to send including the ' +
        'space after it. So 20 words per minute means twenty PARIS-lengths a minute, and one dit is ' +
        '1200 ÷ 20 = 60 milliseconds. A dah is three dits; the gap inside a character is one dit, between ' +
        'characters three, between words seven.'),
      el('h3', { text: 'Weighting' }),
      el('p', {},
        'A dah is nominally three dits exactly. Real operators drift from that, and this app lets you both ' +
        'practise copying an imperfect fist and measure your own. Around 3.0 is textbook; slightly heavier is ' +
        'often easier for the other station to copy.'),
      el('h3', { text: 'The envelope, and why tones are not switched on' }),
      el('p', {},
        'In Settings there is an envelope control, in milliseconds. It sets how long each tone takes to rise ' +
        'and to fall. The default is 6 ms and the useful range is about 4 to 8.'),
      el('p', {},
        'Switching a tone on instantly sounds like a click at the start of every element, and an hour of that ' +
        'is genuinely tiring to copy. The click is not a flaw in your ears: a hard edge spreads energy far ' +
        'either side of the tone, which is why a badly keyed transmitter can be heard across a whole band. A ' +
        'shaped edge keeps that energy where it belongs.'),
      el('p', { class: 'hint' },
        'Measured on this app at the default 6 ms: the spread 1 kHz either side of the tone sits 84 dB below ' +
        'it. Switched hard instead, it would be 56 dB \u2014 nearly 300 times stronger. Longer envelopes are ' +
        'cleaner still, but past about 10 ms the edges start to soften the rhythm you are trying to hear.'),
    ),

    section(
      'help-conditions',
      'Practising under real conditions',
      el('p', {},
        'Every drill this application sends you is a perfect signal: a steady tone at a constant level, ' +
        'silence behind it, nobody else on the frequency, and timing exact to the millisecond because a ' +
        'machine produced it. Nothing on the air is like that. If the first imperfect signal you ever ' +
        'meet is a real one, on a real evening, you are likely to conclude that you cannot copy after ' +
        'all \u2014 when in fact you can copy perfectly, and have simply never practised anything else.'),
      el('p', {},
        'So once you have ten characters, Settings offers four departures from perfection. They can be ' +
        'used together or one at a time, at two levels.'),
      el('h3', { text: 'The four' }),
      el('ul', {},
        el('li', {}, el('b', { text: 'Fading. ' }),
          'The signal rises and falls slowly, the way a distant station does when the path between you ' +
          'shifts. It never disappears altogether \u2014 that would be a dropout, and copying through one ' +
          'teaches guessing rather than copying.'),
        el('li', {}, el('b', { text: 'Static. ' }),
          'A low hiss with crashes over it. The crashes are the hard part: a crash can swallow a whole ' +
          'character, and the skill is carrying on rather than stopping to mourn it.'),
        el('li', {}, el('b', { text: 'Another station. ' }),
          'A weaker station a few hundred hertz away, sending something else at a different speed. ' +
          'Learning to hold on to the one you want, and let the other become background, is a real ' +
          'skill and it is learnable.'),
        el('li', {}, el('b', { text: 'A hand at the key. ' }),
          'Elements and gaps that vary slightly, and a dah that is a little long or a little short all ' +
          'evening, as one operator\u2019s fist would be. The variation is bounded so the sending stays ' +
          'readable \u2014 you are being given a human operator, not a broken one.'),
      ),
      el('h3', { text: 'Two things worth knowing' }),
      el('p', {},
        el('b', { text: 'Examinations always run on a clean signal' }),
        ', whatever you have chosen here. A certificate has to mean the same thing for every member ' +
        'who holds one, and it cannot if two members sat different examinations.'),
      el('p', {},
        'Your sessions also record ', el('b', { text: 'which level you worked them at' }),
        '. Conditioned sessions score lower than clean ones \u2014 that is the whole point of them \u2014 and ' +
        'without that record your progress would appear to decline the week you switched them on. It ' +
        'does not. You are doing something harder.'),
      el('p', { class: 'hint' },
        'A suggestion rather than a rule: leave them off while a character is new, and switch them on ' +
        'once a lesson feels comfortable. Conditions are for consolidating what you know, not for ' +
        'learning what you do not.'),
    ),

    section(
      'help-keys',
      'Keys and paddles',
      el('p', { class: 'hint' },
        'What you own changes how you practise, and how this app should be set. With no key at all, the ' +
        'bracket keys on your keyboard work: [ for dit, ] for dah.'),
      ...KEY_TYPES.flatMap((key) => [
        el('h3', { text: key.name }),
        el('p', { text: key.how }),
        el('p', { class: 'notice', text: key.inThisApp }),
      ]),
      el('h3', { text: 'Iambic mode A and mode B' }),
      el('p', {},
        'This only matters with a dual-lever paddle, and only in one situation: you squeeze both levers and ' +
        'then release them. In mode A the keyer finishes the element it is sending and stops. In mode B it ' +
        'finishes that element and then sends one more, of the opposite kind.'),
      el('p', { class: 'hint' },
        'Neither is more correct. Pick one and stay with it — the muscle memory is specific to the mode, ' +
        'and switching later means sending stray characters for a week. Mode B is the more common default.'),
      el('h3', { text: 'Getting a USB paddle adaptor working' }),
      el('p', {},
        'Most inexpensive adaptors do not present themselves to the computer as a key or a keyboard. They ' +
        'appear as a mouse, and every dit becomes a real mouse click. This app accepts mouse buttons directly ' +
        'for exactly that reason, so many adaptors work with nothing to configure.'),
      el('p', {},
        'The other common arrangement sends the bracket keys [ and ], which is the convention the VBand ' +
        'online keyer uses. That is this app’s default too, so an adaptor already set up for VBand — ' +
        'including one going through a key-remapping utility — works here untouched.'),
      el('p', { class: 'hint' },
        'If neither works, Settings → Key mapping → "Set dit" captures whatever you press next, keyboard ' +
        'key or mouse button.'),
    ),

    section(
      'help-report',
      'Reading your sending report',
      el('p', { class: 'hint' },
        'After keying, press Analyse on the Send tab. A row of figures comes back, then a report on your ' +
        'timing. They mean different things.'),
      el('h3', { text: 'Speed' }),
      el('p', {}, 'What the app worked out you were sending at, measured from your own dit length.'),
      el('h3', { text: 'Weighting' }),
      el('p', {},
        'Your dah divided by your dit. 3.00 is textbook. Consistently high means a heavy, deliberate fist, ' +
        'which is usually fine. Wildly varying means the dahs are not under control yet.'),
      el('h3', { text: 'Consistency' }),
      el('p', {},
        'How even you were across the whole run. This matters more than it looks. A station sending steadily ' +
        'at a slightly odd weight is easy to copy; one that is accurate on average but erratic element to ' +
        'element is genuinely hard work at the other end.'),
      el('h3', { text: 'The gaps' }),
      el('p', {},
        'Two more figures: the average gap you left inside a letter, and the average gap you left between ' +
        'letters. They are where most unreadable sending comes from, and they are the last thing anyone ' +
        'thinks to check.'),
      el('h3', { text: 'The timing report' }),
      el('p', {},
        'Below the figures, five rows — dit, dah, gap inside a letter, gap between letters, gap between ' +
        'words. Each is drawn twice: what standard Morse asks for, and what you actually sent, both with ' +
        'the length in milliseconds beside them. A row you did not send anything for says so rather than ' +
        'scoring you zero.'),
      el('p', {},
        'The comparison is against your own speed, not the drill speed. Sending faster or slower than you ' +
        'were asked is not an error in itself — what makes sending readable is that the parts keep their ' +
        'proportions: a dah is three dits, the gap inside a letter is one, between letters three, between ' +
        'words seven. If you sent the whole thing at 25 WPM when the drill said 18, every row can still be ' +
        'green. The speed figure is where that shows up.'),
      el('p', { class: 'notice' },
        'Above the rows is one sentence naming the most useful thing to fix. Read that first. If it says ' +
        'your letters are running into each other, nothing else on the page matters until that is sorted: ' +
        'it is the fault that makes sending unreadable even when every dit and dah is perfect.'),
      el('h3', { text: 'Element by element' }),
      el('p', {},
        'Under the report is a fold-out with one row per element of the target, grouped by letter. The pale ' +
        'bar is the ideal length, the solid bar is what you sent — green within 15%, amber within 35%, ' +
        'red beyond. Look for a pattern rather than individual misses: consistently short dahs is worth ' +
        'fixing, one stray dit is not.'),
      el('p', { class: 'hint' },
        'It pairs your elements with the target in order, so one extra or missing element shifts everything ' +
        'after it. When the counts differ it says so. Trust the five rows above it over this.'),
      el('p', { class: 'notice' },
        'If "Match" reads 0%, the decoder did not read back the target text. Either you sent something else, ' +
        'which is fine — the timing figures are still valid — or the tolerance is too tight for your ' +
        'fist. Loosen the tolerance slider before concluding you cannot send.'),
    ),

    section(
      'help-qso',
      'Making a contact',
      el('p', { class: 'hint' },
        'A first contact is more ritual than conversation, which is good news: the shape is always the same, ' +
        'so you can learn it long before you can hold a conversation in Morse.'),
      el('h3', { text: 'The shape of a short contact' }),
      el('pre', { class: 'qso-example', text: QSO_EXAMPLE }),
      el('p', { class: 'notice' },
        'Practise it on the QSO tab. A simulated operator works through the same sequence \u2014 report, ' +
        'name, location, then a rag chew if you want one. It sends on a band with noise and fading rather ' +
        'than in a silent room, and it will repeat anything you miss.'),
      el('h3', { text: 'Answering, and calling' }),
      el('p', {},
        'The QSO tab runs the contact either way round, and they are not the same exercise. Under "Who ' +
        'calls", the default has the simulated operator call CQ and you answer it. The other way round, you ' +
        'call CQ and a station you have never heard comes back to you.'),
      el('p', {},
        'Calling is the harder half and the one worth practising. When you answer a CQ you have already ' +
        'heard the other callsign two or three times before you have to use it. When you call, the first ' +
        'thing that happens is a callsign you have never heard, sent once, in noise, with no warning \u2014 ' +
        'and you have to have it right, because everything after depends on it. That moment is why people ' +
        'listen for years without ever calling CQ.'),
      el('p', { class: 'hint' },
        'It sends the call twice and nothing else, exactly as a real answer does. If you do not get it, ' +
        'send AGN. Everyone does, including operators who have been doing this for forty years.'),
      el('h3', { text: 'Typing your reply, or keying it' }),
      el('p', {},
        'Under "How you reply" you can send your side of the contact on your own key instead of typing it. ' +
        'What you key is decoded as you send, and shown above the pad \u2014 so you can see what the other ' +
        'station is about to hear before it goes.'),
      el('p', {},
        'What the decoder reads is what gets sent. If your callsign comes out wrong, it goes out wrong and ' +
        'the other station answers the callsign you actually sent. That is the point: on the air nobody ' +
        'corrects your sending for you.'),
      el('p', {},
        'A transmission ends when you stop. Leave the key alone for a couple of seconds and it goes, the way ' +
        'it does on the air \u2014 or press "Send it" if you would rather not wait. The pad is live only when ' +
        'it is your turn; while the other station is sending, your key is dead, so your own sidetone cannot ' +
        'play over the top of what you are trying to copy.'),
      el('p', { class: 'hint' },
        'Your key type \u2014 straight or paddle \u2014 and the iambic mode come from the Send tab, and the ' +
        'same keys and mouse buttons work here. Typing stays the default: copying is the harder half, and ' +
        'you should be able to practise contacts without a key plugged in.'),
      el('h3', { text: 'What the station you work is like' }),
      el('p', {},
        'The station that answers you is invented on the spot, but not at random: its callsign, the name it '
        + 'gives and the town it gives all belong together. A station signing EA3 is in Spain and will be '
        + 'called something Spanish; one signing JA1 is in Japan. Copying a callsign and knowing roughly '
        + 'where it is from is a real part of operating, and a robot that paired them at random would have '
        + 'been teaching you the opposite.'),
      el('p', { class: 'hint' },
        'It greets you by the time of day where you are, and it thanks you only for what you actually sent '
        + '\u2014 send it your report and it thanks you for the report; send it nothing but a greeting and it '
        + 'will not pretend otherwise. If it ever appears to answer something you did not send, that is a '
        + 'fault worth reporting.'),

      el('h3', { text: 'If you miss something' }),
      el('p', {},
        'Send AGN (again) or PSE RPT (please repeat), and QRS if they are simply too fast for you. No ' +
        'competent operator minds in the slightest. Asking for a repeat is ordinary practice, not an ' +
        'admission of anything.'),
      el('p', { class: 'hint' },
        'Two habits worth having from the very first contact: send a little slower than you can receive, and ' +
        'send your callsign at the speed you want to be answered at.'),

      el('h3', { text: 'It has to copy you first' }),
      el('p', {},
        'When you answer a CQ, send your own callsign. Until one arrives the station comes back with '
        + 'QRZ? rather than address you \u2014 it will not take your call from your account and pretend to '
        + 'have heard it. That is not the application being difficult: a station that answers a call it '
        + 'could not read is no use to you, because you learn nothing about whether you were readable.'),
      el('p', { class: 'hint' },
        'It works the call you send, not the one you registered with. Practise as a different callsign, '
        + 'as /P, or as a club station and it will come back to that \u2014 and if you send your own call '
        + 'wrong, it will come back to the wrong one, which is exactly what would happen on the air.'),

      el('h3', { text: 'Asking the robot a question' }),
      el('p', {},
        'You can ask the station for any one of the six facts it holds, and it will answer and hand the '
        + 'contact straight back to you, carrying on afterwards from exactly where it paused: NAME? QTH? '
        + 'RIG? ANT? WX? RST? Put the question mark immediately after the word, the way it is sent on the '
        + 'air — a transmission that merely mentions a town is you telling it yours, not asking for its.'),
      el('p', { class: 'hint' },
        'Those six are all it knows. Ask it for power, a QSL route or how long it has been licensed and it '
        + 'will carry on with the contact rather than answer, because inventing a plausible reply would be '
        + 'worse than not hearing the question.'),
    ),

    section(
      'help-band',
      'Working other members on the air',
      el('p', { class: 'notice' },
        'This is Phase 2, now on the "On air" tab for member testing. It needs an ' +
        'account (below) and a connection to the server; everything else in this application ' +
        'still works without either.'),

      el('h3', { text: 'The On air tab, in one minute' }),
      el('ol', { class: 'steps' },
        el('li', { text: 'Sign in, or create an account. Press "Enable sound" if you have not already.' }),
        el('li', { text: 'The band scope is the band, 7 000 to 7 040 kHz, drawn as an SDR draws it: a spectrum ' +
          'along the top and a waterfall beneath, scrolling down. A station shows as a peak and a bright trace ' +
          'only while its key is down, so you see the dits and dahs go by \u2014 the display shows the code being ' +
          'sent, not a carrier that never moves. The noise floor follows the band conditions you choose. Each ' +
          'station carries its callsign above the glass; amber means you can hear it from where you are, a ' +
          'green ring means it is calling CQ, the red line is your dial and the lighter strip either side of it ' +
          'is your passband. Stations on or near the same frequency share one label \u2014 the strongest two by ' +
          'name and "+3" for the rest, as a pile-up \u2014 and the Heard list below names them all. ' +
          'Drag across the glass to tune, or press a station\u2019s marker to land on it.' }),
        el('li', { text: 'The tuning knob beside the readout is the VFO: drag round it and the dial follows, one ' +
          'full turn to the kilohertz, in 10 Hz steps; hold Shift for 100 Hz steps. The wheel and the arrow keys ' +
          'work on it too. For jumps, the buttons beside the readout step 10 Hz, 100 Hz and 1 kHz and the slider ' +
          'sweeps the whole band. "\u25c2 Next" and "Next \u25b8" are a signal scan: they jump the dial down or up to ' +
          'the nearest other station you could hear once tuned to it, landing exactly on its frequency \u2014 a ' +
          'station too weak for your receiver is skipped, one outside your passband still counts, and if there is ' +
          'nobody in that direction nothing happens. Hop with Next, then finish with the knob.' }),
        el('li', { text: '"Heard" lists what is audible from where you are, loudest first, each with a signal ' +
          'bar \u2014 a station too weak or too far off is simply not there, as on the air. "Zero-beat" puts ' +
          'your dial exactly on someone. A caller off your dial is still named, with a "Tune to" button, ' +
          'because a CQ is meant to be found.' }),
        el('li', { text: 'To call: "Find a clear spot", then "Call CQ here" \u2014 that arms your key and marks you ' +
          'as calling. Send CQ on your key; everyone on the band hears it at the pitch their own dial gives it.' }),
        el('li', { text: 'To answer: press "Answer" on a station in the Heard list. Your dial moves onto them, the ' +
          'direct connection is set up (a few seconds; "connecting" then "connected" in the status row) and ' +
          'your key is armed. Then work them as you would on the air.' }),
        el('li', { text: '"End contact" closes it and it goes into both logs. "Leave the band" takes you off the ' +
          'air; nobody hears you and you hear nobody until you come back.' }),
        el('li', { text: 'On a phone or tablet the key pad is your paddle: the left half is dit, the right half ' +
          'dah, and two thumbs squeeze exactly as two paddles do. In straight-key mode the whole pad is the key. ' +
          'The same pad works on the Send and QSO tabs.' })),
      el('p', { class: 'hint' },
        'Contacts are over to over: a fifth of a second or more of buffering makes true break-in impossible, ' +
        'so the application holds your key while the other station is sending and for two and a half seconds ' +
        'after their last element \u2014 the pad turns amber and says "Their over", and the lamp beside it ' +
        'shows whose over it is. Keying during the hold makes no sound and sends nothing; that is not a ' +
        'fault, it is the other station still sending. If the status row says "could not connect", that is ' +
        'the network between you and the server, never your sending \u2014 and it says so.'),
      el('p', { class: 'hint' },
        'Phones drop the connection to the server when the screen locks or you switch apps. When you come back ' +
        'the application reconnects at once, puts you back on your frequency, and ends any contact you were ' +
        'in \u2014 the other station has been told you left \u2014 so just call or answer again. If the "Band" ' +
        'badge says "reconnecting", wait for "on the band" before keying. The badge also shows the round trip ' +
        'to the server in milliseconds; the application checks the connection every fifteen seconds and ' +
        'reconnects by itself if the server has gone quiet, so a station that has really gone disappears from ' +
        'everyone\u2019s band within about half a minute.'),

      el('h3', { text: 'A band, not a chat room' }),
      el('p', {},
        'You will not pick a member from a list. You will pick a frequency, and so will everyone else. ' +
        'Tuning across the band you will hear signals arrive, rise to their proper pitch, and fade away ' +
        'again as you tune past \u2014 which means you can miss someone, exactly as on the air.'),
      el('p', { class: 'hint' },
        'The arithmetic is the arithmetic of a real radio: a station sounds at your chosen pitch when you ' +
        'are tuned onto them, higher when your dial is low, lower when it is high. Getting a station to ' +
        'sound right is zero-beating, and it is the skill this interface exists to teach.'),
      el('p', {},
        'The band-conditions engine from the QSO tab applies here as well: the "Band conditions" choice ' +
        'under the Heard list puts the same noise floor and static under every station you hear, through ' +
        'the same receiver filter, so a contact is worked in noise rather than in a silent room and narrowing ' +
        'the filter quietens the band exactly as it does on your drills, and the fading (QSB) of the preset ' +
        'you choose rides on every station you hear. The stations themselves are at the level the Heard list ' +
        'shows for them, and its signal-to-noise figure is the same arithmetic as your drills.'),

      el('h3', { text: 'What travels between you' }),
      el('p', {},
        'Not audio. Your key-down and key-up times are sent, and the tone is generated again in the other ' +
        'member\u2019s browser at whatever pitch they prefer. Nothing is compressed, so nothing is ' +
        'distorted, and the whole contact costs a few bytes a second.'),
      el('p', { class: 'hint' },
        'Each side holds what arrives for about a fifth of a second before sounding it, which is what lets ' +
        'the timing be rebuilt exactly. The price is that break-in is impossible: contacts are over to ' +
        'over, and you will hear the whole of a transmission before you can answer it.'),

      el('h3', { text: 'When the connection is the problem' }),
      el('p', { class: 'notice warn' },
        'Measured before any of it was built: on a wired connection, on home wifi, and between countries, ' +
        'the elements arrive exactly as sent \u2014 no error at all. On hotel wifi and on a phone ' +
        'they often do not arrive in time, and the application has to work around it.'),
      el('p', {},
        'It does so by delaying what you hear. Every station you hear is played 200 ms behind the sender ' +
        'to give late packets time to arrive. When one is still late, it is played the moment it comes ' +
        '(never thrown away \u2014 a missing element would sound like a sending error) and the delay is ' +
        'grown so the ones behind it are on time. Between overs the delay shrinks back if it can. On a ' +
        'good connection it stays at 200 ms; on a phone on wifi it may settle at half a second or more, ' +
        'and the first over of a contact will sound rough while it learns.'),
      el('p', {},
        'The link line under each heard station tells you what is happening: how many key movements ' +
        'arrived, how many were late, and \u2014 once it has grown \u2014 the delay in use. It turns red when ' +
        'the delay reaches half a second or packets went missing. That is your network or theirs, in ' +
        'those words, and never dressed up as poor conditions or left to look like bad sending. ' +
        'You should never be practising against a fist that the connection wrecked in transit.'),
      el('p', {},
        'If the server itself cannot be reached \u2014 it is down, or you are offline \u2014 the '
        + 'On air tab says so and offers a "Retry" button, rather than hanging on "Checking your session\u2026" '
        + 'or asking you to sign in again. You are still signed in; nothing is lost. Every other tab works '
        + 'without the server, so practice carries on regardless.'),

      el('h3', { text: 'If you are not licensed yet' }),
      el('p', {},
        'You will be able to use all of it. Nothing here goes on the air \u2014 it is two browsers talking to '
        + 'each other \u2014 so no licence is needed for any of it, and there is no sense in which you would be '
        + 'transmitting.'),
      el('p', { class: 'hint' },
        'You will be given a training identifier that looks like a callsign so that copying it is the same '
        + 'exercise, but that no real station anywhere can ever hold: it begins A0, a series the ITU never '
        + 'issues, followed by your initials where they are free \u2014 so Anna Maria Rossi would be A0AMR. It is '
        + 'labelled as a training identifier wherever it appears, contacts made under one are kept out of the '
        + 'ADIF export so nobody uploads practice to a real award by accident, and when you pass your licence '
        + 'your real callsign is added beside it.'),

      el('h3', { text: 'Your account' }),
      el('p', {},
        'Live contacts need an account: a name, an email address and a password of at least ten characters, '
        + 'plus your callsign if you hold one. Your password is never stored, only a one-way hash of it, and '
        + 'a forgotten one is replaced through a link sent to your email that works once and for one hour. '
        + 'You can change it yourself under "Your account" on the Settings tab, giving the current one; '
        + 'changing or resetting it signs out every other device you were signed in on.'),
      el('p', { class: 'hint' },
        'If the reset mail does not arrive within a few minutes, look in your spam or junk folder before asking '
        + 'for another: the server sends from noreply@mikroutik.com, an address you have never written '
        + 'to, and some providers file a first message from one there. Marking it as not spam keeps the next one '
        + 'in your inbox. The link works once and for one hour, so if an older one has expired, ask for a fresh '
        + 'one from "Forgotten password" rather than following the old mail.'),
      el('p', {},
        'A callsign you claim is confirmed by an administrator before it counts as yours. Until then you '
        + 'can practise and go on the band, but your callsign is marked "unconfirmed" wherever it appears and '
        + 'no contact with you is exportable \u2014 so nobody can appear in another member\u2019s log as an '
        + 'operator they are not. A training identifier needs no confirmation; the application issued it.'),
      el('p', {},
        'Your profile \u2014 QTH, grid square, rig, antenna, licence, preferred sidetone and target speed \u2014 '
        + 'lives under "Your account" too. It is the one place these are kept: the sidetone you save there '
        + 'becomes the sidetone this browser uses; the QSO tab\u2019s robot addresses you by your own '
        + 'callsign or training identifier once you have signed in, and by name \u2014 but only after you have '
        + 'sent your name to it, because it copies, it does not read your profile. On the band, whatever you '
        + 'filled in is shown under your callsign to anyone who can hear you, as you would send it in the '
        + 'exchange. Leave a field blank and nothing is shown.'),
      el('p', { class: 'hint' },
        'If you sign in from a second device, the first is signed off the band \u2014 you cannot be on '
        + 'frequency twice. Nothing about your account is shared with anyone else, and the '
        + 'only web page allowed to talk to the server is this one.'),
      el('p', {},
        'Certificates you have earned are listed there too. Each has a "View and print" button, which '
        + 'opens the sheet again exactly as it was issued, and a control for whether the QR square on the '
        + 'printed sheet still resolves. Withdraw it and the verification page answers that there is no '
        + 'such certificate \u2014 not that there used to be one. Put it back whenever you like. Either way '
        + 'the sheet stays yours to open and print from here.'),
      el('p', { class: 'hint' },
        'Closing your account is at the bottom of the same panel. It asks for your password and for your '
        + 'callsign, typed out, because it cannot be undone: the account is emptied, your callsign is '
        + 'released, and your final exam and certificate are deleted outright. Contacts you have already '
        + 'made stay in the other station\u2019s log. Your practice history in this browser is untouched; '
        + 'if you had switched on training records, those are deleted with the account.'),

      el('h3', { text: 'Keeping your training records on the server' }),
      el('p', {},
        'Off unless you ask for it, and worth asking for if you practise on more than one machine. With '
        + 'it on, a summary of each finished session goes to the server: how long it was, the two '
        + 'speeds, how many characters it asked of you and how many you got right, and which characters '
        + 'they were. Your keystrokes are never sent, and nothing from the Send tab or the band.'),
      el('p', {},
        'Two things follow from that. The Progress tab grows a panel called ',
        el('b', { text: 'Across your devices' }),
        ', which is the same report drawn from every machine you practise on rather than this one alone. '
        + 'And when you sign in somewhere else, the application takes whichever position is further on \u2014 '
        + 'yours here, or the server\u2019s \u2014 so a lesson you unlocked on the train is where you start at '
        + 'the desk. It never moves you backwards: a character you have unlocked stays unlocked.'),
      el('p', { class: 'hint' },
        'Nobody else can read it, not an administrator and not another member. You will find the switch '
        + 'in Your account on the Settings tab, and at registration. Turning it off deletes what the '
        + 'server holds at once, '
        + 'and it leaves the nightly backups within fourteen days; turn it on again later and it starts '
        + 'empty. A session finished while you were offline goes up the next time the application can '
        + 'reach the server \u2014 there is nothing to press.'),

      el('h3', { text: 'For administrators' }),
      el('p', {},
        'A member whose role is administrator sees an extra tab, ADMIN, at the end of the tab bar. It appears '
        + 'when such a member signs in on the On air tab and goes again when they sign out; no other member ever '
        + 'sees it. Hiding it only keeps the interface tidy \u2014 the server refuses every '
        + 'administrator\u2019s request from an account that is not one, whether or not the tab is on screen.'),
      el('p', {},
        'The tab carries what used to sit at the foot of the On air tab: '
        + 'the four actions an administrator has and nothing more \u2014 confirm a callsign (or withdraw the '
        + 'confirmation), force a password reset, disable an account (and enable it again), and delete one; '
        + 'a member muted from the band also gets an "Unmute" button there, so a 24-hour mute can be lifted early. '
        + 'Members whose callsigns are waiting on you are listed first and marked. Delete is drawn in red, as the '
        + 'one action on the page that cannot be undone from it.'),
      el('p', {},
        'The count at the top of the list counts members, not rows: a deleted account is not a member, so '
        + 'three rows of which two are deleted read "1 member \u00B7 2 deleted". The deleted ones are folded '
        + 'away under that line and can be opened if you want to see them. They are kept rather than removed '
        + 'because the moderation log and other members\u2019 contacts point at them, and the record '
        + 'of who was disciplined should not quietly lose its subject.'),
      el('p', { class: 'hint' },
        'Every action asks for a reason and is logged with it. A forced reset signs the member out everywhere '
        + 'and mails them a link; the administrator never sees the link. Deleting empties the account and '
        + 'releases the callsign for someone else to register; past contacts keep the callsign as text, so '
        + 'the other station\u2019s log is not rewritten. Reports members have sent from the band are listed '
        + 'under the members, open ones first, with a button to mark each dealt with. Muting and removing a '
        + 'member from the band itself is done from their row in the Heard list, as before; removing is the '
        + 'same as disabling.'),

      el('h3', { text: 'Your log, and exporting it' }),
      el('p', {},
        'Both sides get the contact in their log automatically the moment it ends; "Your log" at the foot of ' +
        'the On air tab lists them, newest first. Each row has three boxes for the exchange: the RST you sent, ' +
        'the RST you received, and a note \u2014 type 5NN or 599, either is accepted, and it is saved when you ' +
        'leave the box. These are your own account of the contact; the other station keeps theirs. "Export ' +
        'ADIF" downloads a file every logging program imports \u2014 one record per contact with the other ' +
        'station\u2019s callsign, date and time in UTC, frequency, band, mode, and the RST and note if you ' +
        'wrote them.'),
      el('p', { class: 'hint' },
        'Two things are deliberate. A contact with a training identifier stays in your log but is never ' +
        'exported, because A0 is not a callsign and no logging program should be handed it as one. And every ' +
        'exported record says in its comment that it was a practice contact on this virtual band, not an ' +
        'on-air QSO, so a log merged with your real one still tells the truth about each row.'),

      el('h3', { text: 'Who can see a contact' }),
      el('p', {},
        'An administrator can monitor an active contact and can mute or remove ' +
        'a member, and you can report abuse from inside a contact without leaving it first: "Report" on a ' +
        'station\u2019s row asks what happened and sends it to the administrators together with a transcript ' +
        'of what that station sent, decoded by your browser as a machine would copy it. Nothing you sent is ' +
        'included, and no transcript is kept or shown at any other time \u2014 copying by ear is the point.'),
      el('p', { class: 'hint' },
        'Anyone you work sees whatever you put in your profile, in the same way you would send it in a real ' +
        'contact \u2014 leave a field blank and nothing is shown.'),
      el('p', { class: 'hint' },
        el('span', { text: 'What is held on the server, who else can see it and how long it is kept is '
          + 'written out in the ' }),
        el('a', { href: PRIVACY_URL, target: '_blank', rel: 'noopener', text: 'privacy notice' }),
        el('span', { text: '. You can close your account yourself at any time \u2014 "Your account" on the '
          + 'Settings tab.' })),
    ),

    section(
      'help-codes',
      'Q codes, abbreviations and prosigns',
      el('h3', { text: 'Q codes' }),
      el('p', { class: 'hint' },
        'Three-letter codes that ask a question with a "?" after them and state a fact without one. They ' +
        'exist because they are quick to send and mean the same thing in every language.'),
      el('div', { class: 'scroll-x' },
        el('table', {},
          el('thead', {}, el('tr', {},
            el('th', { text: 'Code' }),
            el('th', { text: 'As a question' }),
            el('th', { text: 'As a statement' }))),
          el('tbody', {}, ...Q_CODES.map((q) =>
            el('tr', {},
              el('td', {}, el('b', { text: q.code })),
              el('td', { text: q.question }),
              el('td', { text: q.answer })))))),
      el('h3', { text: 'Abbreviations' }),
      el('p', { class: 'hint' },
        'Vowels get dropped and common words get shortened, because every character costs time.'),
      el('div', { class: 'scroll-x' },
        el('table', {},
          el('tbody', {}, ...ABBREVIATIONS.map((a) =>
            el('tr', {},
              el('td', {}, el('b', { text: a.short })),
              el('td', { text: a.meaning })))))),
      el('h3', { text: 'Prosigns' }),
      el('p', {},
        'A prosign is two letters sent with no gap between them, so they arrive as one long character rather ' +
        'than as two. That is the whole trick: because it is not a gap-separated letter pair, it cannot be ' +
        'mistaken for text. Prosigns are punctuation and traffic control — they tell the other operator ' +
        'what you are doing, not what you are saying.'),
      el('p', { class: 'hint' },
        'In writing they are shown with a bar over the top (AR), or in angle brackets. This app uses angle ' +
        'brackets, so the prosigns lesson sends things like <AR> and <SK>.'),

      el('h4', { text: 'Ending a transmission: K, KN, AR and SK' }),
      el('p', {},
        'This is where nearly every beginner mistake happens, because all four mean roughly "I have stopped ' +
        'sending" and they are not interchangeable.'),
      el('div', { class: 'scroll-x' },
        el('table', {},
          el('thead', {}, el('tr', {},
            el('th', { text: 'Send' }),
            el('th', { text: 'It means' }),
            el('th', { text: 'Use it when' }))),
          el('tbody', {}, ...HANDOVER_SIGNALS.map((h) =>
            el('tr', {},
              el('td', {}, el('b', { text: h.signal })),
              el('td', { text: h.means }),
              el('td', { text: h.sendItWhen })))))),
      el('p', { class: 'hint' },
        'In one sentence: K after a CQ, KN for the rest of the contact, SK once at the very end.'),

      el('h4', { text: 'Where they fall in a real contact' }),
      el('pre', { class: 'qso-example', text: PROSIGN_EXAMPLE }),

      el('h4', { text: 'Every prosign, and when to send it' }),
      el('div', { class: 'scroll-x' },
        el('table', {},
          el('thead', {}, el('tr', {},
            el('th', { text: 'Prosign' }),
            el('th', { text: 'Sound' }),
            el('th', { text: 'Means' }),
            el('th', { text: 'Send it when' }))),
          el('tbody', {}, ...PROSIGN_NOTES.map((p) =>
            el('tr', {},
              el('td', {}, el('b', { text: p.name })),
              el('td', { class: 'mono', text: visual(patternFor(p.token) ?? '') }),
              el('td', { text: p.meaning }),
              el('td', { text: p.when })))))),

      el('h4', { text: 'Mistakes worth avoiding' }),
      el('ul', { class: 'steps' }, ...PROSIGN_MISTAKES.map((m) => el('li', { text: m }))),
      el('p', { class: 'notice' },
        'Practise them: choose the "Prosigns" lesson on the Receive tab to learn the sounds, and send them ' +
        'yourself on the Send tab. They are short, there are only a handful, and getting them right is most ' +
        'of what makes a contact sound competent.'),
    ),

    section(
      'help-glossary',
      'Glossary',
      el('p', { class: 'hint' }, 'Every term this application puts on screen, explained once.'),
      el('dl', { class: 'glossary' },
        ...GLOSSARY.flatMap((entry) => [
          el('dt', { text: entry.term }),
          el('dd', { text: entry.definition }),
        ])),
    ),

    section(
      'help-trouble',
      'When something is not working',
      el('h3', { text: 'No sound at all' }),
      el('p', {},
        'Click "Enable sound" in the header. Browsers block audio until you interact with the page, so this ' +
        'is not optional and it is not a fault.'),
      el('h3', { text: 'The paddle does nothing' }),
      el('p', {},
        'Press [ on your keyboard. If that makes a tone, the app is fine and the problem lies between the ' +
        'paddle and the computer — check the adaptor is enabled in whatever remapping utility you use. If ' +
        '[ does nothing either, check you pressed "Arm the key" and then clicked the keying area so that it ' +
        'has keyboard focus.'),
      el('h3', { text: 'I changed headphones and the sound stopped' }),
      el('p', {},
        'Connecting AirPods or any other Bluetooth output, or unplugging a monitor with speakers in it, ' +
        'can leave the browser\u2019s audio still pointed at the device that went away. The app watches for ' +
        'this and rebuilds its audio automatically, which takes a second or two \u2014 you will see a message ' +
        'saying it reconnected.'),
      el('p', {},
        'If it does not come back by itself, press "Restart audio" in the header. That is the same button as ' +
        '"Enable sound"; it changes its name once audio has been started at least once.'),
      el('p', { class: 'notice warn' },
        'Bluetooth headphones are fine for receiving practice, but not for sending: they add 100\u2013200 ms ' +
        'between your key and the tone, which no software can remove. Check the latency panel on the Send ' +
        'tab \u2014 it will turn red and say so.'),
      el('h3', { text: 'The tone lags behind the key' }),
      el('p', {},
        'Look at the latency panel on the Send tab; over about 60 ms it turns red. The usual cause is ' +
        'Bluetooth headphones or a Bluetooth speaker, which add 100–200 ms that no software can remove. ' +
        'Switch to wired output or the built-in speakers, then click "Enable sound" again.'),
      el('h3', { text: 'The latency figure is stuck high after using Bluetooth headphones' }),
      el('p', {},
        'Once Bluetooth headphones have been used, the browser keeps reporting their delay \u2014 over ' +
        '200 ms \u2014 for the rest of its life, even with the headphones disconnected and the built-in ' +
        'speakers selected. Reloading the page does not clear it, and neither does closing the window.'),
      el('p', { class: 'notice' },
        'Quitting the browser completely does clear it. On a Mac that means \u2318Q, not just closing the ' +
        'window \u2014 closing the last window leaves the application running. Measured on one Mac: 190 ms ' +
        'before a full quit, 8.9 ms after.'),
      el('p', {},
        'Either way, press "Measure for real" first. It tells you whether the delay is genuinely there or ' +
        'the browser is simply reporting a stale number, and those two need very different responses.'),
      el('h3', { text: '"Measure for real" says only some of the clicks were heard' }),
      el('p', {},
        'The measurement plays seven short clicks and times each one through your microphone. If it ' +
        'reports that only one or two were heard, the microphone is not picking them out of the room ' +
        'often enough to average, and the figure it managed is not worth trusting. Turn the output volume ' +
        'up, play through speakers rather than headphones so the microphone can actually hear them, and ' +
        'run it again somewhere quiet. The room and click levels it saw are printed beside every ' +
        'message it prints, trustworthy readings included, ' +
        'and the line under the button will tell you how many clicks were heard rather than offering a ' +
        'figure it cannot stand behind.'),
      el('p', { class: 'notice' },
        'This is a different fault from readings that disagree, and it needs the opposite fix — louder ' +
        'rather than quieter. Until 0.8.8 both were reported as disagreement, which sent people looking ' +
        'for a quieter room when the click simply was not loud enough to hear.'),
      el('p', {},
        'Safari on a Mac is a special case, and no amount of volume will help there. It removes sound ' +
        'the machine has just played from what the microphone hears — which is useful on a video call ' +
        'and is exactly what this measurement needs it not to do. Measured on one Mac: a steady tone, ' +
        'clearly audible across the room, reached Safari\u2019s microphone about 23 dB quieter than it ' +
        'reached Chrome\u2019s and Firefox\u2019s through the same speaker at the same volume, which is to ' +
        'say barely at all. From 0.8.11 the application recognises this and says so rather than telling ' +
        'you to turn the volume up. Run the measurement once in Chrome or Firefox instead; the delay it ' +
        'finds belongs to the machine more than to the browser.'),
      el('p', {},
        'From 0.8.12 that recognition no longer depends on how many clicks survived. Six runs in Safari ' +
        'on one Mac each returned exactly three readings, which was just enough to count as a ' +
        'measurement, and one of the six agreed with itself closely enough to be published as a figure ' +
        'of 107 ms — while Chrome on the same machine, through the same speaker, in the same room, ' +
        'measured 64 ms. Whether the sound reached the microphone is now judged from the recorded levels ' +
        'before anything is said about the readings, so a run that timed nothing can no longer be ' +
        'reported as a measurement however neatly its readings agree.'),
      el('p', {},
        'Every message about a measurement now carries the levels behind it. From 0.8.13 those levels ' +
        'are given for each of the seven runs separately rather than as one figure for the lot. The ' +
        'single figure was a maximum, and a maximum over seven runs is simply whichever run was ' +
        'loudest: on one Mac, Chrome having heard all seven clicks and Safari having heard two ' +
        'produced totals within twelve per cent of each other. Nothing can be diagnosed from a number ' +
        'like that. Each run now shows its own room level, its own loudest moment and whether its ' +
        'click was heard, which is what separates a click that was taken away from one that arrived ' +
        'and was not recognised.'),
      el('p', {},
        'Raising the volume is no longer suggested when the click is already arriving loudly. On the ' +
        'runs that did work it was reaching nearly seventy times the room level, so loudness was ' +
        'plainly not the problem, and the application was saying so anyway. Taken to maximum output it ' +
        'recovered nothing at all and the microphone input began to clip instead.'),
      el('p', {},
        'From 0.8.14 the measurement plays one click before the seven it counts, and throws the result ' +
        'away. The first click used to be taken before the recorder had settled, and it was unreliable ' +
        'in both directions: on one machine it reported no room level at all, which lets anything count ' +
        'as a click, and on the same machine at a different volume it reported nothing recorded after ' +
        'the click was played. A run with no room measured behind it is now marked unusable and takes ' +
        'no part in any conclusion, rather than being read as a click that was heard.'),
      el('h3', { text: '"Measure for real" says the input is overloading' }),
      el('p', {},
        'Recorded sound runs from minus one to plus one. Anything beyond that is the input being driven ' +
        'past what it can represent, and the recording is clipped — the tops of the waveform are ' +
        'simply cut off. One Mac at maximum output reached 2.02, more than double. It matters here ' +
        'because the measurement recognises the click by its shape, and clipping is exactly the ' +
        'destruction of that shape, so a clipped run cannot be timed however loud it looks. ',
        el('b', { text: 'Turn the output volume down' }),
        ' and measure again. This is the one case where the answer is less volume rather than more.'),
      el('h3', { text: 'The measured figure and the 60 ms limit are not the same quantity' }),
      el('p', {},
        'The 60 ms the panel warns about is the one-way path: your key press to the first moment of the ' +
        'sidetone. A measurement is a round trip — out through the speaker, across the room, and back in ' +
        'through the microphone, which has its own delay your sidetone never passes through. The round ' +
        'trip is always the larger of the two, typically by thirty-odd milliseconds, so it is read as an ' +
        'upper bound rather than compared with the limit directly. Until 0.8.11 the coloured badge did ' +
        'compare it directly, and could show a measured figure in red while the note beneath it said the ' +
        'delay was probably fine. The note was the one telling the truth.'),
      el('p', {},
        'From 0.8.10 the measurement times each click on the audio thread rather than on the main one, ' +
        'and recognises it by its shape rather than by its loudness. In plain terms it is steadier: the ' +
        'spread between readings should be smaller than it used to be, and a click heard faintly is ' +
        'more likely to be timed correctly rather than a millisecond or two late.'),
      el('h3', { text: 'My progress has disappeared' }),
      el('p', {},
        'Progress lives in this browser, on this device, at this address. It does not follow you to another ' +
        'browser, and clearing your browsing data removes it. Export regularly from Settings — that file ' +
        'is the only backup that exists.'),
      el('h3', { text: 'It will not work offline' }),
      el('p', {},
        'Offline needs the version served from a web address rather than a file opened from your disk. Load ' +
        'the app from its address once while connected, and it will work without a connection after that \u2014 ' +
        'on a train, in the car park, at a shack with no wifi.'),
      el('p', { class: 'hint' },
        'If it still will not, something is clearing your browsing data on quit. Safari\u2019s "Prevent ' +
        'cross-site tracking" does not do this, but privacy extensions and "clear on exit" settings do, and ' +
        'they take your practice history with them.'),
      el('h3', { text: 'Keeping it on your phone or dock' }),
      el('p', {},
        'It installs like an app and then opens without the browser furniture around it. On an iPhone or ' +
        'iPad: the Share button, then "Add to Home Screen". On Android, or desktop Chrome and Edge: an ' +
        'install icon appears in the address bar, or look under the browser menu for "Install".'),
      el('p', { class: 'hint' },
        'Installed or not, it is the same application and the same stored progress. Installing only changes ' +
        'how you reach it \u2014 and makes it rather harder to lose.'),
    ),
  );

  return { node };
}
