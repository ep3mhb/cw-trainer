/**
 * RFD A55: limits that keep the server from being used to send mail or to
 * guess passwords.
 *
 * A fixed window per key, in memory. A restart forgets every count, which
 * is acceptable: the limits are there to make abuse slow and expensive, not
 * to keep a ledger. Keys are prefixed by purpose ("reg-ip:", "mail:") so one
 * limiter can hold them all.
 *
 * Two kinds of key are used together on purpose. Per address (IP or email)
 * stops one source hammering; global stops many sources together — and an
 * IP taken from a forwarded header can be forged, so the global ceiling is
 * the one that cannot be talked round.
 */
export class Limiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly now: () => number) {}

  /** Count one event against `key`. False when the limit was already reached. */
  take(key: string, limit: number, windowMs: number): boolean {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= windowMs) {
      this.windows.set(key, { start: t, count: 1 });
      this.prune(t);
      return true;
    }
    if (w.count >= limit) return false;
    w.count += 1;
    return true;
  }

  /** Would `take` succeed, without counting? */
  allows(key: string, limit: number, windowMs: number): boolean {
    const w = this.windows.get(key);
    return !w || this.now() - w.start >= windowMs || w.count < limit;
  }

  /** Forget a key, e.g. failed sign-ins once the right password arrives. */
  clear(key: string): void { this.windows.delete(key); }

  private lastPrune = 0;
  private prune(t: number): void {
    if (t - this.lastPrune < 10 * 60 * 1000) return;
    this.lastPrune = t;
    // Nothing here uses a window longer than a day.
    for (const [k, w] of this.windows) if (t - w.start > 24 * 3600 * 1000) this.windows.delete(k);
  }
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Every limit in one place, so the help text and the RFD can quote them. */
export const LIMITS = {
  registerPerIp: { limit: 3, windowMs: HOUR },
  registerGlobal: { limit: 30, windowMs: HOUR },
  loginFailPerIp: { limit: 20, windowMs: 15 * MIN },
  loginFailPerEmail: { limit: 10, windowMs: 15 * MIN },
  resetPerEmail: { limit: 3, windowMs: HOUR },
  resetPerIp: { limit: 10, windowMs: HOUR },
  resendPerMember: { limit: 5, windowMs: DAY },
  /** Every mail the server sends, of every kind: protects the mail server's reputation. */
  mailGlobal: { limit: 120, windowMs: HOUR },
} as const;
