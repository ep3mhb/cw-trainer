/**
 * The accounts API (RFP §8), as the browser calls it.
 *
 * Thin: JSON in, JSON out, the session token as a bearer header. Every error
 * the server returns is a sentence meant for the member, and this passes it
 * through unchanged rather than inventing its own.
 */

import { sigOrigin } from './config';
import { readSession } from './session';

export interface MemberInfo {
  id: number;
  callsign: string;
  training: boolean;
  name: string;
  email: string;
  role: 'student' | 'member' | 'instructor' | 'admin';
  profile: MemberProfile;
  muted: boolean;
  /** §8: a claimed callsign confirmed by an administrator. Training identifiers are always confirmed. */
  verified: boolean;
  /**
   * RFD A37: has this member asked for their training records to be kept on
   * the server? The browser uploads nothing while this is false, and
   * it learns the answer from the server rather than from a local setting
   * that could disagree with it.
   */
  keepRecords: boolean;
}

/** RFP §8's profile fields; blank means not shown. */
export interface MemberProfile {
  qth?: string;
  grid?: string;
  rig?: string;
  antenna?: string;
  licence?: string;
  sidetoneHz?: number;
  targetWpm?: number;
}

/** What an administrator sees of each member. */
export interface AdminMember extends MemberInfo {
  disabled: boolean;
  mutedUntil: string | null;
}

export interface ReportRecord {
  id: number;
  byId: number;
  aboutId: number;
  byCallsign: string;
  aboutCallsign: string;
  reason: string;
  transcript: string;
  createdAt: string;
  resolved: boolean;
}

export type AdminAction = 'verify' | 'unverify' | 'disable' | 'enable' | 'delete' | 'reset' | 'unmute';

