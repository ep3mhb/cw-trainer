/**
 * Working the robot operator (RFP §6).
 *
 * The robot's transmissions are sent as CW through the band-conditions chain,
 * so copying it is the same skill as copying a real station. The student
 * replies by typing what they would have sent; keying into a contact is the
 * obvious next refinement and is recorded in the roadmap.
 *
 * The contact runs either way round. Answering a CQ was the original and is
 * still the default. Calling CQ and being answered is the half that decides
 * whether a member ever calls CQ on the air: a station they have never heard
 * comes back with a callsign they have to copy cold, which is the moment
 * people freeze.
 *
 * Replies go back either typed or keyed. Keyed is the real thing: the member
 * sends on their own key, the decoder reads it, and whatever it read is what
 * the other station hears — mis-sent callsign and all. Typing stays the
 * default because copying is the harder half and a member should be able to
 * practise it without a key plugged in.
 */

import { BandChain } from '../core/band-audio';
import { decode } from '../core/decoder';
import { BAND_PRESETS, describe as describeBand, signalToNoiseDb, type BandPreset, type BandSettings } from '../core/band';
import {
  abandon,
  respond,
  startQso,
  summarise,
  type Difficulty,
  type QsoRole,
  type QsoState,
  type Stage,
} from '../core/qso';
import { systemRandom } from '../core/random';
import { schedule } from '../core/timing';
import { badge, clear, el, radioGroup, select, slider } from './dom';
import { keyInput } from './keyinput';
import { readMemberCallsign, readMemberName } from '../net/session';
import type { PlaybackHandle } from '../core/audio';
import type { Ctx, View } from './context';

/** The interfering station just sends the band's usual chatter, endlessly. */
const QRM_TEXT = 'CQ CQ DE DL2ABC DL2ABC K = TEST 599 001 = TU ';

