import { describe, expect, it } from 'vitest';
import {
  abandon, carriesReport, extractCallsign, greetingAt, interpret, makeRobot, questionSubject,
  respond, startQso, summarise,
  type QsoOptions, type QsoState,
} from '../src/core/qso';
import { ROBOT_STATIONS } from '../src/data/wordlists';
import { seeded } from '../src/core/random';

const options = (over: Partial<QsoOptions> = {}): QsoOptions => ({
  studentCallsign: 'A65XY',
  role: 'answering',
  difficulty: 'machine',
  ragchew: true,
  random: seeded(11),
  wpm: 18,
  ...over,
});

/** Work the robot through a whole contact, returning every state. */
function fullContact(opts = options()): { states: QsoState[]; sent: string[] } {
  const started = startQso(opts);
  const states = [started.state];
  const sent = started.send === null ? [] : [started.send];
  let state = started.state;
  for (const text of [
    `${state.robot.callsign} DE A65XY A65XY K`,
    'DE A65XY = UR RST 579 = NAME MOHAMMAD = QTH DUBAI = HW? KN',
    'DE A65XY = RIG IC 7300 = ANT DIPOLE = WX SUNNY = KN',
    'DE A65XY = TNX 73 ES CUL SK',
  ]) {
    const reply = respond(state, text);
    state = reply.state;
    states.push(state);
    if (reply.send !== null) sent.push(reply.send);
  }
  return { states, sent };
}

describe('the contact sequence', () => {
  it('opens with a CQ carrying the robot’s callsign', () => {
    const { state, send } = startQso(options());
    expect(state.stage).toBe('calling');
    expect(send).toContain('CQ');
    expect(send).toContain(state.robot.callsign);
  });

  it('runs CQ, exchange, rag chew, signoff, complete in order', () => {
    const { states } = fullContact();
    expect(states.map((s) => s.stage)).toEqual([
      'calling', 'exchange', 'ragchew', 'signoff', 'complete',
    ]);
  });

  it('sends report, name and QTH in the exchange', () => {
    const { sent } = fullContact();
    const exchange = sent[1] as string;
    expect(exchange).toContain('RST');
    expect(exchange).toContain('NAME');
    expect(exchange).toContain('QTH');
  });

  it('sends rig, antenna and weather in the rag chew', () => {
    const { sent } = fullContact();
    const ragchew = sent[2] as string;
    expect(ragchew).toContain('RIG');
    expect(ragchew).toContain('ANT');
    expect(ragchew).toContain('WX');
  });

  it('addresses the student by their own callsign throughout', () => {
    const { sent } = fullContact();
    for (const line of sent.slice(1)) expect(line).toContain('A65XY');
  });

  it('skips the rag chew when it is switched off', () => {
    const opts = options({ ragchew: false });
    const started = startQso(opts);
    const answered = respond(started.state, 'DE A65XY K');
    const afterExchange = respond(answered.state, 'DE A65XY = RST 579 = NAME MOHAMMAD KN');
    expect(afterExchange.state.stage).toBe('signoff');
    expect(afterExchange.send).toContain('73');
  });

  it('ends with 73 and SK', () => {
    const { sent } = fullContact();
    const last = sent[sent.length - 1] as string;
    expect(last).toContain('73');
    expect(last).toContain('SK');
  });
});

