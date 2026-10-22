/**
 * Outbound mail: password resets and nothing else (docs/SERVER-SETUP.md §9).
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
      await transport.sendMail({ from, to, subject, text });
      log(`mail sent to=${to} subject="${subject}"`);
    },
  };
}
