/**
 * Everything the server keeps, behind one interface.
 *
 * Same move as the client's `Store` in src/storage/db.ts: one class owns the
 * database, nothing else touches it, and a second implementation that keeps
 * everything in memory lets the rest of the server be tested without a
 * PostgreSQL instance. The PostgreSQL implementation is the thin one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import type { Role } from '../../src/core/signalling';

export interface Member {
  id: number;
  callsign: string;
  training: boolean;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  profile: Profile;
  mutedUntil: Date | null;
  /** Disabled: cannot sign in, and every session is refused. */
  removed: boolean;
  /**
   * §8: a licensed callsign is confirmed by an administrator before it is
   * active. Training identifiers are confirmed at issue. Unconfirmed, a
   * member is on the band marked as such and no contact with them exports.
   */
  verified: boolean;
  /**
   * RFD A37: has this member asked for their training records to be kept on
   * the server? False until they say otherwise, for everyone, for ever.
   *
   * A real column rather than a flag in `profile`, because a consent is not
   * a preference: it decides whether practice data may exist here at all,
   * and it should be visible in the schema to anyone reading it.
   */
  keepRecords: boolean;
}

/** RFP §8's profile fields. All optional; blank means not shown. */
export interface Profile {
  qth?: string;
  grid?: string;
  rig?: string;
  antenna?: string;
  licence?: string;
  sidetoneHz?: number;
  targetWpm?: number;
}

export interface NewMember {
  callsign: string;
  training: boolean;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  verified: boolean;
}

export interface Contact {
  id: number;
  aId: number;
  bId: number;
  aCallsign: string;
  bCallsign: string;
  frequencyHz: number;
  startedAt: Date;
  endedAt: Date | null;
  exportable: boolean;
  /** This member's own account of the exchange (§7); blank until they write it. */
  rstSent: string;
  rstRcvd: string;
  note: string;
}

export interface ContactNote {
  rstSent: string;
  rstRcvd: string;
  note: string;
}

export interface Report {
  id: number;
  byId: number;
  aboutId: number;
  reason: string;
  transcript: string;
  createdAt: Date;
  resolved: boolean;
  resolvedBy: number | null;
}

/**
 * A final exam, as the server holds it.
 *
 * `characters` is what was sent. It never leaves the machine: the browser is
 * given the timing of the Morse and nothing else, so the answers are not
 * sitting in the response it is being asked to answer.
 */
export interface Exam {
  id: number;
  memberId: number;
  characters: string;
  characterWpm: number;
  effectiveWpm: number;
  startedAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  typed: string | null;
  correct: number | null;
  passed: boolean | null;
}

export interface Certificate {
  serial: string;
  memberId: number;
  examId: number;
  issuedAt: Date;
  verifiable: boolean;
}

/** One finished session, as the browser recorded it. Immutable. */
export interface TrainingSession {
  /** The id the browser already generates: `s-<timestamp>`. */
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  lessonType: string;
  characterWpm: number;
  effectiveWpm: number;
  attempted: number;
  correct: number;
  /** The member's position in the course when this session ended. */
  unlockedCount: number;
  /** What the session was worked against: 'off', 'mild' or 'strong' (A39). */
  conditions: string;
}

/** Per character within one session. No keystrokes, by design. */
export interface TrainingCharacter {
  character: string;
  attempted: number;
  correct: number;
  /** Summed, so a mean survives aggregation. */
  responseMsTotal: number;
}

export interface TrainingUpload {
  session: TrainingSession;
  characters: TrainingCharacter[];
}

/**
 * A series of drills the member is part of the way through (RFD A42).
 *
 * The first training record the server holds that is not final, and the
 * only one. It carries no per-character breakdown: those are summarised
 * when the series finishes and arrives as an ordinary TrainingUpload, and
 * uploading them twice over would mean reconciling two versions of the same
 * counts. What travels here is only what another device needs in order to
 * carry on: where the member is in the ten, and what they have scored so
 * far.
 */
export interface OpenSession {
  sessionId: string;
  startedAt: Date;
  lessonType: string;
  characterWpm: number;
  effectiveWpm: number;
  /** How far through the series, 0..DRILLS_PER_SESSION. */
  drillsDone: number;
  attempted: number;
  correct: number;
  unlockedCount: number;
  /** When the device that owns it last said anything. Server-set. */
  updatedAt: Date;
}

export interface TrainingReport {
  sessions: TrainingSession[];
  /** Rolled up across every session held. */
  characters: TrainingCharacter[];
  /**
   * The greater of MAX(unlocked_count) over the sessions held and the
   * position the member's own device last reported (A40). Never the latest:
   * a session drilled on a device that was behind must not drag the position
   * backwards, and neither must a stale device reporting its position.
   */
  unlocked: number;
  weights: Record<string, number>;
  /**
   * The series in progress, if the member has one: the most recently
   * touched, since a member drilling in two places is unusual and the one
   * they spoke from last is the one they are at. Null when there is none.
   */
  open: OpenSession | null;
}

export interface Store {
  createMember(member: NewMember): Promise<Member>;
  memberById(id: number): Promise<Member | null>;
  memberByEmail(email: string): Promise<Member | null>;
  memberByCallsign(callsign: string): Promise<Member | null>;
  allCallsigns(): Promise<Set<string>>;
  listMembers(): Promise<Member[]>;
  updateProfile(id: number, profile: Profile): Promise<void>;
  updatePassword(id: number, passwordHash: string): Promise<void>;
  setMuted(id: number, until: Date | null): Promise<void>;
  setRemoved(id: number, removed: boolean): Promise<void>;
  setVerified(id: number, verified: boolean): Promise<void>;
  /**
   * §8 "delete a user": the account is emptied and disabled and its callsign
   * released for someone else to register. The row itself stays, because
   * contacts and reports point at it; they keep the callsign as text, so
   * the other station's log still says who they worked.
   */
  deleteMember(id: number): Promise<void>;
  touch(id: number): Promise<void>;

