/**
 * The member's session token, kept in this browser only.
 *
 * localStorage rather than the IndexedDB store on purpose: the token is not
 * training data, must not travel in an export file, and should vanish when
 * the member signs out rather than be rolled up with their history.
 */

const KEY = 'cw.session';

export function readSession(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeSession(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, token);
  } catch {
    /* private window: the session lasts as long as the page */
  }
}

/**
 * The signed-in member's callsign, cached beside the token so views that do
 * not talk to the server (the robot QSO) can default to it — §8's "one source
 * of truth, no duplicate entry". Written whenever the account panel learns
 * who the member is; cleared with the token.
 */
const CALLSIGN_KEY = 'cw.callsign';
const NAME_KEY = 'cw.name';

export function readMemberCallsign(): string | null {
  try {
    return window.localStorage.getItem(CALLSIGN_KEY);
  } catch {
    return null;
  }
}

export function readMemberName(): string | null {
  try {
    return window.localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

/** Cache who is signed in — callsign and name — or clear both with null. */
export function writeMemberCallsign(callsign: string | null, name: string | null = null): void {
  try {
    if (callsign === null) {
      window.localStorage.removeItem(CALLSIGN_KEY);
      window.localStorage.removeItem(NAME_KEY);
    } else {
      window.localStorage.setItem(CALLSIGN_KEY, callsign);
      if (name) window.localStorage.setItem(NAME_KEY, name);
    }
  } catch {
    /* as above */
  }
}
