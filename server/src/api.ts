/**
 * Accounts over plain HTTP JSON (RFP §8), behind Caddy at /api/.
 *
 * Small on purpose: register, sign in, sign out, who am I, change profile or
 * password, close my account, reset a password, read my log, and — for
 * administrators — §8's four actions (confirm a callsign, force a reset,
 * disable, delete) plus the list of reports. The WebSocket in hub.ts trusts
 * a session token this file issued and nothing else.
 *
 * Every handler takes parsed JSON and returns {status, body}; the HTTP plumbing
 * is in server.ts. That keeps the account rules testable without a socket.
 */

import { DEFAULT_BAND_PLAN } from '../../src/core/tuning';
import { DEFAULT_COURSE, buildExam, gradeExam } from '../../src/core/koch';
import { schedule } from '../../src/core/timing';
import { issueTrainingIdentifier, parseCallsign } from '../../src/core/callsign';
import { seeded } from '../../src/core/random';
import { normaliseRst } from '../../src/core/rst';
import type { Role } from '../../src/core/signalling';
import { randomBytes } from 'node:crypto';
import qrcode from 'qrcode-generator';
import {
  MIN_PASSWORD_LENGTH, hashPassword, looksLikeEmail, newToken, tokenHash, verifyPassword,
} from './auth';
import type { Config } from './config';
import { LIMITS, Limiter } from './limits';
import type { Mailer } from './mail';
import type { Member, OpenSession, Profile, Store, TrainingCharacter, TrainingUpload } from './store';

type AdminAction = 'verify' | 'unverify' | 'disable' | 'enable' | 'delete' | 'reset' | 'unmute' | 'confirm-link';

export interface ApiResponse {
  status: number;
  body: unknown;
  /**
   * Set when the body is already text in some other format. Everything this
   * server answers is JSON except the certificate verification page, which is
   * read by a person rather than by a program.
   */
  contentType?: string;
}

export interface ApiRequest {
  method: string;
  path: string;
  /** Bearer token from the Authorization header, if any. */
  token: string | null;
  body: unknown;
  /** The client's address as server.ts determined it (RFD A55), for rate limits. */
  ip?: string;
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const bad = (status: number, error: string): ApiResponse => ({ status, body: { error } });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): v is string => typeof v === 'string';

/** What a member is allowed to see about themselves (never the hash). */
export function publicMember(m: Member): Record<string, unknown> {
  return {
    id: m.id, callsign: m.callsign, training: m.training, name: m.name, email: m.email,
    role: m.role, profile: m.profile, verified: m.verified,
    muted: m.mutedUntil !== null && m.mutedUntil.getTime() > Date.now(),
    // RFD A37. The browser has to know whether it may upload anything, and
    // it must learn that from the server rather than from a local setting
    // that could disagree with it.
    keepRecords: m.keepRecords,
    // RFD A55.
    emailConfirmed: m.emailConfirmed,
  };
}

/**
 * What an administrator sees of a member: the above plus account state, and
 * (RFD A56) when the newest unused confirmation link was sent, if any.
 */
export function adminMemberView(m: Member, linkExpires?: Date, now = Date.now()): Record<string, unknown> {
  const pending = !m.emailConfirmed && linkExpires !== undefined;
  return {
    ...publicMember(m), disabled: m.removed, mutedUntil: m.mutedUntil,
    confirmationSentAt: pending ? new Date(linkExpires.getTime() - CONFIRM_TTL_MS).toISOString() : null,
    confirmationExpired: pending ? linkExpires.getTime() <= now : false,
    // A58: for the admin table.
    createdAt: m.createdAt ? m.createdAt.toISOString() : null,
    lastSeenAt: m.lastSeenAt ? m.lastSeenAt.toISOString() : null,
  };
}

const ADMIN_MEMBER_ROUTE = /^\/api\/admin\/members\/(\d+)\/(verify|unverify|disable|enable|delete|reset|unmute|confirm-link)$/;
const ADMIN_REPORT_ROUTE = /^\/api\/admin\/reports\/(\d+)\/resolve$/;
// Lowercase accepted and folded in the handler: serials get read aloud and
// typed in by hand, and case is not part of the secret.
const CERTIFICATE_ROUTE = /^\/api\/certificate\/([0-9A-Za-z-]{8,16})$/;
/** The same thing for a person: the page a scanned QR square lands on. */
const CERTIFICATE_PAGE = /^\/certificate\/([0-9A-Za-z-]{8,16})$/;

/**
 * A generous batch. A member returning after a fortnight offline has at most
 * a few dozen sessions queued; anything far beyond that is a client fault or
 * somebody probing, and either way it should be refused rather than written.
 */
/**
 * A series is ten drills, and the bound is generous rather than exact so
 * that changing DRILLS_PER_SESSION in the client does not need a server
 * release. It exists to stop a nonsense value winning every disagreement,
 * not to enforce the course.
 */
const MAX_OPEN_DRILLS = 1000;

/** The only conditions levels the schema's CHECK will accept (A39). */
const KNOWN_CONDITIONS = new Set(['off', 'mild', 'strong']);
const MAX_UPLOAD_SESSIONS = 200;

