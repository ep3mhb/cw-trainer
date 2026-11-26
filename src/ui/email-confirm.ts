/**
 * RFD A55: confirming the address on an account.
 *
 * The server mails a link (#confirm-email=<token>) at registration. Opening
 * it confirms the address — no sign-in needed, since the link itself is the
 * proof — and the server then mails the administrator. Until it is
 * confirmed, a signed-in member sees a line saying so with a button that
 * sends the link again. Nothing is withheld meanwhile.
 *
 * `emailConfirmed` is compared with false rather than tested for falsehood:
 * a server older than 0.11.0 does not send it at all, and a member of such a
 * server should not be told to confirm something it cannot confirm.
 */

import { api, type MemberInfo } from '../net/api';
import { el, failureText, sentence } from './dom';
import type { Ctx } from './context';

export const CONFIRM_HASH = '#confirm-email=';

export function confirmTokenInHash(hash: string = window.location.hash): string | null {
  return hash.startsWith(CONFIRM_HASH) ? (/^#confirm-email=([A-Za-z0-9_-]+)/.exec(hash)?.[1] ?? null) : null;
}

/** Use the link from the mail, and say what happened. */
export async function confirmFromLink(ctx: Ctx, token: string): Promise<void> {
  try {
    const { member } = await api.confirmEmail(token);
    if (ctx.member !== null && ctx.member.id === member.id) ctx.setMember({ ...ctx.member, emailConfirmed: true });
    ctx.toast(
      member.training || member.verified
        ? 'Thank you — your email address is confirmed.'
        : 'Thank you — your email address is confirmed. The administrator has been told and will confirm your callsign.',
      // (With automatic approval, the default, the server confirms the callsign in the same step and `verified` is already true.)
      'good',
    );
  } catch (error) {
    ctx.toast(failureText(error, 'That confirmation link did not work.'), 'bad');
  }
}

/** The line shown to a signed-in member whose address is not confirmed yet, or null. */
export function emailNotice(ctx: Ctx, me: MemberInfo): HTMLElement | null {
  if (me.emailConfirmed !== false) return null;
  const again = el('button', { class: 'btn', text: 'Send the link again' });
  const said = el('span', { class: 'hint' });
  again.addEventListener('click', () => void (async () => {
    again.disabled = true;
    try {
      const r = await api.resendConfirmation();
      said.textContent = ` ${sentence(r.message)}`;
      ctx.toast(`A new confirmation link is on its way to ${me.email}.`, 'good');
    } catch (error) {
      said.textContent = ` ${failureText(error, 'Could not reach the server.')}`;
      again.disabled = false;
    }
  })());
  // Shown straight after the registration form is sent, and until the address is confirmed.
  return el('div', { class: 'notice warn email-notice' },
    el('p', {},
      'Confirm your email address: a confirmation email has been sent to ',
      el('b', { text: me.email }),
      ' from ', el('b', { text: 'RESONIK CW Trainer <noreply@mikroutik.com>' }),
      '. Open the link in it; the band opens to you once you have, and practice does not wait.'),
    el('p', { text:
      'Not in your inbox within a few minutes? Look in your spam or junk folder, and mark the email as not spam '
      + 'so that the next one arrives normally.' }),
    el('div', { class: 'row' }, again, said));
}

/**
 * Straight after the registration form is sent: a window that stays until
 * the member closes it, naming the sender and the spam folder. The first
 * live test (25 Nov 2026) found the email in spam, and a line in the page
 * below the band was too easy to miss.
 */
export function showRegisteredDialog(email: string, sent: boolean): void {
  const ok = el('button', { class: 'btn primary', text: 'OK, I will check' });
  const dialog = el('dialog', { class: 'notice-dialog', 'aria-labelledby': 'reg-dialog-title' },
    el('h2', { id: 'reg-dialog-title', text: sent ? 'Check your email' : 'Your account is made' }),
    sent
      ? el('p', {},
        'A confirmation email has been sent to ', el('b', { text: email }), ' from ',
        el('b', { text: 'RESONIK CW Trainer <noreply@mikroutik.com>' }), '.')
      : el('p', { text: 'The confirmation email could not be sent just now. Use “Send the link again” on the On air tab in a few minutes.' }),
    sent ? el('p', { text: 'Open the link in it to confirm your address. The band opens to you once you have; practice does not wait.' }) : null,
    sent ? el('p', { class: 'notice warn', text:
      'Not in your inbox within a few minutes? Look in your spam or junk folder, and mark the email as '
      + '“not spam” so that the next one arrives normally.' }) : null,
    el('div', { class: 'row' }, ok));
  ok.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  (dialog as HTMLDialogElement).showModal();
  ok.focus();
}
