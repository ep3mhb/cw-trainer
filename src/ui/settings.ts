/**
 * Settings, key mapping, and export / import (RFP §3, §5, §9).
 *
 * The export/import pair is the Phase 2 migration path, so it is presented
 * as a first-class feature here rather than buried: a member's whole
 * history has to be able to leave this browser.
 */

import { ENVELOPE_MAX, ENVELOPE_MIN, PITCH_MAX, PITCH_MIN } from '../core/audio';
import { conditionsAvailable } from '../core/conditions';
import { writeMemberCallsign, writeSession } from '../net/session';
import { accountSection } from './account';
import { schedule } from '../core/timing';
import { VBAND_KEYMAP } from '../storage/schema';
import { clear, downloadText, el, pickFile, radioGroup, slider } from './dom';
import { buttonLabel, buttonList, keyLabel, keyList } from './keylabels';
import type { Ctx, View } from './context';

export function settingsView(ctx: Ctx): View {
  const node = el('div');
  const captureStatus = el('p', { class: 'hint' });
  const keymapSummary = el('div', { class: 'row' });
  const storageInfo = el('p', { class: 'hint' });

  // ---- audio ----

  const pitch = slider({
    label: 'Sidetone pitch',
    min: PITCH_MIN, max: PITCH_MAX, step: 5, value: ctx.settings.audio.pitchHz, unit: ' Hz',
    onInput: (value) => {
      ctx.settings.audio.pitchHz = value;
      ctx.audio.update({ pitchHz: value });
      void ctx.saveSettings();
    },
  });

  const volume = slider({
    label: 'Output volume',
    min: 0, max: 1, step: 0.02, value: ctx.settings.audio.volume,
    format: (v) => `${(v * 100).toFixed(0)}%`,
    onInput: (value) => {
      ctx.settings.audio.volume = value;
      ctx.audio.update({ volume: value });
      void ctx.saveSettings();
    },
  });

  const envelope = slider({
    label: 'Envelope rise and fall',
    min: ENVELOPE_MIN, max: ENVELOPE_MAX, step: 0.5, value: ctx.settings.audio.envelopeMs, unit: ' ms',
    onInput: (value) => {
      ctx.settings.audio.envelopeMs = value;
      ctx.audio.update({ envelopeMs: value });
      void ctx.saveSettings();
    },
  });

  const weighting = slider({
    label: 'Weighting',
    min: 2, max: 4, step: 0.05, value: ctx.settings.timing.weighting,
    format: (v) => (Math.abs(v - 3) < 0.03 ? '3.00 standard' : `${v.toFixed(2)} : 1`),
    onInput: (value) => {
      ctx.settings.timing.weighting = value;
      void ctx.saveSettings();
    },
  });

  const latencyWarn = slider({
    label: 'Latency warning above',
    min: 20, max: 200, step: 5, value: ctx.settings.latencyWarnMs, unit: ' ms',
    onInput: (value) => {
      ctx.settings.latencyWarnMs = value;
      void ctx.saveSettings();
    },
  });

  const muteToggle = el('button', { class: 'btn', text: ctx.settings.audio.muted ? 'Unmute' : 'Mute' });
  muteToggle.addEventListener('click', () => {
    ctx.settings.audio.muted = !ctx.settings.audio.muted;
    ctx.audio.update({ muted: ctx.settings.audio.muted });
    muteToggle.textContent = ctx.settings.audio.muted ? 'Unmute' : 'Mute';
    void ctx.saveSettings();
  });

  /*
   * Real conditions (RFD A39).
   *
   * The whole section is absent below ten unlocked characters rather than
   * present and disabled: a control a beginner cannot use is still a
   * control they have to wonder about, and the amendment says the setting
   * "does not appear at all until a learner has unlocked ten of the forty
   * characters".
   */
  const conditionsPanel = ((): HTMLElement | null => {
    if (!conditionsAvailable(ctx.progress.unlocked)) return null;

    const switches = el('div', { class: 'row' });
    const sub = (
      key: 'fading' | 'static' | 'secondStation' | 'hand',
      label: string,
    ): HTMLElement => {
      const box = el('input', { type: 'checkbox', checked: ctx.settings.conditions[key] });
      box.addEventListener('change', () => {
        ctx.settings.conditions = { ...ctx.settings.conditions, [key]: box.checked };
        void ctx.saveSettings();
      });
      return el('label', { class: 'check' }, box, ' ', label);
    };
    switches.append(
      sub('fading', 'Fading'),
      sub('static', 'Static'),
      sub('secondStation', 'Another station'),
      sub('hand', 'A hand at the key'),
    );

    const level = radioGroup<'off' | 'mild' | 'strong'>({
      legend: 'Conditions',
      name: 'conditions-level',
      value: ctx.settings.conditions.level,
      choices: [
        { value: 'off', label: 'Off — a perfect signal' },
        { value: 'mild', label: 'Mild' },
        { value: 'strong', label: 'Strong' },
      ],
      onChange: (value) => {
        ctx.settings.conditions = { ...ctx.settings.conditions, level: value };
        void ctx.saveSettings();
      },
    });

    return el(
      'section',
      { class: 'panel' },
      el('h2', { text: 'Real conditions' }),
      el('p', { class: 'hint', text:
        'Every drill the application sends is a perfect signal: steady, silent behind it, and timed '
        + 'by a machine. Nothing on the air is, and a learner who only ever copies a perfect signal '
        + 'meets all four of these at once on their first evening. Practise against them here.' }),
      level,
      el('p', { class: 'hint', text: 'Choose which of the four you want at that level:' }),
      switches,
      el('p', { class: 'hint', text:
        'Examinations always run on a clean signal, whatever is set here — a certificate has to mean '
        + 'the same thing for everyone who holds one. Sessions record the level they were worked at, '
        + 'so practising against static does not look like getting worse in your progress report.' }),
    );
  })();

  /*
   * RFD A43: the account lives here now, beside the member's local data
   * rather than at the foot of the On air tab.
   *
   * A slot rather than a section, because this is the one tab whose
   * contents depend on whether anybody is signed in — and most members are
   * not, by design. They get a short statement of what an account is for,
   * not an empty space where other people have controls, because the
   * application's first promise is that practice needs no account and a
   * tab implying otherwise would contradict it.
   */
  const accountSlot = el('div');
  function renderAccount(): void {
    clear(accountSlot);
    const me = ctx.member;
    if (me === null) {
      accountSlot.append(el('section', { class: 'panel' },
        el('h2', { text: 'Your account' }),
        el('p', { class: 'hint', text:
          'You do not have one, and nothing above needs one — the course, sending practice and '
          + 'everything on this tab work without an account and stay in this browser.' }),
        el('p', { class: 'hint', text:
          'An account is for two things: working other members on the band, and the final exam at '
          + 'the end of the course, which earns a certificate. Sign in or create one from the '
          + '"On air" tab, and your account settings will appear here.' }),
      ));
      return;
    }
    accountSlot.append(accountSection(ctx, me, {
      onSignedOut: () => {
        writeSession(null);
        writeMemberCallsign(null);
        ctx.setMember(null);
        renderAccount();
      },
      onMemberChanged: (updated) => { ctx.setMember(updated); },
    }));
  }

  const testTone = el('button', { class: 'btn primary', text: 'Test — send V V V' });
  testTone.addEventListener('click', () => {
    void (async () => {
      if (!(await ctx.ensureAudio())) return;
      ctx.audio.play(schedule('V V V', ctx.settings.timing));
    })();
  });

  const panic = el('button', { class: 'btn danger', text: 'Silence' });
  panic.addEventListener('click', () => ctx.audio.silenceNow());

  // ---- key mapping ----

  function renderKeymap(): void {
    const map = ctx.settings.keyMap;
    clear(keymapSummary);
    const entries: [string, string][] = [
      ['Dit', keyList(map.ditKeys)],
      ['Dah', keyList(map.dahKeys)],
      ['Straight key', keyList(map.straightKeys)],
      ['Dit button', buttonList(map.ditButtons)],
      ['Dah button', buttonList(map.dahButtons)],
    ];
    for (const [label, value] of entries) {
      keymapSummary.append(el('span', { class: 'badge' }, `${label} `, el('b', { text: value })));
    }
  }

  function captureKey(slot: 'ditKeys' | 'dahKeys' | 'straightKeys'): void {
    captureStatus.textContent = 'Press the key or squeeze the paddle lever now… (Escape to cancel)';
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      cleanup();
      if (event.key === 'Escape') {
        captureStatus.textContent = 'Cancelled.';
        return;
      }
      ctx.settings.keyMap[slot] = [event.code];
      void ctx.saveSettings();
      renderKeymap();
      captureStatus.textContent = `Mapped ${keyLabel(event.code)}.`;
    };
    const onButton = (event: MouseEvent): void => {
      event.preventDefault();
      cleanup();
      const target = slot === 'ditKeys' ? 'ditButtons' : slot === 'dahKeys' ? 'dahButtons' : 'straightButtons';
      ctx.settings.keyMap[target] = [event.button];
      void ctx.saveSettings();
      renderKeymap();
      captureStatus.textContent = `Mapped the ${buttonLabel(event.button)}.`;
    };
    const cleanup = (): void => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onButton, true);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onButton, true);
  }

  const resetKeymap = el('button', { class: 'btn', text: 'Restore VBand defaults' });
  resetKeymap.addEventListener('click', () => {
    ctx.settings.keyMap = { ...VBAND_KEYMAP, ditKeys: [...VBAND_KEYMAP.ditKeys], dahKeys: [...VBAND_KEYMAP.dahKeys], ditButtons: [...VBAND_KEYMAP.ditButtons], dahButtons: [...VBAND_KEYMAP.dahButtons], straightKeys: [...VBAND_KEYMAP.straightKeys], straightButtons: [...VBAND_KEYMAP.straightButtons] };
    void ctx.saveSettings();
    renderKeymap();
    captureStatus.textContent = 'Restored [ for dit and ] for dah.';
  });

  // ---- export / import ----

  const exportButton = el('button', { class: 'btn primary', text: 'Export everything' });
  exportButton.addEventListener('click', () => {
    void (async () => {
      const envelope = await ctx.store.exportAll();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(`cw-trainer-${stamp}.json`, JSON.stringify(envelope, null, 2));
      ctx.toast('Export written to your downloads.', 'good');
    })();
  });

  const importButton = el('button', { class: 'btn', text: 'Import a file' });
  importButton.addEventListener('click', () => {
    void (async () => {
      const picked = await pickFile('application/json,.json');
      if (picked === null) return;
      if (!window.confirm('Importing replaces all progress and settings in this browser. Continue?')) return;
      try {
        const envelope = await ctx.store.importAll(JSON.parse(picked.text));
        ctx.settings = envelope.settings;
        ctx.progress = envelope.progress;
        ctx.audio.update(envelope.settings.audio);
        await ctx.saveSettings();
        ctx.refreshStatus();
        ctx.toast(`Imported ${String(envelope.sessions.length)} sessions. Reloading…`, 'good');
        window.setTimeout(() => window.location.reload(), 900);
      } catch (error) {
        ctx.toast(error instanceof Error ? error.message : 'Import failed.', 'bad');
      }
    })();
  });

  const rollupButton = el('button', { class: 'btn', text: 'Roll up old data' });
  rollupButton.addEventListener('click', () => {
    void (async () => {
      const { rolledUp } = await ctx.store.rollUpOldAttempts();
      ctx.toast(rolledUp === 0 ? 'Nothing older than 30 days.' : `Rolled up ${String(rolledUp)} old attempts.`, 'good');
      void renderStorage();
    })();
  });

  const wipeButton = el('button', { class: 'btn danger', text: 'Delete all local data' });
  wipeButton.addEventListener('click', () => {
    void (async () => {
      if (!window.confirm('Delete every session, attempt and setting stored in this browser? Export first if you want a copy.')) return;
      await ctx.store.clearAll();
      ctx.toast('Local data deleted. Reloading…', 'warn');
      window.setTimeout(() => window.location.reload(), 900);
    })();
  });

  async function renderStorage(): Promise<void> {
    const [sessions, attempts, sending] = await Promise.all([
      ctx.store.sessions(), ctx.store.attempts(), ctx.store.sending(),
    ]);
    let quota = '';
    if (navigator.storage?.estimate !== undefined) {
      try {
        const estimate = await navigator.storage.estimate();
        if (estimate.usage !== undefined) quota = ` Using about ${(estimate.usage / 1024).toFixed(0)} kB of browser storage.`;
      } catch {
        /* estimate is advisory only */
      }
    }
    storageInfo.textContent =
      `${String(sessions.length)} sessions, ${String(attempts.length)} raw attempts, ` +
      `${String(sending.length)} sending runs held in this browser.${quota} ` +
      'Nothing leaves this device — practice data is never sent to the server.';
  }

  node.append(
    el(
      'section',
      { class: 'panel' },
      el('h2', { text: 'Audio' }),
      el('p', { class: 'hint', text: 'The sidetone is generated live, so pitch and envelope change the sound immediately. A 4-8 ms envelope is what removes the key clicks.' }),
      el('div', { class: 'grid' }, pitch, volume, envelope, weighting),
      el('div', { class: 'row' }, testTone, muteToggle, panic),
    ),
    conditionsPanel ?? '',
    el(
      'section',
      { class: 'panel' },
      el('h2', { text: 'Key mapping' }),
      el('p', {
        class: 'hint',
        html:
          'Most USB paddle adaptors present themselves as a mouse or a keyboard. ' +
          'The defaults are VBand’s <kbd>[</kbd> and <kbd>]</kbd>, so an adaptor already set up for VBand works here untouched. ' +
          'Mouse buttons are accepted directly as well.',
      }),
      keymapSummary,
      el('div', { style: 'height:0.7rem' }),
      el(
        'div',
        { class: 'row' },
        button('Set dit', () => captureKey('ditKeys')),
        button('Set dah', () => captureKey('dahKeys')),
        button('Set straight key', () => captureKey('straightKeys')),
        resetKeymap,
      ),
      captureStatus,
      latencyWarn,
    ),
    el(
      'section',
      { class: 'panel' },
      el('h2', { text: 'Your data' }),
      el('p', {
        class: 'hint',
        text:
          'Everything is stored in this browser. Export writes one file holding every session, attempt and setting — ' +
          'use it to move to another device, or to keep a copy of your record outside the browser.',
      }),
      storageInfo,
      el('div', { class: 'row' }, exportButton, importButton, rollupButton, wipeButton),
    ),
    accountSlot,
  );

  renderKeymap();
  void renderStorage();
  renderAccount();

  return {
    node,
    refresh: () => {
      void renderStorage();
      // A43: signing in or out happens on another tab, so this one has to
      // be told. refresh() runs whenever Settings comes back into view and
      // whenever the shell learns who is signed in.
      renderAccount();
    },
  };
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', { class: 'btn', text: label });
  node.addEventListener('click', onClick);
  return node;
}
