/**
 * The robot operator (RFP §6).
 *
 * A template state machine, explicitly not free text generation: a student
 * learning their first contacts needs the shape to be the same every time,
 * and a machine that improvises teaches nothing reliable. The templates are
 * the ordinary ritual of a short contact, which is exactly what a beginner
 * has to be able to get through before anything else.
 *
 * Pure: takes what the student sent, returns the new state and what the robot
 * says next. No audio, no DOM, no timers — so every branch of the contact,
 * including the awkward ones, is unit-tested.
 */

import type { Random } from './random';
import { ROBOT_ANTENNAS, ROBOT_RIGS, ROBOT_STATIONS, ROBOT_WEATHER } from '../data/wordlists';

export type Stage =
  | 'awaiting-cq'  // the band is open and nobody has transmitted; the student calls
  | 'calling'      // robot has sent CQ, waiting to be answered
  | 'answered'     // robot has come back to the student's CQ, waiting for their report
  | 'exchange'     // robot has sent its report, name and QTH
  | 'ragchew'      // robot has sent rig, antenna and weather
  | 'signoff'      // robot has sent 73 and SK
  | 'complete'
  | 'abandoned';

/**
 * Which way round the contact runs.
 *
 * 'answering' is the original: the robot calls CQ and the student comes back
 * to it. 'calling' is the other half of the skill and the half a member needs
 * before they ever call CQ on the air for the first time — the student sends
 * the CQ and a station they have never heard before answers. Copying an
 * unknown callsign out of the noise, cold, is the part that frightens people
 * off calling CQ, and it is exactly the part the original direction never
 * asked of them.
 */
export type QsoRole = 'answering' | 'calling';

export type Difficulty = 'machine' | 'variable' | 'human';

export interface RobotProfile {
  callsign: string;
  name: string;
  qth: string;
  rig: string;
  antenna: string;
  weather: string;
  /** The report the robot gives the student. */
  rst: string;
  wpm: number;
  /** GM, GA or GE — whichever is true where the member is sitting. */
  greeting: string;
}

export interface QsoOptions {
  studentCallsign: string;
  /**
   * The student's name, from their profile (§8: "these fields feed the robot
   * QSO"). The robot uses it only once the student has actually SENT it —
   * an operator who calls you by a name you never gave has not been
   * listening, and this robot is careful about that (see carriesReport).
   */
  studentName?: string;
  role: QsoRole;
  difficulty: Difficulty;
  /** Whether to include the rag chew, which RFP §6 makes optional. */
  ragchew: boolean;
  random: Random;
  /** Speed the robot starts at; QRS lowers it. */
  wpm: number;
  /**
   * Local hour, 0–23, for the greeting. Passed in rather than read from a
   * clock so this module stays pure and the greeting is testable; the caller
   * supplies `new Date().getHours()`.
   */
  hour?: number;
}

export interface QsoState {
  stage: Stage;
  role: QsoRole;
  robot: RobotProfile;
  studentCallsign: string;
  studentName?: string;
  difficulty: Difficulty;
  ragchew: boolean;
  /**
   * The callsign the robot has actually copied off the air in this contact,
   * or null while it has copied none (RFD A46, corrected by A47).
   *
   * Not a yes-or-no against the profile. The robot works whatever station
   * answers it, exactly as a real one does: a member practising as A51AB
   * when their account says EP2MHB is worked as A51AB, because the robot
   * has no business knowing what is on anybody's licence.
   */
  heardCallsign: string | null;
  /**
   * Whether a signal report has been sent at any point in this contact
   * (RFD A48).
   *
   * A41 made the robot thank the student for a report only when one had
   * arrived, but judged it from the single transmission that advanced the
   * stage. A45 then inserted a turn — the robot answering a question — and
   * a report sent in that turn stopped counting, so a student who gave one
   * was thanked for their call instead. A fact once sent stays sent.
   */
  heardReport: boolean;
  /** What the robot last sent, so a repeat request can resend it verbatim. */
  lastSent: string;
  repeatsRequested: number;
  /** Everything said, in order, for the log and the on-screen transcript. */
  transcript: { from: 'robot' | 'student'; text: string }[];
}

