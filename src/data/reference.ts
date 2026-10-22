/**
 * Reference content for the Help page.
 *
 * Kept as plain data in one file so an operator can correct or extend it
 * without touching any application code — the same reasoning as the robot
 * QSO slot values in wordlists.ts.
 */

export interface QCode {
  code: string;
  /** What it means when sent as a question (with a "?"). */
  question: string;
  /** What it means as a statement. */
  answer: string;
}

/** The Q codes a member will actually meet in a CW contact. */
export const Q_CODES: readonly QCode[] = [
  { code: 'QRL', question: 'Is this frequency busy?', answer: 'This frequency is busy.' },
  { code: 'QRM', question: 'Are you being interfered with?', answer: 'I am being interfered with by another station.' },
  { code: 'QRN', question: 'Are you troubled by static?', answer: 'I am troubled by static and atmospheric noise.' },
  { code: 'QRO', question: 'Shall I increase power?', answer: 'Increase power.' },
  { code: 'QRP', question: 'Shall I decrease power?', answer: 'Decrease power. (Also: operating at low power.)' },
  { code: 'QRQ', question: 'Shall I send faster?', answer: 'Send faster.' },
  { code: 'QRS', question: 'Shall I send more slowly?', answer: 'Send more slowly. The most useful code a learner can send.' },
  { code: 'QRT', question: 'Shall I stop sending?', answer: 'I am closing down.' },
  { code: 'QRU', question: 'Have you anything for me?', answer: 'I have nothing for you.' },
  { code: 'QRV', question: 'Are you ready?', answer: 'I am ready.' },
  { code: 'QRX', question: 'When will you call again?', answer: 'Wait — stand by.' },
  { code: 'QRZ', question: 'Who is calling me?', answer: 'You are being called by…' },
  { code: 'QSB', question: 'Are my signals fading?', answer: 'Your signals are fading.' },
  { code: 'QSL', question: 'Can you acknowledge receipt?', answer: 'I acknowledge receipt. (Also: a confirmation card.)' },
  { code: 'QSO', question: 'Can you contact… directly?', answer: 'A contact between two stations.' },
  { code: 'QSY', question: 'Shall I change frequency?', answer: 'Change to another frequency.' },
  { code: 'QTH', question: 'What is your location?', answer: 'My location is…' },
  { code: 'QTR', question: 'What is the correct time?', answer: 'The time is…' },
];

export interface Abbreviation {
  short: string;
  meaning: string;
}

/** Everyday CW shorthand, roughly in order of how often it appears. */
export const ABBREVIATIONS: readonly Abbreviation[] = [
  { short: 'CQ', meaning: 'Calling any station' },
  { short: 'DE', meaning: 'From (precedes the caller’s own callsign)' },
  { short: 'K', meaning: 'Over — any station may reply' },
  { short: 'KN', meaning: 'Over — only the station I named may reply' },
  { short: 'R', meaning: 'Roger, received' },
  { short: 'UR', meaning: 'Your / you are' },
  { short: 'RST', meaning: 'Signal report: readability, strength, tone' },
  { short: '5NN', meaning: '599, said quickly — contest shorthand' },
  { short: 'OM', meaning: 'Old man — any male operator' },
  { short: 'YL', meaning: 'Young lady — any female operator' },
  { short: 'XYL', meaning: 'Wife' },
  { short: 'ES', meaning: 'And' },
  { short: 'HR', meaning: 'Here' },
  { short: 'HW?', meaning: 'How do you copy me?' },
  { short: 'TU', meaning: 'Thank you' },
  { short: 'TNX / TKS', meaning: 'Thanks' },
  { short: 'PSE', meaning: 'Please' },
  { short: 'SRI', meaning: 'Sorry' },
  { short: 'AGN', meaning: 'Again — please repeat' },
  { short: 'RPT', meaning: 'Repeat' },
  { short: 'FB', meaning: 'Fine business — good, excellent' },
  { short: 'WX', meaning: 'Weather' },
  { short: 'ANT', meaning: 'Antenna' },
  { short: 'PWR', meaning: 'Power' },
  { short: 'RIG', meaning: 'Radio equipment' },
  { short: 'GM / GA / GE', meaning: 'Good morning / afternoon / evening' },
  { short: 'CUL', meaning: 'See you later' },
  { short: 'DX', meaning: 'Distant station, long-distance contact' },
  { short: 'BK', meaning: 'Break — passing back briefly' },
  { short: 'CFM', meaning: 'Confirm' },
  { short: 'NR', meaning: 'Number' },
  { short: 'HI', meaning: 'Laughter' },
  { short: '73', meaning: 'Best regards — how a contact ends' },
  { short: '88', meaning: 'Love and kisses — to a spouse or close friend' },
];

export interface Prosign {
  token: string;
  name: string;
  meaning: string;
  /** When a member should actually send it. */
  when: string;
}

/**
 * Prosigns are sent as one run of elements with no gap inside, which is why
 * they are not simply the two letters side by side. The `when` field matters
 * more than the meaning: knowing that SK means "end of contact" does not stop
 * a beginner sending it in the middle of one.
 */
