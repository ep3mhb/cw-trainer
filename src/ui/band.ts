/**
 * On the air (RFP §7): the virtual band, as a member sees it.
 *
 * Everything with a decision in it lives elsewhere and is tested there —
 * what a station sounds like from where the dial sits (core/tuning.ts), when
 * a remote key transition should sound (core/link.ts), who gives way when two
 * members call at once (core/signalling.ts). This file draws a dial, a band
 * and a key, and joins those modules to the server (net/socket.ts), to a data
 * channel (net/peer.ts) and to the loudspeaker (core/audio.ts).
 *
 * The one design rule from §7 that shapes the whole layout: this is a tuning
 * interface, not a list of users. The band strip is the primary control; the
 * list of stations under it is a legend for the strip, ordered by how loud
 * each one is where you are tuned, and a station too faint to hear is not in
 * it — you find them by tuning, as on the air.
 */

import type { Voice } from '../core/audio';
import { BAND_PRESETS, type BandPreset, type BandSettings } from '../core/band';
import { BandChain } from '../core/band-audio';
import { describeIdentifier } from '../core/callsign';
import { decode, type KeyEvent } from '../core/decoder';
import { DEFAULT_LINK, KeyLink, SLOW_BUFFER_MS, type KeyPacket } from '../core/link';
import { TurnKeeper } from '../core/turn';
import type { IceServer, IcePolicy, PeerState, ServerMessage, Signal } from '../core/signalling';
import { MAX_TRANSCRIPT } from '../core/signalling';
import {
  DEFAULT_BAND_PLAN, bandScan, clearSpot, describeSignal, formatFrequency, nextSignal,
  receptionOf, snap, tune, type Reception, type Station,
} from '../core/tuning';
import { systemRandom } from '../core/random';
import { api, ApiError, type ContactRecord, type MemberInfo } from '../net/api';
import { Contact } from '../net/peer';
import { readSession, writeMemberCallsign, writeSession } from '../net/session';
import { BandSocket, type SocketState } from '../net/socket';
import { adifExport, adifFileName } from '../core/adif';
import { badge, clear, downloadText, el, select } from './dom';
import { keyInput } from './keyinput';
import { tuningKnob } from './knob';
import { KeyTrace, spectrumRow, waterfallColour } from '../core/spectrum';
import type { Ctx, View } from './context';

declare const __APP_VERSION__: string;

const PLAN = DEFAULT_BAND_PLAN;
const TUNE_STEPS = [-1000, -100, -10, 10, 100, 1000];

/** A station we can hear, with the machinery that plays it. */
interface Heard {
  link: KeyLink;
  voice: Voice | null;
  /** Their key as the display should show it, at play-out time. */
  trace: KeyTrace;
}