// RFP §6: "The robot repeats any element on request, so a student who misses
// something can recover rather than restart."
describe('repeat requests', () => {
  it.each(['AGN', 'AGN AGN', 'PSE RPT', '?', 'DE A65XY AGN KN'])(
    'repeats verbatim on "%s"',
    (request) => {
      const started = startQso(options());
      const answered = respond(started.state, 'DE A65XY K');
      const again = respond(answered.state, request);
      expect(again.repeated).toBe(true);
      expect(again.send).toBe(answered.send);
      expect(again.state.stage).toBe('exchange');
    },
  );

  it('repeats during the rag chew too', () => {
    const started = startQso(options());
    const answered = respond(started.state, 'DE A65XY K');
    const ragchew = respond(answered.state, 'DE A65XY = RST 579 KN');
    const again = respond(ragchew.state, 'AGN PSE');
    expect(again.repeated).toBe(true);
    expect(again.send).toBe(ragchew.send);
    expect(again.state.stage).toBe('ragchew');
  });

  it('does not advance the contact when it repeats', () => {
    const started = startQso(options());
    let state = respond(started.state, 'DE A65XY K').state;
    for (let i = 0; i < 4; i += 1) state = respond(state, 'AGN').state;
    expect(state.stage).toBe('exchange');
    expect(state.repeatsRequested).toBe(4);
  });

  it('counts repeats for the log', () => {
    const started = startQso(options());
    const answered = respond(started.state, 'DE A65XY K');
    const once = respond(answered.state, '?');
    expect(summarise(once.state).repeatsRequested).toBe(1);
  });
});

describe('QRS', () => {
  it('slows the robot down and resends', () => {
    const started = startQso(options({ wpm: 20 }));
    const answered = respond(started.state, 'DE A65XY K');
    const before = answered.state.robot.wpm;
    const slower = respond(answered.state, 'QRS PSE QRS');
    expect(slower.state.robot.wpm).toBeLessThan(before);
    expect(slower.send).toBe(answered.send);
  });

  it('will not slow below a floor, however many times it is asked', () => {
    const started = startQso(options({ wpm: 12 }));
    let state = respond(started.state, 'DE A65XY K').state;
    for (let i = 0; i < 20; i += 1) state = respond(state, 'QRS').state;
    expect(state.robot.wpm).toBe(5);
  });
});

describe('tolerating a beginner', () => {
  it('works the call it copied, even when that is not the call on the account', () => {
    // A46 first made this send QRZ, by checking what arrived against the
    // member's profile. A47 corrected that: the robot reads the call rather
    // than verifying it, so a fumbled A6XY is answered as A6XY — which is
    // what a station on the air does, and is how the student finds out.
    const started = startQso(options());
    const answered = respond(started.state, 'DE A6XY KK');
    expect(answered.state.stage).toBe('exchange');
    expect(answered.state.heardCallsign).toBe('A6XY');
    expect(answered.send).toContain('A6XY DE');
    expect(answered.send).not.toContain('A65XY');
  });

  it('moves on from a turn it cannot make sense of, rather than stalling', () => {
    const started = startQso(options());
    const answered = respond(started.state, 'DE A65XY K');
    const garbled = respond(answered.state, 'RST 5NN NM MHMD QT DBI');
    expect(garbled.state.stage).toBe('ragchew');
  });

  it('waits rather than advancing when nothing was sent', () => {
    const started = startQso(options());
    const nothing = respond(started.state, '   ');
    expect(nothing.state.stage).toBe('calling');
    expect(nothing.send).toBeNull();
  });

  it('lets the student sign off early and answers politely', () => {
    const started = startQso(options());
    const answered = respond(started.state, 'DE A65XY K');
    const early = respond(answered.state, 'SRI QRL 73 SK');
    expect(early.state.stage).toBe('complete');
    expect(early.send).toContain('73');
  });
});

describe('reading the student', () => {
  it.each([
    ['AGN', 'repeat'], ['PSE RPT', 'repeat'], ['?', 'repeat'],
    ['QRS PSE', 'slower'], ['73 ES CUL', 'signoff'], ['SK', 'signoff'],
    ['', 'nothing'], ['   ', 'nothing'],
  ])('reads "%s" as %s', (text, expected) => {
    const { state } = startQso(options());
    expect(interpret(text, { ...state, stage: 'exchange' })).toBe(expected);
  });

  it('prefers a repeat request over an ordinary turn when both appear', () => {
    const { state } = startQso(options());
    expect(interpret('UR RST 579 BUT PSE RPT NAME', { ...state, stage: 'exchange' })).toBe('repeat');
  });
});

