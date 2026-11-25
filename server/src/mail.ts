/**
 * Outbound mail (docs/SERVER-SETUP.md §9): password resets, and since RFD A55
 * the address-confirmation link and the administrator's notices of new
 * registrations. Nothing else, and never anything a member did not cause.
 *
 * Without SMTP configured the server still runs and logs what it would have
 * sent, so the rest of the system can be exercised before the mail provider
 * is chosen. It never silently pretends a reset mail went out: the log line
 * says so in words.
 */

import nodemailer from 'nodemailer';
import type { Config } from './config';

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

const escapeHtml = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * RFD A57: the same message as simple HTML, sent beside the plain text.
 * Yahoo showed a plain-text-only confirmation with an empty body (25 Nov
 * 2026). Paragraphs are the blank-line-separated blocks of the text, and
 * every https:// address becomes a link; nothing is added that the text
 * does not say, so the two parts can never disagree.
 */
export function textToHtml(text: string): string {
  const paragraphs = text.trim().split(/\n{2,}/).map((block) => {
    const html = escapeHtml(block)
      .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#b86e00;word-break:break-all">$1</a>')
      .replace(/\n/g, '<br>');
    return `<p style="margin:0 0 14px">${html}</p>`;
  });
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
    + '<body style="margin:0;padding:24px;background:#ffffff;color:#1d2229;'
    + 'font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5">'
    + `<div style="max-width:560px">${paragraphs.join('')}</div></body></html>`;
}

export function makeMailer(config: Config, log: (line: string) => void): Mailer {
  if (!config.smtp) {
    return {
      async send(to, subject, text) {
        log(`MAIL NOT SENT (no SMTP configured) to=${to} subject="${subject}"\n${text}`);
      },
    };
  }
  const { host, port, user, pass, from } = config.smtp;
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from, to, subject, text, html: textToHtml(text) });
      log(`mail sent to=${to} subject="${subject}"`);
    },
  };
}