/** What the student's transmission meant. */
export type Intent =
  | 'call'          // they called CQ themselves
  | 'answer'        // they came back to the CQ
  | 'over'          // an ordinary turn, whatever it contained
  | 'question'      // they asked for one of the facts the robot holds (A45)
  | 'repeat'        // AGN, PSE RPT, ?
  | 'slower'        // QRS
  | 'signoff'       // 73 / SK
  | 'nothing';

/**
 * The facts the robot can be asked for (RFD A45).
 *
 * Exactly the six its own profile holds, and no more. A robot that invents a
 * plausible answer is worse than one that does not hear the question, because
 * the student cannot tell which they have been given.
 */
export type Fact = 'name' | 'qth' | 'rig' | 'antenna' | 'weather' | 'rst';

/**
 * Which fact a transmission asked for, or null if it asked for none.
 *
 * The question mark must FOLLOW THE SUBJECT, which is both how an operator
 * asks — "QTH?", "UR RIG?" — and the only reading that survives contact with
 * a real transmission. Merely requiring a subject and a question mark
 * somewhere in the same turn matches almost every correct exchange, because
 * the ritual ends with "HW?": "UR RST 579 = NAME MOHAMMAD = QTH DUBAI = HW?"
 * would be read as a question about the town. That was the first attempt and
 * the existing contact-sequence tests caught it.
 *
 * "MY QTH IS DUBAI" states a fact rather than asking for one, and a robot
 * that answers it is not listening either — the same fault as ignoring the
 * question, in the other direction.
 *
 * RPT is deliberately not read as a request for the signal report. It is the
 * existing token for "repeat", and taking it would break a control a beginner
 * depends on to get out of trouble.
 */
export function questionSubject(text: string): Fact | null {
  // The question mark is split into a token of its own before anything else.
  // Without that, "QTH?" is one word and every subject test misses it — which
  // is exactly how this was first written, and every case failed.
  const t = ` ${text.toUpperCase().replace(/[^A-Z0-9?/ ]/g, ' ').replace(/\?/g, ' ? ').replace(/\s+/g, ' ')} `;
  if (!t.includes(' ? ')) return null;
  if (/ (NAME|OP) \? /.test(t)) return 'name';
  if (/ QTH \? /.test(t)) return 'qth';
  if (/ RIG \? /.test(t)) return 'rig';
  if (/ (ANT|ANTENNA) \? /.test(t)) return 'antenna';
  if (/ (WX|WEATHER) \? /.test(t)) return 'weather';
  if (/ RST \? /.test(t)) return 'rst';
  return null;
}

const RST_CHOICES = ['599', '589', '579', '569', '559', '449'];

/**
 * Which greeting is true at this hour.
 *
 * A robot that sends GM at nine in the evening is teaching the member to do
 * the same, and an operator who does it on the air is marked as someone who
 * has not been listening. Cheap to get right, so it is got right.
 */
export function greetingAt(hour: number): string {
  if (hour < 12) return 'GM';
  if (hour < 18) return 'GA';
  return 'GE';
}

export function makeRobot(options: QsoOptions): RobotProfile {
  const { random } = options;
  // Prefix, town and name come from one entry, so the station is a station
  // that could exist rather than three unrelated draws. See ROBOT_STATIONS.
  const station = random.pick(ROBOT_STATIONS);
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let suffix = '';
  for (let i = 0; i < 2 + random.int(2); i += 1) suffix += letters[random.int(26)] as string;

  // A human fist wanders off the nominal speed; a machine does not.
  const wpm =
    options.difficulty === 'machine'
      ? options.wpm
      : Math.max(5, options.wpm + (random.int(5) - 2));

  return {
    callsign: `${station.prefix}${suffix}`,
    name: random.pick(station.names),
    qth: random.pick(station.qth),
    rig: random.pick(ROBOT_RIGS),
    antenna: random.pick(ROBOT_ANTENNAS),
    weather: random.pick(ROBOT_WEATHER),
    rst: random.pick(RST_CHOICES),
    wpm,
    greeting: greetingAt(options.hour ?? 12),
  };
}

