/**
 * Application shell and bootstrap.
 *
 * Phase 1 has no server and no accounts: this file opens the local
 * database, loads settings, and wires up the four views.
 */

import './style.css';

import { CwAudioEngine } from './core/audio';
import { Store } from './storage/db';
import type { Settings } from './storage/schema';
import type { Ctx, View } from './ui/context';
import { api, type MemberInfo } from './net/api';
import { readSession } from './net/session';
import { certificateLookup } from './ui/certificate';
import { badge, clear, el } from './ui/dom';
import { adminView } from './ui/admin';
import { bandView } from './ui/band';
import { helpView } from './ui/help';
import { progressView } from './ui/progress';
import { syncTraining } from './net/training';
import { qsoView } from './ui/qso';
import { landingView, shouldShowLanding } from './ui/landing';
import { receiveView } from './ui/receive';
import { sendView } from './ui/send';
import { settingsView } from './ui/settings';

type TabId = 'receive' | 'send' | 'qso' | 'air' | 'progress' | 'settings' | 'help' | 'admin';

/**
 * `adminOnly` keeps a tab off the bar unless an administrator is signed in.
 * It is tidiness, not security: the administrator's routes are refused by
 * the server to anyone whose session is not an administrator's, so nothing
 * is protected by the tab being hidden and nothing is exposed by its being
 * shown.
 */
const TABS: { id: TabId; label: string; build: (ctx: Ctx) => View; adminOnly?: true }[] = [
  { id: 'receive', label: 'Receive', build: receiveView },
  { id: 'send', label: 'Send', build: sendView },
  { id: 'qso', label: 'QSO', build: qsoView },
  { id: 'air', label: 'On air', build: bandView },
  { id: 'progress', label: 'Progress', build: progressView },
  { id: 'settings', label: 'Settings', build: settingsView },
  { id: 'help', label: 'Help', build: helpView },
  { id: 'admin', label: 'ADMIN', build: adminView, adminOnly: true },
];

