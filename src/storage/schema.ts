/**
 * The stored data model and the export envelope.
 *
 * RFP §9: "The member must be able to export their entire history to a file
 * and import it again... The export format is a Phase 1 deliverable and
 * Phase 2 must accept it."
 *
 * That makes this file a contract, not an implementation detail. It is
 * versioned, and Phase 2's importer is expected to read every version.
 */

import { DEFAULT_CONDITIONS, type ConditionSettings } from '../core/conditions';
import type { AudioSettings } from '../core/audio';
import type { LessonType } from '../core/generators';
import type { IambicMode } from '../core/keyer';
import { DEFAULT_PRACTICE, type PracticeSelection } from '../core/koch';
import type { Attempt, SessionRecord } from '../core/stats';
import type { TimingSettings } from '../core/timing';

/** Bump only for a breaking change, and add a migration when you do. */
/**
 * 1 — the original shape.
 * 2 — RFD A25: progress carries the characters a failed exam named, so the
 *     over-sampling follows an export to a new browser rather than being
 *     quietly lost. Version 1 files still import; the field simply reads as
 *     empty, which is the honest reading of "this file does not say".
 */
export const EXPORT_VERSION = 2;

export type KeyInputMode = 'straight' | 'iambic';

export interface KeyMap {
  /** Keyboard keys that act as the dit paddle. */
  ditKeys: string[];
  /** Keyboard keys that act as the dah paddle. */
  dahKeys: string[];
  /** Mouse buttons that act as the dit paddle (0 = left, 2 = right). */
  ditButtons: number[];
  dahButtons: number[];
  /** Straight key closes on any of these. */
  straightKeys: string[];
  straightButtons: number[];
}

/**
 * VBand's convention, supported out of the box (RFP §5) because members
 * already have adaptors and Karabiner rules producing these keys.
 */
export const VBAND_KEYMAP: Readonly<KeyMap> = Object.freeze({
  ditKeys: ['BracketLeft'],
  dahKeys: ['BracketRight'],
  ditButtons: [0],
  dahButtons: [2],
  straightKeys: ['BracketLeft', 'ControlLeft'],
  straightButtons: [0],
});

export interface Settings {
  timing: TimingSettings;
  audio: AudioSettings;
  lessonType: LessonType;
  /** Which characters the drills draw from: the course, any lesson, or your own. */
  practice: PracticeSelection;
  /** Characters of material per drill. */
  drillLength: number;
  keyInput: KeyInputMode;
  iambicMode: IambicMode;
  /** Whether replies in a contact are typed or keyed. */
  qsoReplyMode: 'typing' | 'key';
  keyMap: KeyMap;
  /** Decoder tolerance, 0..1. */
  decodeTolerance: number;
  /** Latency above which sending practice is flagged as unusable, in ms. */
  latencyWarnMs: number;
  /** Fading, static, a second station and a hand at the key (RFD A39). */
  conditions: ConditionSettings;
  /**
   * Whether the invitation to try conditions has been put to this member
   * yet. A39 asks for it "once, calmly" — not on every session end for
   * ever, which is how a calm offer becomes nagging.
   */
  conditionsOffered: boolean;
}

/** A finished sending practice run. */
export interface SendingRecord {
  id: string;
  at: number;
  target: string;
  decoded: string;
  accuracy: number;
  estimatedWpm: number;
  weighting: number;
  consistency: number;
  measuredLatencyMs: number;
}

/** Rolled-up per-character totals kept after raw attempts are discarded. */
export interface CharacterRollup {
  character: string;
  attempted: number;
  correct: number;
  /** Sum of response times, so a mean survives the rollup. */
  responseMsTotal: number;
  updatedAt: number;
}

