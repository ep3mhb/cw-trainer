/**
 * IndexedDB store (RFP §9: "All progress, settings and logs held in the
 * browser using IndexedDB, with no server and no account").
 *
 * A thin promise wrapper rather than a library, so Phase 1 ships with no
 * runtime dependencies at all and the whole storage layer is auditable.
 */

import type { OpenSeries } from '../core/training';
import type { Attempt, SessionRecord } from '../core/stats';
import { partitionForRollup } from '../core/stats';
import {
  DEFAULT_SETTINGS, EXPORT_VERSION, mergeSettings, parseEnvelope,
  type CharacterRollup, type ExportEnvelope, type SendingRecord, type Settings,
} from './schema';

const DB_NAME = 'cw-trainer';
const DB_VERSION = 1;

const STORE = {
  meta: 'meta',
  sessions: 'sessions',
  attempts: 'attempts',
  sending: 'sending',
  rollups: 'rollups',
} as const;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class Store {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<Store> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const database = open.result;
        if (!database.objectStoreNames.contains(STORE.meta)) {
          database.createObjectStore(STORE.meta);
        }
        if (!database.objectStoreNames.contains(STORE.sessions)) {
          database.createObjectStore(STORE.sessions, { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
        }
        if (!database.objectStoreNames.contains(STORE.attempts)) {
          database.createObjectStore(STORE.attempts, { autoIncrement: true }).createIndex('at', 'at');
        }
        if (!database.objectStoreNames.contains(STORE.sending)) {
          database.createObjectStore(STORE.sending, { keyPath: 'id' }).createIndex('at', 'at');
        }
        if (!database.objectStoreNames.contains(STORE.rollups)) {
          database.createObjectStore(STORE.rollups, { keyPath: 'character' });
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('Could not open the local database'));
      open.onblocked = () => reject(new Error('Another tab is upgrading the database. Close it and reload.'));
    });
    return new Store(db);
  }

  // ---- settings and progress ----

  async settings(): Promise<Settings> {
    const tx = this.db.transaction(STORE.meta, 'readonly');
    const raw = await request(tx.objectStore(STORE.meta).get('settings'));
    return mergeSettings(raw);
  }

  async saveSettings(settings: Settings): Promise<void> {
    const tx = this.db.transaction(STORE.meta, 'readwrite');
    tx.objectStore(STORE.meta).put(settings, 'settings');
    await done(tx);
  }

  async progress(): Promise<{ unlocked: number; failed?: string[] }> {
    const tx = this.db.transaction(STORE.meta, 'readonly');
    const raw = await request(tx.objectStore(STORE.meta).get('progress'));
    const stored = raw as { unlocked?: number; failed?: unknown } | undefined;
    const unlocked = stored?.unlocked;
    const failed = Array.isArray(stored?.failed)
      ? stored.failed.filter((c): c is string => typeof c === 'string')
      : [];
    return { unlocked: typeof unlocked === 'number' ? unlocked : 2, failed };
  }

  async saveProgress(progress: { unlocked: number; failed?: string[] }): Promise<void> {
    const tx = this.db.transaction(STORE.meta, 'readwrite');
    tx.objectStore(STORE.meta).put(progress, 'progress');
    await done(tx);
  }

  // ---- sessions, attempts, sending ----

  async addSession(session: SessionRecord): Promise<void> {
    const tx = this.db.transaction(STORE.sessions, 'readwrite');
    tx.objectStore(STORE.sessions).put(session);
    await done(tx);
  }

  async sessions(): Promise<SessionRecord[]> {
    const tx = this.db.transaction(STORE.sessions, 'readonly');
    const all = await request(tx.objectStore(STORE.sessions).getAll() as IDBRequest<SessionRecord[]>);
    return all.sort((a, b) => a.startedAt - b.startedAt);
  }

  async addAttempts(attempts: readonly Attempt[]): Promise<void> {
    if (attempts.length === 0) return;
    const tx = this.db.transaction(STORE.attempts, 'readwrite');
    const store = tx.objectStore(STORE.attempts);
    for (const attempt of attempts) store.add(attempt);
    await done(tx);
  }

  async attempts(): Promise<Attempt[]> {
    const tx = this.db.transaction(STORE.attempts, 'readonly');
    return request(tx.objectStore(STORE.attempts).getAll() as IDBRequest<Attempt[]>);
  }

  async addSending(record: SendingRecord): Promise<void> {
    const tx = this.db.transaction(STORE.sending, 'readwrite');
    tx.objectStore(STORE.sending).put(record);
    await done(tx);
  }

  async sending(): Promise<SendingRecord[]> {
    const tx = this.db.transaction(STORE.sending, 'readonly');
    const all = await request(tx.objectStore(STORE.sending).getAll() as IDBRequest<SendingRecord[]>);
    return all.sort((a, b) => a.at - b.at);
  }

  /**
   * Which sessions the server has acknowledged (RFD A37).
   *
   * Kept here rather than guessed from a timestamp: a high-water mark skips
   * anything that arrives out of order or fails once, and a hole in a
   * member's history is not repaired by anything later. The server ignores
   * a session it already holds, so the worst this list can cost is a
   * duplicate request.
   */
  async uploadedSessionIds(): Promise<string[]> {
    const tx = this.db.transaction(STORE.meta, 'readonly');
    const raw = await request(tx.objectStore(STORE.meta).get('training-uploaded'));
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  }

  /**
   * The course position this browser last told the server (RFD A40), or 0 if
   * it has told it nothing. Kept beside the uploaded session ids and cleared
   * with them, so switching the service off and on again re-sends everything.
   */
  async uploadedPosition(): Promise<number> {
    const tx = this.db.transaction(STORE.meta, 'readonly');
    const raw = await request(tx.objectStore(STORE.meta).get('training-position'));
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  }

  async markPositionUploaded(unlocked: number): Promise<void> {
    const tx = this.db.transaction(STORE.meta, 'readwrite');
    tx.objectStore(STORE.meta).put(unlocked, 'training-position');
    await done(tx);
  }

  async markSessionsUploaded(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const known = await this.uploadedSessionIds();
    const tx = this.db.transaction(STORE.meta, 'readwrite');
    tx.objectStore(STORE.meta).put([...new Set([...known, ...ids])], 'training-uploaded');
    await done(tx);
  }

  /** Forget what was acknowledged — used when a member switches the service off. */
  async forgetUploadedSessions(): Promise<void> {
    const tx = this.db.transaction(STORE.meta, 'readwrite');
    tx.objectStore(STORE.meta).delete('training-uploaded');
    tx.objectStore(STORE.meta).delete('training-position');
    await done(tx);
  }

  /*
   * The series of drills in progress (RFD A42).
   *
   * Deliberately NOT cleared by forgetUploadedSessions. Switching records
   * off means the server forgets, not that this browser throws away the
   * series the member is in the middle of — they are still sitting in front
   * of drill six, and the local half of this amendment is owed to every
   * member whether or not they ever asked for anything to leave the browser.
   */
  async openSeries(): Promise<OpenSeries | null> {
    const tx = this.db.transaction(STORE.meta, 'readonly');
    const raw: unknown = await request(tx.objectStore(STORE.meta).get('training-open'));
    if (raw === null || typeof raw !== 'object') return null;
    const o = raw as Partial<OpenSeries>;
    // A shape check rather than a cast: this value survives upgrades, and a
    // half-written record should start a fresh series rather than throw on
    // the first drill.
    if (typeof o.id !== 'string' || typeof o.drillsDone !== 'number') return null;
    if (typeof o.startedAt !== 'number' || typeof o.attempted !== 'number') return null;
    if (typeof o.correct !== 'number' || typeof o.unlockedCount !== 'number') return null;
    return {
      id: o.id,
      startedAt: o.startedAt,
      lessonType: typeof o.lessonType === 'string' ? o.lessonType : 'groups',
      characterWpm: typeof o.characterWpm === 'number' ? o.characterWpm : 18,
      effectiveWpm: typeof o.effectiveWpm === 'number' ? o.effectiveWpm : 8,
      drillsDone: o.drillsDone,
      attempted: o.attempted,
      correct: o.correct,
      unlockedCount: o.unlockedCount,
    };
  }

  async saveOpenSeries(series: OpenSeries): Promise<void> {
    const tx = this.db.transaction(STORE.meta, 'readwrite');
    tx.objectStore(STORE.meta).put({ ...series }, 'training-open');
    await done(tx);
  }

  async clearOpenSeries(): Promise<void> {
    const tx = this.db.transaction(STORE.meta, 'readwrite');
    tx.objectStore(STORE.meta).delete('training-open');
    await done(tx);
  }

  async rollups(): Promise<CharacterRollup[]> {
    const tx = this.db.transaction(STORE.rollups, 'readonly');
    return request(tx.objectStore(STORE.rollups).getAll() as IDBRequest<CharacterRollup[]>);
  }

  /**
   * Discard raw attempts older than the retention window, folding their
   * totals into the per-character rollups first (RFP §4).
   */
  async rollUpOldAttempts(now: number = Date.now()): Promise<{ rolledUp: number }> {
    const attempts = await this.attempts();
    const { rollUp } = partitionForRollup(attempts, now);
    if (rollUp.length === 0) return { rolledUp: 0 };

    const existing = new Map((await this.rollups()).map((r) => [r.character, r]));
    for (const attempt of rollUp) {
      if (attempt.sent === '') continue;
      const entry = existing.get(attempt.sent) ??
        { character: attempt.sent, attempted: 0, correct: 0, responseMsTotal: 0, updatedAt: now };
      entry.attempted += 1;
      if (attempt.typed === attempt.sent) entry.correct += 1;
      entry.responseMsTotal += attempt.responseMs;
      entry.updatedAt = now;
      existing.set(attempt.sent, entry);
    }

    const tx = this.db.transaction([STORE.attempts, STORE.rollups], 'readwrite');
    const rollupStore = tx.objectStore(STORE.rollups);
    for (const entry of existing.values()) rollupStore.put(entry);

    const attemptStore = tx.objectStore(STORE.attempts);
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    const cursorRequest = attemptStore.index('at').openCursor(IDBKeyRange.upperBound(cutoff, true));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor === null) return;
      cursor.delete();
      cursor.continue();
    };
    await done(tx);
    return { rolledUp: rollUp.length };
  }

  // ---- export and import (RFP §9, acceptance criterion 8) ----

  async exportAll(): Promise<ExportEnvelope> {
    const [settings, progress, sessions, attempts, sending, rollups] = await Promise.all([
      this.settings(), this.progress(), this.sessions(), this.attempts(), this.sending(), this.rollups(),
    ]);
    return {
      format: 'cw-trainer-export',
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      settings,
      progress,
      sessions,
      attempts,
      sending,
      rollups,
    };
  }

  /**
   * Replace everything with the contents of an export file.
   *
   * Destructive by design: the two cases that matter are moving to a new
   * device and restoring after clearing browser storage, and in both the
   * file is the truth. The UI confirms before calling this.
   */
  async importAll(raw: unknown): Promise<ExportEnvelope> {
    const envelope = parseEnvelope(raw);
    const tx = this.db.transaction(
      [STORE.meta, STORE.sessions, STORE.attempts, STORE.sending, STORE.rollups],
      'readwrite',
    );
    tx.objectStore(STORE.sessions).clear();
    tx.objectStore(STORE.attempts).clear();
    tx.objectStore(STORE.sending).clear();
    tx.objectStore(STORE.rollups).clear();
    tx.objectStore(STORE.meta).put(envelope.settings, 'settings');
    tx.objectStore(STORE.meta).put(envelope.progress, 'progress');
    const sessions = tx.objectStore(STORE.sessions);
    for (const session of envelope.sessions) sessions.put(session);
    const attempts = tx.objectStore(STORE.attempts);
    for (const attempt of envelope.attempts) attempts.add(attempt);
    const sending = tx.objectStore(STORE.sending);
    for (const record of envelope.sending) sending.put(record);
    const rollups = tx.objectStore(STORE.rollups);
    for (const rollup of envelope.rollups) rollups.put(rollup);
    await done(tx);
    return envelope;
  }

  /** Wipe local data (the privacy-minded counterpart to export). */
  async clearAll(): Promise<void> {
    const tx = this.db.transaction(
      [STORE.meta, STORE.sessions, STORE.attempts, STORE.sending, STORE.rollups],
      'readwrite',
    );
    for (const name of Object.values(STORE)) tx.objectStore(name).clear();
    tx.objectStore(STORE.meta).put(DEFAULT_SETTINGS, 'settings');
    await done(tx);
  }
}