/**
 * Start a contact.
 *
 * Answering: the robot calls CQ and there is something to send straight away.
 * Calling: the band is simply open, so there is nothing to send and `send` is
 * null — the student transmits first, and the robot is not on the air at all
 * until they do.
 */
export function startQso(options: QsoOptions): { state: QsoState; send: string | null } {
  const robot = makeRobot(options);
  const base = {
    robot,
    role: options.role,
    studentCallsign: options.studentCallsign.toUpperCase(),
    ...(options.studentName && options.studentName.trim() ? { studentName: options.studentName.trim().toUpperCase() } : {}),
    difficulty: options.difficulty,
    ragchew: options.ragchew,
    repeatsRequested: 0,
    heardCallsign: null,
    heardReport: false,
  };

  if (options.role === 'calling') {
    return {
      state: { ...base, stage: 'awaiting-cq', lastSent: '', transcript: [] },
      send: null,
    };
  }

  const send = `CQ CQ CQ DE ${robot.callsign} ${robot.callsign} K`;
  return {
    state: { ...base, stage: 'calling', lastSent: send, transcript: [{ from: 'robot', text: send }] },
    send,
  };
}

/**
 * Read a student's transmission.
 *
 * Deliberately forgiving. RFP §6 requires the robot to "tolerate sending
 * errors from the student", and a beginner's sending is exactly where errors
 * live — so this looks for the few tokens that carry meaning rather than
 * matching a whole phrase.
 */
export function interpret(text: string, state: QsoState): Intent {
  const t = ` ${text.toUpperCase().replace(/[^A-Z0-9?/ ]/g, ' ').replace(/\s+/g, ' ')} `;
  if (t.trim() === '') return 'nothing';

  // A question is read before anything else, because a bare question mark is
  // the existing signal for "repeat" and that test is next. Read in the other
  // order, every question asked would be answered by the robot replaying its
  // last transmission — the fault A45 exists to cure, entrenched instead.
  //
  // The robot must have transmitted at least once. Before that it is not on
  // the air at all, and a station that has sent nothing cannot answer for a
  // name or a town it has never given.
  if (state.lastSent !== '' && questionSubject(text) !== null) return 'question';

  // Repeat requests come next: they can arrive at any point, and mistaking
  // one for an ordinary turn is the single most frustrating thing a robot
  // operator can do to a beginner.
  if (/ (AGN|RPT|QRM|QRZ) | \? |PSE RPT/.test(t)) return 'repeat';
  if (/ QRS /.test(t)) return 'slower';
  if (/ (73|88|SK|CUL|GB) /.test(t)) return 'signoff';

  // Nothing has been transmitted yet, so whatever the student sends is their
  // CQ. Not checked for the letters C and Q: a beginner who sends the ritual
  // slightly wrong should get a station back, not silence.
  if (state.stage === 'awaiting-cq') return 'call';

  if (state.stage === 'calling') {
    // They answered if they sent the robot's call, or their own, or both.
    const said = (c: string): boolean => t.includes(` ${c} `);
    if (said(state.robot.callsign) || said(state.studentCallsign)) return 'answer';
    // Something was sent but neither callsign appeared; treat as an answer
    // anyway rather than stonewalling a beginner who fumbled the call.
    return 'answer';
  }
  return 'over';
}