  createSession(tokenHash: string, memberId: number, expiresAt: Date): Promise<void>;
  memberBySession(tokenHash: string, now?: Date): Promise<Member | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsFor(memberId: number): Promise<void>;

  /** Also retires any earlier unused link for the member: only the newest works. */
  createReset(tokenHash: string, memberId: number, expiresAt: Date): Promise<void>;
  /** Returns the member and marks the token used, or null if unknown/expired/used. */
  consumeReset(tokenHash: string, now?: Date): Promise<Member | null>;

  createExam(e: Omit<Exam, 'id' | 'startedAt' | 'submittedAt' | 'typed' | 'correct' | 'passed'>): Promise<Exam>;
  examById(id: number): Promise<Exam | null>;
  /** Record a submission. False if it was already submitted — an exam is marked once. */
  submitExam(id: number, typed: string, correct: number, passed: boolean, now?: Date): Promise<boolean>;
  createCertificate(serial: string, memberId: number, examId: number, verifiable: boolean): Promise<Certificate>;
  certificateBySerial(serial: string): Promise<Certificate | null>;
  certificatesFor(memberId: number): Promise<Certificate[]>;
  /**
   * Take a certificate off the public lookup, or put it back. Scoped to the
   * member on purpose: a serial is all an outsider would need otherwise.
   */
  setCertificateVisible(serial: string, memberId: number, verifiable: boolean): Promise<Certificate | null>;

  startContact(c: Omit<Contact, 'id' | 'startedAt' | 'endedAt' | 'rstSent' | 'rstRcvd' | 'note'>): Promise<number>;
  endContact(id: number): Promise<void>;
  contactsFor(memberId: number): Promise<Contact[]>;
  /** Write this member's RST and note on a contact they were part of; false if they were not. */
  noteContact(contactId: number, memberId: number, note: ContactNote): Promise<boolean>;

  /**
   * RFD A37. Turning it OFF deletes everything already uploaded, not merely
   * future uploads — see docs/PHASE4-TRAINING-RECORDS.md §5. Off means gone.
   */
  setKeepRecords(memberId: number, enabled: boolean): Promise<void>;
  /**
   * Append-only. A session the server already holds is ignored rather than
   * refused, so the client may retry freely from any device. Returns how
   * many were new. Refuses outright if the member has not opted in.
   */
  /**
   * `unlocked` is the member's course position as this device knows it,
   * sent independently of the sessions because it changes when an
   * examination is passed and not when a session ends (A40). Stored as the
   * greater of what is held and what arrives.
   */
  uploadTraining(
    memberId: number,
    uploads: TrainingUpload[],
    weights: Record<string, number>,
    unlocked: number,
    /**
     * The series in progress on the calling device, if any (A42). Kept
     * against the copy already held: the one with more drills wins, because
     * the member did that work and the shorter copy is a device that has
     * been away. Null says nothing about any series — only an explicit
     * finished session in `uploads` closes one.
     */
    open?: OpenSession | null,
  ): Promise<number>;
  trainingReport(memberId: number): Promise<TrainingReport>;
  /** Every training row for this member, gone. Used by the toggle and by deleteMember. */
  deleteTrainingRecords(memberId: number): Promise<void>;

  addReport(r: Omit<Report, 'id' | 'createdAt' | 'resolved' | 'resolvedBy'>): Promise<number>;
  listReports(): Promise<Report[]>;
  resolveReport(id: number, adminId: number): Promise<boolean>;
  logModeration(adminId: number, memberId: number, action: string, reason: string): Promise<void>;

  close(): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * In memory — for tests and for `--check`.
 * ------------------------------------------------------------------ */

export class MemoryStore implements Store {
  private members: Member[] = [];
  private sessions = new Map<string, { memberId: number; expiresAt: Date }>();
  private resets = new Map<string, { memberId: number; expiresAt: Date; used: boolean }>();
  private contacts: Contact[] = [];
  private notes = new Map<string, ContactNote>();
  private reports: Report[] = [];
  /** RFD A42: at most one open series per (member, series id). */
  private open = new Map<string, { memberId: number; session: OpenSession }>();
  readonly moderation: { adminId: number; memberId: number; action: string; reason: string }[] = [];
  private nextId = 1;