export const PROSIGN_NOTES: readonly Prosign[] = [
  {
    token: '<KN>',
    name: 'KN',
    meaning: 'Over \u2014 but only the station I named may reply.',
    when:
      'Handing over inside a contact, when you do not want a third station joining in. ' +
      'This is the one to use for most of a QSO.',
  },
  {
    token: '<AR>',
    name: 'AR',
    meaning: 'End of message. Nothing more to say in this transmission.',
    when:
      'Closing a transmission where no particular reply is invited yet \u2014 for example when calling a ' +
      'specific station that has not answered you. Often followed immediately by K.',
  },
  {
    token: '<BT>',
    name: 'BT',
    meaning: 'Separator \u2014 a new paragraph. Written as "=".',
    when:
      'Between the parts of your transmission: after the greeting, after the signal report, after the name. ' +
      'Also the polite thing to send while you think, instead of going silent.',
  },
  {
    token: '<SK>',
    name: 'SK',
    meaning: 'End of contact. This exchange is finished for good.',
    when:
      'On your final transmission only, after the 73. Sending it earlier tells the other operator you are ' +
      'leaving, which is rarely what a beginner means.',
  },
  {
    token: '<AS>',
    name: 'AS',
    meaning: 'Wait, stand by.',
    when:
      'When you need a few seconds \u2014 someone at the door, a note to find. Seconds, not minutes; for a ' +
      'longer wait send QRX with a time.',
  },
  {
    token: '<VE>',
    name: 'VE',
    meaning: 'Understood, received correctly.',
    when: 'Acknowledging something specific. Much less common than a plain R.',
  },
  {
    token: '<SOS>',
    name: 'SOS',
    meaning: 'Distress. A life is in danger.',
    when:
      'Never in practice, and never on the air unless it is real. It is in this table so you recognise it ' +
      'if you ever hear it.',
  },
];

/**
 * The end-of-transmission signals, which is where nearly every beginner's
 * mistake happens. K is a plain character rather than a prosign, but it
 * belongs in this comparison because the choice is between all four.
 */
export interface HandoverSignal {
  signal: string;
  means: string;
  sendItWhen: string;
}

export const HANDOVER_SIGNALS: readonly HandoverSignal[] = [
  {
    signal: 'K',
    means: 'Over \u2014 anyone may reply.',
    sendItWhen: 'At the end of a CQ call, when you want any station at all to come back to you.',
  },
  {
    signal: 'KN',
    means: 'Over \u2014 named station only.',
    sendItWhen: 'Mid-contact, handing back to the station you are working. Keeps others from breaking in.',
  },
  {
    signal: 'AR',
    means: 'End of message.',
    sendItWhen:
      'Finishing a transmission that does not invite an immediate reply \u2014 typically when calling a ' +
      'specific station that has not yet answered. Usually sent as "AR K".',
  },
  {
    signal: 'SK',
    means: 'End of contact.',
    sendItWhen: 'Your very last transmission of the QSO, after 73. Not before.',
  },
];

/** The mistakes worth warning about before a first contact. */
export const PROSIGN_MISTAKES: readonly string[] = [
  'Sending SK in the middle of a contact. It means you are leaving, and a polite operator will simply say ' +
  '73 and go. Use KN to hand back instead.',
  'Sending K instead of KN during a QSO, then wondering why a third station replied. K invites everybody.',
  'Sending the letters separately. A R with a normal gap between them is the word "AR", not the prosign \u2014 ' +
  'the whole point is that the elements run together with no gap, so it sounds like one long character.',
  'Leaving out BT entirely, so the transmission arrives as one unbroken wall. The separators are what make ' +
  'a message readable at the other end.',
  'Sending 73 more than once, or sending "73s". It is already plural \u2014 it means "best regards".',
];

export interface KeyType {
  name: string;
  how: string;
  /** How this app handles it, or that it does not. */
  inThisApp: string;
}

export const KEY_TYPES: readonly KeyType[] = [
  {
    name: 'Straight key',
    how:
      'One lever, pressed down and released. You time every dit, every dah and every gap yourself. ' +
      'Nothing is generated for you, which is why a straight key shows a beginner’s unevenness plainly — ' +
      'and why it is the honest place to learn what good timing feels like.',
    inThisApp: 'Fully supported. Choose "Straight key" on the Send tab. The decoder judges your own timing.',
  },
  {
    name: 'Iambic (dual-lever) paddle',
    how:
      'Two levers side by side: one makes dits, the other dahs, and an electronic keyer generates them at a ' +
      'set speed for as long as you hold. Squeezing both at once produces alternating dits and dahs — ' +
      'the "iambic" part, named for the alternating rhythm. This is what most operators use today.',
    inThisApp: 'Fully supported, modes A and B. The keyer is built in, so the speed comes from the app, not from hardware.',
  },
  {
    name: 'Single-lever paddle',
    how:
      'One lever that rocks left and right rather than two separate ones. Dits one way, dahs the other. ' +
      'Because you cannot press both at once, squeeze (iambic) sending is impossible — every element is ' +
      'deliberate. Some very fast operators prefer it for exactly that reason.',
    inThisApp:
      'Use the "Iambic paddle" setting. Everything works; the squeeze behaviour simply never comes up, ' +
      'so mode A and mode B make no difference to you.',
  },
  {
    name: 'Bug (semi-automatic key)',
    how:
      'A mechanical key with a weighted pendulum that makes a string of dits automatically while you form ' +
      'every dah by hand. Invented to save operators’ wrists in the telegraph era. It gives a distinctive, ' +
      'slightly uneven "swing" that experienced operators can recognise.',
    inThisApp:
      'Use "Straight key" mode and key it directly — the app will not generate anything for you, which is ' +
      'what a bug needs. The decoder tolerance may need loosening for a bug’s characteristic swing.',
  },
  {
    name: 'Sideswiper (cootie)',
    how:
      'A single springy lever worked side to side, where both directions simply close the contact. ' +
      'All timing is manual, like a straight key, but the sideways motion is easier on the wrist.',
    inThisApp: 'Use "Straight key" mode.',
  },
];

