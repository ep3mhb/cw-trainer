import type { MemberInfo } from '../net/api';
import type { CourseProgress } from '../core/koch';
import type { CwAudioEngine } from '../core/audio';
import type { Store } from '../storage/db';
import type { Settings } from '../storage/schema';

/*
 * The privacy notice, at its canonical address rather than a path on this
 * host. Absolute and cross-origin on purpose: the service worker is cache
 * first and leaves other origins alone, so a member always reads the current
 * notice rather than the one that happened to ship with their build. A
 * statement about what is held must not be able to go stale in a cache.
 */
export const PRIVACY_URL = 'https://www.mikroutik.com/privacy.html';

/** Everything a view needs. Passed explicitly rather than imported. */
export interface Ctx {
  store: Store;
  audio: CwAudioEngine;
  settings: Settings;
  progress: CourseProgress;
  /** Persist the current settings and re-apply them to the audio engine. */
  saveSettings: () => Promise<void>;
  saveProgress: () => Promise<void>;
  /** Redraw the header badges. */
  refreshStatus: () => void;
  /** Ask the user's permission to start audio, returning true if running. */
  ensureAudio: () => Promise<boolean>;
  /** Show a transient message in the header. */
  toast: (message: string, tone?: 'good' | 'warn' | 'bad') => void;
  /**
   * Who is signed in to the server, as the On air tab last saw them,
   * or null. The shell reads it to decide whether the ADMIN tab is on the
   * bar; it is an interface convenience and nothing more — the server
   * refuses an administrator's route to anyone else regardless.
   */
  member: MemberInfo | null;
  /** Told by the On air tab whenever somebody signs in, out, or is refreshed. */
  setMember: (member: MemberInfo | null) => void;
}

export interface View {
  node: HTMLElement;
  /** Called when the view is replaced — stop timers, cut audio. */
  dispose?: () => void;
  /** Called when the view becomes visible again. */
  refresh?: () => void | Promise<void>;
}
