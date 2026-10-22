/**
 * Over to over (RFP §7). The key is held while the other station is sending
 * and for a hold after; it is not held across the gaps inside their over,
 * and it lifts at the handover.
 */

import { describe, expect, it } from 'vitest';
import { TURN_HOLD_MS, TurnKeeper } from '../src/core/turn';

describe('whose over it is', () => {
  it('is free until anyone keys, then theirs while their key is down', () => {
    const t = new TurnKeeper();
    expect(t.at(0)).toBe('free');
    expect(t.mayKey(0)).toBe(true);
    t.theirKey(1000, true);
    expect(t.at(1050)).toBe('theirs');
    expect(t.mayKey(1050)).toBe(false);
    // Down for a long time (a dah, or a stuck key): still theirs.
    expect(t.at(1000 + TURN_HOLD_MS * 2)).toBe('theirs');
  });

  it('stays theirs across the gaps inside an over — a word gap at 5 WPM is 1.7 s', () => {
    const t = new TurnKeeper();
    t.theirKey(1000, true);
    t.theirKey(1240, false);
    expect(t.at(1240 + 1700)).toBe('theirs');
    expect(t.heldForMs(1240 + 1700)).toBe(TURN_HOLD_MS - 1700);
  });

  it('lifts the hold after the other station has been quiet for the hold', () => {
    const t = new TurnKeeper();
    t.theirKey(1000, true);
    t.theirKey(1060, false);
    expect(t.at(1060 + TURN_HOLD_MS - 1)).toBe('theirs');
    expect(t.at(1060 + TURN_HOLD_MS)).toBe('free');
    expect(t.heldForMs(1060 + TURN_HOLD_MS)).toBe(0);
  });

  it('is mine while I am sending, and theirs the moment they key over me', () => {
    const t = new TurnKeeper();
    t.myKey(5000);
    expect(t.at(5100)).toBe('mine');
    expect(t.mayKey(5100)).toBe(true);
    // If they double anyway, what we hear wins: our key is held so the
    // doubling stops on one side at least.
    t.theirKey(5200, true);
    expect(t.at(5250)).toBe('theirs');
  });

  it('forgets everything on reset', () => {
    const t = new TurnKeeper();
    t.theirKey(1000, true);
    t.reset();
    expect(t.at(1001)).toBe('free');
  });
});