export function bandView(ctx: Ctx): View {
  const node = el('div', { class: 'view band-view' });
  let disposed = false;
  let member: MemberInfo | null = null;
  /** The server did not answer at all, as distinct from "you are not signed in". */
  let unreachable = false;

  async function whoAmI(): Promise<void> {
    unreachable = false;
    if (readSession() === null) {
      member = null;
      return;
    }
    try {
      member = (await api.me()).member;
      writeMemberCallsign(member.callsign, member.name);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        writeSession(null);
        writeMemberCallsign(null);
      } else if (error instanceof ApiError && error.status === 0) {
        // Status 0 is this application's own word for "no answer": the
        // request never got a reply, or it ran past the deadline in
        // net/api.ts. The member's token is untouched and still good.
        unreachable = true;
      }
      member = null;
    }
  }

  /**
   * Shown instead of the sign-in form when the server did not answer.
   * The old behaviour was to fall back to the sign-in form, which told a
   * member who was signed in that they were not — and before 0.7.3 a request
   * that never returned left the tab on "Checking your session…" for good.
   */
  function unreachablePanel(): HTMLElement {
    const retry = el('button', { class: 'btn primary', text: 'Retry' });
    retry.addEventListener('click', () => {
      retry.disabled = true;
      retry.textContent = 'Trying…';
      void whoAmI().then(render);
    });
    return el('section', { class: 'panel' },
      el('h2', { text: 'On the air' }),
      el('p', { class: 'notice bad', text: 'Can’t reach the server.' }),
      el('p', { class: 'hint' },
        'You are still signed in on this device; nothing has been lost. The server may be down or your '
        + 'connection may be off. Everything on the other tabs works without it.'),
      el('div', { class: 'row' }, retry));
  }

  // ------------------------------------------------------------------
  // Account panel: sign in, register, or finish a reset from a mailed link.
  // ------------------------------------------------------------------
  function accountPanel(): HTMLElement {
    const panel = el('section', { class: 'panel' }, el('h2', { text: 'Sign in to the band' }));
    const message = el('p', { class: 'notice', hidden: true });
    const say = (text: string, tone: '' | 'bad' | 'good' = ''): void => {
      message.hidden = false;
      message.className = `notice ${tone}`.trim();
      message.textContent = text;
    };
    const field = (label: string, input: HTMLInputElement): HTMLLabelElement =>
      el('label', { class: 'field' },
        el('span', { class: 'label-row' }, el('span', { text: label })),
        el('span', { class: 'control' }, input));

    const email = el('input', { type: 'email', autocomplete: 'username', placeholder: 'you@example.com' });
    const password = el('input', { type: 'password', autocomplete: 'current-password' });
    const signIn = el('button', { class: 'btn primary', text: 'Sign in' });
    const forgot = el('button', { class: 'btn', text: 'Forgotten password' });

    const rName = el('input', { type: 'text', autocomplete: 'name', placeholder: 'as you want it heard' });
    const rEmail = el('input', { type: 'email', autocomplete: 'email' });
    const rPassword = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'at least 10 characters' });
    const rCall = el('input', { type: 'text', autocomplete: 'off', placeholder: 'leave blank if not licensed yet' });
    /*
     * RFD A37. Unticked, and it stays unticked unless the member reaches
     * for it: having an account does not imply wanting practice history on
     * somebody else's machine. Some members will want the report and the
     * portability; some would rather their fumbling stayed on their own
     * computer, and the only way to know is to ask.
     */
    const rKeep = el('input', { type: 'checkbox' });
    const register = el('button', { class: 'btn', text: 'Create account' });

    const resetToken = /#reset=([A-Za-z0-9_-]+)/.exec(window.location.hash)?.[1] ?? null;
    const newPassword = el('input', { type: 'password', autocomplete: 'new-password' });
    const doReset = el('button', { class: 'btn primary', text: 'Set new password' });

    const busy = (on: boolean): void => {
      for (const b of [signIn, forgot, register, doReset]) b.disabled = on;
    };
    const attempt = (work: () => Promise<void>, failure: string): void => {
      void (async () => {
        busy(true);
        try {
          await work();
        } catch (error) {
          say(error instanceof Error ? error.message : failure, 'bad');
        } finally {
          busy(false);
        }
      })();
    };

    signIn.addEventListener('click', () => attempt(async () => {
      const r = await api.login(email.value.trim(), password.value);
      writeSession(r.token);
      writeMemberCallsign(r.member.callsign, r.member.name);
      member = r.member;
      render();
    }, 'sign-in failed'));

    forgot.addEventListener('click', () => {
      if (!email.value.trim()) {
        say('type your email address first, then press this again', 'bad');
        return;
      }
      attempt(async () => {
        say((await api.resetRequest(email.value.trim())).message, 'good');
      }, 'could not request a reset');
    });

    register.addEventListener('click', () => attempt(async () => {
      const input: {
        name: string; email: string; password: string; callsign?: string; keepRecords?: boolean;
      } = {
        name: rName.value.trim(), email: rEmail.value.trim(), password: rPassword.value,
      };
      if (rCall.value.trim()) input.callsign = rCall.value.trim();
      if (rKeep.checked) input.keepRecords = true;
      const r = await api.register(input);
      writeSession(r.token);
      writeMemberCallsign(r.member.callsign, r.member.name);
      member = r.member;
      ctx.toast(r.member.training
        ? `Welcome. Your training identifier is ${r.member.callsign}.`
        : r.member.verified
          ? `Welcome, ${r.member.callsign}.`
          : `Welcome, ${r.member.callsign}. An administrator will confirm your callsign; until then it is marked unconfirmed on the band.`, 'good');
      render();
    }, 'could not create the account'));

    doReset.addEventListener('click', () => {
      if (resetToken === null) return;
      attempt(async () => {
        const r = await api.resetConfirm(resetToken, newPassword.value);
        writeSession(r.token);
        writeMemberCallsign(r.member.callsign, r.member.name);
        member = r.member;
        window.location.hash = '';
        ctx.toast('Password changed. Every other device has been signed out.', 'good');
        render();
      }, 'that link did not work');
    });

    if (resetToken !== null) {
      panel.append(
        el('p', { class: 'hint', text: 'You followed a reset link. Choose a new password; it signs out every other device.' }),
        field('New password', newPassword),
        el('div', { class: 'row' }, doReset),
        message,
      );
      return panel;
    }

    panel.append(
      el('p', { class: 'hint' },
        'Live contacts need an account. Everything else in this application works without one and stays on this device.'),
      field('Email', email),
      field('Password', password),
      el('div', { class: 'row' }, signIn, forgot),
      message,
      el('h3', { text: 'New here?' }),
      el('p', { class: 'hint' },
        'Give your callsign if you hold one — an administrator confirms it before it counts as yours, and until then '
        + 'it is marked unconfirmed on the band. If you are not licensed, leave it blank and you will be issued a '
        + 'training identifier: it begins A0, a series no real station can ever hold, and is labelled as training '
        + 'wherever it appears.'),
      field('Name', rName),
      field('Email', rEmail),
      field('Password', rPassword),
      field('Callsign (optional)', rCall),
      el('label', { class: 'field' },
        el('span', { class: 'control' }, rKeep, el('span', { text: ' Keep my training records on the server' }))),
      el('p', { class: 'hint' },
        'Optional, and off unless you tick it. With it on, a summary of each practice session is kept on the '
        + 'server so you can see your progress from any computer or phone and carry on where you left off. '
        + 'Your keystrokes are never sent — only how many characters you attempted and how many you got right. '
        + 'Nobody else can see it, not even an administrator. You can turn it off later under "Your account" on the Settings tab, and '
        + 'turning it off deletes everything already stored.'),
      el('div', { class: 'row' }, register),
    );
    return panel;
  }

  // ------------------------------------------------------------------
  // The band itself.
  // ------------------------------------------------------------------
  function bandPanel(me: MemberInfo): HTMLElement & { dispose: () => void } {
    const wrap = el('div');
    const random = systemRandom();

    let dialHz = snap(7_018_000, PLAN);
    let band: BandSettings = { ...BAND_PRESETS.quiet };

    /**
     * The band-conditions chain under every remote station (§7). Noise and
     * static come from the chain and pass through its receiver filter, so
     * narrowing the filter quietens the band exactly as on the Receive tab.
     * The stations themselves join the chain at its live input: they fade
     * with the band (QSB) but bypass the filter, because their level from
     * where the dial sits is already the receiver model in tuning.ts (the
     * same figures the Heard list shows), and filtering them twice would make
     * the display and the ear disagree.
     */
    let chain: BandChain | null = null;
    let chainTick: number | null = null;
    function ensureChain(): AudioNode | undefined {
      if (chain !== null) return chain.liveInput;
      const audioCtx = ctx.audio.context;
      if (audioCtx === null) return undefined;
      chain = new BandChain(audioCtx, band);
      ctx.audio.connectChain(chain);
      chain.setCentreHz(ctx.settings.audio.pitchHz);
      chain.start();
      chainTick = window.setInterval(() => chain?.tick(), 25);
      return chain.liveInput;
    }
    function stopChain(): void {
      if (chainTick !== null) window.clearInterval(chainTick);
      chainTick = null;
      chain?.stop();
      chain = null;
    }
    const receiver = (): { dialHz: number; pitchHz: number } => ({ dialHz, pitchHz: ctx.settings.audio.pitchHz });

    let stations: Station[] = [];
    let selfId = '';
    let ice: IceServer[] = [];
    let icePolicy: IcePolicy = 'relay';
    let socketState: SocketState = 'closed';
    let socketDetail = '';
    let spotHz: number | null = null;
    let calling = false;

    const heard = new Map<string, Heard>();
    let contact: Contact | null = null;
    let partnerId: string | null = null;
    let contactWords = '';
    let txSeq = 0;
    /** Whose over it is in the current contact (§7: over to over). */
    const turn = new TurnKeeper();
    /**
     * What each heard station has sent, as played, so a report can carry a
     * transcript (§7 "report abuse from within a contact"). Decoded only at
     * the moment of a report — never shown during a contact, because copying
     * by ear is the skill this application exists to teach.
     */
    const sentByPeer = new Map<string, KeyEvent[]>();
    const TRANSCRIPT_EVENTS = 4000;
    const nowMs = (): number => ctx.audio.now * 1000;

    // ---- status ----
    const statusRow = el('div', { class: 'row' });
    const idInfo = describeIdentifier(me.callsign);
    function renderStatus(): void {
      clear(statusRow);
      statusRow.append(
        badge('You', idInfo.training ? `${idInfo.text} (training)` : me.verified ? idInfo.text : `${idInfo.text} (unconfirmed)`,
          idInfo.training ? 'warn' : me.verified ? '' : 'bad'),
        badge('Band', (socketDetail || socketState) + (socketState === 'open' && socket.rttMs > 0 ? ` · ${String(socket.rttMs)} ms` : ''),
          socketState === 'open' ? 'good' : socketState === 'refused' ? 'bad' : 'warn'),
        badge('On air', String(stations.length)),
        badge('Dial', formatFrequency(dialHz)),
      );
      if (contactWords) statusRow.append(badge('Contact', contactWords, contact?.open ? 'good' : ''));
    }

    // ---- dial ----
    const readout = el('div', {
      class: 'dial-readout', text: formatFrequency(dialHz), tabindex: 0, role: 'slider',
      'aria-valuemin': PLAN.startHz, 'aria-valuemax': PLAN.endHz, 'aria-valuenow': dialHz, 'aria-label': 'Frequency',
    });
    const range = el('input', {
      type: 'range', min: PLAN.startHz, max: PLAN.endHz, step: PLAN.stepHz, value: dialHz, 'aria-label': 'Tune',
    });
    /**
     * The band scope: §7's "tuning interface, not a list of users", drawn.
     * Every station is a bar whose height is its strength, labelled with its
     * callsign; the shaded passband around the red dial line is what the
     * receiver can hear; a drag across it tunes. The Heard list under it is
     * the legend, never the control.
     */
    const scope = el('div', { class: 'band-scope', tabindex: 0, role: 'slider', 'aria-label': 'Band — drag to tune',
      'aria-valuemin': PLAN.startHz, 'aria-valuemax': PLAN.endHz, 'aria-valuenow': dialHz });
    /**
     * The panadapter behind the scope: a spectrum along the top and a
     * waterfall beneath, drawn from what the receiver knows (core/spectrum).
     * A CW signal is only there while its key is down, so the waterfall
     * shows the code as it is sent. The DOM marks and labels sit over it.
     */
    const scopeCanvas = el('canvas', { class: 'scope-canvas', 'aria-hidden': 'true' });
    const knob = tuningKnob({
      label: 'Tuning knob', stepHz: PLAN.stepHz, min: PLAN.startHz, max: PLAN.endHz,
      onStep: (detents) => step(detents),
    });

    function setDial(hz: number): void {
      dialHz = snap(hz, PLAN);
      readout.textContent = formatFrequency(dialHz);
      readout.setAttribute('aria-valuenow', String(dialHz));
      range.value = String(dialHz);
      knob.setValue(dialHz);
      retune();
      renderStrip();
      renderStations();
      renderStatus();
      renderControls();
    }
    const step = (detents: number): void => setDial(tune(dialHz, detents, PLAN));

    range.addEventListener('input', () => setDial(Number(range.value)));
    const onTuneKey = (e: KeyboardEvent): void => {
      const big = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { step(big); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { step(-big); e.preventDefault(); }
      else if (e.key === 'PageUp') { step(100); e.preventDefault(); }
      else if (e.key === 'PageDown') { step(-100); e.preventDefault(); }
    };
    const onTuneWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const size = e.shiftKey ? 10 : 1;
      step(e.deltaY < 0 ? size : -size);
    };
    readout.addEventListener('keydown', onTuneKey);
    readout.addEventListener('wheel', onTuneWheel, { passive: false });
    scope.addEventListener('keydown', onTuneKey);
    scope.addEventListener('wheel', onTuneWheel, { passive: false });

    // Drag across the scope to tune, as a finger on a dial. A press on a
    // station's bar lands exactly on it (see renderStrip); a press anywhere
    // else lands where the finger is.
    const hzAt = (clientX: number): number => {
      const box = scope.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      return PLAN.startHz + frac * (PLAN.endHz - PLAN.startHz);
    };
    let dragging = false;
    scope.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).classList.contains('band-mark')) return;
      dragging = true;
      scope.setPointerCapture(e.pointerId);
      setDial(hzAt(e.clientX));
      scope.focus();
    });
    scope.addEventListener('pointermove', (e) => { if (dragging) setDial(hzAt(e.clientX)); });
    const stopDrag = (): void => { dragging = false; };
    scope.addEventListener('pointerup', stopDrag);
    scope.addEventListener('pointercancel', stopDrag);

    const stepButton = (d: number): HTMLButtonElement => {
      const label = Math.abs(d) >= 1000 ? `${String(Math.abs(d) / 1000)}k` : String(Math.abs(d));
      const b = el('button', { class: 'btn step', text: `${d > 0 ? '+' : '−'}${label}`,
        title: `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d) >= 1000 ? `${String(Math.abs(d) / 1000)} kHz` : `${String(Math.abs(d))} Hz`}` });
      b.addEventListener('click', () => setDial(dialHz + d));
      return b;
    };
    const downSteps = el('div', { class: 'dial-group' }, ...TUNE_STEPS.filter((d) => d < 0).map(stepButton));
    const upSteps = el('div', { class: 'dial-group' }, ...TUNE_STEPS.filter((d) => d > 0).map(stepButton));
    const scanDown = el('button', { class: 'btn', text: '◂ Next', title: 'Next signal down the band' });
    const scanUp = el('button', { class: 'btn', text: 'Next ▸', title: 'Next signal up the band' });
    scanDown.addEventListener('click', () => { const s = nextSignal(others(), receiver(), band, -1); if (s) setDial(s.frequencyHz); });
    scanUp.addEventListener('click', () => { const s = nextSignal(others(), receiver(), band, 1); if (s) setDial(s.frequencyHz); });

    const others = (): Station[] => stations.filter((s) => s.id !== selfId);

    function renderStrip(): void {
      clear(scope);
      scope.append(scopeCanvas);
      scope.setAttribute('aria-valuenow', String(dialHz));
      const span = PLAN.endHz - PLAN.startHz;
      const frac = (hz: number): number => (hz - PLAN.startHz) / span;
      const x = (hz: number): string => `${String(frac(hz) * 100)}%`;
      // Ticks every kHz, labelled every 5.
      for (let hz = PLAN.startHz; hz <= PLAN.endHz; hz += 1000) {
        const major = (hz - PLAN.startHz) % 5000 === 0;
        scope.append(el('div', { class: `scope-tick${major ? ' major' : ''}`, style: `left:${x(hz)}` }));
        if (major && hz > PLAN.startHz && hz < PLAN.endHz) {
          scope.append(el('span', { class: 'scope-tick-label', text: (hz / 1000).toFixed(0), style: `left:${x(hz)}` }));
        }
      }
      // The passband: the flat top of the receiver's filter, either side of
      // the dial. Signals outside it are still heard, fading with distance.
      const half = band.filterHz / 2;
      const lo = Math.max(PLAN.startHz, dialHz - half);
      const hi = Math.min(PLAN.endHz, dialHz + half);
      scope.append(el('div', { class: 'scope-passband', style: `left:${x(lo)}; width:${String((frac(hi) - frac(lo)) * 100)}%` }));
      // Stations. Bars are drawn one per station; labels are drawn one per
      // CLUSTER — stations within a label's width of each other share one,
      // naming the strongest two and counting the rest — so five members on
      // one frequency read as a pile-up, not as five labels printed over each
      // other. The Heard list underneath carries the full detail.
      const sorted = [...stations].sort((a, b) => a.frequencyHz - b.frequencyHz);
      const CLUSTER = 0.05;
      const clusters: Station[][] = [];
      for (const s of sorted) {
        const last = clusters[clusters.length - 1];
        if (last && frac(s.frequencyHz) - frac((last[0] as Station).frequencyHz) < CLUSTER) last.push(s);
        else clusters.push([s]);
      }
      for (const s of sorted) {
        const r = receptionOf(s, receiver(), band);
        const classes = ['band-mark'];
        if (r.audible) classes.push('audible');
        if (s.transmitting) classes.push('tx');
        if (s.calling) classes.push('cq');
        if (s.id === selfId) classes.push('me');
        const mark = el('button', {
          class: classes.join(' '),
          title: `${s.callsign} — ${formatFrequency(s.frequencyHz)}${s.calling ? ' — calling CQ' : ''}`,
          'aria-label': `${s.callsign} at ${formatFrequency(s.frequencyHz)}`,
          style: `left:${x(s.frequencyHz)}; --level:${String(Math.max(0.15, s.strength))}`,
        });
        if (s.id !== selfId) mark.addEventListener('click', () => setDial(s.frequencyHz));
        scope.append(mark);
      }
      let lastLabelFrac = -1;
      let tier = 0;
      for (const group of clusters) {
        // Strongest first; "you" is named last so the others read first.
        const named = [...group].sort((a, b) => (a.id === selfId ? 1 : 0) - (b.id === selfId ? 1 : 0) || b.strength - a.strength);
        const centre = named.reduce((sum, s) => sum + frac(s.frequencyHz), 0) / named.length;
        const words = named.slice(0, 2).map((s) => (s.id === selfId ? 'you' : s.callsign));
        const more = named.length - words.length;
        tier = centre - lastLabelFrac < 0.09 ? (tier + 1) % 3 : 0;
        lastLabelFrac = centre;
        const labelClasses = ['band-mark-label'];
        if (named.some((s) => s.calling)) labelClasses.push('cq');
        if (named.length === 1 && named[0]?.id === selfId) labelClasses.push('me');
        const edge = centre < 0.06 ? 'transform:none' : centre > 0.94 ? 'transform:translateX(-100%)' : '';
        scope.append(el('span', {
          class: labelClasses.join(' '),
          text: words.join(', ') + (more > 0 ? ` +${String(more)}` : ''),
          title: named.map((s) => `${s.callsign} — ${formatFrequency(s.frequencyHz)}`).join('\n'),
          style: `left:${String(centre * 100)}%; top:${String(0.25 + tier * 0.95)}rem; ${edge}`,
        }));
      }
      scope.append(el('div', { class: 'band-cursor', style: `left:${x(dialHz)}` }));
    }

    // ---- the panadapter ----
    /** Our own key, as the display shows it: at the time each element sounds. */
    const myTrace = new KeyTrace();
    // A third of the glass for the spectrum, the rest for the waterfall,
    // which moves one pixel per frame at ~30 frames a second: a dit at
    // 18 WPM is two pixels, a dah six, and the glass holds about five
    // seconds of the band.
    const SPECTRUM_FRAC = 0.32;
    const ROW_PX = 1;
    let frameHandle: number | null = null;
    let lastFrameMs = 0;
    // Slower when the member asked for less motion; the code still shows.
    const FRAME_MS = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : 40;
    // The waterfall's history lives in two offscreen canvases that alternate:
    // each frame the old one is drawn one row lower into the other. Drawing a
    // canvas onto ITSELF, the obvious way, makes Safari read the pixels back
    // every frame and the page crawls (reported the hour it shipped).
    let wfA = document.createElement('canvas');
    let wfB = document.createElement('canvas');
    // Only draw while the glass is on screen.
    let scopeVisible = true;
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) scopeVisible = e.isIntersecting;
    });
    seen.observe(scope);
    function sizeCanvas(): boolean {
      const w = Math.min(900, Math.max(1, Math.round(scope.clientWidth)));
      const h = Math.max(1, Math.round(scope.clientHeight));
      if (scopeCanvas.width !== w || scopeCanvas.height !== h) {
        scopeCanvas.width = w;
        scopeCanvas.height = h;
        return true;
      }
      return false;
    }
    function drawFrame(nowMs: number): void {
      frameHandle = window.requestAnimationFrame(drawFrame);
      if (nowMs - lastFrameMs < FRAME_MS) return;
      lastFrameMs = nowMs;
      if (!scopeCanvas.isConnected) return;
      const g = scopeCanvas.getContext('2d');
      if (!g) return;
      if (!scopeVisible || document.visibilityState !== 'visible') return;
      const resized = sizeCanvas();
      const w = scopeCanvas.width;
      const h = scopeCanvas.height;
      const specH = Math.round(h * SPECTRUM_FRAC);
      const wfH = h - specH;
      if (resized || wfA.width !== w || wfA.height !== wfH) {
        for (const c of [wfA, wfB]) {
          c.width = w; c.height = wfH;
          const cg = c.getContext('2d');
          if (cg) { cg.fillStyle = '#000028'; cg.fillRect(0, 0, w, wfH); }
        }
      }
      const span = PLAN.endHz - PLAN.startHz;
      const audioNow = ctx.audio.now * 1000;
      const list = stations.map((s) => {
        const h2 = heard.get(s.id);
        const on = s.id === selfId ? myTrace.at(audioNow) : h2 ? h2.trace.at(audioNow) : s.transmitting;
        return { frac: (s.frequencyHz - PLAN.startHz) / span, level: Math.max(0, Math.min(1, s.strength)), on };
      });
      const row = spectrumRow({ bins: w, stations: list, noise: band.noise, random: Math.random });

      // Waterfall: the previous history one row lower into the other buffer,
      // the new row at the top, then the result onto the glass.
      const wg = wfB.getContext('2d');
      if (!wg) return;
      wg.drawImage(wfA, 0, ROW_PX);
      const line = wg.createImageData(w, ROW_PX);
      for (let x = 0; x < w; x += 1) {
        const [r, gg, b] = waterfallColour(row[x] as number);
        for (let y = 0; y < ROW_PX; y += 1) {
          const o = (y * w + x) * 4;
          line.data[o] = r; line.data[o + 1] = gg; line.data[o + 2] = b; line.data[o + 3] = 255;
        }
      }
      wg.putImageData(line, 0, 0);
      [wfA, wfB] = [wfB, wfA];
      g.drawImage(wfA, 0, specH);

      // Spectrum: the row as a filled trace, amber on glass.
      g.fillStyle = '#07090b';
      g.fillRect(0, 0, w, specH);
      g.beginPath();
      g.moveTo(0, specH);
      for (let x = 0; x < w; x += 1) g.lineTo(x, specH - (row[x] as number) * (specH - 4));
      g.lineTo(w, specH);
      g.closePath();
      const fill = g.createLinearGradient(0, 0, 0, specH);
      fill.addColorStop(0, 'rgba(255,181,69,0.85)');
      fill.addColorStop(1, 'rgba(255,181,69,0.12)');
      g.fillStyle = fill;
      g.fill();
      g.strokeStyle = 'rgba(255,225,170,0.9)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x < w; x += 1) {
        const y = specH - (row[x] as number) * (specH - 4);
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      // A hairline between spectrum and waterfall.
      g.fillStyle = 'rgba(255,181,69,0.35)';
      g.fillRect(0, specH - 1, w, 1);
    }
    frameHandle = window.requestAnimationFrame(drawFrame);

    // ---- heard ----
    const stationList = el('div', { class: 'station-list' });
    function renderStations(): void {
      clear(stationList);
      const scan: Reception[] = bandScan(others(), receiver(), band);
      if (scan.length === 0) {
        // A CQ is meant to be found: name the callers who are off the dial and
        // where they are. A station merely on the band can still be missed.
        const callers = others().filter((s) => s.calling);
        if (callers.length > 0) {
          for (const s of callers) {
            const go = el('button', { class: 'btn primary', text: `Tune to ${s.callsign}` });
            go.addEventListener('click', () => setDial(s.frequencyHz));
            stationList.append(el('div', { class: 'station-row' },
              el('div', { class: 'station-main' },
                el('b', { class: 'mono', text: s.callsign }),
                el('span', { class: 'badge good', text: 'CQ' }),
                el('span', { class: 'hint', text: `calling at ${formatFrequency(s.frequencyHz)} — off your dial` })),
              el('div', { class: 'row' }, go)));
          }
          return;
        }
        stationList.append(el('p', { class: 'hint', text: others().length === 0
          ? 'Nobody else is on the band. Call CQ and see who comes back.'
          : 'Nothing audible here. Tune across the band, or use Next signal.' }));
        return;
      }
      for (const r of scan) {
        const id = describeIdentifier(r.station.callsign);
        const isPartner = r.station.id === partnerId;
        const actions = el('div', { class: 'row' });
        const button = (text: string, cls: string, onClick: () => void): void => {
          const b = el('button', { class: cls, text });
          b.addEventListener('click', onClick);
          actions.append(b);
        };
        if (r.offsetHz !== 0) button('Zero-beat', 'btn', () => setDial(r.station.frequencyHz));
        if (!isPartner && contact === null) {
          button(r.station.calling ? 'Answer' : 'Call', 'btn primary', () => void startContact(r.station));
        }
        if (isPartner) button('End contact', 'btn danger', () => endContact('you ended the contact'));
        button('Report', 'btn', () => report(r.station));
        if (me.role === 'admin') {
          button('Mute', 'btn danger', () => moderate(r.station, 'mute'));
          button('Remove', 'btn danger', () => moderate(r.station, 'remove'));
        }
        stationList.append(
          el('div', { class: `station-row${isPartner ? ' partner' : ''}` },
            el('div', { class: 'station-main' },
              el('b', { class: 'mono', text: id.text }),
              id.training ? el('span', { class: 'badge warn', text: 'training' }) : null,
              r.station.unconfirmed ? el('span', { class: 'badge bad', text: 'unconfirmed', title: 'This callsign has not yet been confirmed by an administrator; a contact with it is not exportable.' }) : null,
              r.station.calling ? el('span', { class: 'badge good', text: 'CQ' }) : null,
              r.station.transmitting ? el('span', { class: 'badge', text: 'keying' }) : null,
              el('span', { class: 's-meter', title: describeSignal(r), style: `--level:${String(Math.min(1, r.level))}` }, el('i')),
              el('span', { class: 'hint',
                text: `${formatFrequency(r.station.frequencyHz)} · ${String(Math.round(r.audioHz))} Hz · ${describeSignal(r)}` }),
              aboutLine(r.station),
              linkLine(r.station.id)),
            actions,
          ),
        );
      }
    }

    /**
     * Who they are, as their profile has it (§8): name, QTH, grid, rig,
     * antenna, licence — whatever they filled in, nothing for what they left
     * blank. This is what you would be told in the exchange; seeing it is not
     * the same as copying it, so it is a small line, not a card.
     */
    function aboutLine(s: Station): HTMLElement | null {
      const a = s.about;
      if (!a) return null;
      const parts = [a.name, a.qth, a.grid, a.rig, a.antenna, a.licence].filter((x): x is string => Boolean(x));
      if (parts.length === 0) return null;
      return el('span', { class: 'hint about-line', text: parts.join(' · ') });
    }

    /**
     * What the link to one station is doing, in words a member can act on.
     * Empty until something has been heard. A bad connection is named as a
     * connection (late, missing, a grown buffer), never left to sound like
     * bad sending. The buffer is shown once it has grown past the floor, so
     * a member who finds the exchange slow can see the delay is the
     * connection's, and how much of it there is.
     */
    function linkLine(peerId: string): HTMLElement {
      const h = heard.get(peerId);
      const line = el('span', { class: 'hint link-line', 'data-peer': peerId });
      if (!h || h.link.stats.received === 0) return line;
      const st = h.link.stats;
      const trouble = st.lateDropped + st.missing + (st.bufferMs >= SLOW_BUFFER_MS ? 1 : 0);
      line.textContent = `link: ${String(st.received)} received`
        + (st.latePlayed ? `, ${String(st.latePlayed)} late` : '')
        + (st.lateDropped ? `, ${String(st.lateDropped)} skipped` : '')
        + (st.missing ? `, ${String(st.missing)} missing` : '')
        + (st.bufferMs > DEFAULT_LINK.bufferMs ? ` · delay ${String(st.bufferMs)} ms` : '')
        + (h.voice ? ` · playing at ${String(Math.round(h.voice.pitchHz))} Hz` : '');
      if (trouble > 0) line.classList.add('bad');
      return line;
    }

    function refreshLinkLines(): void {
      for (const old of Array.from(stationList.querySelectorAll('.link-line'))) {
        old.replaceWith(linkLine(old.getAttribute('data-peer') ?? ''));
      }
    }

    // ---- listening ----
    function ensureHeard(peerId: string): Heard {
      let h = heard.get(peerId);
      if (!h) {
        h = { link: new KeyLink(), voice: null, trace: new KeyTrace() };
        heard.set(peerId, h);
      }
      return h;
    }

    let retuneTimer: number | null = null;
    /** Coalesce a slider drag into one cross-fade a few tens of ms later. */
    function retune(): void {
      if (retuneTimer !== null) return;
      retuneTimer = window.setTimeout(() => {
        retuneTimer = null;
        retuneNow();
      }, 40);
    }
    function retuneNow(): void {
      for (const [peerId, h] of heard) {
        const s = stations.find((x) => x.id === peerId);
        if (!s || !h.voice) continue;
        const r = receptionOf(s, receiver(), band);
        h.voice.setPitch(r.audioHz);
        h.voice.setLevel(r.audible ? r.level : 0);
      }
      refreshLinkLines();
    }

    function hearPacket(peerId: string, packet: KeyPacket): void {
      const s = stations.find((x) => x.id === peerId);
      if (!s || !ctx.audio.isRunning) return;
      const h = ensureHeard(peerId);
      const scheduled = h.link.receive(packet, ctx.audio.now * 1000);
      if (!scheduled || scheduled.disposition === 'duplicate') return;
      const r = receptionOf(s, receiver(), band);
      if (!h.voice) {
        try {
          h.voice = ctx.audio.voice(r.audioHz, r.audible ? r.level : 0, ensureChain());
        } catch {
          return;
        }
      }
      h.voice.keyAt(scheduled.playAtMs / 1000, scheduled.down);
      h.trace.push(scheduled.playAtMs, scheduled.down);
      if (peerId === partnerId) turn.theirKey(scheduled.playAtMs, scheduled.down);
      const sent = sentByPeer.get(peerId) ?? [];
      sent.push({ down: scheduled.down, t: scheduled.playAtMs });
      if (sent.length > TRANSCRIPT_EVENTS) sent.splice(0, sent.length - TRANSCRIPT_EVENTS);
      sentByPeer.set(peerId, sent);
      if (!scheduled.down) refreshLinkLines();
    }

    /** Tell the server what this receiver has heard from each station. */
    function reportLinks(): void {
      renderStatus();
      if (socketState !== 'open') return;
      const agent = navigator.userAgent.slice(0, 200);
      for (const [peerId, h] of heard) {
        const st = h.link.stats;
        if (st.received === 0) continue;
        socket.send({
          kind: 'link', peer: peerId,
          received: st.received, latePlayed: st.latePlayed, lateDropped: st.lateDropped, missing: st.missing,
          offsetMs: st.offsetMs, resyncs: st.resyncs, playingHz: h.voice ? h.voice.pitchHz : 0,
          bufferMs: st.bufferMs, agent,
        });
      }
    }
    const reportTimer = window.setInterval(reportLinks, 10_000);

    // Back to the foreground (a phone unlocked, a tab re-selected): if the
    // socket died meanwhile, reconnect now rather than after the backoff.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') socket.nudge();
    };
    document.addEventListener('visibilitychange', onVisible);

    /** Follow the turn: the pad says whose over it is, and the row lamps it. */
    const turnLamp = el('span', { class: 'badge turn-lamp', hidden: true });
    function renderTurn(): void {
      if (contact === null || !key.armed) {
        key.setHeld(false);
        turnLamp.hidden = true;
        return;
      }
      const whose = turn.at(nowMs());
      key.setHeld(whose === 'theirs');
      turnLamp.hidden = false;
      turnLamp.className = `badge turn-lamp ${whose === 'theirs' ? 'warn' : whose === 'mine' ? 'good' : ''}`;
      turnLamp.textContent = whose === 'theirs' ? 'their over' : whose === 'mine' ? 'your over' : 'either may send';
    }
    const turnTimer = window.setInterval(renderTurn, 250);

    function forget(peerId: string): void {
      const h = heard.get(peerId);
      if (h) {
        h.voice?.dispose();
        heard.delete(peerId);
      }
      sentByPeer.delete(peerId);
    }

    /** What a station sent, decoded as a machine would copy it, for a report. */
    function transcriptOf(peerId: string): string {
      const sent = sentByPeer.get(peerId);
      if (!sent || sent.length < 2) return '';
      try {
        return decode([...sent].sort((a, b) => a.t - b.t), { tolerance: 0.5 }).text.slice(0, MAX_TRANSCRIPT);
      } catch {
        return '';
      }
    }

    // ---- socket ----
    const socket = new BandSocket({
      token: readSession() ?? '',
      onState: (state, detail) => {
        socketState = state;
        socketDetail = detail;
        if (state === 'open' && ctx.audio.isRunning) ensureChain();
        renderStatus();
        renderControls();
        if (state === 'refused') {
          ctx.toast(`The band refused the connection: ${detail}.`, 'bad');
          if (detail.includes('sign in')) {
            writeSession(null);
            member = null;
            render();
          }
        }
      },
      onMessage: (m) => onServer(m),
    });

    let welcomed = false;
    function onServer(m: ServerMessage): void {
      switch (m.kind) {
        case 'welcome':
          selfId = m.you;
          ice = m.ice;
          icePolicy = m.icePolicy;
          if (welcomed) {
            // A reconnect, not the first hello. The server has forgotten us:
            // our old peer id, our spot, and any contact we were in. Found on
            // an iPhone, 21 September 2026 — the socket dies when the phone
            // locks, the page came back showing a contact and a frequency the
            // server no longer knew about, and nobody else could see us.
            if (contact !== null) endContact('the connection to the server dropped and came back', false);
            if (spotHz !== null) socket.send({ kind: 'spot', frequencyHz: spotHz, calling });
          }
          welcomed = true;
          break;
        case 'band':
          stations = m.stations;
          for (const id of Array.from(heard.keys())) if (!stations.some((s) => s.id === id)) forget(id);
          retune();
          renderStrip();
          renderStations();
          renderStatus();
          break;
        case 'keying':
          // Our partner's keying arrives over the data channel; the server
          // copy is for everyone else. Never play it twice.
          if (m.peer === partnerId && contact?.open) return;
          hearPacket(m.peer, { seq: m.seq, t: m.t, down: m.down });
          break;
        case 'signal':
          onSignal(m.from, m.payload);
          break;
        case 'gone':
          reportLinks();
          forget(m.peer);
          if (m.peer === partnerId) endContact('the other station left the band', false);
          break;
        case 'moderated':
          if (m.peer === selfId) {
            ctx.toast(m.action === 'muted'
              ? `An administrator (${m.by}) has muted you for 24 hours.`
              : `An administrator (${m.by}) has removed you from the band.`, 'bad');
          }
          break;
        case 'error':
          if (m.code === 'band-full') ctx.toast('Someone is close to that frequency. Tune a little away before calling CQ.', 'warn');
          else if (m.code === 'muted') ctx.toast('You are muted and cannot transmit at the moment.', 'bad');
          else if (m.code === 'rate-limited') ctx.toast('Slow down — the server is dropping messages.', 'warn');
          else if (m.code !== 'not-authorised') ctx.toast(`Server: ${m.detail || m.code}`, 'warn');
          break;
        default:
          break;
      }
    }

    // ---- transmitting ----
    const key = keyInput({
      ctx,
      // Over to over: while the other station in a contact is sending, or
      // has just stopped, our key is held. Outside a contact everyone may
      // call at once, as on a band.
      gate: () => contact === null || turn.mayKey(nowMs()),
      onHeld: () => {
        const wait = Math.ceil(turn.heldForMs(nowMs()) / 1000);
        key.setHeld(true, `Their over — wait${wait > 0 ? ` (${String(wait)} s)` : ''}`);
      },
      onEvent: (event) => {
        myTrace.push(event.t + key.epochMs, event.down);
        turn.myKey(event.t + key.epochMs);
        const t = event.t + key.epochMs;
        const seq = txSeq++;
        // Same packet by both routes: the band hears it via the server, the
        // partner via the channel, and a receiver getting both keeps one.
        socket.send({ kind: 'key', seq, t, down: event.down });
        contact?.sendKey(seq, t, event.down);
      },
    });

    const cqButton = el('button', { class: 'btn primary', text: 'Call CQ here' });
    const listenButton = el('button', { class: 'btn', text: 'Listen here' });
    const clearSpotButton = el('button', { class: 'btn', text: 'Find a clear spot' });
    const leaveButton = el('button', { class: 'btn danger', text: 'Leave the band' });

    async function spot(asCaller: boolean): Promise<void> {
      if (asCaller ? !(await key.arm()) : !(await ctx.ensureAudio())) return;
      // The band has a noise floor whether or not anyone is keying.
      ensureChain();
      spotHz = dialHz;
      calling = asCaller;
      socket.send({ kind: 'spot', frequencyHz: dialHz, calling: asCaller });
      renderControls();
    }
    cqButton.addEventListener('click', () => void spot(true));
    listenButton.addEventListener('click', () => void spot(false));
    clearSpotButton.addEventListener('click', () => {
      const hz = clearSpot(others(), random, PLAN);
      if (hz === null) ctx.toast('The band is full — no clear spot at all. Try again in a minute.', 'warn');
      else setDial(hz);
    });
    leaveButton.addEventListener('click', () => {
      reportLinks();
      endContact('you left the band');
      socket.close();
      key.disarm();
      spotHz = null;
      calling = false;
      renderControls();
    });

    const controls = el('div', { class: 'row' });
    function renderControls(): void {
      clear(controls);
      const on = socketState === 'open';
      cqButton.disabled = !on;
      listenButton.disabled = !on;
      clearSpotButton.disabled = !on;
      leaveButton.disabled = socketState === 'closed' || socketState === 'refused';
      cqButton.textContent = calling && spotHz === dialHz ? 'Calling CQ here' : 'Call CQ here';
      controls.append(clearSpotButton, listenButton, cqButton, leaveButton);
    }

    // ---- the contact ----
    function onSignal(from: string, payload: Signal): void {
      if (contact === null) {
        if (payload.kind !== 'offer') return;
        partnerId = from;
        contact = makeContact(from);
        const who = stations.find((s) => s.id === from)?.callsign ?? 'a station';
        ctx.toast(`${who} is calling you.`, 'good');
        void key.arm().then(() => ensureChain());
      }
      if (from !== partnerId) return;
      contact.receive(payload);
    }

    function makeContact(peerId: string): Contact {
      ensureHeard(peerId);
      turn.reset();
      return new Contact({
        selfId, peerId, ice, icePolicy,
        signal: (payload) => { socket.send({ kind: 'signal', to: peerId, payload }); },
        onPacket: (packet) => hearPacket(peerId, packet),
        onPhase: (state: PeerState, words) => {
          contactWords = words;
          renderStatus();
          renderStations();
          if (state.phase === 'failed') {
            // The transport spike's obligation: name the network, never the operator.
            ctx.toast(`Could not connect: ${state.reason || 'the network refused'}. This is the connection, not your sending.`, 'bad');
          }
          if (state.phase === 'closed' || state.phase === 'failed') {
            // Before the partner is forgotten: this is the receiver's last
            // word on what the contact sounded like.
            reportLinks();
            contact = null;
            partnerId = null;
            contactWords = '';
            renderStatus();
            renderStations();
          }
        },
        onLog: (line) => { if (import.meta.env.DEV) console.debug('[contact]', line); },
      });
    }

    async function startContact(station: Station): Promise<void> {
      if (contact !== null || socketState !== 'open') return;
      if (!(await key.arm())) return;
      ensureChain();
      setDial(station.frequencyHz);
      spotHz = dialHz;
      calling = false;
      socket.send({ kind: 'spot', frequencyHz: dialHz, calling: false });
      partnerId = station.id;
      contact = makeContact(station.id);
      contact.invite();
      renderControls();
      renderStations();
    }

    function endContact(why: string, sendBye = true): void {
      if (contact === null) return;
      reportLinks();
      const c = contact;
      contact = null;
      partnerId = null;
      contactWords = '';
      if (sendBye) c.hangUp();
      ctx.toast(`Contact ended: ${why}.`);
      renderStatus();
      renderStations();
      window.setTimeout(() => void loadLog(), 1500);
    }

    function report(station: Station): void {
      const reason = window.prompt(`Report ${station.callsign} to the administrators. What happened?`);
      if (reason === null || reason.trim() === '') return;
      const transcript = transcriptOf(station.id);
      socket.send({ kind: 'report', about: station.id, reason: reason.trim(), transcript });
      ctx.toast(transcript
        ? 'Report sent, with a transcript of what they sent. An administrator will look at it.'
        : 'Report sent. An administrator will look at it.', 'good');
    }

    function moderate(station: Station, action: 'mute' | 'remove'): void {
      const reason = window.prompt(`${action === 'mute' ? 'Mute' : 'Remove'} ${station.callsign}. Reason (logged):`);
      if (reason === null) return;
      socket.send({ kind: 'moderate', peer: station.id, action, reason: reason.trim() });
    }

    // ---- band conditions ----
    const presetSelect = select<BandPreset>({
      label: 'Band conditions',
      value: 'quiet',
      choices: (Object.keys(BAND_PRESETS) as BandPreset[]).map((k) => ({ value: k, label: k })),
      onChange: (v) => { band = { ...BAND_PRESETS[v] }; chain?.update(band); retune(); renderStrip(); renderStations(); },
    });

    // ---- the log (§7: both sides get the contact; ADIF export) ----
    const logList = el('div', { class: 'log-list' });
    const logNote = el('p', { class: 'hint', text: 'Loading your contacts…' });
    const exportButton = el('button', { class: 'btn', text: 'Export ADIF' });
    const refreshLog = el('button', { class: 'btn', text: 'Refresh' });
    let logged: ContactRecord[] = [];
    const whenText = (iso: string): string => {
      const d = new Date(iso);
      return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    };
    const durationText = (c: ContactRecord): string => {
      if (c.endedAt === null) return 'open';
      const s = Math.max(0, Math.round((new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime()) / 1000));
      return s < 60 ? `${String(s)} s` : `${String(Math.floor(s / 60))} min ${String(s % 60).padStart(2, '0')} s`;
    };
    function renderLog(): void {
      clear(logList);
      const recent = [...logged].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 12);
      const exportable = logged.filter((c) => c.exportable && c.endedAt !== null).length;
      exportButton.disabled = exportable === 0;
      logNote.textContent = logged.length === 0
        ? 'No contacts yet. The first one you work goes in here, and in the other station\u2019s log.'
        : `${String(logged.length)} contact${logged.length === 1 ? '' : 's'}; ${String(exportable)} exportable`
          + (exportable < logged.length ? ' — a contact with a training identifier stays in this log but is not exported, because A0 is not a callsign.' : '.')
          + (recent.length < logged.length ? ` Showing the latest ${String(recent.length)}.` : '');
      for (const c of recent) {
        const other = c.aCallsign === me.callsign ? c.bCallsign : c.aCallsign;
        const oid = describeIdentifier(other);
        // The exchange, as the member wrote it down (§7): RST sent, RST
        // received, a note. Saved when a field is left; RST as sent on CW
        // (5NN) is accepted and shown as digits.
        const rstIn = (label: string, value: string): HTMLInputElement =>
          el('input', { type: 'text', class: 'rst', value, placeholder: label, 'aria-label': `${label} to ${oid.text}`, maxlength: 3, size: 4 });
        const sent = rstIn('RST sent', c.rstSent);
        const rcvd = rstIn('RST rcvd', c.rstRcvd);
        const note = el('input', { type: 'text', class: 'log-note', value: c.note, placeholder: 'note', 'aria-label': `note on the contact with ${oid.text}`, maxlength: 500 });
        const status = el('span', { class: 'hint log-status' });
        const save = async (): Promise<void> => {
          if (sent.value === c.rstSent && rcvd.value === c.rstRcvd && note.value === c.note) return;
          try {
            const r = await api.noteContact(c.id, { rstSent: sent.value, rstRcvd: rcvd.value, note: note.value });
            c.rstSent = r.rstSent; c.rstRcvd = r.rstRcvd; c.note = r.note;
            sent.value = r.rstSent; rcvd.value = r.rstRcvd;
            status.textContent = 'saved';
            status.classList.remove('bad');
          } catch (error) {
            status.textContent = error instanceof Error ? error.message : 'not saved';
            status.classList.add('bad');
          }
        };
        for (const input of [sent, rcvd, note]) {
          input.addEventListener('blur', () => void save());
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); });
        }
        logList.append(el('div', { class: 'log-row' },
          el('span', { class: 'mono', text: whenText(c.startedAt) }),
          el('b', { class: 'mono', text: oid.text }),
          oid.training ? el('span', { class: 'badge warn', text: 'training' }) : null,
          el('span', { class: 'hint', text: `${formatFrequency(c.frequencyHz)} · ${durationText(c)}` }),
          c.exportable ? null : el('span', { class: 'hint', text: 'not exported' }),
          el('span', { class: 'log-exchange' }, sent, rcvd, note, status),
        ));
      }
    }
    async function loadLog(): Promise<void> {
      try {
        logged = (await api.contacts()).contacts;
      } catch {
        logNote.textContent = 'Could not load your contacts from the server just now.';
        return;
      }
      renderLog();
    }
    refreshLog.addEventListener('click', () => void loadLog());
    exportButton.addEventListener('click', () => {
      const now = new Date();
      const out = adifExport(logged, {
        myCallsign: me.callsign, programId: 'CW Trainer',
        programVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev', now,
      });
      downloadText(adifFileName(me.callsign, now), out.text, 'text/plain');
      ctx.toast(`${String(out.exported)} contact${out.exported === 1 ? '' : 's'} exported`
        + (out.withheld > 0 ? `; ${String(out.withheld)} with a training identifier left out` : '') + '.', 'good');
    });

    const signOut = el('button', { class: 'btn', text: 'Sign out' });
    signOut.addEventListener('click', () => void (async () => {
      socket.close();
      try { await api.logout(); } catch { /* the token is going anyway */ }
      writeSession(null);
      writeMemberCallsign(null);
      member = null;
      render();
    })());

    /*
     * RFD A43. Everything about the account used to be here, in a
     * collapsed panel below the log. It is in Settings now, beside the
     * member's local data, and this tab keeps only what putting somebody
     * on the band actually needs.
     */
    const accountPanelNode = el('section', { class: 'panel' },
      el('h2', { text: 'Signed in' }),
      el('p', { class: 'hint' },
        el('span', { text: `${me.name} · ${idInfo.training ? `training identifier ${idInfo.text}` : idInfo.text}` }),
        el('span', { text: me.verified || idInfo.training ? '' : ', awaiting confirmation by an administrator' })),
      el('p', { class: 'hint', text:
        'Your profile, password, certificates, training records and the button that closes your '
        + 'account are all on the Settings tab.' }),
    );

    wrap.append(
      el('section', { class: 'panel' },
        el('h2', { text: 'On the air' }),
        statusRow,
        scope,
        el('div', { class: 'band-legend' },
          el('span', { class: 'l-audible', text: 'audible from your dial' }),
          el('span', { class: 'l-cq', text: 'calling CQ' }),
          el('span', { class: 'l-tx', text: 'keying' }),
          el('span', { class: 'l-me', text: 'you' }),
          el('span', { class: 'l-pass', text: 'your passband' })),
        el('div', { class: 'vfo' },
          el('div', { class: 'vfo-main' },
            el('div', { class: 'dial-row' }, scanDown, downSteps, readout, upSteps, scanUp),
            range),
          knob.node),
        el('p', { class: 'hint' },
          'Drag across the band, use the slider, the wheel, or the arrow keys on the readout (Shift for 100 Hz, '
          + 'Page keys for 1 kHz). A station sounds at your sidetone pitch when you are on it, higher when your dial '
          + 'is low. You can miss one — that is the point.'),
        controls,
      ),
      el('section', { class: 'panel' },
        el('h2', { text: 'Heard' }),
        el('p', { class: 'hint', text: 'Strongest first, from where your dial is. Stations you cannot hear are not listed.' }),
        stationList,
        presetSelect,
      ),
      el('section', { class: 'panel' },
        el('h2', { text: 'Your key' }),
        el('div', { class: 'row' }, key.lamp, turnLamp,
          el('span', { class: 'hint', text: 'Armed by Call CQ or Answer. Everyone on the band hears what you send; your contact hears it over the direct channel. In a contact your key is held while the other station is sending — contacts are over to over.' })),
        key.pad,
      ),
      el('section', { class: 'panel' },
        el('h2', { text: 'Your log' }),
        logNote,
        logList,
        el('div', { class: 'row' }, exportButton, refreshLog, el('span', { class: 'hint', style: 'margin:0',
          text: 'ADIF is the file every logging program imports. Each record says it was a practice contact, not an on-air QSO.' })),
      ),
      accountPanelNode,
      el('div', { class: 'row end' }, signOut),
    );
    void loadLog();

    renderStatus();
    renderStrip();
    renderStations();
    renderControls();
    socket.connect();

    return Object.assign(wrap, {
      dispose: () => {
        if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
        seen.disconnect();
        document.removeEventListener('visibilitychange', onVisible);
        window.clearInterval(reportTimer);
        window.clearInterval(turnTimer);
        reportLinks();
        endContact('you left the tab');
        socket.close();
        key.dispose();
        for (const id of Array.from(heard.keys())) forget(id);
        stopChain();
      },
    });
  }

  // ------------------------------------------------------------------
  let currentDispose: (() => void) | null = null;
  function render(): void {
    if (disposed) return;
    currentDispose?.();
    currentDispose = null;
    clear(node);
    ctx.setMember(member);
    if (member === null) {
      node.append(unreachable ? unreachablePanel() : accountPanel());
      return;
    }
    const panel = bandPanel(member);
    currentDispose = panel.dispose;
    node.append(panel);
  }

  node.append(el('section', { class: 'panel' }, el('p', { class: 'hint', text: 'Checking your session…' })));
  void whoAmI().then(render);

  return {
    node,
    dispose: () => {
      disposed = true;
      currentDispose?.();
    },
  };
}