async function boot(): Promise<void> {
  const root = document.querySelector('#app');
  if (root === null) throw new Error('#app is missing from index.html');

  let store: Store;
  try {
    store = await Store.open();
  } catch (error) {
    clear(root);
    root.append(
      el('div', { class: 'shell' },
        el('p', { class: 'notice bad', text: error instanceof Error ? error.message : 'Could not open local storage.' }),
        el('p', { class: 'hint', text: 'Private browsing windows sometimes block IndexedDB. Try a normal window.' })),
    );
    return;
  }

  const settings: Settings = await store.settings();
  const progress = await store.progress();
  const audio = new CwAudioEngine(settings.audio);

  // Roll up anything past the retention window, once per load (RFP §4).
  void store.rollUpOldAttempts().catch(() => undefined);

  const statusRow = el('div', { class: 'top-status' });
  const toastLine = el('div', { 'aria-live': 'polite' });
  // Filled and shown by watchForUpdates() when a new build is waiting.
  const updateBanner = el('div', { class: 'update-banner', role: 'status', hidden: true });
  const startAudioButton = el('button', { class: 'btn primary', text: 'Enable sound' });

  // Support hook. `__cwAudio.latency()` from the console answers the
  // question members ask most; the browser test uses `tap()` to hear.
  (window as unknown as { __cwAudio: CwAudioEngine }).__cwAudio = audio;

  const ctx: Ctx = {
    store,
    audio,
    settings,
    progress,
    saveSettings: async () => {
      audio.update(ctx.settings.audio);
      await store.saveSettings(ctx.settings);
    },
    saveProgress: async () => {
      await store.saveProgress(ctx.progress);
    },
    refreshStatus: () => renderStatus(),
    ensureAudio: async () => {
      try {
        await audio.start();
        renderStatus();
        return audio.isRunning;
      } catch (error) {
        ctx.toast(error instanceof Error ? error.message : 'Could not start audio.', 'bad');
        return false;
      }
    },
    toast: (message, tone) => {
      clear(toastLine);
      toastLine.append(el('p', { class: `notice ${tone ?? ''}`.trim(), text: message }));
      window.setTimeout(() => clear(toastLine), 6000);
    },
    member: null,
    setMember: (member) => {
      const wasAdmin = ctx.member?.role === 'admin';
      const wasId = ctx.member?.id ?? null;
      ctx.member = member;

      /*
       * RFD A37. Signing in is the moment to reconcile with the project
       * server: take its position first in case this browser is behind,
       * then send whatever it has not got.
       *
       * Fired on the transition only, not on every re-render, and only for
       * a member who asked for the service. It is deliberately not awaited
       * — nothing on screen waits for the network — and it reports only
       * when the member's position actually moved, because "you are now on
       * lesson 12" is worth a line and "nothing changed" is not.
       */
      if (member !== null && member.id !== wasId && member.keepRecords) {
        void runSync(member);
      }

      /*
       * RFD A43: the account panel is on Settings and signing in happens
       * on On air, so Settings has to be told when that changes or it
       * keeps offering to explain what an account is to somebody who has
       * just made one.
       */
      if (currentId === 'settings') void current?.refresh?.();

      const isAdmin = member?.role === 'admin';
      if (wasAdmin === isAdmin) return;
      renderTabBar();
      // An administrator who signs out should not be left looking at the
      // tab that has just gone from the bar.
      if (!isAdmin && currentId === 'admin') show('air');
    },
  };

  function renderStatus(): void {
    clear(statusRow);
    const state = audio.state;
    const label =
      state === 'running' ? 'running'
        : state === 'none' ? 'not started'
          : state === 'interrupted' ? 'interrupted'
            : state;
    statusRow.append(
      badge('Speed', `${String(ctx.settings.timing.characterWpm)} / ${String(ctx.settings.timing.effectiveWpm)} WPM`),
      badge('Course', `${String(ctx.progress.unlocked)} chars`),
      badge('Audio', label, state === 'running' ? 'good' : state === 'none' ? 'warn' : 'bad'),
    );
    startAudioButton.hidden = state === 'running';
    startAudioButton.textContent = state === 'none' ? 'Enable sound' : 'Restart audio';
  }

  /**
   * Recover audio after the output device changes.
   *
   * Switching to Bluetooth headphones, or unplugging a monitor with speakers,
   * can leave the AudioContext alive but bound to a device that no longer
   * exists: it still reports state 'running' and produces silence. The tell is
   * the audio clock, which stops advancing. Nothing raises an error, so the
   * app has to notice for itself.
   */
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

  let recovering = false;
  async function recoverAudio(reason: string): Promise<void> {
    if (recovering || audio.state === 'none') return;
    recovering = true;
    try {
      // A plain suspend needs only a resume. A device change needs a whole new
      // context, because the old one stays bound to the device that went away
      // and will keep reporting 'running' while making no sound.
      let alive = false;
      if (await audio.tryResume()) {
        audio.clockAdvanced(); // take a reading
        await sleep(150);
        alive = audio.clockAdvanced(); // did the clock actually move?
      }
      if (!alive) await audio.restart();

      renderStatus();
      ctx.toast(
        audio.isRunning
          ? `Audio reconnected after ${reason}.`
          : `Audio stopped after ${reason}. Press "Restart audio".`,
        audio.isRunning ? 'good' : 'bad',
      );
    } catch {
      renderStatus();
      ctx.toast('Audio could not be restarted. Check your output device, then press "Restart audio".', 'bad');
    } finally {
      recovering = false;
    }
  }

  audio.onStateChange = (state) => {
    renderStatus();
    if (state === 'interrupted' || state === 'suspended') void recoverAudio('an interruption');
  };

  // Headphones connecting or disconnecting fires this.
  if (navigator.mediaDevices !== undefined) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      void recoverAudio('an audio device change');
    });
  }

  /**
   * Watchdog for the silent-but-"running" case, which raises no event at all.
   * Only runs while the tab is visible and audio has been started.
   */
  window.setInterval(() => {
    if (document.hidden || audio.state === 'none' || recovering) return;
    if (audio.state !== 'running') {
      renderStatus();
      return;
    }
    if (!audio.clockAdvanced()) void recoverAudio('the audio clock stalling');
  }, 2000);

  startAudioButton.addEventListener('click', () => {
    void (async () => {
      // From 'none' this is a plain start; from any other state the context
      // exists but is not producing sound, so rebuild it outright.
      if (audio.state !== 'none') await audio.restart().catch(() => undefined);
      else await ctx.ensureAudio();
      renderStatus();
    })();
  });


  /**
   * Reconcile with the server: take what it knows, then send what it does
   * not have.
   *
   * Named rather than inline because it is now called from two places. The
   * second is coming back to the page (A42): a member who did three drills
   * on a laptop and picks up their telephone has not signed in again, so
   * nothing would otherwise ask the server whether a series is waiting —
   * and the series is exactly what they came back for.
   */
  let lastSync = 0;
  function runSync(member: MemberInfo): void {
    lastSync = Date.now();
    void syncTraining(ctx.store, member).then((pulled) => {
      if (!pulled) return;
      const { moved, adopted } = pulled;
      if (moved) {
        ctx.progress.unlocked = moved.unlocked;
        ctx.progress.failed = moved.failed;
        ctx.refreshStatus();
        // The report and the course position are both on the Progress tab;
        // if that is what is on screen it has to be told.
        if (currentId === 'progress') void current?.refresh?.();
        ctx.toast(`Picked up where you left off — ${String(moved.unlocked)} characters unlocked.`, 'good');
      }
      /*
       * RFD A42: a statement, not a question. Being asked to approve the
       * continuation of one's own work is an irritation rather than a
       * safeguard, so the series is already adopted by the time this
       * appears and the line only says so.
       */
      if (adopted && adopted.drillsDone > 0) {
        ctx.toast(
          `Carrying on the series you began elsewhere — drill ${String(adopted.drillsDone)} of 10.`,
          'good',
        );
        // The Receive tab reads the series when a session starts, so if it
        // is the tab on screen it should show the new number at once.
        if (currentId === 'receive') void current?.refresh?.();
      }
    });
  }

  /*
   * Asking again when the page comes back. Throttled, because switching
   * between two applications on a telephone fires this constantly and the
   * answer cannot change in five seconds.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const m = ctx.member;
    if (m === null || !m.keepRecords) return;
    if (Date.now() - lastSync < 5000) return;
    runSync(m);
  });

  // ---- shell ----

  const nav = el('nav', { class: 'tabs', role: 'tablist' });
  const main = el('main', { id: 'panel', role: 'tabpanel' });
  const buttons = new Map<TabId, HTMLButtonElement>();
  let current: View | null = null;
  let currentId: TabId | null = null;

  function visible(id: TabId): boolean {
    const tab = TABS.find((t) => t.id === id);
    if (tab === undefined) return false;
    return tab.adminOnly !== true || ctx.member?.role === 'admin';
  }

  function renderTabBar(): void {
    for (const [tabId, button] of buttons) button.hidden = !visible(tabId);
  }

  function show(id: TabId): void {
    if (!visible(id)) return;
    dismissLanding();
    if (id === currentId) {
      void current?.refresh?.();
      return;
    }
    current?.dispose?.();
    const tab = TABS.find((t) => t.id === id);
    if (tab === undefined) return;
    current = tab.build(ctx);
    currentId = id;
    clear(main);
    main.append(current.node);
    for (const [tabId, button] of buttons) {
      button.setAttribute('aria-selected', String(tabId === id));
    }
    // A reset link (#reset=...) is consumed by the On air tab; do not
    // overwrite it with the tab name before that tab has read it.
    if (!window.location.hash.startsWith('#reset=')) window.location.hash = id;
  }

  for (const tab of TABS) {
    const button = el('button', { role: 'tab', 'aria-selected': 'false', text: tab.label });
    button.addEventListener('click', () => show(tab.id));
    buttons.set(tab.id, button);
    nav.append(button);
  }
  renderTabBar();

  clear(root);
  root.append(
    el(
      'div',
      { class: 'shell' },
      el(
        'header',
        { class: 'top' },
        el('h1', {}, 'CW Trainer', el('span', { class: 'sub', text: 'Koch course, sending practice and progress — all in this browser' })),
        el('div', { class: 'row' }, startAudioButton, statusRow),
      ),
      nav,
      updateBanner,
      toastLine,
      main,
      el('footer', { class: 'hint', style: 'margin-top:2rem' },
        'Practice needs no account and stays on this device. "On air" talks to the server once you sign in, and so does the final exam at the end of the course. Nothing else does. ',
        el('span', { text: 'Audio needs one click before it can start, in every browser.' })),
    ),
  );
  root.setAttribute('aria-busy', 'false');

  renderStatus();

  /**
   * A scanned certificate: #certificate=SERIAL.
   *
   * It takes over the panel rather than living in a tab, because whoever
   * followed that QR square came to check one thing and is probably not a
   * member at all. No account, no sign-in, nothing to navigate.
   */
  const certificateSerial = (): string | null => {
    const match = /^#certificate=([0-9A-Za-z-]{8,16})$/.exec(window.location.hash);
    return match ? (match[1] as string).toUpperCase() : null;
  };
  const showCertificate = (serial: string): void => {
    current?.dispose?.();
    current = null;
    currentId = null;
    for (const [, button] of buttons) button.setAttribute('aria-selected', 'false');
    // Taking over the panel is not taking over the page: the header, the tab
    // bar and the footer live outside `main` and used to survive, so a
    // scanned certificate arrived underneath "Enable sound", a speed badge
    // and seven tabs. The class takes the member's furniture away.
    document.body.classList.add('verifying');
    clear(main);
    main.append(certificateLookup(serial, (s) => api.certificate(s)));
  };

  /*
   * RFD A38: the landing view.
   *
   * It takes over the panel in the same way a scanned certificate does, and
   * for the same reason — somebody who has never been here has no use for a
   * row of seven tabs and a speed badge before they know what this is. The
   * difference is that it is dismissed into the application rather than
   * being a dead end, so the furniture comes back as soon as they choose
   * anything.
   *
   * The decision to show it is made from what the browser holds, not from a
   * flag of its own: one drill is a history, and a history is what makes
   * somebody not a first-time visitor. See shouldShowLanding.
   */
  let landing: View | null = null;
  const showLanding = (): void => {
    current?.dispose?.();
    current = null;
    currentId = null;
    for (const [, button] of buttons) button.setAttribute('aria-selected', 'false');
    document.body.classList.add('landing-open');
    landing?.dispose?.();
    landing = landingView({
      startLesson: () => { dismissLanding(); show('receive'); },
      listenToBand: () => { dismissLanding(); show('air'); },
      dismiss: () => { dismissLanding(); show('receive'); },
    });
    clear(main);
    main.append(landing.node);
  };
  function dismissLanding(): void {
    landing?.dispose?.();
    landing = null;
    document.body.classList.remove('landing-open');
  }
  // Help needs a way back to it, so nothing is unreachable for having been
  // dismissed once (A38).
  (window as unknown as { __cwLanding: () => void }).__cwLanding = showLanding;

  const scanned = certificateSerial();
  const fromHash = window.location.hash.replace('#', '') as TabId;
  if (scanned !== null) showCertificate(scanned);
  else if (window.location.hash.startsWith('#reset=')) show('air');
  else if (shouldShowLanding(
    { sessions: (await store.sessions()).length, attempts: (await store.attempts()).length },
    readSession() !== null,
    window.location.hash,
  )) showLanding();
  else show(visible(fromHash) ? fromHash : 'receive');

  /*
   * RFD A37. Only the tab in view is built, so until 0.9.0 the application
   * did not learn who was signed in until the On air tab had been opened at
   * least once in that page load. Nothing outside On air used the member, so
   * nothing showed it — but training records do: the Progress tab's "Across
   * your devices" report and the course position taken from the server both
   * need the member before they can appear, and a member who practises
   * without visiting On air would have seen neither.
   *
   * So a browser already holding a session token asks once, on load, whose
   * it is. It is the same request the On air tab makes, to the same place,
   * moved earlier — and a browser with no token asks nothing at all, as
   * before. Failure is silent: reporting trouble with the server is the
   * On air tab's job, not the whole application's.
   */
  if (currentId !== 'air' && readSession() !== null) {
    void api.me().then(
      ({ member }) => {
        ctx.setMember(member);
        if (currentId === 'progress') void current?.refresh?.();
      },
      () => undefined,
    );
  }

  window.addEventListener('hashchange', () => {
    const serial = certificateSerial();
    if (serial !== null) {
      showCertificate(serial);
      return;
    }
    const id = window.location.hash.replace('#', '') as TabId;
    if (visible(id)) show(id);
  });

  // Cut the audio if the tab is hidden, so a forgotten session does not
  // keep sounding in a background tab.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.silenceNow();
  });

  registerServiceWorker(updateBanner);
}