/**
 * Whether a transmission actually carried a signal report.
 *
 * The robot used to thank the student for a report whether or not one had
 * been sent — "FB ES TNX FER RPRT" after a transmission that said only "TNX
 * FOR CALL". A student copying that learns the ritual wrong, and worse,
 * learns that the robot is not really listening, which is the one thing a
 * practice partner cannot afford to be.
 *
 * An RST is three digits: readability 1–5, strength 1–9, tone 1–9. Matching
 * that shape rather than the word RST catches "UR 559 559", which is how it
 * is usually sent.
 */
export function carriesReport(text: string): boolean {
  // 5NN is how a report is sent when the numbers are cut, so it counts.
  if (/5NN/i.test(text)) return true;
  const digitsOnly = ` ${text.replace(/[^0-9]+/g, ' ').trim()} `;
  return / [1-5][1-9][1-9] /.test(digitsOnly);
}

/** The shape of an amateur callsign, loosely: a prefix, a digit, a suffix. */
const CALLSIGN = /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}$/;

/**
 * The callsign a transmission identifies the sender by, or null (A46/A47).
 *
 * The robot used to open "EP2MHB DE SU1XB" after a transmission consisting
 * of the single letter S: it had the call from the member's profile and used
 * it as though it had copied it off the air. A46 stopped that by checking
 * what was sent against the profile — which was the wrong correction, and
 * showed itself the first time a member practised under a different call.
 * Sending A51AB from an account registered as EP2MHB left the robot asking
 * QRZ for ever, because it was not looking for a callsign at all. It was
 * looking for ONE callsign.
 *
 * So it reads the call rather than verifying it. DE means "from", so the
 * token after DE is the sender and is preferred; failing that, a single
 * unambiguous callsign in the transmission is taken. Two unknown calls in
 * one turn is not a station identifying itself, so that yields nothing.
 *
 * A wrong call is copied as sent. That is not a flaw: a station on the air
 * works the call it hears, and a learner who sends it wrong should see it
 * come back wrong.
 */
export function extractCallsign(text: string, exclude: string): string | null {
  const tokens = text.toUpperCase().replace(/[^A-Z0-9/ ]/g, ' ').split(/\s+/).filter(Boolean);
  const own = exclude.toUpperCase();
  const ok = (tok: string): boolean => {
    const base = tok.split('/')[0] as string;
    return base.length >= 4 && CALLSIGN.test(base) && base !== own;
  };
  const de = tokens.indexOf('DE');
  const after = de >= 0 ? tokens[de + 1] : undefined;
  if (after !== undefined && ok(after)) return after;
  const found = tokens.filter(ok);
  return found.length === 1 ? (found[0] as string) : null;
}

export interface Reply {
  state: QsoState;
  /** What the robot sends back, or null if it is waiting for more. */
  send: string | null;
  /** True when the robot repeated itself rather than moving on. */
  repeated: boolean;
}

/**
 * One fact, sent the way an operator sends it (RFD A45).
 *
 * Doubled, as the exchange templates double a name and a town, because a
 * fact worth asking for is worth sending twice. The weather is sent once:
 * it is a phrase rather than a word, and the existing rag-chew template
 * sends it once for the same reason.
 */
function answerFact(state: QsoState, fact: Fact): string {
  const r = state.robot;
  const body =
    fact === 'name' ? `NAME HR ${r.name} ${r.name}`
      : fact === 'qth' ? `QTH ${r.qth} ${r.qth}`
        : fact === 'rig' ? `RIG HR ${r.rig} ${r.rig}`
          : fact === 'antenna' ? `ANT ${r.antenna} ${r.antenna}`
            : fact === 'weather' ? `WX ${r.weather}`
              : `UR RST ${r.rst} ${r.rst}`;
  const to = state.heardCallsign ?? state.studentCallsign;
  return `${to} DE ${r.callsign} = ${body} = ${to} DE ${r.callsign} KN`;
}

