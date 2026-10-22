/**
 * Where the server is.
 *
 * One constant, overridable from the browser console for testing against a
 * different box:  localStorage.setItem('cw.sigOrigin', 'https://other.example')
 * The application itself stays static and served from wherever it is served.
 */

const DEFAULT_SIG_ORIGIN = 'https://sig.mikroutik.com';
const STORAGE_KEY = 'cw.sigOrigin';

export function sigOrigin(): string {
  try {
    const override = window.localStorage.getItem(STORAGE_KEY);
    if (override && /^https?:\/\//.test(override)) return override.replace(/\/$/, '');
  } catch {
    /* storage unavailable: use the default */
  }
  return DEFAULT_SIG_ORIGIN;
}

export function wsUrl(): string {
  return `${sigOrigin().replace(/^http/, 'ws')}/ws`;
}