/** Only finite, non-negative numbers, and only for characters we were sent. */
function numberMap(o: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k.length <= 4 && typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

const intAt = (o: Record<string, unknown>, key: string): number | null => {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
};

/**
 * Validate one uploaded session, or refuse it.
 *
 * The browser is not trusted here any more than anywhere else: these rows
 * are a member's own history and nobody else can read them, but a malformed
 * timestamp or a negative count would still be a defect written down
 * permanently, and this table has no UPDATE path to repair it with.
 */
/**
 * The series in progress (RFD A42).
 *
 * Validated as strictly as a finished session, and then some: drillsDone is
 * bounded because it is the field that decides which of two devices wins a
 * disagreement, and an unbounded value sent by a broken or dishonest client
 * would win every time and freeze a member's series for ever.
 *
 * An unparseable value is not an error here, unlike a malformed finished
 * session. A finished session is history and losing one silently would be
 * wrong; an open series is a position that the next upload restates in any
 * case, so dropping a bad one costs a member nothing and keeps a client bug
 * from blocking the sessions travelling in the same request.
 */
function parseOpen(raw: unknown): OpenSession | null {
  if (!isObject(raw)) return null;
  const id = str(raw['id']) ? raw['id'].trim() : '';
  if (id === '' || id.length > 64) return null;
  const startedAt = intAt(raw, 'startedAt');
  const drillsDone = intAt(raw, 'drillsDone');
  const attempted = intAt(raw, 'attempted');
  const correct = intAt(raw, 'correct');
  const unlockedCount = intAt(raw, 'unlockedCount');
  const characterWpm = intAt(raw, 'characterWpm');
  const effectiveWpm = intAt(raw, 'effectiveWpm');
  if (startedAt === null || drillsDone === null || attempted === null || correct === null) return null;
  if (unlockedCount === null || characterWpm === null || effectiveWpm === null) return null;
  if (drillsDone < 0 || drillsDone > MAX_OPEN_DRILLS) return null;
  if (correct > attempted) return null;
  return {
    sessionId: id,
    startedAt: new Date(startedAt),
    lessonType: str(raw['lessonType']) ? raw['lessonType'].slice(0, 32) : 'groups',
    characterWpm, effectiveWpm, drillsDone, attempted, correct, unlockedCount,
    updatedAt: new Date(),   // the server's clock, not the caller's
  };
}

function parseUpload(raw: unknown): TrainingUpload | null {
  if (!isObject(raw)) return null;
  const id = str(raw['id']) ? raw['id'].trim() : '';
  if (id === '' || id.length > 64) return null;
  const startedAt = intAt(raw, 'startedAt');
  const endedAt = intAt(raw, 'endedAt');
  const attempted = intAt(raw, 'attempted');
  const correct = intAt(raw, 'correct');
  const unlockedCount = intAt(raw, 'unlockedCount');
  const characterWpm = intAt(raw, 'characterWpm');
  const effectiveWpm = intAt(raw, 'effectiveWpm');
  if (startedAt === null || endedAt === null || attempted === null || correct === null) return null;
  if (unlockedCount === null || characterWpm === null || effectiveWpm === null) return null;
  // A session cannot end before it began, and cannot have more right than
  // were asked. Both are cheap to check and impossible to correct later.
  if (endedAt < startedAt) return null;
  if (correct > attempted) return null;

  const characters: TrainingCharacter[] = [];
  const list = raw['characters'];
  if (Array.isArray(list)) {
    for (const c of list) {
      if (!isObject(c)) return null;
      const character = str(c['character']) ? c['character'] : '';
      const a = intAt(c, 'attempted');
      const k = intAt(c, 'correct');
      const t = intAt(c, 'responseMsTotal');
      if (character === '' || character.length > 4 || a === null || k === null || t === null) return null;
      if (k > a) return null;
      characters.push({ character, attempted: a, correct: k, responseMsTotal: t });
    }
  }

  return {
    session: {
      sessionId: id,
      startedAt: new Date(startedAt),
      endedAt: new Date(endedAt),
      lessonType: str(raw['lessonType']) ? raw['lessonType'].slice(0, 32) : 'groups',
      characterWpm, effectiveWpm, attempted, correct, unlockedCount,
      /*
       * RFD A39. Anything the server does not recognise is recorded as
       * 'off' rather than refused, and the column has a CHECK that would
       * refuse it anyway. A client sending a level this server has never
       * heard of is a client from the future, and losing one session's
       * conditions label is a far smaller harm than losing the session.
       */
      conditions: KNOWN_CONDITIONS.has(String(raw['conditions'])) ? String(raw['conditions']) : 'off',
    },
    characters,
  };
}

const RESET_TTL_MS = 60 * 60 * 1000;
/**
 * RFD A55. Longer than a reset, because nobody is locked out while it waits
 * and a member may register in the evening and read their mail the next
 * day. A lapsed link costs one click on "Send the link again".
 */
const CONFIRM_TTL_MS = 48 * 60 * 60 * 1000;
/** How soon a member may ask for the confirmation mail again. */
const RESEND_GAP_MS = 60 * 1000;
const APP_NAME = 'RESONIK CW Trainer';

/** A UTC time a reader in any country can place: 2026-11-25 14:05 UTC. */
const utc = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
/** An exam left open indefinitely is an invitation to sit it with help. */
const EXAM_TTL_MS = 60 * 60 * 1000;
/** Characters per group, matching an ordinary drill. */
const EXAM_GROUP = 5;

/**
 * A certificate serial: short enough to read aloud on the air, long enough
 * not to be guessed. Ambiguous characters are left out on purpose, because
 * these get read over a noisy band.
 */
const SERIAL_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Where a scanned certificate lands: a page served by this server.
 *
 * It used to be `${appOrigin}/#certificate=SERIAL`, which loaded the whole
 * training application — service worker, audio engine, tab bar, an "Enable
 * sound" button — on somebody who had come to check one fact and was
 * probably not a member at all. Worse, the thing confirming the certificate
 * was a JavaScript application asking the server on the reader's behalf; the
 * confirmation should come from the server itself, and should work with no
 * JavaScript, on any phone, at once.
 *
 * The hash route still works, for certificates already printed.
 */
export const verifyUrl = (publicOrigin: string, serial: string): string =>
  `${publicOrigin}/certificate/${serial}`;

/**
 * The QR square printed on the certificate.
 *
 * Generated here rather than in the browser so the client keeps its promise
 * of no runtime dependencies at all, and so the printed certificate and the
 * page it scans to are produced by the same code.
 */
function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 1, scalable: true });
}
function newSerial(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += SERIAL_ALPHABET[(bytes[i] as number) % SERIAL_ALPHABET.length] as string;
    if (i === 3 || i === 6) out += '-';
  }
  return out;
}

