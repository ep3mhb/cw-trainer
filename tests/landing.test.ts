/**
 * The landing view's one decision (RFD A38).
 *
 * Who sees it is the whole of it, and getting it wrong is worse in one
 * direction than the other: a first-time visitor who misses the page has
 * merely landed where members land, but a member of six months who is
 * shown a welcome screen every morning will think the application has
 * forgotten them.
 */

import { describe, expect, it } from 'vitest';
import { shouldShowLanding } from '../src/ui/landing';

describe('who is shown the landing view', () => {
  it('shows it to a browser that has never been used here', () => {
    expect(shouldShowLanding({ sessions: 0, attempts: 0 }, false)).toBe(true);
  });

  it('does not show it to somebody who has finished a session', () => {
    expect(shouldShowLanding({ sessions: 1, attempts: 50 }, false)).toBe(false);
  });

  /*
   * One drill is a history. A member who answered five characters and
   * closed the tab has met the application, and the series they left open
   * (A42) may be waiting for them — being greeted as a stranger instead
   * would be worse than useless.
   */
  it('does not show it to somebody who has answered even one drill', () => {
    expect(shouldShowLanding({ sessions: 0, attempts: 5 }, false)).toBe(false);
  });

  /*
   * A member signed in on a brand-new machine has no local history at all,
   * which is exactly the shape of a first-time visitor. They are not one.
   */
  it('does not show it to a signed-in member on a fresh machine', () => {
    expect(shouldShowLanding({ sessions: 0, attempts: 0 }, true)).toBe(false);
  });

  it('does not show it to a signed-in member with a history either', () => {
    expect(shouldShowLanding({ sessions: 9, attempts: 400 }, true)).toBe(false);
  });
});

/*
 * The address in the bar is not an instruction (16 October 2026).
 *
 * The application writes the current tab into the hash on every switch, so
 * the address anybody copies out of their browser and sends to a friend is
 * cw.mikroutik.com/#receive, not the bare domain. Treating that as "take me
 * straight to Receive" meant the single visitor this page exists for — the
 * one following a shared link, who has never seen the application — was the
 * one visitor who never saw it.
 */
describe('a hash in the address', () => {
  const fresh = { sessions: 0, attempts: 0 };

  it('does not suppress the welcome page when it merely names a tab', () => {
    expect(shouldShowLanding(fresh, false, '#receive')).toBe(true);
    expect(shouldShowLanding(fresh, false, '#send')).toBe(true);
    expect(shouldShowLanding(fresh, false, '#air')).toBe(true);
    expect(shouldShowLanding(fresh, false, '#help')).toBe(true);
  });

  it('still shows it for a bare address, with or without the #', () => {
    expect(shouldShowLanding(fresh, false, '')).toBe(true);
    expect(shouldShowLanding(fresh, false, '#')).toBe(true);
  });

  /*
   * An errand is different from a tab. Somebody following a reset link has
   * a password to change, and somebody scanning a certificate's QR square
   * wants to check one thing. Greeting either with a welcome page would be
   * worse than useless.
   */
  it('gets out of the way of a password reset', () => {
    expect(shouldShowLanding(fresh, false, '#reset=abc123')).toBe(false);
  });

  it('gets out of the way of a scanned certificate', () => {
    expect(shouldShowLanding(fresh, false, '#certificate=AB12CD34')).toBe(false);
  });

  it('still refuses a member with a history, whatever the address says', () => {
    expect(shouldShowLanding({ sessions: 3, attempts: 150 }, false, '')).toBe(false);
  });
});