/** How often to ask the server whether a new build exists, while the app is open. */
const UPDATE_CHECK_MS = 30 * 60 * 1000;
/** Focus and visibilitychange often fire together; one request will do. */
const MIN_CHECK_GAP_MS = 10 * 1000;

function registerServiceWorker(banner: HTMLElement): void {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  // Relative to the page, so the app works from a sub-path such as a
  // GitHub Pages project site as well as from a domain root.
  const register = (): void => {
    /*
     * updateViaCache: 'none' — never read sw.js from the HTTP cache when
     * checking for a new one. The default, 'imports', is supposed to bypass
     * the cache for the main script already, but Safari was found in the
     * wild sitting on an 0.8.0 worker while the server had 0.8.2, with
     * registration.update() resolving in 131 ms and reporting nothing new.
     * It was not asking the server. This says so explicitly, and costs one
     * conditional request per check.
     */
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
      .then((registration) => { watchForUpdates(registration, banner); })
      .catch(() => undefined);
  };
  // boot() awaits IndexedDB, so 'load' has usually already fired by now —
  // waiting for it unconditionally would mean never registering, and no
  // offline support at all.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/**
 * Notice a new build, and say so.
 *
 * Two things were wrong before, and both were invisible from inside the app.
 * The browser only checks sw.js when the page is navigated, so an installed
 * app left open on a home screen never checked at all — it could run a build
 * from months ago and nothing would ever say otherwise. And when it did
 * check, the page in front of the member had already been drawn from the old
 * cache, so the new version only appeared on a SECOND ordinary reload that
 * nothing asked them for. Members sat on stale builds indefinitely and
 * concluded the application simply never changed.
 *
 * So: ask on returning to the tab and on a timer, and when something is
 * waiting, tell them and let them choose the moment. Never reload for them —
 * it would throw away a drill, or drop them off the band mid-contact.
 */
function watchForUpdates(registration: ServiceWorkerRegistration, banner: HTMLElement): void {
  let dismissed = false;

  const show = (worker: ServiceWorker): void => {
    if (dismissed || !banner.hidden) return;
    const reload = el('button', { class: 'btn primary', text: 'Reload' });
    const later = el('button', { class: 'btn', text: 'Not now' });
    reload.addEventListener('click', () => {
      reload.disabled = true;
      reload.textContent = 'Reloading\u2026';
      // The waiting worker takes over, which fires controllerchange, and only
      // then is it safe to reload into the new build.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      }, { once: true });
      worker.postMessage({ type: 'skip-waiting' });
    });
    later.addEventListener('click', () => {
      dismissed = true;
      banner.hidden = true;
      clear(banner);
    });
    clear(banner);
    banner.append(
      el('span', { text: 'A new version of CW Trainer is ready.' }),
      el('span', { class: 'hint', text: 'Your practice history is not affected.' }),
      el('span', { class: 'row' }, reload, later),
    );
    banner.hidden = false;
  };

  // Already waiting when the page loaded — the member declined last time, or
  // the build landed while the app was closed.
  if (registration.waiting && navigator.serviceWorker.controller) show(registration.waiting);

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      // controller is null on the very first install; there is no "new"
      // version to announce when there was no old one.
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        dismissed = false;
        show(installing);
      }
    });
  });

  /*
   * Going looking, which is the whole point: the browser only checks sw.js on
   * a navigation, so an installed application left open never checks at all.
   *
   * Three triggers, because one is not enough. `visibilitychange` catches a
   * tab switched away from and back; `focus` catches the far commoner case of
   * leaving the BROWSER for another application and returning, which on macOS
   * frequently leaves the tab "visible" throughout and so fires no
   * visibilitychange at all. (Found the hard way: a new build was uploaded
   * from another app with the trainer open beside it, and nothing happened.)
   * The timer is the backstop for a tab nobody touches.
   *
   * Throttled, because focus and visibilitychange often arrive together and
   * there is no sense asking the server twice in the same second.
   */
  let lastCheck = 0;
  const check = (): void => {
    const now = Date.now();
    if (now - lastCheck < MIN_CHECK_GAP_MS) return;
    lastCheck = now;
    void registration.update().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('focus', check);
  window.setInterval(check, UPDATE_CHECK_MS);
}

void boot();