export interface GlossaryEntry {
  term: string;
  definition: string;
}

/** Every term this application puts on screen, explained once. */
export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: 'Dit and dah',
    definition:
      'The two elements Morse is built from — the short one and the long one. Say them aloud as "dit" and ' +
      '"dah" rather than "dot" and "dash": Morse is a sound, and naming it as a sound is how it stays one.',
  },
  {
    term: 'Element',
    definition: 'One dit or one dah. The letter C (dah-di-dah-dit) is four elements.',
  },
  {
    term: 'WPM (words per minute)',
    definition:
      'Speed, measured against the standard word PARIS, which takes exactly 50 dit-lengths to send. ' +
      'At 20 WPM a dit is 60 milliseconds, because 1200 divided by 20 is 60.',
  },
  {
    term: 'Character speed',
    definition: 'How fast the characters themselves are sent. This is the rhythm you are learning to recognise.',
  },
  {
    term: 'Effective speed',
    definition:
      'The overall speed once the gaps between characters are counted. Always the same as, or slower than, ' +
      'the character speed.',
  },
  {
    term: 'Farnsworth spacing',
    definition:
      'Sending the characters quickly but leaving extra silence between them. You hear each character at its ' +
      'true, final rhythm from the first lesson, while the gaps give you time to think. As you improve you ' +
      'shorten the gaps rather than relearning the characters.',
  },
  {
    term: 'Koch method',
    definition:
      'Start at full speed with just two characters, and add one more only when you are copying at 90%. ' +
      'The alternative — learning all forty slowly and speeding up — teaches you to count elements, a habit ' +
      'that has to be painfully unlearned around 10 WPM.',
  },
  {
    term: 'Weighting',
    definition:
      'The length of a dah measured in dits. Textbook is exactly 3. A heavier weighting (3.2, say) sounds ' +
      'more deliberate and is often easier to copy; lighter sounds hurried. Your own weighting is one of the ' +
      'things that makes your sending recognisable.',
  },
  {
    term: 'Fist',
    definition:
      'Your personal sending style — your weighting, your spacing, your hesitations. A good fist is even and ' +
      'easy to copy. Operators genuinely recognise each other by fist alone.',
  },
  {
    term: 'Sidetone',
    definition: 'The tone you hear while keying. It is generated locally and is not transmitted anywhere.',
  },
  {
    term: 'Envelope (rise and fall)',
    definition:
      'How quickly the tone fades up and down at the start and end of each element. Switching it on and off ' +
      'instantly produces a click that is tiring to listen to and splatters across the band on the air. ' +
      'Four to eight milliseconds is right.',
  },
  {
    term: 'Latency',
    definition:
      'The delay between pressing the key and hearing the tone. Under about 60 ms you stop noticing; much ' +
      'above it you are practising against a delay that will not be there on the air. Bluetooth audio adds ' +
      '100–200 ms and cannot be fixed in software.',
  },
  {
    term: 'Decoder tolerance',
    definition:
      'How forgiving the app is when judging your sending. Loose while you are starting out, tightened as ' +
      'you improve so it starts holding you to real timing.',
  },
  {
    term: 'Consistency',
    definition:
      'How even your elements are across a whole run. Being consistently slightly wrong is far easier to ' +
      'copy than being erratically almost right, which is why this is scored separately from accuracy.',
  },
  {
    term: 'Confusion matrix',
    definition:
      'A grid of what was sent against what you typed. It turns "I keep making mistakes" into "I hear S as H", ' +
      'which you can actually drill.',
  },
  {
    term: 'Prosign',
    definition:
      'Two letters run together with no gap between them, acting as a piece of punctuation rather than ' +
      'letters — see the list further down.',
  },
  {
    term: 'QSO',
    definition: 'A contact — one complete exchange between two stations.',
  },
  {
    term: 'RST',
    definition:
      'The signal report: readability 1–5, strength 1–9, tone 1–9. "599" means perfectly readable, extremely ' +
      'strong, perfect tone — and is sent so routinely that it often means little.',
  },
  {
    term: 'Callsign',
    definition:
      'The identifier issued to a licensed station, such as A65XY. It is yours alone and it is a legal ' +
      'requirement to identify with it on the air.',
  },
];