describe('difficulty', () => {
  it('sends at exactly the requested speed on the machine tier', () => {
    for (let seed = 1; seed < 8; seed += 1) {
      const robot = makeRobot(options({ difficulty: 'machine', wpm: 18, random: seeded(seed) }));
      expect(robot.wpm).toBe(18);
    }
  });

  it('wanders off the nominal speed on the human tier', () => {
    const speeds = new Set<number>();
    for (let seed = 1; seed < 30; seed += 1) {
      speeds.add(makeRobot(options({ difficulty: 'human', wpm: 18, random: seeded(seed) })).wpm);
    }
    expect(speeds.size).toBeGreaterThan(1);
  });

  it('never produces a speed below the floor', () => {
    for (let seed = 1; seed < 40; seed += 1) {
      expect(makeRobot(options({ difficulty: 'human', wpm: 5, random: seeded(seed) })).wpm).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('the log entry', () => {
  it('records a completed contact', () => {
    const { states } = fullContact();
    const summary = summarise(states[states.length - 1] as QsoState);
    expect(summary.completed).toBe(true);
    expect(summary.exchanges).toBe(4);
    expect(summary.robotCallsign).toMatch(/^[A-Z0-9]+$/);
  });

  it('records an abandoned contact as incomplete', () => {
    const started = startQso(options());
    const summary = summarise(abandon(respond(started.state, 'DE A65XY K').state));
    expect(summary.completed).toBe(false);
  });

  it('says nothing more once the contact is over', () => {
    const { states } = fullContact();
    const after = respond(states[states.length - 1] as QsoState, 'CQ CQ');
    expect(after.send).toBeNull();
  });
});

describe('reproducibility', () => {
  it('builds the same operator from the same seed', () => {
    const a = makeRobot(options({ random: seeded(99) }));
    const b = makeRobot(options({ random: seeded(99) }));
    expect(a).toEqual(b);
  });
});

/*
 * The other direction: the student calls CQ and a station they have never
 * heard answers. The half of the skill that decides whether a member ever
 * calls CQ on the air.
 */
describe('calling CQ', () => {
  const calling = (over: Partial<QsoOptions> = {}): QsoOptions =>
    options({ role: 'calling', ...over });

  it('opens with the band empty and nothing transmitted', () => {
    const { state, send } = startQso(calling());
    expect(state.stage).toBe('awaiting-cq');
    expect(send).toBeNull();
    expect(state.transcript).toHaveLength(0);
    expect(state.lastSent).toBe('');
  });

  it('brings a station back with its callsign, and nothing else', () => {
    const { state } = startQso(calling());
    const reply = respond(state, 'CQ CQ CQ DE A65XY A65XY K');
    expect(reply.state.stage).toBe('answered');
    expect(reply.send).toContain(state.robot.callsign);
    expect(reply.send).toContain('A65XY');
    // An answer to a CQ is a callsign, not a report: the exchange comes after
    // the student has sent theirs.
    expect(reply.send).not.toContain('RST');
    expect(reply.send).not.toContain(state.robot.name);
  });

  it('answers a fumbled CQ rather than stonewalling a beginner', () => {
    const { state } = startQso(calling());
    expect(interpret('CQ DE A65X K', state)).toBe('call');
    expect(interpret('anything at all', state)).toBe('call');
    expect(respond(state, 'CQ K').send).not.toBeNull();
  });

  it('gives its own report only after the student has given theirs', () => {
    const { state } = startQso(calling());
    const answered = respond(state, 'CQ CQ CQ DE A65XY A65XY K').state;
    const exchanged = respond(answered, 'DE A65XY = UR RST 599 = NAME MOHAMMAD = QTH DUBAI = HW? KN');
    expect(exchanged.state.stage).toBe('exchange');
    expect(exchanged.send).toContain(state.robot.rst);
    expect(exchanged.send).toContain(state.robot.name);
    expect(exchanged.send).toContain(state.robot.qth);
    // They were thanked for calling one transmission ago.
    expect(exchanged.send).toContain('TNX FER RPRT');
  });

  it('runs the whole sequence through to a complete contact', () => {
    const { state } = startQso(calling());
    let s = state;
    const stages: string[] = [s.stage];
    for (const text of [
      'CQ CQ CQ DE A65XY A65XY K',
      'DE A65XY = UR RST 599 = NAME MOHAMMAD = QTH DUBAI = HW? KN',
      'DE A65XY = RIG IC 7300 = ANT DIPOLE = WX SUNNY = KN',
      'DE A65XY = TNX FER FB QSO = KN',
      'DE A65XY = TNX 73 ES CUL SK',
    ]) {
      s = respond(s, text).state;
      stages.push(s.stage);
    }
    expect(stages).toEqual([
      'awaiting-cq', 'answered', 'exchange', 'ragchew', 'signoff', 'complete',
    ]);
    expect(summarise(s).completed).toBe(true);
  });

  it('has nothing to repeat before anyone has transmitted', () => {
    const { state } = startQso(calling());
    const reply = respond(state, 'AGN');
    expect(reply.send).toBeNull();
    expect(reply.repeated).toBe(false);
    expect(reply.state.stage).toBe('awaiting-cq');
    expect(reply.state.repeatsRequested).toBe(0);
  });

  it('has nobody to ask to slow down before anyone has transmitted', () => {
    const { state } = startQso(calling());
    expect(respond(state, 'QRS PSE').send).toBeNull();
  });

  it('still replays a real transmission once there is one', () => {
    const { state } = startQso(calling());
    const answered = respond(state, 'CQ CQ CQ DE A65XY A65XY K').state;
    const again = respond(answered, 'AGN');
    expect(again.repeated).toBe(true);
    expect(again.send).toBe(answered.lastSent);
  });

  it('honours a student who gives up on the contact after being answered', () => {
    const { state } = startQso(calling());
    const answered = respond(state, 'CQ CQ CQ DE A65XY A65XY K').state;
    const s = abandon(answered);
    expect(s.stage).toBe('abandoned');
    expect(summarise(s).completed).toBe(false);
  });

  it('counts the stages of its own sequence, not the other one', () => {
    const { state } = startQso(calling());
    const answered = respond(state, 'CQ CQ CQ DE A65XY A65XY K').state;
    expect(summarise(answered).stagesReached).toBe(2);
  });
});

/**
 * Three faults a member found working a contact on 20 September 2026, all of
 * the same kind: the robot saying something that was not true.
 */
describe('the robot does not say untrue things', () => {
  const calling = (over: Partial<QsoOptions> = {}): QsoOptions =>
    options({ role: 'calling', studentCallsign: 'EP2MHB', ...over });

  it('does not thank the student for a report they never sent', () => {
    const { state } = startQso(calling());
    const answered = respond(state, 'CQ CQ CQ DE EP2MHB EP2MHB K').state;
    const reply = respond(answered, `${answered.robot.callsign} DE EP2MHB TNX FER CALL`);
    expect(reply.send).toContain('TNX FER CALL');
    expect(reply.send).not.toContain('TNX FER RPRT');
  });

  it('does thank them for it when it is there', () => {
    const { state } = startQso(calling());
    const answered = respond(state, 'CQ CQ CQ DE EP2MHB EP2MHB K').state;
    const reply = respond(answered, `${answered.robot.callsign} DE EP2MHB = UR RST 559 559 = HW?`);
    expect(reply.send).toContain('TNX FER RPRT');
  });

  it('uses the student\u2019s name only once the student has sent it', () => {
    // §8: the profile feeds the robot QSO — but a robot that greets you by a
    // name you never sent has not been listening. It copies, like anyone.
    const { state } = startQso(calling({ studentName: 'Mohammad' }));
    const answered = respond(state, 'CQ CQ CQ DE EP2MHB EP2MHB K').state;
    const first = respond(answered, `${answered.robot.callsign} DE EP2MHB = UR RST 559 559 = HW?`);
    expect(first.send).not.toContain('MOHAMMAD');
    const second = respond(first.state, `${answered.robot.callsign} DE EP2MHB = NAME HR MOHAMMAD MOHAMMAD = HW?`);
    expect(second.send).toContain('FB MOHAMMAD');
  });

  it('never invents a name when the profile has none', () => {
    const { state } = startQso(calling());
    const answered = respond(state, 'CQ CQ CQ DE EP2MHB EP2MHB K').state;
    const reply = respond(answered, `${answered.robot.callsign} DE EP2MHB = NAME HR ALI = HW?`);
    expect(reply.send).toContain('FB ES');
    expect(reply.send).not.toContain('ALI');
  });

  it('reads a report however it is sent, and is not fooled by a callsign', () => {
    expect(carriesReport('UR RST 559 559')).toBe(true);
    expect(carriesReport('ur 599')).toBe(true);
    expect(carriesReport('TU 5NN 001')).toBe(true);
    expect(carriesReport('EP2MHB DE A65XY TNX FER CALL')).toBe(false);
    expect(carriesReport('QTH IS 1000 KM AWAY')).toBe(false);
  });

  it('gives a station a name and a town that belong to its callsign', () => {
    // Every draw, not one: the fault was a random pairing that was usually
    // wrong and occasionally right.
    for (let seed = 0; seed < 200; seed += 1) {
      const robot = makeRobot(options({ random: seeded(seed) }));
      const home = ROBOT_STATIONS.find((s) => robot.callsign.startsWith(s.prefix));
      expect(home, `no station for ${robot.callsign}`).toBeDefined();
      expect(home?.names).toContain(robot.name);
      expect(home?.qth).toContain(robot.qth);
    }
  });

  it('greets by the hour the member is actually sitting in', () => {
    expect(greetingAt(9)).toBe('GM');
    expect(greetingAt(14)).toBe('GA');
    expect(greetingAt(21)).toBe('GE');
    const { state } = startQso(options({ hour: 21 }));
    const reply = respond(state, `${state.robot.callsign} DE A65XY A65XY K`);
    expect(reply.send).toContain('GE ES TNX FER CALL');
    expect(reply.send).not.toContain('GM');
  });
});

describe('the robot answers a question it knows the answer to (A45)', () => {
  /** Walk a contact to a named stage and hand back the state. */
  function at(stage: 'exchange' | 'ragchew' | 'signoff' | 'answered', role: 'answering' | 'calling' = 'answering'): QsoState {
    let { state } = startQso(options({ role }));
    const steps = role === 'calling'
      ? ['CQ CQ DE A65XY K', 'UR RST 579', 'FB TNX', 'TNX 73']
      : ['A65XY DE A65XY K', 'UR RST 579', 'FB TNX', 'TNX 73'];
    for (const step of steps) {
      if (state.stage === stage) return state;
      state = respond(state, step).state;
    }
    return state;
  }

  it('reads each of the six facts out of a question', () => {
    expect(questionSubject('UR QTH?')).toBe('qth');
    expect(questionSubject('NAME?')).toBe('name');
    expect(questionSubject('RIG?')).toBe('rig');
    expect(questionSubject('ANT?')).toBe('antenna');
    expect(questionSubject('WX?')).toBe('weather');
    expect(questionSubject('RST?')).toBe('rst');
  });

  it('does not mistake a statement for a question', () => {
    // The opposite fault, and just as much a failure to listen.
    expect(questionSubject('MY QTH IS DUBAI')).toBeNull();
    expect(questionSubject('NAME HR MOHAMMAD')).toBeNull();
    expect(questionSubject('RIG HR X6100 ES ANT DIPOLE')).toBeNull();
  });

  it('does not read a correct exchange as a question', () => {
    // The ritual ends with HW?, so a subject and a question mark appear in
    // the same turn almost every time. The mark has to follow the subject.
    expect(questionSubject('DE A65XY = UR RST 579 = NAME MOHAMMAD = QTH DUBAI = HW? KN')).toBeNull();
    expect(questionSubject('RIG IC 7300 = ANT DIPOLE = WX SUNNY = HW CPY?')).toBeNull();
  });

  it('asks for nothing it cannot answer', () => {
    expect(questionSubject('PWR?')).toBeNull();
    expect(questionSubject('QSL?')).toBeNull();
    expect(questionSubject('?')).toBeNull();
  });

  it('answers truthfully from that station own profile', () => {
    const state = at('exchange');
    const r = respond(state, 'UR QTH?');
    expect(r.send).toContain(`QTH ${state.robot.qth} ${state.robot.qth}`);
    expect(respond(state, 'RIG?').send).toContain(state.robot.rig);
    expect(respond(state, 'ANT?').send).toContain(state.robot.antenna);
    expect(respond(state, 'WX?').send).toContain(state.robot.weather);
    expect(respond(state, 'NAME?').send).toContain(state.robot.name);
    expect(respond(state, 'RST?').send).toContain(state.robot.rst);
  });

  it('stays exactly where it was, so the script resumes rather than restarts', () => {
    for (const stage of ['exchange', 'ragchew', 'signoff'] as const) {
      const before = at(stage);
      const after = respond(before, 'QTH?');
      expect(after.state.stage, `stage moved at ${stage}`).toBe(before.stage);
      expect(after.send).not.toBeNull();
    }
  });

  it('answers in both directions of the contact', () => {
    for (const role of ['answering', 'calling'] as const) {
      const state = at('exchange', role);
      const r = respond(state, 'RIG?');
      expect(r.send, `no answer in ${role}`).toContain(state.robot.rig);
      expect(r.state.stage).toBe('exchange');
    }
  });

  it('hands the contact back with KN', () => {
    const state = at('exchange');
    const r = respond(state, 'QTH?');
    expect(r.send?.endsWith(`${state.studentCallsign} DE ${state.robot.callsign} KN`)).toBe(true);
  });

  it('still repeats when asked to repeat', () => {
    // The precedence that matters: a bare question mark is the repeat signal,
    // and reading it as a question would break a control beginners depend on.
    const state = at('exchange');
    const before = state.lastSent;
    for (const ask of ['AGN', 'PSE RPT', ' ? ']) {
      const r = respond(state, ask);
      expect(r.repeated, `${ask} did not repeat`).toBe(true);
      expect(r.send).toBe(before);
    }
  });

  it('replays the answer, not the block before it, when asked again', () => {
    const state = at('exchange');
    const answered = respond(state, 'QTH?').state;
    const again = respond(answered, 'AGN');
    expect(again.repeated).toBe(true);
    expect(again.send).toContain(answered.robot.qth);
  });

  it('carries on exactly as before when asked something it does not know', () => {
    // PWR is not a fact the robot holds, so A45 must not touch this turn.
    // Before A45 it was read as an ordinary turn and advanced the script —
    // the repeat rule wants spaces around the question mark, which "PWR?"
    // does not have — and that is still what happens.
    const state = at('exchange');
    const r = respond(state, 'PWR?');
    expect(interpret('PWR?', state)).toBe('over');
    expect(r.repeated).toBe(false);
    expect(r.state.stage).toBe('ragchew');
    expect(r.send).toContain('RIG HR');
  });

  it('will not answer before it has transmitted at all', () => {
    // The student calls CQ first in this direction; the robot is not on the
    // air and has no town to give.
    const { state } = startQso(options({ role: 'calling' }));
    expect(state.lastSent).toBe('');
    expect(interpret('QTH?', state)).toBe('call');
  });
});

describe('the robot works the callsign it copied (A46, corrected by A47)', () => {
  it('reads the call out of a transmission rather than checking it', () => {
    expect(extractCallsign('F5DDB DE A51AB KN', 'F5DDB')).toBe('A51AB');
    expect(extractCallsign('de ep2mhb kn', 'F5DDB')).toBe('EP2MHB');
    expect(extractCallsign('A51AB KN', 'F5DDB')).toBe('A51AB');
    expect(extractCallsign('DE A51AB/P K', 'F5DDB')).toBe('A51AB/P');
    expect(extractCallsign('S', 'F5DDB')).toBeNull();
    expect(extractCallsign('QRS PSE', 'F5DDB')).toBeNull();
    expect(extractCallsign('CQ CQ CQ K', 'F5DDB')).toBeNull();
    // Its own call is not somebody identifying themselves.
    expect(extractCallsign('F5DDB DE F5DDB K', 'F5DDB')).toBeNull();
    // Two unknown calls in one turn is not one station identifying itself.
    expect(extractCallsign('A51AB G4ABC K', 'F5DDB')).toBeNull();
  });

  it('works a member who is practising under a different callsign', () => {
    // The reported fault: an account registered EP2MHB, sending A51AB, was
    // answered QRZ for ever because the robot compared rather than copied.
    let { state } = startQso(options({ role: 'calling', studentCallsign: 'EP2MHB' }));
    state = respond(state, 'CQ CQ DE A51AB A51AB K').state;
    expect(state.heardCallsign).toBe('A51AB');
    const r = respond(state, 'UR RST 579');
    expect(r.send).toContain('A51AB DE');
    expect(r.send).not.toContain('EP2MHB');
  });

  it('does not open an exchange with a station it cannot name', () => {
    // The reported fault, exactly: two transmissions, neither carrying the
    // call, and the robot opened "EP2MHB DE SU1XB ... TNX FER CALL".
    let { state } = startQso(options());
    state = respond(state, 'QRS PSE').state;
    const r = respond(state, 'S');
    expect(r.state.stage).toBe('calling');
    expect(r.send).not.toContain('A65XY');
    expect(r.send).toContain('QRZ?');
  });

  it('opens the exchange as soon as the call does arrive', () => {
    let { state } = startQso(options());
    state = respond(state, 'S').state;
    const r = respond(state, `${state.robot.callsign} DE A65XY A65XY K`);
    expect(r.state.stage).toBe('exchange');
    expect(r.state.heardCallsign).toBe('A65XY');
    expect(r.send).toContain('A65XY DE');
    expect(r.send).toContain('TNX FER CALL');
  });

  it('asks who is calling when a CQ carries no callsign', () => {
    const { state } = startQso(options({ role: 'calling' }));
    const r = respond(state, 'CQ CQ CQ K');
    expect(r.state.stage).toBe('awaiting-cq');
    expect(r.send).toContain('QRZ?');
    expect(r.send).not.toContain('A65XY');
  });

  it('answers that CQ once the caller identifies', () => {
    let { state } = startQso(options({ role: 'calling' }));
    state = respond(state, 'CQ CQ CQ K').state;
    const r = respond(state, 'CQ CQ DE A65XY A65XY K');
    expect(r.state.stage).toBe('answered');
    expect(r.send).toContain('A65XY DE');
  });

  it('remembers the call even when it arrives late', () => {
    let { state } = startQso(options());
    state = respond(state, 'S').state;
    expect(state.heardCallsign).toBeNull();
    state = respond(state, 'DE A65XY K').state;
    expect(state.heardCallsign).toBe('A65XY');
  });

  it('signs off courteously without borrowing a name it never heard', () => {
    const { state } = startQso(options());
    const r = respond(state, '73 ES CUL');
    expect(r.state.stage).toBe('complete');
    expect(r.send).toContain('73');
    expect(r.send).not.toContain('A65XY');
  });
});

describe('a report once sent stays sent (A48)', () => {
  it('thanks for the report even when a question came in between', () => {
    // The regression A45 caused: the report arrived in the turn that was
    // consumed by answering a question, so the turn that advanced the stage
    // carried none and the robot thanked for the call instead.
    let { state } = startQso(options());
    state = respond(state, `${state.robot.callsign} DE A65XY K`).state;
    state = respond(state, 'UR RST 547 = WHAT IS UR RIG?').state;
    expect(state.heardReport).toBe(true);
    const r = respond(state, 'TNX = RIG HR HOME MADE = QTH DUBAI');
    expect(r.send).toContain('TNX FER RPRT');
    expect(r.send).not.toContain('TNX FER CALL');
  });

  it('still thanks for the call when no report was ever sent', () => {
    let { state } = startQso(options());
    const r = respond(state, `${state.robot.callsign} DE A65XY K`);
    expect(r.send).toContain('TNX FER CALL');
    expect(r.state.heardReport).toBe(false);
  });
});
