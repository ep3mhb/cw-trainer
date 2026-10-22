/**
 * Everything to do with a member's account (RFD A43).
 *
 * It used to live in a collapsed panel at the foot of the On air tab,
 * beneath the band scope, the tuning control, the list of stations heard
 * and the contact log — so a member who wanted to switch their training
 * records off had to open the tab that connects them to the band and
 * scroll past a working instrument to find a disclosure triangle. Worse,
 * the Settings tab already held the same member's LOCAL data, several
 * screens away, with nothing in either place to say the other existed.
 *
 * So it is a module of its own, rendered by Settings, and the On air tab
 * keeps only what it needs to put somebody on the band: the way in when
 * signed out, a callsign and a way to leave when signed in.
 *
 * This panel owns none of the things it used to reach for directly — the
 * session token, the band socket, what is on screen — so where it once
 * tore those down itself it now tells the caller, through `hooks`.
 */

import { api, type MemberInfo, type MemberProfile, type CertificateSheet } from '../net/api';
import { writeSession } from '../net/session';
import { pushTraining, setKeepRecords } from '../net/training';
import { describeIdentifier } from '../core/callsign';
import { certificate, factsFromSheet, longDate } from './certificate';
import { clear, el } from './dom';
import { PRIVACY_URL, type Ctx } from './context';

export interface AccountHooks {
  /**
   * The member no longer has an account, or no longer has this session.
   * The caller clears the token, closes the band socket and redraws.
   */
  onSignedOut: () => void;
  /** The member record changed here and the rest of the application should know. */
  onMemberChanged: (me: MemberInfo) => void;
}