export function qsoView(ctx: Ctx): View {
  const node = el('div');

  let chain: BandChain | null = null;
  let band: BandSettings = { ...BAND_PRESETS.typical };
  let state: QsoState | null = null;
  let difficulty: Difficulty = 'machine';
  let role: QsoRole = 'answering';
  let ragchew = true;
  // Signed in on the band, the member's own callsign or training identifier
  // is the one the robot hears (§8: one source of truth); otherwise the
  // placeholder, editable below.
  let callsign = readMemberCallsign() ?? 'A65XY';
  let playing: PlaybackHandle | null = null;
  let qrmPlaying: PlaybackHandle | null = null;
  let tickHandle: number | null = null;
  let busy = false;


  const transcript = el('div', { class: 'transcript', 'aria-live': 'polite' });
  const sending = el('p', { class: 'hint sending-now', hidden: true, 'aria-live': 'polite' },
    el('span', { class: 'keying-lamp on' }), ' Receiving \u2014 copy what you can.');
  const statusRow = el('div', { class: 'row' });
  const replyInput = el('input', {
    type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
    placeholder: 'Type what you would send, then press Enter', 'aria-label': 'Your transmission',
    disabled: true,
  });
  /*
   * Keying a reply. The decode is shown as it is keyed, because a member has
   * to be able to see what the other station is about to hear: sending is
   * only half of it, and finding out your callsign came out wrong after the
   * contact has moved on teaches nothing.
   */
  const keyedOut = el('div', { class: 'readout answer', 'aria-live': 'off' });
  const showKeyedPlaceholder = (): void => {
    clear(keyedOut);
    keyedOut.append(el('span', { class: 'pending', text: 'Key your reply. Stop for a moment and it goes.' }));
  };
  const key = keyInput({
    ctx,
    idleMs: 2500,
    onEvent: () => renderKeyed(),
    onIdle: () => { void sendKeyed(); },
  });
  const keyPanel = el('div', { hidden: true },
    keyedOut,
    el('div', { style: 'height:0.5rem' }),
    key.pad);

  const startButton = el('button', { class: 'btn primary', text: 'Listen for a CQ' });
  const cqButton = el('button', { class: 'btn', text: 'Send CQ', hidden: true });
  const repeatButton = el('button', { class: 'btn', text: 'Ask for a repeat (AGN)', disabled: true });
  const slowerButton = el('button', { class: 'btn', text: 'Ask for slower (QRS)', disabled: true });
  const quitButton = el('button', { class: 'btn danger', text: 'Give up', disabled: true });
  const sendKeyedButton = el('button', { class: 'btn', text: 'Send it', hidden: true, disabled: true });

  const stageLabel: Record<string, string> = {
    'awaiting-cq': 'your move \u2014 call CQ', calling: 'they are calling CQ',
    answered: 'someone came back to you', exchange: 'exchanging reports', ragchew: 'rag chew',
    signoff: 'signing off', complete: 'contact complete', abandoned: 'abandoned',
  };

  function renderStatus(): void {
    clear(statusRow);
    if (state === null) {
      statusRow.append(badge('Contact', 'not started'), badge('Band', describeBand(band)));
      return;
    }
    // Before anyone has answered there is no station to name, and inventing
    // one on the badge would hand the student the callsign they are about to
    // be asked to copy.
    const heard = state.transcript.some((entry) => entry.from === 'robot');
    statusRow.append(
      badge('Station', heard ? state.robot.callsign : 'nobody yet'),
      badge('Speed', `${String(state.robot.wpm)} WPM`),
      badge('Stage', stageLabel[state.stage] ?? state.stage,
        state.stage === 'complete' ? 'good' : state.stage === 'abandoned' ? 'bad' : ''),
      badge('Repeats', String(state.repeatsRequested)),
      badge('S/N', `${signalToNoiseDb(band).toFixed(0)} dB`),
    );
  }

  function line(from: 'robot' | 'student', text: string): void {
    transcript.append(
      el('div', { class: `qso-line ${from}` },
        // The student's side of the transcript is labelled with the call they
        // actually sent, not the one on the account: a member working as
        // A51AB should see A51AB against their own transmissions (A47).
        el('span', { class: 'qso-who', text: from === 'robot' ? (state?.robot.callsign ?? 'DX') : (state?.heardCallsign ?? callsign) }),
        el('span', { class: 'qso-text', text }),
      ),
    );
    transcript.scrollTop = transcript.scrollHeight;
  }

  /** What the decoder makes of what has been keyed so far. */
  function keyedText(): string {
    return decode([...key.events], {
      tolerance: ctx.settings.decodeTolerance,
      ...(ctx.settings.keyInput === 'iambic' ? { referenceWpm: ctx.settings.timing.characterWpm } : {}),
    }).text.trim();
  }

  function renderKeyed(): void {
    const text = keyedText();
    sendKeyedButton.disabled = text === '';
    if (text === '') {
      showKeyedPlaceholder();
      return;
    }
    clear(keyedOut);
    keyedOut.append(el('span', { text }));
  }

  async function sendKeyed(): Promise<void> {
    const text = keyedText();
    if (text === '' || busy) return;
    key.clear();
    showKeyedPlaceholder();
    sendKeyedButton.disabled = true;
    await reply(text);
  }

  /**
   * Hand the key over, or take it back. The pad is armed only while it is
   * the member's turn: a key that is live while the other station is sending
   * would put their sidetone over the top of the signal they are copying.
   */
  function setOurTurn(ours: boolean): void {
    if (ctx.settings.qsoReplyMode === 'key' && ours) {
      if (!key.armed) void key.arm();
    } else if (key.armed) {
      key.disarm();
    }
    replyInput.disabled = !ours || ctx.settings.qsoReplyMode === 'key';
    if (ours && ctx.settings.qsoReplyMode === 'typing') replyInput.focus();
  }

  /** Send one transmission as CW, through the band chain. */
  async function transmit(text: string): Promise<void> {
    if (!(await ctx.ensureAudio()) || chain === null || state === null) return;
    busy = true;
    setOurTurn(false);
    renderControls();
    playing?.stop();

    const wpm = state.robot.wpm;
    // The human tier hesitates: character speed stays put, the gaps stretch.
    const effective = state.difficulty === 'human' ? Math.max(5, wpm - 4) : wpm;
    const weighting = state.difficulty === 'human' ? 2.8 + Math.random() * 0.5 : 3;
    const plan = schedule(text, { characterWpm: wpm, effectiveWpm: effective, weighting });

    playing = ctx.audio.play(plan, { destination: chain.input });
    await playing.finished;

    busy = false;
    setOurTurn(state.stage !== 'complete' && state.stage !== 'abandoned');
    renderControls();
  }

  function renderControls(): void {
    const live = state !== null && state.stage !== 'complete' && state.stage !== 'abandoned';
    const nothingHeardYet = state !== null && state.lastSent === '';
    // Nothing has been transmitted, so there is nothing to repeat and nobody
    // to ask to slow down. Leaving these live invites a click that does
    // nothing, which reads as a broken button.
    repeatButton.disabled = !live || busy || nothingHeardYet;
    slowerButton.disabled = !live || busy || nothingHeardYet;
    quitButton.disabled = !live;
    cqButton.hidden = !(live && state?.stage === 'awaiting-cq');
    cqButton.disabled = busy;
    startButton.textContent = live
      ? 'Start a new contact'
      : role === 'calling' ? 'Open the band' : 'Listen for a CQ';
    // A transmission can run the best part of a minute. Without this the
    // interface looks frozen and the buttons look clickable while doing
    // nothing, which is worse than being plainly disabled.
    sending.hidden = !busy;
    const onKey = ctx.settings.qsoReplyMode === 'key';
    keyPanel.hidden = !onKey;
    replyInput.hidden = onKey;
    sendKeyedButton.hidden = !onKey;
    sendKeyedButton.disabled = !live || busy || keyedText() === '';
    replyInput.placeholder = busy
      ? 'Listening\u2026 wait for them to finish'
      : state?.stage === 'awaiting-cq'
        ? 'Call CQ \u2014 or press "Send CQ" for the usual wording'
        : 'Type what you would send, then press Enter';
  }

  function startQrm(): void {
    if (chain === null || band.qrm <= 0) return;
    const plan = schedule(QRM_TEXT.repeat(6), { characterWpm: 22, effectiveWpm: 22, weighting: 3 });
    qrmPlaying = ctx.audio.play(plan, {
      destination: chain.qrmInput,
      pitchHz: ctx.settings.audio.pitchHz + band.qrmOffsetHz,
      leadS: 0.3,
    });
  }

  async function begin(): Promise<void> {
    if (!(await ctx.ensureAudio())) return;
    const audioCtx = ctx.audio.context;
    if (audioCtx === null) return;

    stopBand();

    chain = new BandChain(audioCtx, band);
    ctx.audio.connectChain(chain);
    chain.setCentreHz(ctx.settings.audio.pitchHz);
    chain.start();
    if (tickHandle === null) tickHandle = window.setInterval(() => chain?.tick(), 25);
    startQrm();

    const started = startQso({
      studentCallsign: callsign, role, difficulty, ragchew, random: systemRandom(),
      ...(readMemberName() ? { studentName: readMemberName() as string } : {}),
      wpm: ctx.settings.timing.characterWpm,
      // So the station greets the member with the time of day they are
      // actually sitting in, rather than always good morning.
      hour: new Date().getHours(),
    });
    state = started.state;
    clear(transcript);
    renderStatus();
    renderControls();

    if (started.send === null) {
      // Calling: the band is open and empty. Nobody transmits until they do.
      transcript.append(el('span', { class: 'pending',
        text: 'The band is open. Call CQ and see who comes back.' }));
      setOurTurn(true);
      return;
    }
    line('robot', started.send);
    await transmit(started.send);
  }

  async function reply(text: string): Promise<void> {
    if (state === null || busy || text.trim() === '') return;
    const wasCalling = state.stage === 'awaiting-cq';
    if (wasCalling) clear(transcript);
    line('student', text);
    const result = respond(state, text);
    state = result.state;
    renderStatus();
    renderControls();
    replyInput.value = '';

    // A real CQ is followed by a moment of nothing before anyone answers. The
    // pause is short, but without it a station materialises the instant the
    // student stops sending, which is the one thing that never happens.
    if (wasCalling && result.send !== null) {
      busy = true;
      renderControls();
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      busy = false;
    }

    if (result.send !== null) {
      line('robot', result.repeated ? `${result.send}   (repeat)` : result.send);
      await transmit(result.send);
    }

    if (state.stage === 'complete') finish();
  }

  /** Tear down the audio for a contact that is over, however it ended. */
  function stopBand(): void {
    playing?.stop();
    playing = null;
    qrmPlaying?.stop();
    qrmPlaying = null;
    chain?.stop();
    if (tickHandle !== null) {
      window.clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  function finish(reached?: Stage): void {
    if (state === null) return;
    // Where the contact actually got to. Read after abandon() it would say
    // "abandoned", which told the member nothing.
    const stoppedAt = reached ?? state.stage;
    const s = summarise(state);
    // The band goes quiet with the contact. Leaving the noise running after
    // the member has given up is the application talking over them.
    busy = false;
    stopBand();
    setOurTurn(false);
    replyInput.disabled = true;
    void ctx.store.addSending({
      id: `q-${String(Date.now())}`,
      at: Date.now(),
      target: `QSO with ${s.robotCallsign}`,
      decoded: s.completed ? 'completed' : 'abandoned',
      accuracy: s.completed ? 1 : 0,
      estimatedWpm: s.finalWpm,
      weighting: 3,
      consistency: s.repeatsRequested === 0 ? 1 : Math.max(0, 1 - s.repeatsRequested / 10),
      measuredLatencyMs: 0,
    });
    transcript.append(
      el('p', { class: 'notice' },
        s.completed
          ? `Contact complete with ${s.robotCallsign} at ${String(s.finalWpm)} WPM, ` +
            `${String(s.repeatsRequested)} repeat${s.repeatsRequested === 1 ? '' : 's'} asked for. Logged.`
          : `Contact stopped at “${stageLabel[stoppedAt] ?? stoppedAt}”. Nothing wrong with that — try again.`),
    );
    renderControls();
  }

  replyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void reply(replyInput.value);
    }
  });
  sendKeyedButton.addEventListener('click', () => void sendKeyed());
  startButton.addEventListener('click', () => void begin());
  cqButton.addEventListener('click', () => {
    // On a key this is a shortcut, not a substitute: it stands in for the
    // member's own CQ so they are not stuck at a blank pad wondering what
    // the ritual is. Everything after it they send themselves.
    void reply(`CQ CQ CQ DE ${callsign} ${callsign} K`);
  });
  repeatButton.addEventListener('click', () => void reply('AGN'));
  slowerButton.addEventListener('click', () => void reply('QRS PSE'));
  quitButton.addEventListener('click', () => {
    if (state === null) return;
    const reached = state.stage;
    state = abandon(state);
    renderStatus();
    finish(reached);
  });

  // ---- controls ----

  const presetSelect = select<BandPreset>({
    label: 'Band conditions',
    value: 'typical',
    choices: [
      { value: 'quiet', label: 'Quiet — strong local station' },
      { value: 'typical', label: 'Typical — some hiss and fading' },
      { value: 'poor', label: 'Poor — noisy, deep fading, interference' },
      { value: 'contest', label: 'Contest — crowded band' },
    ],
    onChange: (value) => {
      band = { ...BAND_PRESETS[value] };
      chain?.update(band);
      filterSlider.setValue(band.filterHz);
      renderStatus();
    },
  });

  const filterSlider = slider({
    label: 'Receiver filter',
    min: 100, max: 2400, step: 50, value: band.filterHz, unit: ' Hz',
    onInput: (value) => {
      band = { ...band, filterHz: value };
      chain?.update(band);
      renderStatus();
    },
  });

  node.append(
    el('section', { class: 'panel' },
      el('h2', { text: 'Work a station' }),
      el('p', { class: 'hint' },
        'Work a simulated operator either way round: answer their CQ, or call CQ yourself and see who comes ' +
        'back. Copy what they send by ear, then type what you would have sent back. The band is not quiet — ' +
        'that is the point.'),
      statusRow,
      sending,
      el('div', { style: 'height:0.8rem' }),
      transcript,
      el('div', { style: 'height:0.6rem' }),
      replyInput,
      keyPanel,
      el('div', { style: 'height:0.6rem' }),
      el('div', { class: 'row' }, startButton, cqButton, sendKeyedButton, repeatButton, slowerButton, quitButton),
      el('p', { class: 'hint', style: 'margin-top:0.7rem' },
        'If you miss something, ask — send AGN, or PSE RPT, and it will send it again. QRS asks it to ' +
        'slow down. No operator minds being asked.'),
      el('p', { class: 'hint' },
        'You can also ask it for any one fact, and it will answer and hand the contact back: NAME? QTH? ' +
        'RIG? ANT? WX? RST? Put the question mark straight after the word, as you would on the air. ' +
        'Anything else it has not been told, so it will simply carry on.'),
      el('p', { class: 'hint' },
        'Send your own callsign when you answer. Until one arrives the station comes back with QRZ? '
        + 'rather than guess, and it then works whatever call you sent — including one that is not the '
        + 'call on your account, and including one you sent wrong. It copies you; it does not look you '
        + 'up.')),

    el('section', { class: 'panel' },
      el('h2', { text: 'Conditions' }),
      el('p', { class: 'hint' },
        'Copying clean tones in a quiet room is a different skill from pulling a signal out of noise. ' +
        'Narrowing the filter cuts the hiss and pushes an interfering station down with it.'),
      el('div', { class: 'grid' }, presetSelect, filterSlider),
      radioGroup<'typing' | 'key'>({
        legend: 'How you reply',
        name: 'qso-reply-mode',
        value: ctx.settings.qsoReplyMode,
        choices: [
          { value: 'typing', label: 'Typing' },
          { value: 'key', label: 'On my key' },
        ],
        onChange: (value) => {
          ctx.settings.qsoReplyMode = value;
          void ctx.saveSettings();
          key.clear();
          showKeyedPlaceholder();
          setOurTurn(state !== null && !busy && state.stage !== 'complete' && state.stage !== 'abandoned');
          renderControls();
        },
      }),
      radioGroup<QsoRole>({
        legend: 'Who calls',
        name: 'qso-role',
        value: role,
        choices: [
          { value: 'answering', label: 'They call CQ, I answer' },
          { value: 'calling', label: 'I call CQ, they answer' },
        ],
        onChange: (value) => {
          role = value;
          renderControls();
        },
      }),
      radioGroup<Difficulty>({
        legend: 'Their fist',
        name: 'difficulty',
        value: difficulty,
        choices: [
          { value: 'machine', label: 'Machine — perfect timing' },
          { value: 'variable', label: 'Variable speed' },
          { value: 'human', label: 'Human — uneven, hesitant' },
        ],
        onChange: (value) => { difficulty = value; },
      }),
      radioGroup<'short' | 'full'>({
        legend: 'Length',
        name: 'ragchew',
        value: 'full',
        choices: [
          { value: 'short', label: 'Short — report and out' },
          { value: 'full', label: 'Full — with a rag chew' },
        ],
        onChange: (value) => { ragchew = value === 'full'; },
      }),
      el('label', { class: 'field' },
        el('span', { class: 'label-row' }, el('span', { text: 'Your callsign' })),
        el('span', { class: 'control' }, (() => {
          const input = el('input', { type: 'text', value: callsign, 'aria-label': 'Your callsign' });
          input.addEventListener('change', () => {
            callsign = input.value.toUpperCase().trim() || 'A65XY';
            input.value = callsign;
          });
          return input;
        })())),
    ),
  );

  renderStatus();
  renderControls();
  clear(transcript);
  transcript.append(el('span', { class: 'pending',
    text: 'Choose who calls under Conditions, then press the button to start.' }));

  showKeyedPlaceholder();

  return {
    node,
    dispose: () => {
      stopBand();
      key.dispose();
    },
  };
}