export class Api {
  constructor(
    private readonly store: Store,
    private readonly config: Config,
    private readonly mailer: Mailer,
    private readonly now: () => number = () => Date.now(),
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  /** RFD A55: when each member last asked for the confirmation mail, in memory only. */
  private readonly lastConfirmationSent = new Map<number, number>();
  /** RFD A55: rate limits, in memory only. */
  private readonly limits = new Limiter(() => this.now());

  private take(key: string, l: { limit: number; windowMs: number }): boolean {
    return this.limits.take(key, l.limit, l.windowMs);
  }

  /**
   * Every mail goes through here so that one ceiling covers all of them.
   * Over the ceiling the mail is not sent and the reason is logged: a flood
   * of sign-ups must not become a flood of mail from mikroutik.com.
   */
  private async mail(to: string, subject: string, text: string): Promise<void> {
    if (!this.take('mail:all', LIMITS.mailGlobal)) {
      this.log(`MAIL HELD (hourly ceiling of ${String(LIMITS.mailGlobal.limit)} reached) to=${to} subject="${subject}"`);
      throw new Error('hourly mail ceiling reached');
    }
    await this.mailer.send(to, subject, text);
  }

  async handle(req: ApiRequest): Promise<ApiResponse> {
    const route = `${req.method} ${req.path}`;
    switch (route) {
      case 'POST /api/register': return this.register(req.body, req.ip ?? '');
      case 'POST /api/login': return this.login(req.body, req.ip ?? '');
      case 'POST /api/logout': return this.logout(req.token);
      case 'GET /api/me': return this.me(req.token);
      case 'PUT /api/me/profile': return this.updateProfile(req.token, req.body);
      case 'PUT /api/me/password': return this.changePassword(req.token, req.body);
      case 'POST /api/me/delete': return this.deleteSelf(req.token, req.body);
      case 'POST /api/exam/start': return this.examStart(req.token, req.body);
      case 'POST /api/exam/submit': return this.examSubmit(req.token, req.body);
      case 'GET /api/me/certificates': return this.myCertificates(req.token);
      case 'PUT /api/me/keep-records': return this.setKeepRecords(req.token, req.body);
      case 'POST /api/me/training': return this.uploadTraining(req.token, req.body);
      case 'GET /api/me/training': return this.trainingReport(req.token);
      case 'POST /api/me/certificates/visibility':
        return this.setCertificateVisibility(req.token, req.body);
      case 'POST /api/reset/request': return this.resetRequest(req.body, req.ip ?? '');
      case 'POST /api/reset/confirm': return this.resetConfirm(req.body);
      case 'POST /api/email/confirm': return this.confirmEmail(req.body);
      case 'POST /api/me/email/resend': return this.resendConfirmation(req.token);
      case 'GET /api/me/contacts': return this.contacts(req.token);
      case 'GET /api/admin/members': return this.adminMembers(req.token);
      case 'GET /api/admin/reports': return this.adminReports(req.token);
      case 'GET /api/band-plan': return ok(DEFAULT_BAND_PLAN);
      default: {
        if (req.method === 'GET') {
          const c = CERTIFICATE_ROUTE.exec(req.path);
          if (c) return this.showCertificate(c[1] as string);
          const page = CERTIFICATE_PAGE.exec(req.path);
          if (page) return this.certificatePage(page[1] as string);
        }
        if (req.method === 'PUT') {
          const c = /^\/api\/me\/contacts\/(\d+)$/.exec(req.path);
          if (c) return this.noteContact(req.token, Number(c[1]), req.body);
        }
        if (req.method === 'POST') {
          const m = ADMIN_MEMBER_ROUTE.exec(req.path);
          if (m) return this.adminAct(req.token, Number(m[1]), m[2] as AdminAction, req.body);
          const r = ADMIN_REPORT_ROUTE.exec(req.path);
          if (r) return this.adminResolve(req.token, Number(r[1]));
        }
        return bad(404, 'no such route');
      }
    }
  }

  private async session(token: string | null): Promise<Member | null> {
    if (!token) return null;
    const m = await this.store.memberBySession(tokenHash(token), new Date(this.now()));
    return m && !m.removed ? m : null;
  }

  /**
   * Register. Licensed members give a callsign; students leave it blank and
   * are issued a training identifier (docs/PHASE2-CALLSIGNS.md). The one
   * callsign named in ADMIN_CALLSIGN registers as admin; everyone else as
   * member or student.
   */
  private async register(body: unknown, ip: string): Promise<ApiResponse> {
    if (!isObject(body)) return bad(400, 'expected a JSON object');
    // RFD A55. A field no person sees: the form hides it, a bot fills it in.
    if (str(body['website']) && body['website'].trim() !== '') {
      this.log(`registration refused: trap field filled (ip ${ip || '?'})`);
      return bad(400, 'the registration could not be accepted');
    }
    const name = str(body['name']) ? body['name'].trim() : '';
    const email = str(body['email']) ? body['email'].trim().toLowerCase() : '';
    const password = str(body['password']) ? body['password'] : '';
    const callsignInput = str(body['callsign']) ? body['callsign'].trim() : '';

    if (name.length < 2 || name.length > 80) return bad(400, 'name must be 2 to 80 characters');
    if (!looksLikeEmail(email)) return bad(400, 'that does not look like an email address');
    if (password.length < MIN_PASSWORD_LENGTH) return bad(400, `password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`);
    if (await this.store.memberByEmail(email)) return bad(409, 'an account with that email already exists');
    // RFD A55. Counted only once the form is valid, so a member correcting a
    // typo is not charged for it; the per-address check comes first so one
    // source cannot use up everyone's share.
    if (ip && !this.limits.allows(`reg-ip:${ip}`, LIMITS.registerPerIp.limit, LIMITS.registerPerIp.windowMs)) {
      this.log(`registration refused: too many from ${ip}`);
      return bad(429, 'too many registrations from your connection; please try again in an hour');
    }
    if (!this.take('reg:all', LIMITS.registerGlobal)) {
      this.log('registration refused: hourly ceiling reached');
      return bad(429, 'registration is busy just now; please try again in an hour');
    }
    if (ip) this.take(`reg-ip:${ip}`, LIMITS.registerPerIp);

    let callsign: string;
    let training: boolean;
    let role: Role;
    let verified: boolean;
    if (callsignInput === '') {
      const taken = await this.store.allCallsigns();
      callsign = issueTrainingIdentifier(name, taken, seeded((this.now() ^ taken.size) >>> 0)).text;
      training = true;
      role = 'student';
      // The application issued it; there is nothing to confirm.
      verified = true;
    } else {
      const parsed = parseCallsign(callsignInput);
      if (!parsed) return bad(400, 'that is not shaped like a callsign; leave it blank if you are not licensed yet');
      if (await this.store.memberByCallsign(parsed.text)) return bad(409, 'that callsign is already registered');
      callsign = parsed.text;
      training = false;
      role = callsign === this.config.adminCallsign ? 'admin' : 'member';
      // §8: a claimed callsign is confirmed by an administrator before it is
      // active. The member is not kept waiting — they can practise and go on
      // the band marked "unconfirmed" — but no contact with them exports
      // until an administrator has looked. The configured administrator's
      // own callsign is the one exception, or nobody could confirm anyone.
      verified = role === 'admin';
    }

    const member = await this.store.createMember({
      callsign, training, name, email, role, verified, passwordHash: await hashPassword(password),
    });
    // RFD A37: the registration form offers to keep training records on the
    // server. Absent or false means no, which is the answer for every
    // member who never sees the question.
    //
    // Re-read afterwards rather than reporting the row we inserted. The
    // insert happened before the consent was written, so `member` still
    // says false — and a reply that says false is a browser that never
    // uploads anything, however firmly the member ticked the box.
    let created = member;
    if (body['keepRecords'] === true) {
      await this.store.setKeepRecords(member.id, true);
      created = (await this.store.memberById(member.id)) ?? member;
    }
    this.log(`registered ${callsign}${training ? ' (training)' : verified ? '' : ' (awaiting confirmation)'} as ${role}`);
    const token = await this.issueSession(created);
    // RFD A55. Neither mail failing undoes the registration: the account
    // exists and works, the member can ask for the link again, and the
    // administrator sees every member on the admin tab regardless.
    const confirmationSent = await this.sendConfirmation(created);
    await this.noticeOfRegistration(created);
    return { status: 201, body: { token, member: publicMember(created), confirmationSent } };
  }

  /* ---------------------------------------------------------------- *
   * RFD A55: confirming the address, and telling the administrator.
   * ---------------------------------------------------------------- */

  /**
   * Mail the member a confirmation link. True if it went. `existing` is the
   * administrator's mail to a member who registered before A55: it explains
   * why they are being asked rather than thanking them for registering.
   */
  private async sendConfirmation(member: Member, existing = false): Promise<boolean> {
    const token = newToken();
    await this.store.createEmailConfirmation(tokenHash(token), member.id, new Date(this.now() + CONFIRM_TTL_MS));
    this.lastConfirmationSent.set(member.id, this.now());
    const link = `${this.config.appOrigin}/#confirm-email=${token}`;
    const next = member.training || member.verified
      ? ''
      : this.autoApprove
        ? 'Confirming your address also confirms your callsign. Until then you can practise and go on the band, '
          + 'where your callsign is marked "unconfirmed".\n\n'
        : 'After that, the administrator will check your callsign and confirm your membership. Until then you can '
          + 'practise and go on the band, where your callsign is marked "unconfirmed".\n\n';
    try {
      await this.mail(
        member.email,
        `${APP_NAME}: please confirm your email address`,
        (existing
          ? `Hello ${member.name},\n\n${APP_NAME} now asks every member to confirm their email address, `
            + `to keep the band free of throwaway accounts. Your account, ${member.callsign}, is kept off the band `
            + 'until you do; practice is not affected.\n\n'
          : `Hello ${member.name},\n\nThank you for registering with ${APP_NAME} as ${member.callsign}.\n\n`)
        + `Please confirm that this is your email address by opening this link within 48 hours:\n\n${link}\n\n`
        + next
        + 'If you did not register, ignore this mail; the account stays unconfirmed.\n\n'
        + `73\n${APP_NAME}\n${this.config.appOrigin}\n`,
      );
      return true;
    } catch (error) {
      this.log(`confirmation mail to ${member.email} failed: ${String(error instanceof Error ? error.message : error)}`);
      return false;
    }
  }

  /** RFD A55: on unless the server sets AUTO_APPROVE=0. */
  private get autoApprove(): boolean { return this.config.autoApprove !== false; }

  /**
   * Where notices for the administrator go: ADMIN_EMAIL if set, otherwise
   * the address on the administrator's own account.
   */
  private async adminAddress(): Promise<string | null> {
    if (this.config.adminEmail) return this.config.adminEmail;
    const admin = await this.store.memberByCallsign(this.config.adminCallsign);
    return admin && !admin.removed && admin.role === 'admin' ? admin.email : null;
  }

  /** A notice to the administrator. Never fails the request that caused it. */
  private async tellAdmin(subject: string, text: string): Promise<void> {
    const to = await this.adminAddress();
    if (to === null) {
      this.log(`admin notice not sent (no administrator address): ${subject}`);
      return;
    }
    try {
      await this.mail(to, subject, text);
    } catch (error) {
      this.log(`admin notice to ${to} failed: ${String(error instanceof Error ? error.message : error)}`);
    }
  }

  private describeForAdmin(m: Member): string {
    return `Callsign: ${m.callsign}${m.training ? ' (training identifier, issued by the application)' : ''}\n`
      + `Name:     ${m.name}\n`
      + `Email:    ${m.email}\n`;
  }

  /** Every registration is reported; a claimed callsign is marked as waiting on the administrator. */
  private async noticeOfRegistration(m: Member): Promise<void> {
    if (m.role === 'admin') return;
    const needsYou = !m.training && !m.verified && !this.autoApprove;
    await this.tellAdmin(
      needsYou
        ? `${APP_NAME}: ${m.callsign} has registered and awaits your approval`
        : m.training
          ? `${APP_NAME}: new student ${m.callsign} has registered`
          : `${APP_NAME}: new member ${m.callsign} has registered`,
      `A new member registered at ${utc(this.now())}.\n\n${this.describeForAdmin(m)}\n`
      + (m.training
        ? 'A training identifier needs no approval. You will get a second mail when they have confirmed their address.\n\n'
        : needsYou
          ? 'Their email address is not confirmed yet. You will get a second mail when they have confirmed it; '
            + 'confirm their callsign after that.\n\n'
          : 'Their callsign will be confirmed automatically when they confirm their email address; you will get a '
            + 'second mail then. Nothing to do unless the callsign is not theirs.\n\n')
      + `Admin tab: ${this.config.appOrigin}/#admin\n`,
    );
  }

  /** The link in the mail. Anyone holding it may use it; no session is needed. */
  private async confirmEmail(body: unknown): Promise<ApiResponse> {
    if (!isObject(body) || !str(body['token'])) return bad(400, 'token required');
    const member = await this.store.consumeEmailConfirmation(tokenHash(body['token']), new Date(this.now()));
    if (!member || member.removed) {
      return bad(400, 'that confirmation link is not valid any more; sign in and ask for a new one');
    }
    this.log(`email confirmed ${member.callsign}`);
    let confirmed = member;
    let approvedNow = false;
    if (!member.training && !member.verified && this.autoApprove) {
      // RFD A55: the address is the approval. The administrator is told,
      // and "Withdraw confirmation" on the admin tab undoes it.
      await this.store.setVerified(member.id, true);
      confirmed = (await this.store.memberById(member.id)) ?? { ...member, verified: true };
      approvedNow = true;
      this.log(`callsign ${member.callsign} confirmed automatically with the email address`);
    }
    const needsYou = !confirmed.training && !confirmed.verified;
    await this.tellAdmin(
      needsYou
        ? `${APP_NAME}: ${member.callsign} confirmed their email — please approve the membership`
        : approvedNow
          ? `${APP_NAME}: ${member.callsign} confirmed their email and is now a member`
          : `${APP_NAME}: ${member.callsign} confirmed their email`,
      `${member.callsign} confirmed their email address at ${utc(this.now())}.\n\n${this.describeForAdmin(member)}\n`
      + (needsYou
        ? 'Their callsign is waiting for you. Open the admin tab and press "Confirm callsign" once you are satisfied '
          + `the callsign is theirs:\n\n${this.config.appOrigin}/#admin\n`
        : approvedNow
          ? 'Their callsign was confirmed automatically. Nothing to do — unless the callsign is not theirs, in which '
            + `case press "Withdraw confirmation" on the admin tab:\n\n${this.config.appOrigin}/#admin\n`
          : member.training
            ? 'A training identifier needs no approval; nothing to do.\n'
            : 'You have already confirmed their callsign; nothing to do.\n'),
    );
    return ok({ member: publicMember(confirmed) });
  }

  /** "Send the link again", for a signed-in member whose address is unconfirmed. */
  private async resendConfirmation(token: string | null): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    if (m.emailConfirmed) return bad(400, 'your email address is already confirmed');
    const last = this.lastConfirmationSent.get(m.id);
    if (last !== undefined && this.now() - last < RESEND_GAP_MS) {
      return bad(429, 'a link was sent less than a minute ago; please check your inbox and spam folder');
    }
    if (!this.take(`resend:${String(m.id)}`, LIMITS.resendPerMember)) {
      return bad(429, 'that is enough links for one day; please check your spam folder, or try again tomorrow');
    }
    if (!(await this.sendConfirmation(m))) {
      return bad(503, 'the mail could not be sent right now; please try again later');
    }
    return ok({ message: `a new link is on its way to ${m.email}` });
  }