/** Hand the robot what the student sent, and get its answer. */
export function respond(state: QsoState, studentText: string): Reply {
  if (state.stage === 'complete' || state.stage === 'abandoned') {
    return { state, send: null, repeated: false };
  }

  const intent = interpret(studentText, state);
  const next: QsoState = {
    ...state,
    // Checked on every transmission, not only the answer: a student who
    // fumbles the call and sends it properly two turns later has still sent
    // it, and the robot has still heard it.
    heardCallsign: extractCallsign(studentText, state.robot.callsign) ?? state.heardCallsign,
    heardReport: state.heardReport || carriesReport(studentText),
    transcript: [...state.transcript, { from: 'student', text: studentText }],
  };

  if (intent === 'nothing') return { state: next, send: null, repeated: false };

  // Asking for a repeat before anyone has transmitted has nothing to replay.
  // Echoing an empty string would put a blank line in the transcript and key
  // silence into the band chain.
  if ((intent === 'repeat' || intent === 'slower') && state.lastSent === '') {
    return { state: next, send: null, repeated: false };
  }

  // A repeat request replays the last transmission, at every stage. RFP §6
  // names the exchange and rag chew specifically; there is no reason to be
  // less helpful anywhere else.
  if (intent === 'repeat') {
    const send = state.lastSent;
    return {
      state: {
        ...next,
        repeatsRequested: next.repeatsRequested + 1,
        transcript: [...next.transcript, { from: 'robot', text: send }],
      },
      send,
      repeated: true,
    };
  }

  // A question is answered from the robot's own profile and the contact stays
  // exactly where it was, so the script resumes rather than restarts. That is
  // what a courteous operator does, and it costs the ritual nothing.
  //
  // lastSent moves to the answer, so an AGN straight afterwards replays the
  // answer rather than the block before it: what the student just missed is
  // what they are asking for again.
  if (intent === 'question') {
    const fact = questionSubject(studentText);
    if (fact === null) return { state: next, send: null, repeated: false };
    const send = answerFact(next, fact);
    return {
      state: {
        ...next,
        lastSent: send,
        transcript: [...next.transcript, { from: 'robot', text: send }],
      },
      send,
      repeated: false,
    };
  }

  // QRS slows the robot down and resends, which is what a courteous operator
  // does. Three dits per request, with a floor.
  if (intent === 'slower') {
    const wpm = Math.max(5, state.robot.wpm - 3);
    const send = state.lastSent;
    return {
      state: {
        ...next,
        robot: { ...next.robot, wpm },
        repeatsRequested: next.repeatsRequested + 1,
        transcript: [...next.transcript, { from: 'robot', text: send }],
      },
      send,
      repeated: true,
    };
  }

  const { robot, studentCallsign } = next;
  // Every template addresses the station the robot has actually copied. The
  // profile call is the fallback only, and the stages that could reach it
  // unheard are guarded below.
  const worked = next.heardCallsign ?? studentCallsign;
  // What there is to thank them for, judged from what they just sent.
  const thanks = next.heardReport ? 'TNX FER RPRT' : 'TNX FER CALL';
  // The student's name, once THEY have sent it in this contact — the robot
  // copies, it does not read the profile over their shoulder.
  const nameSent = next.studentName !== undefined
    && next.transcript.some((t) => t.from === 'student' && ` ${t.text.toUpperCase()} `.includes(` ${next.studentName as string} `));
  const byName = nameSent ? ` ${next.studentName as string}` : '';
  const emit = (stage: Stage, send: string): Reply => ({
    state: {
      ...next,
      stage,
      lastSent: send,
      transcript: [...next.transcript, { from: 'robot', text: send }],
    },
    send,
    repeated: false,
  });

  // The student signing off early is honoured wherever it happens.
  if (intent === 'signoff' && state.stage !== 'signoff') {
    // Signing off before ever being copied is rare but reachable, and the
    // courtesy is owed either way — just not in someone else's name.
    const to = next.heardCallsign ? `${studentCallsign} ` : '';
    return emit('complete', `${to}DE ${robot.callsign} = TU${byName} 73 ES CUL = SK`);
  }

  switch (state.stage) {
    case 'awaiting-cq':
      // Somebody called, but the call did not arrive. A station comes back
      // asking who it was rather than inventing an answer, and the contact
      // waits here until the student sends their callsign readably — which
      // is the lesson, not an obstruction.
      if (!next.heardCallsign) {
        return emit('awaiting-cq', `QRZ? QRZ? DE ${robot.callsign} ${robot.callsign} K`);
      }
      // A station the student has never heard comes back to them. Its call is
      // sent twice and nothing else is: that is what a real answer sounds
      // like, and copying it cold is the whole exercise.
      return emit('answered', `${worked} DE ${robot.callsign} ${robot.callsign} K`);

    case 'answered':
      // The robot gives its own report back. What it thanks them for depends
      // on what they actually sent: claiming a report that never arrived is
      // the robot not listening, and a student who spots it stops trusting
      // anything else it says.
      return emit(
        'exchange',
        `${worked} DE ${robot.callsign} = FB${byName} ES ${thanks} = UR RST ${robot.rst} ${robot.rst} = ` +
          `NAME HR ${robot.name} ${robot.name} = QTH ${robot.qth} ${robot.qth} = HW? ` +
          `${worked} DE ${robot.callsign} KN`,
      );

    case 'calling':
      // Something came back to the CQ and the callsign was not in it. The
      // robot asks again instead of opening an exchange with a station it
      // cannot name.
      if (!next.heardCallsign) {
        return emit('calling', `QRZ? DE ${robot.callsign} K`);
      }
      return emit(
        'exchange',
        `${worked} DE ${robot.callsign} = ${robot.greeting} ES TNX FER CALL = ` +
          `UR RST ${robot.rst} ${robot.rst} = ` +
          `NAME HR ${robot.name} ${robot.name} = QTH ${robot.qth} ${robot.qth} = HW? ` +
          `${worked} DE ${robot.callsign} KN`,
      );

    case 'exchange':
      if (!state.ragchew) {
        return emit('signoff', `${worked} DE ${robot.callsign} = TNX FER QSO${byName} = 73 ES CUL = SK`);
      }
      return emit(
        'ragchew',
        `${worked} DE ${robot.callsign} = FB${byName} ES ${thanks} = RIG HR ${robot.rig} = ` +
          `ANT ${robot.antenna} = WX ${robot.weather} = HW CPY? ` +
          `${worked} DE ${robot.callsign} KN`,
      );

    case 'ragchew':
      return emit(
        'signoff',
        `${worked} DE ${robot.callsign} = FB OM TNX FER NICE QSO = HPE CUL = ` +
          `73 ES GL = ${worked} DE ${robot.callsign} SK`,
      );

    case 'signoff':
      return { state: { ...next, stage: 'complete' }, send: null, repeated: false };

    default:
      return { state: next, send: null, repeated: false };
  }
}

/** Give up on a contact part way through. */
export function abandon(state: QsoState): QsoState {
  return { ...state, stage: 'abandoned' };
}

export interface QsoSummary {
  completed: boolean;
  stagesReached: number;
  repeatsRequested: number;
  robotCallsign: string;
  finalWpm: number;
  exchanges: number;
}

/** The stages a contact passes through, which differ by who called whom. */
export function stageOrder(role: QsoRole): Stage[] {
  return role === 'calling'
    ? ['awaiting-cq', 'answered', 'exchange', 'ragchew', 'signoff', 'complete']
    : ['calling', 'exchange', 'ragchew', 'signoff', 'complete'];
}

/** What to write to the practice log (RFP §6). */
export function summarise(state: QsoState): QsoSummary {
  const order = stageOrder(state.role);
  return {
    completed: state.stage === 'complete',
    stagesReached: Math.max(0, order.indexOf(state.stage)) + 1,
    repeatsRequested: state.repeatsRequested,
    robotCallsign: state.robot.callsign,
    finalWpm: state.robot.wpm,
    exchanges: state.transcript.filter((t) => t.from === 'student').length,
  };
}