export function accountSection(ctx: Ctx, me: MemberInfo, hooks: AccountHooks): HTMLElement {
  const idInfo = describeIdentifier(me.callsign);
  // ---- your account: profile and password (§8) ----
  const profileField = (label: string, key: keyof MemberProfile, attrs: Record<string, string | number>): [HTMLLabelElement, HTMLInputElement] => {
    const current = me.profile[key];
    const input = el('input', { ...attrs, value: current === undefined ? '' : String(current), 'aria-label': label });
    return [el('label', { class: 'field' }, el('span', { class: 'label-row' }, el('span', { text: label })), el('span', { class: 'control' }, input)), input];
  };
  const [qthF, qthI] = profileField('QTH', 'qth', { type: 'text', placeholder: 'town, as you would send it', maxlength: 60 });
  const [gridF, gridI] = profileField('Grid square', 'grid', { type: 'text', placeholder: 'LL75', maxlength: 8 });
  const [rigF, rigI] = profileField('Rig', 'rig', { type: 'text', maxlength: 60 });
  const [antF, antI] = profileField('Antenna', 'antenna', { type: 'text', maxlength: 60 });
  const [licF, licI] = profileField('Licence', 'licence', { type: 'text', placeholder: 'class, or "studying"', maxlength: 40 });
  const [sideF, sideI] = profileField('Preferred sidetone (Hz)', 'sidetoneHz', { type: 'number', min: 300, max: 1200, step: 10 });
  const [wpmF, wpmI] = profileField('Target speed (WPM)', 'targetWpm', { type: 'number', min: 5, max: 60, step: 1 });
  if (sideI.value === '') sideI.value = String(ctx.settings.audio.pitchHz);
  const saveProfile = el('button', { class: 'btn primary', text: 'Save profile' });
  const profileNote = el('span', { class: 'hint', style: 'margin:0' });
  saveProfile.addEventListener('click', () => void (async () => {
    saveProfile.disabled = true;
    const profile: MemberProfile = {};
    const t = (i: HTMLInputElement): string | undefined => (i.value.trim() === '' ? undefined : i.value.trim());
    const n = (i: HTMLInputElement): number | undefined => (i.value.trim() === '' || !Number.isFinite(Number(i.value)) ? undefined : Number(i.value));
    const qth = t(qthI); if (qth) profile.qth = qth;
    const grid = t(gridI); if (grid) profile.grid = grid;
    const rig = t(rigI); if (rig) profile.rig = rig;
    const antenna = t(antI); if (antenna) profile.antenna = antenna;
    const licence = t(licI); if (licence) profile.licence = licence;
    const sidetoneHz = n(sideI); if (sidetoneHz !== undefined) profile.sidetoneHz = sidetoneHz;
    const targetWpm = n(wpmI); if (targetWpm !== undefined) profile.targetWpm = targetWpm;
    try {
      const r = await api.updateProfile(profile);
      me.profile = r.member.profile;
      // One source of truth: the sidetone in the profile is the sidetone
      // this browser uses, so a member is not asked for it twice.
      if (profile.sidetoneHz !== undefined && profile.sidetoneHz !== ctx.settings.audio.pitchHz) {
        ctx.settings.audio.pitchHz = profile.sidetoneHz;
        await ctx.saveSettings();
        // The band's own filter used to be retuned from here. It is a
        // different tab now; saveSettings is what both of them read, and
        // the band picks the new pitch up when it is next drawn.
      }
      hooks.onMemberChanged(me);
      profileNote.textContent = 'Saved.';
    } catch (error) {
      profileNote.textContent = error instanceof Error ? error.message : 'could not save';
    } finally {
      saveProfile.disabled = false;
    }
  })());

  const curPw = el('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Current password' });
  const newPw = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'at least 10 characters', 'aria-label': 'New password' });
  const changePw = el('button', { class: 'btn', text: 'Change password' });
  const pwNote = el('span', { class: 'hint', style: 'margin:0' });
  changePw.addEventListener('click', () => void (async () => {
    changePw.disabled = true;
    try {
      const r = await api.changePassword(curPw.value, newPw.value);
      writeSession(r.token);
      curPw.value = '';
      newPw.value = '';
      pwNote.textContent = 'Changed. Every other device has been signed out.';
    } catch (error) {
      pwNote.textContent = error instanceof Error ? error.message : 'could not change it';
    } finally {
      changePw.disabled = false;
    }
  })());

  // ---- closing your own account (\u00a78, and the privacy notice) ----
  //
  // Deliberately awkward. The password again, because an unlocked phone on
  // a table should not be able to do this; the callsign typed out, because
  // a confirm dialog alone is something people click through; and then the
  // dialog as well. Nothing here can be undone from inside the application.
  const delPw = el('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Password, to close your account' });
  const delCall = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: me.callsign, 'aria-label': 'Your callsign, to confirm' });
  const delBtn = el('button', { class: 'btn danger destructive', text: 'Close my account' });
  const delNote = el('span', { class: 'hint', style: 'margin:0' });
  delBtn.addEventListener('click', () => void (async () => {
    if (delCall.value.trim().toUpperCase() !== me.callsign.toUpperCase()) {
      delNote.textContent = `Type ${me.callsign} in the box to confirm.`;
      return;
    }
    if (!window.confirm(
      `Close ${me.callsign} for good?\n\nThe account is emptied and the callsign released for someone else to `
      + 'register. This cannot be undone. Your practice history stays in this browser.',
    )) return;
    delBtn.disabled = true;
    delNote.textContent = '';
    try {
      await api.deleteAccount(delPw.value);
      delPw.value = '';
      delCall.value = '';
      ctx.toast('Your account is closed. 73.', 'good');
      // The shell owns the session token, the band socket and what is on
      // screen; this panel owns none of them and says so by asking.
      hooks.onSignedOut();
    } catch (error) {
      delNote.textContent = error instanceof Error ? error.message : 'could not close the account';
      delBtn.disabled = false;
    }
  })());

  /*
   * Certificates, and the one control that matters about them: whether the
   * QR square on a printed sheet still resolves. The serial names a callsign
   * on a page anyone can open, so the holder gets to switch it off without
   * closing the whole account.
   */
  const certList = el('div', { class: 'cert-list' },
    el('p', { class: 'hint', text: 'Loading\u2026' }));

  const renderCertificates = (certificates: CertificateSheet[]): void => {
    clear(certList);
    if (certificates.length === 0) {
      certList.append(el('p', { class: 'hint', text:
        'None yet. One is issued when you pass the final exam of the course.' }));
      return;
    }
    for (const c of certificates) {
      const note = el('span', { class: 'hint' });

      // The sheet itself, on demand. Withdrawing takes the public page
      // away; it was never meant to take the holder's own copy with it,
      // and until now closing the tab did exactly that.
      const slot = el('div', { class: 'cert-slot' });
      let open = false;
      const view = el('button', { class: 'btn', text: 'View and print' }) as HTMLButtonElement;
      view.addEventListener('click', () => {
        open = !open;
        clear(slot);
        if (open) slot.append(certificate(factsFromSheet(me, c)));
        view.textContent = open ? 'Hide' : 'View and print';
      });

      const toggle = el('button', { class: 'btn ghost', text:
        c.verifiable ? 'Withdraw from the public page' : 'Publish it again' }) as HTMLButtonElement;
      let live = c.verifiable;
      toggle.addEventListener('click', () => void (async () => {
        toggle.disabled = true;
        try {
          const next = await api.certificateVisibility(c.serial, !live);
          live = next.verifiable;
          toggle.textContent = live ? 'Withdraw from the public page' : 'Publish it again';
          note.textContent = live
            ? 'The QR square resolves.'
            : 'The QR square now answers \u201cnot found\u201d. Your printed copy is unaffected.';
        } catch (error) {
          note.textContent = error instanceof Error ? error.message : 'could not change it';
        } finally {
          toggle.disabled = false;
        }
      })());
      certList.append(el('div', { class: 'cert-entry' },
        el('div', { class: 'cert-row' },
          el('span', { class: 'mono', text: c.serial }),
          el('span', { class: 'hint', text: longDate(new Date(c.issuedAt)) }),
          el('span', { class: 'cert-actions' }, view, toggle),
          note),
        slot));
    }
  };

  void (async () => {
    try {
      renderCertificates((await api.certificates()).certificates);
    } catch {
      clear(certList);
      certList.append(el('p', { class: 'hint', text:
        'Could not reach the server to list your certificates.' }));
    }
  })();

  /*
   * RFD A37: training records on the server.
   *
   * The control is a button rather than a checkbox because switching it
   * off is destructive and a checkbox invites a stray click. Off deletes
   * everything already uploaded, and the member is told that before the
   * request goes, not after.
   */
  const keepNote = el('span', { class: 'hint' });
  const keepBtn = el('button', { class: 'btn' });
  let keeping = me.keepRecords;
  const renderKeep = (): void => {
    keepBtn.textContent = keeping ? 'Turn off and delete' : 'Keep my records on the server';
    keepBtn.className = keeping ? 'btn danger' : 'btn';
    keepNote.textContent = keeping
      ? 'On. A summary of each session is kept so you can read your progress anywhere and carry on from another device.'
      : 'Off. Nothing about your practice leaves this browser.';
  };
  renderKeep();
  keepBtn.addEventListener('click', () => {
    if (keeping && !window.confirm(
      'Turn this off and what the server holds is deleted now: every session summary, the '
      + 'per-character counts and your position. The nightly backups are pruned after fourteen days, so '
      + 'it leaves those within a fortnight.\n\n'
      + 'Your practice history in this browser is not touched. If you turn it on again later it starts empty.',
    )) return;
    void (async () => {
      keepBtn.disabled = true;
      try {
        await setKeepRecords(ctx.store, !keeping);
        keeping = !keeping;
        me.keepRecords = keeping;
        ctx.setMember(me);
        renderKeep();
        ctx.toast(keeping ? 'Your records will be kept on the server.' : 'Deleted from the server.', 'good');
        if (keeping) void pushTraining(ctx.store, me);
      } catch (error) {
        keepNote.textContent = error instanceof Error ? error.message : 'could not reach the server';
      } finally {
        keepBtn.disabled = false;
      }
    })();
  });

  return el('section', { class: 'panel' },
    el('h2', { text: 'Your account' }),
    el('p', { class: 'hint' },
      `${me.name} · ${me.email}` + (idInfo.training ? ` · training identifier ${idInfo.text}` : me.verified
        ? ` · ${idInfo.text}` : ` · ${idInfo.text}, awaiting confirmation by an administrator`)),
    el('h3', { text: 'Profile' }),
    el('p', { class: 'hint', text: 'What the station you work may be told, as you would send it. Leave a field blank and nothing is shown.' }),
    el('div', { class: 'profile-grid' }, qthF, gridF, rigF, antF, licF, sideF, wpmF),
    el('div', { class: 'row' }, saveProfile, profileNote),
    el('h3', { text: 'Password' }),
    el('div', { class: 'profile-grid' },
      el('label', { class: 'field' }, el('span', { class: 'label-row' }, el('span', { text: 'Current password' })), el('span', { class: 'control' }, curPw)),
      el('label', { class: 'field' }, el('span', { class: 'label-row' }, el('span', { text: 'New password' })), el('span', { class: 'control' }, newPw))),
    el('div', { class: 'row' }, changePw, pwNote),
    el('h3', { text: 'Certificates' }),
    el('p', { class: 'hint', text:
      'A certificate carries a QR square that opens a page on the server showing the '
      + 'callsign it was issued to, the date, the serial and the score \u2014 your name is not on '
      + 'that page. Withdraw it and the page stops answering. Your own copy stays here either '
      + 'way: open it again whenever you like.' }),
    certList,
    el('h3', { text: 'Training records on the server' }),
    el('p', { class: 'hint' },
      'Off unless you ask for it. With it on, a summary of each practice session \u2014 how many characters you '
      + 'attempted, how many you got right, and which ones \u2014 is kept on the server, so you can read '
      + 'your progress from any computer or phone and carry on where you left off. Your keystrokes are never '
      + 'sent, and nothing from the Send tab or the band. Nobody else can read it, not even an administrator.'),
    el('div', { class: 'row' }, keepBtn, keepNote),
    el('h3', { text: 'Closing your account' }),
    el('p', { class: 'hint' },
      el('span', { text: 'Your account is emptied, every session ends and your callsign is released for someone '
        + 'else to register. Contacts you have already made stay in the other station\u2019s log, which keeps your '
        + 'callsign as you sent it at the time \u2014 that is their record, not yours. Your practice history in '
        + 'this browser is untouched; anything kept on the server is deleted with the account. ' }),
      el('a', { href: PRIVACY_URL, target: '_blank', rel: 'noopener', text: 'What is held, and for how long' }),
      el('span', { text: '.' })),
    el('div', { class: 'profile-grid' },
      el('label', { class: 'field' }, el('span', { class: 'label-row' }, el('span', { text: 'Your password' })), el('span', { class: 'control' }, delPw)),
      el('label', { class: 'field' }, el('span', { class: 'label-row' }, el('span', { text: `Type ${me.callsign} to confirm` })), el('span', { class: 'control' }, delCall))),
    el('div', { class: 'row' }, delBtn, delNote),
  );
  }