  private async login(body: unknown, ip: string): Promise<ApiResponse> {
    if (!isObject(body) || !str(body['email']) || !str(body['password'])) return bad(400, 'email and password required');
    const email = body['email'].trim().toLowerCase();
    // RFD A55: failed attempts are counted per address and per connection;
    // past the limit nothing is checked at all, right or wrong.
    const ipKey = `login-ip:${ip}`;
    const emailKey = `login-email:${email}`;
    if ((ip && !this.limits.allows(ipKey, LIMITS.loginFailPerIp.limit, LIMITS.loginFailPerIp.windowMs))
      || !this.limits.allows(emailKey, LIMITS.loginFailPerEmail.limit, LIMITS.loginFailPerEmail.windowMs)) {
      this.log(`sign-in refused: too many failures (ip ${ip || '?'})`);
      return bad(429, 'too many failed sign-ins; please wait fifteen minutes, or reset your password');
    }
    const member = await this.store.memberByEmail(email);
    // Same answer whether the address is unknown or the password wrong, so
    // the login form cannot be used to discover who has an account.
    const refused = (): ApiResponse => {
      if (ip) this.take(ipKey, LIMITS.loginFailPerIp);
      this.take(emailKey, LIMITS.loginFailPerEmail);
      return bad(401, 'email or password not recognised');
    };
    if (!member || member.removed) return refused();
    if (!(await verifyPassword(body['password'], member.passwordHash))) return refused();
    this.limits.clear(emailKey);
    const token = await this.issueSession(member);
    return ok({ token, member: publicMember(member) });
  }