  async createMember(m: NewMember): Promise<Member> {
    if (this.members.some((x) => x.callsign === m.callsign)) throw new Error('callsign taken');
    if (this.members.some((x) => x.email === m.email)) throw new Error('email taken');
    const member: Member = {
      id: this.nextId++, ...m, profile: {}, mutedUntil: null, removed: false, keepRecords: false,
    };
    this.members.push(member);
    return { ...member };
  }
  async memberById(id: number): Promise<Member | null> {
    const m = this.members.find((x) => x.id === id);
    return m ? { ...m } : null;
  }
  async memberByEmail(email: string): Promise<Member | null> {
    const m = this.members.find((x) => x.email === email.toLowerCase());
    return m ? { ...m } : null;
  }
  async memberByCallsign(callsign: string): Promise<Member | null> {
    const m = this.members.find((x) => x.callsign === callsign.toUpperCase());
    return m ? { ...m } : null;
  }
  async allCallsigns(): Promise<Set<string>> {
    return new Set(this.members.map((m) => m.callsign));
  }
  async listMembers(): Promise<Member[]> {
    return this.members.map((m) => ({ ...m }));
  }
  private must(id: number): Member {
    const m = this.members.find((x) => x.id === id);
    if (!m) throw new Error(`no member ${String(id)}`);
    return m;
  }
  async updateProfile(id: number, profile: Profile): Promise<void> { this.must(id).profile = profile; }
  async updatePassword(id: number, passwordHash: string): Promise<void> { this.must(id).passwordHash = passwordHash; }
  async setMuted(id: number, until: Date | null): Promise<void> { this.must(id).mutedUntil = until; }
  async setRemoved(id: number, removed: boolean): Promise<void> { this.must(id).removed = removed; }
  async setVerified(id: number, verified: boolean): Promise<void> { this.must(id).verified = verified; }
  async deleteMember(id: number): Promise<void> {
    const m = this.must(id);
    m.callsign = `DELETED-${String(id)}`;
    m.email = `deleted-${String(id)}@deleted.invalid`;
    m.name = 'Deleted member';
    m.passwordHash = '!';
    m.profile = {};
    m.removed = true;
    m.verified = false;
    await this.deleteSessionsFor(id);
    for (const [k, r] of this.resets) if (r.memberId === id) this.resets.delete(k);
    // The member row is tombstoned rather than deleted — contacts have to keep
    // pointing somewhere — so ON DELETE CASCADE never fires. Exams hold what
    // was typed, and the notice says the account is emptied, so take them.
    this.exams = this.exams.filter((e) => e.memberId !== id);
    this.certificates = this.certificates.filter((c) => c.memberId !== id);
    // Same reason, and the one most easily forgotten: the notice tells a
    // member that closing the account removes their practice history, and
    // the cascade above will not do it.
    await this.deleteTrainingRecords(id);
  }

  async setKeepRecords(memberId: number, enabled: boolean): Promise<void> {
    const m = this.must(memberId);
    m.keepRecords = enabled;
    if (!enabled) await this.deleteTrainingRecords(memberId);
  }
  async uploadTraining(
    memberId: number,
    uploads: TrainingUpload[],
    weights: Record<string, number>,
    unlocked: number,
    open: OpenSession | null = null,
  ): Promise<number> {
    const m = this.must(memberId);
    if (!m.keepRecords) throw new Error('not opted in');
    let added = 0;
    for (const u of uploads) {
      const key = `${String(memberId)}:${u.session.sessionId}`;
      if (this.training.has(key)) continue; // already held; a no-op, not an error
      this.training.set(key, { memberId, session: { ...u.session }, characters: u.characters.map((c) => ({ ...c })) });
      // A42: finishing a series closes it. The open row goes whether or not
      // this device is the one that had been keeping it up to date.
      this.open.delete(key);
      added += 1;
    }
    if (open !== null) {
      const key = `${String(memberId)}:${open.sessionId}`;
      // Frozen once finished: a device that was offline when the series
      // ended must not be able to reopen it afterwards.
      if (!this.training.has(key)) {
        const held = this.open.get(key);
        if (held === undefined || open.drillsDone > held.session.drillsDone) {
          this.open.set(key, { memberId, session: { ...open, updatedAt: new Date() } });
        }
      }
    }
    this.weights.set(memberId, { ...weights });
    this.position.set(memberId, Math.max(this.position.get(memberId) ?? 0, unlocked));
    return added;
  }
  async trainingReport(memberId: number): Promise<TrainingReport> {
    const mine = [...this.training.values()].filter((t) => t.memberId === memberId);
    const sessions = mine.map((t) => t.session).sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime());
    const rolled = new Map<string, TrainingCharacter>();
    for (const t of mine) {
      for (const c of t.characters) {
        const got = rolled.get(c.character) ?? { character: c.character, attempted: 0, correct: 0, responseMsTotal: 0 };
        got.attempted += c.attempted;
        got.correct += c.correct;
        got.responseMsTotal += c.responseMsTotal;
        rolled.set(c.character, got);
      }
    }
    return {
      sessions,
      characters: [...rolled.values()].sort((a, b) => a.character.localeCompare(b.character)),
      unlocked: sessions.reduce(
        (max, x) => Math.max(max, x.unlockedCount),
        this.position.get(memberId) ?? 0,
      ),
      weights: { ...(this.weights.get(memberId) ?? {}) },
      open: [...this.open.values()]
        .filter((o) => o.memberId === memberId)
        .sort((a2, b2) => b2.session.updatedAt.getTime() - a2.session.updatedAt.getTime())
        .map((o) => ({ ...o.session }))[0] ?? null,
    };
  }
  async deleteTrainingRecords(memberId: number): Promise<void> {
    for (const [k, t] of this.training) if (t.memberId === memberId) this.training.delete(k);
    for (const [k, o] of this.open) if (o.memberId === memberId) this.open.delete(k);
    this.weights.delete(memberId);
    this.position.delete(memberId);
  }
  async touch(): Promise<void> { /* nothing to record in memory */ }