export interface ExportEnvelope {
  format: 'cw-trainer-export';
  version: number;
  exportedAt: string;
  settings: Settings;
  progress: { unlocked: number; failed?: string[] };
  sessions: SessionRecord[];
  attempts: Attempt[];
  sending: SendingRecord[];
  rollups: CharacterRollup[];
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  timing: { characterWpm: 18, effectiveWpm: 8, weighting: 3 },
  audio: { pitchHz: 600, volume: 0.5, envelopeMs: 6, muted: false },
  lessonType: 'groups',
  practice: DEFAULT_PRACTICE,
  drillLength: 25,
  keyInput: 'iambic',
  iambicMode: 'B',
  qsoReplyMode: 'typing',
  keyMap: VBAND_KEYMAP,
  decodeTolerance: 0.35,
  latencyWarnMs: 60,
  conditions: DEFAULT_CONDITIONS,
  conditionsOffered: false,
});

/**
 * Validate an imported envelope. Deliberately strict about shape and
 * forgiving about missing optional collections, so a file from an older
 * build still loads (acceptance criterion 8).
 */
export function parseEnvelope(raw: unknown): ExportEnvelope {
  if (typeof raw !== 'object' || raw === null) throw new Error('Not a CW Trainer export file.');
  const o = raw as Record<string, unknown>;
  if (o['format'] !== 'cw-trainer-export') throw new Error('Not a CW Trainer export file.');
  const version = typeof o['version'] === 'number' ? o['version'] : 0;
  if (version < 1 || version > EXPORT_VERSION) {
    throw new Error(`Unsupported export version ${String(o['version'])}. This build reads versions 1 to ${EXPORT_VERSION}.`);
  }
  const settings = mergeSettings(o['settings']);
  const unlockedRaw = (o['progress'] as { unlocked?: unknown } | undefined)?.unlocked;
  const failedRaw = (o['progress'] as { failed?: unknown } | undefined)?.failed;
  return {
    format: 'cw-trainer-export',
    version,
    exportedAt: typeof o['exportedAt'] === 'string' ? o['exportedAt'] : new Date().toISOString(),
    settings,
    progress: {
      unlocked: typeof unlockedRaw === 'number' && unlockedRaw >= 1 ? Math.floor(unlockedRaw) : 2,
      // Absent in every export written before RFD A25; an empty weighting is
      // the right reading of "this file does not say".
      failed: Array.isArray(failedRaw) ? failedRaw.filter((c): c is string => typeof c === 'string') : [],
    },
    sessions: Array.isArray(o['sessions']) ? (o['sessions'] as SessionRecord[]) : [],
    attempts: Array.isArray(o['attempts']) ? (o['attempts'] as Attempt[]) : [],
    sending: Array.isArray(o['sending']) ? (o['sending'] as SendingRecord[]) : [],
    rollups: Array.isArray(o['rollups']) ? (o['rollups'] as CharacterRollup[]) : [],
  };
}

/** Merge stored settings over the defaults, so a new field is never missing. */
export function mergeSettings(raw: unknown): Settings {
  const base = structuredCloneish(DEFAULT_SETTINGS);
  if (typeof raw !== 'object' || raw === null) return base;
  const o = raw as Partial<Settings>;
  return {
    timing: { ...base.timing, ...(o.timing ?? {}) },
    audio: { ...base.audio, ...(o.audio ?? {}) },
    lessonType: o.lessonType ?? base.lessonType,
    practice: { ...base.practice, ...(o.practice ?? {}) },
    drillLength: typeof o.drillLength === 'number' ? o.drillLength : base.drillLength,
    keyInput: o.keyInput ?? base.keyInput,
    iambicMode: o.iambicMode ?? base.iambicMode,
    qsoReplyMode: o.qsoReplyMode ?? base.qsoReplyMode,
    keyMap: { ...base.keyMap, ...(o.keyMap ?? {}) },
    decodeTolerance: typeof o.decodeTolerance === 'number' ? o.decodeTolerance : base.decodeTolerance,
    latencyWarnMs: typeof o.latencyWarnMs === 'number' ? o.latencyWarnMs : base.latencyWarnMs,
    conditions: { ...base.conditions, ...(o.conditions ?? {}) },
    conditionsOffered: typeof o.conditionsOffered === 'boolean' ? o.conditionsOffered : base.conditionsOffered,
  };
}

/** structuredClone is not in every supported browser; this is enough here. */
function structuredCloneish(value: Readonly<Settings>): Settings {
  return JSON.parse(JSON.stringify(value)) as Settings;
}