export interface ContactRecord {
  id: number;
  aCallsign: string;
  bCallsign: string;
  frequencyHz: number;
  startedAt: string;
  endedAt: string | null;
  exportable: boolean;
  rstSent: string;
  rstRcvd: string;
  note: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * How long to wait for the server before giving up.
 *
 * `fetch` has no deadline of its own: a server that accepts the connection
 * and then says nothing — a box that is up but wedged, a phone that has
 * lost its radio mid-request — leaves the promise pending for as long as
 * the browser cares to keep the socket, which on the On air tab meant
 * "Checking your session…" and no way forward. Ten seconds is far longer
 * than any of these routes needs on a working connection, and short enough
 * that a member is offered the retry rather than left watching.
 */
const TIMEOUT_MS = 10_000;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = readSession();
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  const controller = new AbortController();
  const deadline = window.setTimeout(() => { controller.abort(); }, TIMEOUT_MS);
  try {
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (body !== undefined) init.body = JSON.stringify(body);
    response = await fetch(`${sigOrigin()}${path}`, init);
  } catch {
    // Both cases are the same to the member and to the caller: status 0,
    // "no answer". The On air tab turns it into an offer to try again.
    throw new ApiError(0, controller.signal.aborted
      ? 'the server did not answer in time'
      : 'could not reach the server — check your connection');
  } finally {
    window.clearTimeout(deadline);
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new ApiError(response.status, 'the server answered with something that was not JSON');
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && typeof (data as { error?: unknown }).error === 'string'
      ? (data as { error: string }).error
      : `server error ${String(response.status)}`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

export interface TrainingReportBody {
  keepRecords: boolean;
  sessions: {
    sessionId: string;
    startedAt: string;
    endedAt: string;
    lessonType: string;
    characterWpm: number;
    effectiveWpm: number;
    attempted: number;
    correct: number;
    unlockedCount: number;
  }[];
  characters: { character: string; attempted: number; correct: number; responseMsTotal: number }[];
  unlocked: number;
  weights: Record<string, number>;
  /**
   * The series the member is part of the way through, if the server holds
   * one (RFD A42). Optional on the wire as well as null-able: a server
   * older than 0.10.0 does not send the field at all, and a client that
   * treated its absence as "no series" would be making the A41 mistake
   * again — believing it had been told something when it had not.
   */
  open?: {
    sessionId: string;
    startedAt: string;
    lessonType: string;
    characterWpm: number;
    effectiveWpm: number;
    drillsDone: number;
    attempted: number;
    correct: number;
    unlockedCount: number;
    updatedAt: string;
  } | null;
}

export interface ExamStart {
  examId: number;
  count: number;
  groupSize: number;
  characterWpm: number;
  effectiveWpm: number;
  /** Timing only, in groups, exactly as an ordinary drill arrives. */
  groups: { tones: { atMs: number; durationMs: number }[] }[];
}

export interface ExamResultBody {
  pass: boolean;
  accuracy: number;
  failed: string[];
  perCharacter: { character: string; correct: number; of: number }[];
  correct: number;
  of: number;
  characterWpm: number;
  effectiveWpm: number;
  serial: string | null;
  /** Where the QR square points, and the square itself as SVG. */
  verify: string | null;
  qr: string | null;
}

/** A certificate looked up by its serial, with no account \u2014 what a scan shows. */
export interface PublicCertificate {
  serial: string;
  callsign: string;
  training: boolean;
  issuedAt: string;
  correct: number;
  of: number;
  characterWpm: number;
  effectiveWpm: number;
}

export interface CertificateInfo {
  serial: string;
  issuedAt: string;
  verifiable: boolean;
}

/**
 * A certificate of your own, with enough on it to print the sheet again.
 *
 * Only `GET /api/me/certificates` returns this. The public lookup returns
 * `PublicCertificate`, which carries no QR \u2014 it is the page the QR points
 * at, so a square there would point at itself.
 */
export interface CertificateSheet extends CertificateInfo {
  correct: number;
  of: number;
  characterWpm: number;
  effectiveWpm: number;
  qr: string;
}

export const api = {
  register: (input: {
    name: string; email: string; password: string; callsign?: string; keepRecords?: boolean;
  }) => call<{ token: string; member: MemberInfo }>('POST', '/api/register', input),
  login: (email: string, password: string) =>
    call<{ token: string; member: MemberInfo }>('POST', '/api/login', { email, password }),
  logout: () => call<Record<string, never>>('POST', '/api/logout'),
  me: () => call<{ member: MemberInfo }>('GET', '/api/me'),
  updateProfile: (profile: MemberProfile) =>
    call<{ member: MemberInfo }>('PUT', '/api/me/profile', profile),
  changePassword: (current: string, password: string) =>
    call<{ token: string; member: MemberInfo }>('PUT', '/api/me/password', { current, password }),
  /** Close your own account. The password is re-entered; nothing here is undoable. */
  deleteAccount: (password: string) =>
    call<{ deleted: boolean }>('POST', '/api/me/delete', { password }),
  /**
   * Start the final exam. The reply carries the timing of the Morse and
   * nothing else \u2014 no characters \u2014 so the browser plays an exam it cannot
   * read (docs/PHASE3-COURSE-EXAM.md \u00a74).
   */
  examStart: (characterWpm: number, effectiveWpm: number) =>
    call<ExamStart>('POST', '/api/exam/start', { characterWpm, effectiveWpm }),
  examSubmit: (examId: number, typed: string[]) =>
    call<ExamResultBody>('POST', '/api/exam/submit', { examId, typed }),
  certificates: () => call<{ certificates: CertificateSheet[] }>('GET', '/api/me/certificates'),
  /** Take your own certificate off the public lookup, or put it back. */
  certificateVisibility: (serial: string, verifiable: boolean) =>
    call<CertificateInfo>('POST', '/api/me/certificates/visibility', { serial, verifiable }),
  /** Public: what the QR square on a printed certificate scans to. */
  certificate: (serial: string) =>
    call<PublicCertificate>('GET', `/api/certificate/${encodeURIComponent(serial)}`),
  /**
   * RFD A37. Turning it off deletes what was already uploaded; the caller
   * is expected to have said so to the member first.
   */
  setKeepRecords: (enabled: boolean) =>
    call<{ keepRecords: boolean }>('PUT', '/api/me/keep-records', { enabled }),
  /**
   * Post finished sessions. Idempotent: `added` may be fewer than were
   * sent, and zero is a success rather than a conflict.
   */
  uploadTraining: (
    sessions: unknown[],
    weights: Record<string, number>,
    unlocked: number,
    open: unknown = null,
  ) =>
    call<{ added: number; received: number }>('POST', '/api/me/training', {
      sessions, weights, unlocked, open,
    }),
  trainingReport: () => call<TrainingReportBody>('GET', '/api/me/training'),
  adminMembers: () => call<{ members: AdminMember[] }>('GET', '/api/admin/members'),
  adminReports: () => call<{ reports: ReportRecord[] }>('GET', '/api/admin/reports'),
  adminAct: (memberId: number, action: AdminAction, reason: string) =>
    call<{ member: AdminMember | null }>('POST', `/api/admin/members/${String(memberId)}/${action}`, { reason }),
  adminResolve: (reportId: number) =>
    call<Record<string, never>>('POST', `/api/admin/reports/${String(reportId)}/resolve`),
  resetRequest: (email: string) => call<{ message: string }>('POST', '/api/reset/request', { email }),
  resetConfirm: (token: string, password: string) =>
    call<{ token: string; member: MemberInfo }>('POST', '/api/reset/confirm', { token, password }),
  contacts: () => call<{ contacts: ContactRecord[] }>('GET', '/api/me/contacts'),
  noteContact: (id: number, note: { rstSent: string; rstRcvd: string; note: string }) =>
    call<{ rstSent: string; rstRcvd: string; note: string }>('PUT', `/api/me/contacts/${String(id)}`, note),
  health: () => call<{ ok: boolean; version: string; onBand: number }>('GET', '/health'),
};