  async createSession(tokenHash: string, memberId: number, expiresAt: Date): Promise<void> {
    this.sessions.set(tokenHash, { memberId, expiresAt });
  }
  async memberBySession(tokenHash: string, now = new Date()): Promise<Member | null> {
    const s = this.sessions.get(tokenHash);
    if (!s || s.expiresAt <= now) return null;
    return this.memberById(s.memberId);
  }
  async deleteSession(tokenHash: string): Promise<void> { this.sessions.delete(tokenHash); }
  async deleteSessionsFor(memberId: number): Promise<void> {
    for (const [k, v] of this.sessions) if (v.memberId === memberId) this.sessions.delete(k);
  }

  async createReset(tokenHash: string, memberId: number, expiresAt: Date): Promise<void> {
    for (const r of this.resets.values()) if (r.memberId === memberId) r.used = true;
    this.resets.set(tokenHash, { memberId, expiresAt, used: false });
  }
  async consumeReset(tokenHash: string, now = new Date()): Promise<Member | null> {
    const r = this.resets.get(tokenHash);
    if (!r || r.used || r.expiresAt <= now) return null;
    r.used = true;
    return this.memberById(r.memberId);
  }

  private exams: Exam[] = [];
  private certificates: Certificate[] = [];
  /** Keyed `<memberId>:<sessionId>`, which is the primary key the table uses. */
  private training = new Map<string, { memberId: number; session: TrainingSession; characters: TrainingCharacter[] }>();
  private weights = new Map<number, Record<string, number>>();
  /** Course position as last reported by the member's own device (A40). */
  private position = new Map<number, number>();

  async createExam(e: Omit<Exam, 'id' | 'startedAt' | 'submittedAt' | 'typed' | 'correct' | 'passed'>): Promise<Exam> {
    const exam: Exam = {
      id: this.nextId++, ...e,
      startedAt: new Date(), submittedAt: null, typed: null, correct: null, passed: null,
    };
    this.exams.push(exam);
    return { ...exam };
  }
  async examById(id: number): Promise<Exam | null> {
    const e = this.exams.find((x) => x.id === id);
    return e ? { ...e } : null;
  }
  async submitExam(id: number, typed: string, correct: number, passed: boolean, now = new Date()): Promise<boolean> {
    const e = this.exams.find((x) => x.id === id);
    if (!e || e.submittedAt !== null) return false;
    e.submittedAt = now; e.typed = typed; e.correct = correct; e.passed = passed;
    return true;
  }
  async createCertificate(serial: string, memberId: number, examId: number, verifiable: boolean): Promise<Certificate> {
    const c: Certificate = { serial, memberId, examId, issuedAt: new Date(), verifiable };
    this.certificates.push(c);
    return { ...c };
  }
  async certificateBySerial(serial: string): Promise<Certificate | null> {
    const c = this.certificates.find((x) => x.serial === serial);
    return c ? { ...c } : null;
  }
  async certificatesFor(memberId: number): Promise<Certificate[]> {
    return this.certificates.filter((c) => c.memberId === memberId).map((c) => ({ ...c }));
  }

  async setCertificateVisible(
    serial: string, memberId: number, verifiable: boolean,
  ): Promise<Certificate | null> {
    const c = this.certificates.find((x) => x.serial === serial && x.memberId === memberId);
    if (!c) return null;
    c.verifiable = verifiable;
    return { ...c };
  }

  async startContact(c: Omit<Contact, 'id' | 'startedAt' | 'endedAt' | 'rstSent' | 'rstRcvd' | 'note'>): Promise<number> {
    const id = this.nextId++;
    this.contacts.push({ ...c, id, startedAt: new Date(), endedAt: null, rstSent: '', rstRcvd: '', note: '' });
    return id;
  }
  async endContact(id: number): Promise<void> {
    const c = this.contacts.find((x) => x.id === id);
    if (c) c.endedAt = new Date();
  }
  async contactsFor(memberId: number): Promise<Contact[]> {
    return this.contacts.filter((c) => c.aId === memberId || c.bId === memberId).map((c) => {
      const n = this.notes.get(`${String(c.id)}:${String(memberId)}`);
      return { ...c, rstSent: n?.rstSent ?? '', rstRcvd: n?.rstRcvd ?? '', note: n?.note ?? '' };
    });
  }
  async noteContact(contactId: number, memberId: number, note: ContactNote): Promise<boolean> {
    const c = this.contacts.find((x) => x.id === contactId && (x.aId === memberId || x.bId === memberId));
    if (!c) return false;
    this.notes.set(`${String(contactId)}:${String(memberId)}`, { ...note });
    return true;
  }

  async addReport(r: Omit<Report, 'id' | 'createdAt' | 'resolved' | 'resolvedBy'>): Promise<number> {
    const id = this.nextId++;
    this.reports.push({ ...r, id, createdAt: new Date(), resolved: false, resolvedBy: null });
    return id;
  }
  async listReports(): Promise<Report[]> { return this.reports.map((r) => ({ ...r })); }
  async resolveReport(id: number, adminId: number): Promise<boolean> {
    const r = this.reports.find((x) => x.id === id);
    if (!r || r.resolved) return false;
    r.resolved = true;
    r.resolvedBy = adminId;
    return true;
  }
  async logModeration(adminId: number, memberId: number, action: string, reason: string): Promise<void> {
    this.moderation.push({ adminId, memberId, action, reason });
  }
  async close(): Promise<void> { /* nothing */ }
}

/* ------------------------------------------------------------------ *
 * PostgreSQL
 * ------------------------------------------------------------------ */

interface MemberRow {
  id: string; callsign: string; training: boolean; name: string; email: string;
  password_hash: string; role: Role; profile: Profile; muted_until: Date | null; removed: boolean;
  verified: boolean;
  keep_records: boolean;
}