  private async logout(token: string | null): Promise<ApiResponse> {
    if (token) await this.store.deleteSession(tokenHash(token));
    return ok({});
  }

  private async me(token: string | null): Promise<ApiResponse> {
    const m = await this.session(token);
    return m ? ok({ member: publicMember(m) }) : bad(401, 'not signed in');
  }

  private async updateProfile(token: string | null, body: unknown): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    if (!isObject(body)) return bad(400, 'expected a JSON object');
    const text = (key: string, max: number): string | undefined =>
      str(body[key]) && body[key].trim() !== '' ? body[key].trim().slice(0, max) : undefined;
    const numIn = (key: string, lo: number, hi: number): number | undefined => {
      const v = body[key];
      return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
    };
    const profile: Profile = {};
    const qth = text('qth', 60); if (qth) profile.qth = qth;
    const grid = text('grid', 8); if (grid) profile.grid = grid.toUpperCase();
    const rig = text('rig', 60); if (rig) profile.rig = rig;
    const antenna = text('antenna', 60); if (antenna) profile.antenna = antenna;
    const licence = text('licence', 40); if (licence) profile.licence = licence;
    const sidetoneHz = numIn('sidetoneHz', 300, 1200); if (sidetoneHz !== undefined) profile.sidetoneHz = sidetoneHz;
    const targetWpm = numIn('targetWpm', 5, 60); if (targetWpm !== undefined) profile.targetWpm = targetWpm;
    await this.store.updateProfile(m.id, profile);
    return ok({ member: publicMember({ ...m, profile }) });
  }

  /**
   * §8 "password change by the member": the current password is required,
   * and every other session is signed out, as a reset does.
   */
  private async changePassword(token: string | null, body: unknown): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    if (!isObject(body) || !str(body['current']) || !str(body['password'])) return bad(400, 'current and new password required');
    if (body['password'].length < MIN_PASSWORD_LENGTH) return bad(400, `password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`);
    if (!(await verifyPassword(body['current'], m.passwordHash))) return bad(403, 'the current password is not right');
    await this.store.updatePassword(m.id, await hashPassword(body['password']));
    await this.store.deleteSessionsFor(m.id);
    const fresh = await this.issueSession(m);
    return ok({ token: fresh, member: publicMember(m) });
  }

  /**
   * A member closing their own account.
   *
   * Exactly the emptying the administrator's 'delete' performs, asked for by
   * the member themselves, so there is one deletion behaviour rather than
   * two that might drift: the callsign is released, the row stays, and the
   * other station's log still says who they worked.
   *
   * The password is re-entered because an unlocked phone left on a table
   * should not be able to destroy an account, and nothing here can be
   * undone. The last remaining administrator is refused: an installation
   * with no administrator cannot be repaired from inside the application.
   *
   * The log line carries no callsign. A record that someone deleted their
   * account is operationally useful; a record of WHO did would outlive the
   * deletion it describes, which is the opposite of what was asked for.
   */
  private async deleteSelf(token: string | null, body: unknown): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    if (!isObject(body) || !str(body['password'])) return bad(400, 'password required');
    if (!(await verifyPassword(body['password'], m.passwordHash))) return bad(403, 'the password is not right');
    if (m.role === 'admin') {
      const admins = (await this.store.listMembers()).filter((x) => x.role === 'admin' && !x.removed);
      if (admins.length <= 1) {
        return bad(409, 'you are the only administrator \u2014 appoint another before closing this account');
      }
    }
    await this.store.deleteMember(m.id);
    this.log('a member closed their own account');
    return ok({ deleted: true });
  }

  // ---- training records on the server (RFD A37) ----
  //
  // Everything in this section is refused unless the member has asked for
  // it. See docs/PHASE4-TRAINING-RECORDS.md; the privacy notice is written
  // from that document and these handlers must not outrun it.

  /**
   * Turn the service on or off.
   *
   * Off deletes what was already uploaded, which is the store's job and is
   * the only reading of "off" that needs no explaining. A member who
   * switches off and later on again starts empty, and the notice says so.
   */
  private async setKeepRecords(token: string | null, body: unknown): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    if (!isObject(body) || typeof body['enabled'] !== 'boolean') {
      return bad(400, 'enabled must be true or false');
    }
    const enabled = body['enabled'];
    await this.store.setKeepRecords(m.id, enabled);
    this.log(enabled ? 'a member turned on server training records' : 'a member turned off server training records');
    return ok({ keepRecords: enabled });
  }

  /**
   * Append finished sessions.
   *
   * Idempotent by the table's primary key, so the client may retry from any
   * device without tracking what it has already sent. `added` is how many
   * were new; a reply of 0 is a success, not a conflict.
   */
  private async uploadTraining(token: string | null, body: unknown): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    if (!m.keepRecords) return bad(403, 'training records are not switched on for this account');
    if (!isObject(body) || !Array.isArray(body['sessions'])) return bad(400, 'sessions must be an array');
    if (body['sessions'].length > MAX_UPLOAD_SESSIONS) {
      return bad(413, `send at most ${String(MAX_UPLOAD_SESSIONS)} sessions at a time`);
    }

    const uploads: TrainingUpload[] = [];
    for (const raw of body['sessions']) {
      const u = parseUpload(raw);
      // One bad entry fails the batch rather than being skipped: a client
      // that is sending nonsense should hear about it, not have part of a
      // member's history quietly dropped.
      if (!u) return bad(400, 'a session in that batch is not shaped correctly');
      uploads.push(u);
    }
    const weights = isObject(body['weights']) ? numberMap(body['weights']) : {};
    /*
     * RFD A40. The course position travels beside the sessions rather than
     * inside them, because it changes when an examination is passed and not
     * when a session ends. A client that does not send it is not in error —
     * it simply has nothing to add, and the sessions still speak for
     * themselves. Absent or nonsense reads as zero, which the store treats
     * as "no opinion" because it keeps the greater of the two.
     */
    const reported = intAt(body, 'unlocked');
    const unlocked = reported !== null && reported >= 0 ? reported : 0;

    /*
     * RFD A42. The series the calling device is part of the way through,
     * if it has one. Absent means "nothing to say about any series" — only
     * a finished session in `sessions` above closes one, so a client that
     * omits this can never destroy work another device is doing.
     */
    const open = 'open' in body ? parseOpen(body['open']) : null;

    const added = await this.store.uploadTraining(m.id, uploads, weights, unlocked, open);
    return ok({ added, received: uploads.length });
  }

  /** The member's own records. Nobody else's, by any route. */
  private async trainingReport(token: string | null): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    if (!m.keepRecords) {
      return ok({ keepRecords: false, sessions: [], characters: [], unlocked: 0, weights: {}, open: null });
    }
    const report = await this.store.trainingReport(m.id);
    return ok({ keepRecords: true, ...report });
  }

  // ---- the final exam (RFD A25) ----

  /**
   * Start the fortieth exam.
   *
   * The response carries the TIMING of the Morse and nothing else: no
   * characters, no dit/dah labels, no character boundaries. The browser plays
   * tones from intervals and never learns what it is sending, so the answers
   * are not sitting in the response it is being asked to answer. Encrypting
   * the characters instead would have been theatre — a browser that can
   * decrypt them has them.
   *
   * It is still not proof against a determined cheat: durations can be
   * decoded, and this application ships a decoder. But that costs more effort
   * than learning the characters, which is the honest place to stop for a
   * project certificate.
   */
  private async examStart(token: string | null, body: unknown): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    const wpm = (key: string, lo: number, hi: number, fallback: number): number => {
      const v = isObject(body) ? body[key] : undefined;
      return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
    };
    const characterWpm = wpm('characterWpm', 5, 40, 18);
    const effectiveWpm = Math.min(characterWpm, wpm('effectiveWpm', 5, 40, characterWpm));

    // The whole course, four times each: this exam is the fortieth character
    // and nothing else, so the server needs to know nothing about the
    // member's history to set it.
    const full = { unlocked: DEFAULT_COURSE.order.length };
    const deck = buildExam(full, seeded((this.now() ^ m.id) >>> 0));
    const exam = await this.store.createExam({
      memberId: m.id,
      characters: deck.join(''),
      characterWpm,
      effectiveWpm,
      expiresAt: new Date(this.now() + EXAM_TTL_MS),
    });

    // Sent as groups, exactly as an ordinary drill is, so the member types as
    // they go rather than holding 160 characters in their head. Group
    // boundaries are word gaps, which are audible anyway, so this exposes
    // nothing the ear does not already get.
    const groups: { tones: { atMs: number; durationMs: number }[] }[] = [];
    for (let i = 0; i < deck.length; i += EXAM_GROUP) {
      const plan = schedule(deck.slice(i, i + EXAM_GROUP).join(''), { characterWpm, effectiveWpm, weighting: 3 });
      groups.push({
        // atMs and durationMs only. `element` would name every dit and dah and
        // `tokenIndex` would mark every character boundary; either one turns
        // the stream back into the answers it was built to withhold.
        tones: plan.tones.map((t) => ({ atMs: t.atMs, durationMs: t.durationMs })),
      });
    }

    return ok({
      examId: exam.id,
      count: deck.length,
      groupSize: EXAM_GROUP,
      characterWpm,
      effectiveWpm,
      groups,
    });
  }

  private async examSubmit(token: string | null, body: unknown): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    if (!isObject(body) || typeof body['examId'] !== 'number' || !Array.isArray(body['typed'])) {
      return bad(400, 'examId and typed required');
    }
    const exam = await this.store.examById(body['examId']);
    if (!exam) return bad(404, 'no such exam');
    // Somebody else's exam is not yours to submit, and saying "not found"
    // rather than "not yours" tells an attacker nothing about what exists.
    if (exam.memberId !== m.id) return bad(404, 'no such exam');
    if (exam.submittedAt !== null) return bad(409, 'that exam has already been marked');
    if (exam.expiresAt.getTime() < this.now()) return bad(410, 'that exam has expired \u2014 start a new one');

    const shown = [...exam.characters];
    const typed = (body['typed'] as unknown[]).map((v) => (typeof v === 'string' ? v : ''));
    if (typed.length !== shown.length) {
      return bad(400, `expected ${String(shown.length)} answers, got ${String(typed.length)}`);
    }
    const result = gradeExam(shown, typed);
    const correct = result.perCharacter.reduce((n, row) => n + row.correct, 0);
    const marked = await this.store.submitExam(exam.id, typed.join(''), correct, result.pass, new Date(this.now()));
    if (!marked) return bad(409, 'that exam has already been marked');

    let serial: string | null = null;
    let verify: string | null = null;
    let qr: string | null = null;
    if (result.pass) {
      serial = newSerial();
      // Verifiable from the start, because the certificate carries a QR
      // square and a code that scans to a page saying "not found" is worse
      // than no code at all. The member can withdraw it afterwards, and the
      // application says so plainly when it hands the certificate over.
      await this.store.createCertificate(serial, m.id, exam.id, true);
      verify = verifyUrl(this.config.publicOrigin, serial);
      qr = qrSvg(verify);
      this.log(`certificate ${serial} issued`);
    }
    return ok({
      pass: result.pass,
      accuracy: result.accuracy,
      failed: result.failed,
      perCharacter: result.perCharacter,
      correct,
      of: shown.length,
      characterWpm: exam.characterWpm,
      effectiveWpm: exam.effectiveWpm,
      serial,
      verify,
      qr,
    });
  }

  /**
   * Look up a certificate by its serial. Public, with no session \u2014 that is
   * what the QR square on the printed certificate scans to.
   *
   * It returns only what is already printed on the paper the holder is
   * showing you: callsign, date, speed and score. Not the name, not the email
   * address, not how long they took to get there. A serial is a weak secret
   * shared by whoever has seen the certificate, so the reply has to be
   * something the holder has already chosen to show.
   */
  private async showCertificate(serial: string): Promise<ApiResponse> {
    const certificate = await this.store.certificateBySerial(serial.toUpperCase());
    // "Not found" for a withdrawn one as well: whether a serial ever existed
    // is itself something the holder did not agree to publish.
    if (!certificate || !certificate.verifiable) return bad(404, 'no certificate with that serial');
    const member = await this.store.memberById(certificate.memberId);
    const exam = await this.store.examById(certificate.examId);
    if (!member || !exam || member.removed) return bad(404, 'no certificate with that serial');
    return ok({
      serial: certificate.serial,
      callsign: member.callsign,
      training: member.training,
      issuedAt: certificate.issuedAt,
      correct: exam.correct ?? 0,
      of: exam.characters.length,
      characterWpm: exam.characterWpm,
      effectiveWpm: exam.effectiveWpm,
    });
  }

  /**
   * The page a scanned QR square lands on.
   *
   * Plain HTML, built here, with no script of any kind. The reader is
   * standing in front of a piece of paper wanting one question answered, on
   * whatever phone they have, possibly on a bad connection. They should not
   * have to load an application to get an answer out of a database.
   *
   * It is deliberately NOT a copy of the certificate. The serial is a weak
   * secret shared with anyone who has seen the sheet, so this page is public
   * to anyone holding one; were it a faithful replica, a screenshot of it
   * would pass as an original. It carries the same facts in a form that
   * plainly reads as the server answering a question — which is the only
   * authority a certificate of this kind has.
   *
   * Exactly what the JSON route gives, and for the same reasons: the
   * callsign, the date, the serial, the speed and the score. Not the name,
   * not the email address.
   */
  private async certificatePage(serial: string): Promise<ApiResponse> {
    const esc = (text: string): string => text.replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
    const page = (status: number, title: string, inner: string): ApiResponse => ({
      status,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
 body{background:#11161d;color:#e7ecf3;font:16px/1.6 ui-sans-serif,system-ui,sans-serif;
      margin:0;padding:2rem 1rem;display:flex;justify-content:center}
 main{max-width:30rem;width:100%}
 h1{font-size:1rem;letter-spacing:.16em;text-transform:uppercase;margin:0 0 .2rem}
 .yes{color:#7fd18a} .no{color:#ff8d7b}
 .lead{color:#8d98a7;margin:0 0 1.6rem}
 dl{margin:0;border:1px solid #2a3542;border-radius:10px;background:#18202a;overflow:hidden}
 div.f{display:flex;justify-content:space-between;gap:1rem;padding:.7rem 1rem;
       border-bottom:1px solid #2a3542}
 div.f:last-child{border-bottom:0}
 dt{color:#8d98a7;font-size:.82rem;letter-spacing:.08em;text-transform:uppercase}
 dd{margin:0;text-align:right;font-weight:600}
 dd.mono{font-family:ui-monospace,monospace;letter-spacing:.06em}
 .note{color:#8d98a7;font-size:.82rem;margin:1.2rem 0 0}
 a{color:#f0b429}
</style></head><body><main>${inner}
<p class="note">This page is the server\u2019s own record, not the certificate.
It answers for as long as the holder leaves it published.
<a href="${esc(this.config.appOrigin)}">CW Trainer</a></p>
</main></body></html>`,
    });

    const certificate = await this.store.certificateBySerial(serial.toUpperCase());
    if (!certificate || !certificate.verifiable) {
      return page(404, 'No such certificate', `<h1 class="no">Not found</h1>
<p class="lead">No certificate with the serial <b>${esc(serial.toUpperCase())}</b>.
It may have been mistyped, or its holder may have withdrawn it from this page.</p>`);
    }
    const member = await this.store.memberById(certificate.memberId);
    const exam = await this.store.examById(certificate.examId);
    if (!member || !exam || member.removed) {
      return page(404, 'No such certificate', `<h1 class="no">Not found</h1>
<p class="lead">No certificate with the serial <b>${esc(serial.toUpperCase())}</b>.</p>`);
    }
    const of = exam.characters.length;
    const correct = exam.correct ?? 0;
    const pct = of === 0 ? '0.0' : ((correct / of) * 100).toFixed(1);
    const issued = certificate.issuedAt.toISOString().slice(0, 10);
    const f = (label: string, value: string, mono = false): string =>
      `<div class="f"><dt>${esc(label)}</dt><dd${mono ? ' class="mono"' : ''}>${esc(value)}</dd></div>`;
    return page(200, `Certificate ${certificate.serial}`, `<h1 class="yes">Verified</h1>
<p class="lead">This server issued this certificate and it stands.</p>
<dl>
${f(member.training ? 'Training identifier' : 'Callsign', member.callsign, true)}
${f('Issued', issued)}
${f('Serial', certificate.serial, true)}
${f('Score', `${String(correct)} of ${String(of)} \u2014 ${pct}%`)}
${f('Speed', `${String(exam.characterWpm)} / ${String(exam.effectiveWpm)} WPM`)}
</dl>
<p class="note">Character speed and effective speed. Awarded for the final
examination of the Koch course. This records a practice course: it is not a
licence, and it is not an examination for one.</p>`);
  }

  /**
   * Take your own certificate off the public lookup, or put it back.
   *
   * The QR on a printed certificate resolves to a page naming a callsign, and
   * a member who has pinned one to a wall may later want that link
   * to stop answering. Closing the account already hides it; this is the same
   * thing without the account going with it. The serial is matched together
   * with the member, so knowing a serial is not enough to act on it.
   */
  private async setCertificateVisibility(
    token: string | null, body: unknown,
  ): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    const b = (body ?? {}) as { serial?: unknown; verifiable?: unknown };
    if (typeof b.serial !== 'string' || typeof b.verifiable !== 'boolean') {
      return bad(400, 'a serial and a verifiable flag are needed');
    }
    const c = await this.store.setCertificateVisible(
      b.serial.toUpperCase(), m.id, b.verifiable,
    );
    if (!c) return bad(404, 'no certificate with that serial');
    return ok({ serial: c.serial, issuedAt: c.issuedAt, verifiable: c.verifiable });
  }

  /**
   * The holder's own certificates, with everything a reprint needs.
   *
   * The sheet used to exist for exactly one page view \u2014 rendered once, in the
   * moment after passing \u2014 so a member who closed the tab had lost it for
   * good. This route is behind their own session, so unlike the public
   * lookup it may hand back the score and the QR square as well.
   *
   * The QR is derived from the serial by `qrSvg`, not stored: there is
   * nothing here that was not already in `certificates` and `exams`.
   *
   * A withdrawn certificate still reprints. Withdrawing stops the public
   * page answering; it was never meant to take the holder's own copy away.
   */
  private async myCertificates(token: string | null): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    const certificates = await this.store.certificatesFor(m.id);
    const sheets = await Promise.all(certificates.map(async (c) => {
      const exam = await this.store.examById(c.examId);
      return {
        serial: c.serial,
        issuedAt: c.issuedAt,
        verifiable: c.verifiable,
        correct: exam?.correct ?? 0,
        of: exam?.characters.length ?? 0,
        characterWpm: exam?.characterWpm ?? 0,
        effectiveWpm: exam?.effectiveWpm ?? 0,
        qr: qrSvg(verifyUrl(this.config.publicOrigin, c.serial)),
      };
    }));
    return ok({ certificates: sheets });
  }

  /**
   * Always answers "if that address has an account, mail is on its way" —
   * the same whether it does or not — for the same reason login does.
   */
  private async resetRequest(body: unknown, ip: string): Promise<ApiResponse> {
    if (!isObject(body) || !str(body['email'])) return bad(400, 'email required');
    const email = body['email'].trim().toLowerCase();
    const member = await this.store.memberByEmail(email);
    // RFD A55: over the limit, the answer is the same and nothing is sent,
    // so the form cannot be used to fill somebody's inbox.
    const allowed = (!ip || this.take(`reset-ip:${ip}`, LIMITS.resetPerIp))
      && this.take(`reset-email:${email}`, LIMITS.resetPerEmail);
    if (!allowed) this.log(`reset mail not sent: limit reached (ip ${ip || '?'})`);
    if (allowed && member && !member.removed) {
      const token = newToken();
      await this.store.createReset(tokenHash(token), member.id, new Date(this.now() + RESET_TTL_MS));
      const link = `${this.config.appOrigin}/#reset=${token}`;
      try {
        await this.mail(
          member.email,
          'CW Trainer: reset your password',
          `Hello ${member.name},\n\nSomeone — probably you — asked to reset the password for ${member.callsign}.\n` +
          `Open this link within an hour to choose a new one:\n\n${link}\n\n` +
          'If you did not ask for this, ignore this mail; nothing changes.\n',
        );
      } catch (error) {
        // The member gets words, the administrator gets the cause. A bare 500
        // told the member nothing and the journal everything, which is the
        // wrong way round for the one who can act on it.
        this.log(`reset mail to ${member.email} failed: ${String(error instanceof Error ? error.message : error)}`);
        return bad(503, 'the reset mail could not be sent right now; please contact the administrator');
      }
    }
    return ok({ message: 'if that address has an account, a reset link is on its way' });
  }

  private async resetConfirm(body: unknown): Promise<ApiResponse> {
    if (!isObject(body) || !str(body['token']) || !str(body['password'])) return bad(400, 'token and password required');
    if (body['password'].length < MIN_PASSWORD_LENGTH) return bad(400, `password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`);
    const member = await this.store.consumeReset(tokenHash(body['token']), new Date(this.now()));
    if (!member) return bad(400, 'that reset link is not valid any more');
    await this.store.updatePassword(member.id, await hashPassword(body['password']));
    // Every existing session is ended: if the password was reset because it
    // leaked, whoever has it is signed out.
    await this.store.deleteSessionsFor(member.id);
    const token = await this.issueSession(member);
    return ok({ token, member: publicMember(member) });
  }

  private async contacts(token: string | null): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    return ok({ contacts: await this.store.contactsFor(m.id) });
  }

  /**
   * §7: the member's own account of a contact — the report they sent, the one
   * they copied, and a note. Blank clears. RST is accepted as sent on CW
   * (5NN) and stored as digits (599).
   */
  private async noteContact(token: string | null, contactId: number, body: unknown): Promise<ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    if (!isObject(body)) return bad(400, 'expected a JSON object');
    const rst = (key: string): string | null | undefined => {
      const v = body[key];
      if (!str(v) || v.trim() === '') return '';
      return normaliseRst(v);
    };
    const rstSent = rst('rstSent');
    const rstRcvd = rst('rstRcvd');
    if (rstSent === null || rstRcvd === null) return bad(400, 'an RST is three figures, readability 1–5 then strength and tone 1–9, e.g. 599 or 5NN');
    const note = str(body['note']) ? body['note'].trim().slice(0, 500) : '';
    const done = await this.store.noteContact(contactId, m.id, { rstSent: rstSent ?? '', rstRcvd: rstRcvd ?? '', note });
    if (!done) return bad(404, 'no such contact of yours');
    return ok({ rstSent: rstSent ?? '', rstRcvd: rstRcvd ?? '', note });
  }

  private async admin(token: string | null): Promise<Member | ApiResponse> {
    const m = await this.session(token);
    if (!m) return bad(401, 'not signed in');
    if (m.role !== 'admin') return bad(403, 'administrators only');
    return m;
  }
  private static isResponse(v: Member | ApiResponse): v is ApiResponse {
    return 'status' in v;
  }

  private async adminMembers(token: string | null): Promise<ApiResponse> {
    const m = await this.admin(token);
    if (Api.isResponse(m)) return m;
    const links = await this.store.pendingConfirmations();
    return ok({
      members: (await this.store.listMembers()).map((x) => adminMemberView(x, links.get(x.id), this.now())),
      // A58: the admin table words callsign status by whether approval is automatic.
      autoApprove: this.autoApprove,
    });
  }

  private async adminReports(token: string | null): Promise<ApiResponse> {
    const m = await this.admin(token);
    if (Api.isResponse(m)) return m;
    const members = new Map((await this.store.listMembers()).map((x) => [x.id, x.callsign]));
    const reports = (await this.store.listReports()).map((r) => ({
      ...r, byCallsign: members.get(r.byId) ?? '?', aboutCallsign: members.get(r.aboutId) ?? '?',
    }));
    return ok({ reports });
  }

  /**
   * §8's minimal admin page, as four actions on a member (plus the reverse
   * of two of them). Each is logged to the moderation table with the reason
   * given, and each refuses to act on the administrator's own account —
   * locking yourself out is not an action anyone means.
   */
  private async adminAct(token: string | null, memberId: number, action: AdminAction, body: unknown): Promise<ApiResponse> {
    const admin = await this.admin(token);
    if (Api.isResponse(admin)) return admin;
    const target = await this.store.memberById(memberId);
    if (!target) return bad(404, 'no such member');
    if (target.id === admin.id) return bad(400, 'not on your own account');
    const reason = isObject(body) && str(body['reason']) ? body['reason'].trim().slice(0, 280) : '';

    switch (action) {
      case 'verify':
        if (target.training) return bad(400, 'a training identifier needs no confirmation');
        await this.store.setVerified(target.id, true);
        break;
      case 'unverify':
        if (target.training) return bad(400, 'a training identifier needs no confirmation');
        await this.store.setVerified(target.id, false);
        break;
      case 'disable':
        await this.store.setRemoved(target.id, true);
        await this.store.deleteSessionsFor(target.id);
        break;
      case 'enable':
        await this.store.setRemoved(target.id, false);
        break;
      case 'confirm-link':
        // RFD A56: for members registered before A55, who were never sent one.
        if (target.removed) return bad(400, 'that account is disabled');
        if (target.emailConfirmed) return bad(400, 'that address is already confirmed');
        if (!(await this.sendConfirmation(target, true))) {
          return bad(503, 'the mail could not be sent right now; try again in a while');
        }
        break;
      case 'unmute':
        // A mute from the band lasts 24 hours; the administrator who can
        // impose it can lift it early.
        await this.store.setMuted(target.id, null);
        break;
      case 'delete':
        await this.store.deleteMember(target.id);
        break;
      case 'reset': {
        // A forced reset: the member's sessions end now, and a link goes to
        // their address. The link is never returned to the administrator.
        await this.store.deleteSessionsFor(target.id);
        const resetToken = newToken();
        await this.store.createReset(tokenHash(resetToken), target.id, new Date(this.now() + RESET_TTL_MS));
        const link = `${this.config.appOrigin}/#reset=${resetToken}`;
        try {
          await this.mail(
            target.email,
            'CW Trainer: an administrator has reset your password',
            `Hello ${target.name},\n\nAn administrator (${admin.callsign}) has reset the password for ${target.callsign}. ` +
            `You have been signed out everywhere. Open this link within an hour to choose a new one:\n\n${link}\n\n` +
            'If this is unexpected, please contact the administrator.\n',
          );
        } catch (error) {
          this.log(`forced-reset mail to ${target.email} failed: ${String(error instanceof Error ? error.message : error)}`);
          await this.store.logModeration(admin.id, target.id, 'reset (mail failed)', reason);
          return bad(503, 'the member was signed out, but the reset mail could not be sent; try again in a while');
        }
        break;
      }
    }
    await this.store.logModeration(admin.id, target.id, action, reason);
    this.log(`admin ${admin.callsign} ${action} ${target.callsign}${reason ? ` — ${reason}` : ''}`);
    const after = await this.store.memberById(target.id);
    const links = await this.store.pendingConfirmations();
    return ok({ member: after ? adminMemberView(after, links.get(after.id), this.now()) : null });
  }

  private async adminResolve(token: string | null, reportId: number): Promise<ApiResponse> {
    const admin = await this.admin(token);
    if (Api.isResponse(admin)) return admin;
    const done = await this.store.resolveReport(reportId, admin.id);
    if (!done) return bad(404, 'no such open report');
    this.log(`admin ${admin.callsign} resolved report ${String(reportId)}`);
    return ok({});
  }

  private async issueSession(member: Member): Promise<string> {
    const token = newToken();
    await this.store.createSession(tokenHash(token), member.id, new Date(this.now() + this.config.sessionTtlS * 1000));
    return token;
  }
}
