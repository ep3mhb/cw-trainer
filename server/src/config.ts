/**
 * Configuration, read once from the environment and checked once.
 *
 * Everything the server needs arrives in /etc/cw-signalling.env (see
 * docs/SERVER-SETUP.md §8). A missing value is a refusal to start with the
 * variable named, not a crash twenty minutes later when the first member
 * tries to log in.
 */

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  turnSecret: string;
  turnUri: string;
  icePolicy: 'all' | 'relay';
  /** The one account created as admin on registration (RFP §8). */
  adminCallsign: string;
  /** Public origin of the application, for links in mail. */
  appOrigin: string;
  /**
   * This server's own public origin.
   *
   * Separate from appOrigin because the certificate verification page is
   * served from HERE, not from the application. Whoever scans a printed
   * certificate is checking it against the project's server, so the page they
   * land on should come from the project's server rather than from a
   * JavaScript application that asks it on their behalf.
   */
  publicOrigin: string;
  smtp: { host: string; port: number; user: string; pass: string; from: string } | null;
  /** How long a TURN credential is good for, seconds. */
  turnTtlS: number;
  /** How long a login session lasts, seconds. */
  sessionTtlS: number;
}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set; see docs/SERVER-SETUP.md §8`);
  }
  return value;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const smtpHost = env['SMTP_HOST'];
  return {
    port: Number(env['PORT'] ?? 8080),
    // Caddy is the only thing that should reach this; never bind publicly.
    host: env['HOST'] ?? '127.0.0.1',
    databaseUrl: required(env, 'DATABASE_URL'),
    turnSecret: required(env, 'TURN_SECRET'),
    turnUri: required(env, 'TURN_URI'),
    icePolicy: env['ICE_POLICY'] === 'all' ? 'all' : 'relay',
    adminCallsign: (env['ADMIN_CALLSIGN'] ?? 'EP2MHB').toUpperCase(),
    appOrigin: env['APP_ORIGIN'] ?? 'https://cw.mikroutik.com',
    publicOrigin: env['PUBLIC_ORIGIN'] ?? 'https://sig.mikroutik.com',
    smtp: smtpHost
      ? {
          host: smtpHost,
          port: Number(env['SMTP_PORT'] ?? 587),
          user: env['SMTP_USER'] ?? '',
          pass: env['SMTP_PASS'] ?? '',
          from: env['SMTP_FROM'] ?? `CW Trainer <noreply@${smtpHost.replace(/^mail\./, '')}>`,
        }
      : null,
    turnTtlS: Number(env['TURN_TTL_S'] ?? 6 * 3600),
    sessionTtlS: Number(env['SESSION_TTL_S'] ?? 30 * 24 * 3600),
  };
}