const toMember = (r: MemberRow): Member => ({
  id: Number(r.id), callsign: r.callsign, training: r.training, name: r.name, email: r.email,
  passwordHash: r.password_hash, role: r.role, profile: r.profile ?? {},
  mutedUntil: r.muted_until, removed: r.removed, verified: r.verified,
  keepRecords: r.keep_records,
});

interface ContactRow {
  id: string; a_id: string; b_id: string; a_callsign: string; b_callsign: string;
  frequency_hz: number; started_at: Date; ended_at: Date | null; exportable: boolean;
  rst_sent: string | null; rst_rcvd: string | null; note: string | null;
}
const toContact = (r: ContactRow): Contact => ({
  id: Number(r.id), aId: Number(r.a_id), bId: Number(r.b_id), aCallsign: r.a_callsign,
  bCallsign: r.b_callsign, frequencyHz: r.frequency_hz, startedAt: r.started_at,
  endedAt: r.ended_at, exportable: r.exportable,
  rstSent: r.rst_sent ?? '', rstRcvd: r.rst_rcvd ?? '', note: r.note ?? '',
});

const MEMBER_COLS =
  'id, callsign, training, name, email, password_hash, role, profile, muted_until, removed, verified, keep_records';

interface ExamRow {
  id: string; member_id: string; characters: string; character_wpm: number; effective_wpm: number;
  started_at: Date; expires_at: Date; submitted_at: Date | null; typed: string | null;
  correct: number | null; passed: boolean | null;
}
const examRow = (r: ExamRow): Exam => ({
  id: Number(r.id), memberId: Number(r.member_id), characters: r.characters,
  characterWpm: r.character_wpm, effectiveWpm: r.effective_wpm,
  startedAt: r.started_at, expiresAt: r.expires_at, submittedAt: r.submitted_at,
  typed: r.typed, correct: r.correct, passed: r.passed,
});

interface CertificateRow {
  serial: string; member_id: string; exam_id: string; issued_at: Date; verifiable: boolean;
}
const certificateRow = (r: CertificateRow): Certificate => ({
  serial: r.serial, memberId: Number(r.member_id), examId: Number(r.exam_id),
  issuedAt: r.issued_at, verifiable: r.verifiable,
});

export class PgStore implements Store {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  }

  /**
   * Apply every migrations/*.sql not yet applied, in name order, each in its
   * own transaction. Run with `--migrate`; the service does not migrate on
   * start, so a bad migration is discovered by the person deploying and not
   * by the systemd restart loop.
   */
  async migrate(dir: string): Promise<string[]> {
    await this.pool.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const done = new Set(
      (await this.pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const applied: string[] = [];
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(name)) continue;
      const sql = readFileSync(join(dir, name), 'utf8');
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        applied.push(name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    return applied;
  }

  private async one(sql: string, params: unknown[]): Promise<Member | null> {
    const { rows } = await this.pool.query<MemberRow>(sql, params);
    return rows[0] ? toMember(rows[0]) : null;
  }

  async createMember(m: NewMember): Promise<Member> {
    const member = await this.one(
      `INSERT INTO members (callsign, training, name, email, password_hash, role, verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${MEMBER_COLS}`,
      [m.callsign, m.training, m.name, m.email, m.passwordHash, m.role, m.verified],
    );
    if (!member) throw new Error('insert returned nothing');
    return member;
  }
  memberById(id: number): Promise<Member | null> {
    return this.one(`SELECT ${MEMBER_COLS} FROM members WHERE id = $1`, [id]);
  }
  memberByEmail(email: string): Promise<Member | null> {
    return this.one(`SELECT ${MEMBER_COLS} FROM members WHERE email = $1`, [email.toLowerCase()]);
  }
  memberByCallsign(callsign: string): Promise<Member | null> {
    return this.one(`SELECT ${MEMBER_COLS} FROM members WHERE callsign = $1`, [callsign.toUpperCase()]);
  }
  async allCallsigns(): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ callsign: string }>('SELECT callsign FROM members');
    return new Set(rows.map((r) => r.callsign));
  }
  async listMembers(): Promise<Member[]> {
    const { rows } = await this.pool.query<MemberRow>(`SELECT ${MEMBER_COLS} FROM members ORDER BY callsign`);
    return rows.map(toMember);
  }
  async updateProfile(id: number, profile: Profile): Promise<void> {
    await this.pool.query('UPDATE members SET profile = $2 WHERE id = $1', [id, JSON.stringify(profile)]);
  }
  async updatePassword(id: number, passwordHash: string): Promise<void> {
    await this.pool.query('UPDATE members SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
  }
  async setMuted(id: number, until: Date | null): Promise<void> {
    await this.pool.query('UPDATE members SET muted_until = $2 WHERE id = $1', [id, until]);
  }
  async setRemoved(id: number, removed: boolean): Promise<void> {
    await this.pool.query('UPDATE members SET removed = $2 WHERE id = $1', [id, removed]);
  }
  async setVerified(id: number, verified: boolean): Promise<void> {
    await this.pool.query('UPDATE members SET verified = $2 WHERE id = $1', [id, verified]);
  }
  async deleteMember(id: number): Promise<void> {
    await this.pool.query(
      `UPDATE members SET callsign = $2, email = $3, name = 'Deleted member', password_hash = '!',
       profile = '{}'::jsonb, removed = TRUE, verified = FALSE, muted_until = NULL WHERE id = $1`,
      [id, `DELETED-${String(id)}`, `deleted-${String(id)}@deleted.invalid`],
    );
    await this.pool.query('DELETE FROM sessions WHERE member_id = $1', [id]);
    await this.pool.query('DELETE FROM password_resets WHERE member_id = $1', [id]);
    // Tombstone, not DELETE, so the cascade on these never fires by itself.
    await this.pool.query('DELETE FROM certificates WHERE member_id = $1', [id]);
    await this.pool.query('DELETE FROM exams WHERE member_id = $1', [id]);
    // Same reason, and the one most easily forgotten: the notice tells a
    // member that closing the account removes their practice history, and
    // ON DELETE CASCADE will not do it while the row is only tombstoned.
    await this.deleteTrainingRecords(id);
  }

  async setKeepRecords(memberId: number, enabled: boolean): Promise<void> {
    await this.pool.query('UPDATE members SET keep_records = $2 WHERE id = $1', [memberId, enabled]);
    // Off means gone, not merely "stop uploading" — PHASE4 §5.
    if (!enabled) await this.deleteTrainingRecords(memberId);
  }

  /**
   * One transaction per call, and ON CONFLICT DO NOTHING on the session.
   * A session the server already holds is skipped silently, which is what
   * lets the client retry an upload from anywhere without bookkeeping.
   */
  async uploadTraining(
    memberId: number,
    uploads: TrainingUpload[],
    weights: Record<string, number>,
    unlocked: number,
    open: OpenSession | null = null,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ keep_records: boolean }>(
        'SELECT keep_records FROM members WHERE id = $1 FOR UPDATE',
        [memberId],
      );
      if (!rows[0]?.keep_records) throw new Error('not opted in');
      let added = 0;
      for (const u of uploads) {
        const ins = await client.query(
          `INSERT INTO training_sessions
             (member_id, session_id, started_at, ended_at, lesson_type,
              character_wpm, effective_wpm, attempted, correct, unlocked_count, conditions)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (member_id, session_id) DO NOTHING`,
          [
            memberId, u.session.sessionId, u.session.startedAt, u.session.endedAt, u.session.lessonType,
            u.session.characterWpm, u.session.effectiveWpm, u.session.attempted, u.session.correct,
            u.session.unlockedCount, u.session.conditions,
          ],
        );
        if (ins.rowCount === 0) continue; // already held
        added += 1;
        // A42: finishing a series closes it, whichever device says so.
        await client.query(
          'DELETE FROM training_open_sessions WHERE member_id = $1 AND session_id = $2',
          [memberId, u.session.sessionId],
        );
        for (const c of u.characters) {
          await client.query(
            `INSERT INTO training_characters
               (member_id, session_id, character, attempted, correct, response_ms_total)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (member_id, session_id, character) DO NOTHING`,
            [memberId, u.session.sessionId, c.character, c.attempted, c.correct, c.responseMsTotal],
          );
        }
      }
      if (open !== null) {
        /*
         * A42, the whole rule in one statement.
         *
         * The WHERE NOT EXISTS freezes a finished series: a device that was
         * offline when the series ended must not be able to post a stale
         * open copy afterwards and reopen a closed record. The WHERE on the
         * DO UPDATE keeps the longer copy: where two devices have drilled
         * the same series, the member did the greater number of drills and
         * the shorter copy is a device that has been away. A no-op is the
         * right answer in both cases, so neither is an error.
         */
        await client.query(
          `INSERT INTO training_open_sessions
             (member_id, session_id, started_at, lesson_type, character_wpm,
              effective_wpm, drills_done, attempted, correct, unlocked_count, updated_at)
           SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now()
            WHERE NOT EXISTS (
                  SELECT 1 FROM training_sessions
                   WHERE member_id = $1 AND session_id = $2)
           ON CONFLICT (member_id, session_id) DO UPDATE SET
             drills_done    = EXCLUDED.drills_done,
             attempted      = EXCLUDED.attempted,
             correct        = EXCLUDED.correct,
             unlocked_count = EXCLUDED.unlocked_count,
             lesson_type    = EXCLUDED.lesson_type,
             character_wpm  = EXCLUDED.character_wpm,
             effective_wpm  = EXCLUDED.effective_wpm,
             updated_at     = now()
           WHERE EXCLUDED.drills_done > training_open_sessions.drills_done`,
          [
            memberId, open.sessionId, open.startedAt, open.lessonType, open.characterWpm,
            open.effectiveWpm, open.drillsDone, open.attempted, open.correct, open.unlockedCount,
          ],
        );
      }
      await client.query(
        `INSERT INTO training_progress (member_id, weights, unlocked, updated_at)
         VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (member_id) DO UPDATE SET
           weights = EXCLUDED.weights,
           unlocked = GREATEST(training_progress.unlocked, EXCLUDED.unlocked),
           updated_at = now()`,
        [memberId, JSON.stringify(weights), unlocked],
      );
      await client.query('COMMIT');
      return added;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async trainingReport(memberId: number): Promise<TrainingReport> {
    const sessions = await this.pool.query<{
      session_id: string; started_at: Date; ended_at: Date; lesson_type: string;
      character_wpm: number; effective_wpm: number; attempted: number; correct: number;
      unlocked_count: number; conditions: string;
    }>(
      `SELECT session_id, started_at, ended_at, lesson_type, character_wpm, effective_wpm,
              attempted, correct, unlocked_count, conditions
         FROM training_sessions WHERE member_id = $1 ORDER BY ended_at`,
      [memberId],
    );
    const chars = await this.pool.query<{
      character: string; attempted: string; correct: string; response_ms_total: string;
    }>(
      `SELECT character, SUM(attempted) AS attempted, SUM(correct) AS correct,
              SUM(response_ms_total) AS response_ms_total
         FROM training_characters WHERE member_id = $1
        GROUP BY character ORDER BY character`,
      [memberId],
    );
    const progress = await this.pool.query<{ weights: Record<string, number>; unlocked: number }>(
      'SELECT weights, unlocked FROM training_progress WHERE member_id = $1',
      [memberId],
    );
    // The most recently touched: a member drilling in two places is unusual,
    // and the device they spoke from last is where they are (A42).
    const open = await this.pool.query<{
      session_id: string; started_at: Date; lesson_type: string; character_wpm: number;
      effective_wpm: number; drills_done: number; attempted: number; correct: number;
      unlocked_count: number; updated_at: Date;
    }>(
      `SELECT session_id, started_at, lesson_type, character_wpm, effective_wpm,
              drills_done, attempted, correct, unlocked_count, updated_at
         FROM training_open_sessions WHERE member_id = $1
        ORDER BY updated_at DESC LIMIT 1`,
      [memberId],
    );
    return {
      sessions: sessions.rows.map((r) => ({
        sessionId: r.session_id, startedAt: r.started_at, endedAt: r.ended_at,
        lessonType: r.lesson_type, characterWpm: r.character_wpm, effectiveWpm: r.effective_wpm,
        attempted: r.attempted, correct: r.correct, unlockedCount: r.unlocked_count,
        conditions: r.conditions,
      })),
      characters: chars.rows.map((r) => ({
        character: r.character, attempted: Number(r.attempted), correct: Number(r.correct),
        responseMsTotal: Number(r.response_ms_total),
      })),
      // MAX, not the latest row: a session drilled on a device that was
      // behind must not drag the member's position backwards.
      unlocked: sessions.rows.reduce(
        (max, r) => Math.max(max, r.unlocked_count),
        progress.rows[0]?.unlocked ?? 0,
      ),
      weights: progress.rows[0]?.weights ?? {},
      open: open.rows[0]
        ? {
            sessionId: open.rows[0].session_id,
            startedAt: open.rows[0].started_at,
            lessonType: open.rows[0].lesson_type,
            characterWpm: open.rows[0].character_wpm,
            effectiveWpm: open.rows[0].effective_wpm,
            drillsDone: open.rows[0].drills_done,
            attempted: open.rows[0].attempted,
            correct: open.rows[0].correct,
            unlockedCount: open.rows[0].unlocked_count,
            updatedAt: open.rows[0].updated_at,
          }
        : null,
    };
  }

  async deleteTrainingRecords(memberId: number): Promise<void> {
    // training_characters cascades off training_sessions, but say it anyway:
    // a deletion a member was promised should not depend on a cascade being
    // read correctly by the next person to touch this file.
    await this.pool.query('DELETE FROM training_characters WHERE member_id = $1', [memberId]);
    await this.pool.query('DELETE FROM training_sessions WHERE member_id = $1', [memberId]);
    await this.pool.query('DELETE FROM training_open_sessions WHERE member_id = $1', [memberId]);
    await this.pool.query('DELETE FROM training_progress WHERE member_id = $1', [memberId]);
  }
  async touch(id: number): Promise<void> {
    await this.pool.query('UPDATE members SET last_seen_at = now() WHERE id = $1', [id]);
  }

  async createSession(tokenHash: string, memberId: number, expiresAt: Date): Promise<void> {
    await this.pool.query(
      'INSERT INTO sessions (token_hash, member_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, memberId, expiresAt],
    );
  }
  memberBySession(tokenHash: string, now = new Date()): Promise<Member | null> {
    return this.one(
      `SELECT ${MEMBER_COLS.split(', ').map((c) => `m.${c}`).join(', ')} FROM sessions s
       JOIN members m ON m.id = s.member_id WHERE s.token_hash = $1 AND s.expires_at > $2`,
      [tokenHash, now],
    );
  }
  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }
  async deleteSessionsFor(memberId: number): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE member_id = $1', [memberId]);
  }

  async createReset(tokenHash: string, memberId: number, expiresAt: Date): Promise<void> {
    await this.pool.query('UPDATE password_resets SET used = TRUE WHERE member_id = $1', [memberId]);
    await this.pool.query(
      'INSERT INTO password_resets (token_hash, member_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, memberId, expiresAt],
    );
  }
  async consumeReset(tokenHash: string, now = new Date()): Promise<Member | null> {
    const { rows } = await this.pool.query<{ member_id: string }>(
      `UPDATE password_resets SET used = TRUE
       WHERE token_hash = $1 AND used = FALSE AND expires_at > $2 RETURNING member_id`,
      [tokenHash, now],
    );
    return rows[0] ? this.memberById(Number(rows[0].member_id)) : null;
  }

  async createExam(e: Omit<Exam, 'id' | 'startedAt' | 'submittedAt' | 'typed' | 'correct' | 'passed'>): Promise<Exam> {
    const { rows } = await this.pool.query(
      `INSERT INTO exams (member_id, characters, character_wpm, effective_wpm, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [e.memberId, e.characters, e.characterWpm, e.effectiveWpm, e.expiresAt],
    );
    return examRow(rows[0] as ExamRow);
  }

  async examById(id: number): Promise<Exam | null> {
    const { rows } = await this.pool.query('SELECT * FROM exams WHERE id = $1', [id]);
    const row = rows[0] as ExamRow | undefined;
    return row ? examRow(row) : null;
  }

  /**
   * Mark it, once. The `submitted_at IS NULL` in the WHERE clause is what
   * makes that true under concurrency: two submissions racing each other both
   * run the UPDATE, and exactly one of them finds a row to change.
   */
  async submitExam(id: number, typed: string, correct: number, passed: boolean, now = new Date()): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE exams SET submitted_at = $2, typed = $3, correct = $4, passed = $5
       WHERE id = $1 AND submitted_at IS NULL`,
      [id, now, typed, correct, passed],
    );
    return (rowCount ?? 0) > 0;
  }

  async createCertificate(serial: string, memberId: number, examId: number, verifiable: boolean): Promise<Certificate> {
    const { rows } = await this.pool.query(
      'INSERT INTO certificates (serial, member_id, exam_id, verifiable) VALUES ($1, $2, $3, $4) RETURNING *',
      [serial, memberId, examId, verifiable],
    );
    return certificateRow(rows[0] as CertificateRow);
  }

  async certificateBySerial(serial: string): Promise<Certificate | null> {
    const { rows } = await this.pool.query('SELECT * FROM certificates WHERE serial = $1', [serial]);
    const row = rows[0] as CertificateRow | undefined;
    return row ? certificateRow(row) : null;
  }

  async certificatesFor(memberId: number): Promise<Certificate[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM certificates WHERE member_id = $1 ORDER BY issued_at DESC', [memberId],
    );
    return (rows as CertificateRow[]).map(certificateRow);
  }

  async setCertificateVisible(
    serial: string, memberId: number, verifiable: boolean,
  ): Promise<Certificate | null> {
    const { rows } = await this.pool.query(
      'UPDATE certificates SET verifiable = $3 WHERE serial = $1 AND member_id = $2 RETURNING *',
      [serial, memberId, verifiable],
    );
    const row = (rows as CertificateRow[])[0];
    return row ? certificateRow(row) : null;
  }

  async startContact(c: Omit<Contact, 'id' | 'startedAt' | 'endedAt' | 'rstSent' | 'rstRcvd' | 'note'>): Promise<number> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO contacts (a_id, b_id, a_callsign, b_callsign, frequency_hz, exportable)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [c.aId, c.bId, c.aCallsign, c.bCallsign, c.frequencyHz, c.exportable],
    );
    return Number(rows[0]?.id);
  }
  async endContact(id: number): Promise<void> {
    await this.pool.query('UPDATE contacts SET ended_at = now() WHERE id = $1 AND ended_at IS NULL', [id]);
  }
  async contactsFor(memberId: number): Promise<Contact[]> {
    const { rows } = await this.pool.query<ContactRow>(
      `SELECT c.*, n.rst_sent, n.rst_rcvd, n.note FROM contacts c
       LEFT JOIN contact_notes n ON n.contact_id = c.id AND n.member_id = $1
       WHERE c.a_id = $1 OR c.b_id = $1 ORDER BY c.started_at DESC`, [memberId],
    );
    return rows.map(toContact);
  }
  async noteContact(contactId: number, memberId: number, note: ContactNote): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO contact_notes (contact_id, member_id, rst_sent, rst_rcvd, note)
       SELECT id, $2, $3, $4, $5 FROM contacts WHERE id = $1 AND (a_id = $2 OR b_id = $2)
       ON CONFLICT (contact_id, member_id) DO UPDATE
       SET rst_sent = EXCLUDED.rst_sent, rst_rcvd = EXCLUDED.rst_rcvd, note = EXCLUDED.note, updated_at = now()`,
      [contactId, memberId, note.rstSent, note.rstRcvd, note.note],
    );
    return (rowCount ?? 0) > 0;
  }

  async addReport(r: Omit<Report, 'id' | 'createdAt' | 'resolved' | 'resolvedBy'>): Promise<number> {
    const { rows } = await this.pool.query<{ id: string }>(
      'INSERT INTO reports (by_id, about_id, reason, transcript) VALUES ($1, $2, $3, $4) RETURNING id',
      [r.byId, r.aboutId, r.reason, r.transcript],
    );
    return Number(rows[0]?.id);
  }
  async listReports(): Promise<Report[]> {
    const { rows } = await this.pool.query<{
      id: string; by_id: string; about_id: string; reason: string; transcript: string; created_at: Date; resolved: boolean;
      resolved_by: string | null;
    }>('SELECT * FROM reports ORDER BY created_at DESC');
    return rows.map((r) => ({
      id: Number(r.id), byId: Number(r.by_id), aboutId: Number(r.about_id), reason: r.reason,
      transcript: r.transcript, createdAt: r.created_at, resolved: r.resolved,
      resolvedBy: r.resolved_by === null ? null : Number(r.resolved_by),
    }));
  }
  async resolveReport(id: number, adminId: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'UPDATE reports SET resolved = TRUE, resolved_by = $2, resolved_at = now() WHERE id = $1 AND resolved = FALSE',
      [id, adminId],
    );
    return (rowCount ?? 0) > 0;
  }
  async logModeration(adminId: number, memberId: number, action: string, reason: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO moderation_log (admin_id, member_id, action, reason) VALUES ($1, $2, $3, $4)',
      [adminId, memberId, action, reason],
    );
  }
  async close(): Promise<void> { await this.pool.end(); }
}
