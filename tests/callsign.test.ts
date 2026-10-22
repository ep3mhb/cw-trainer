/**
 * Training identifiers (RFP open point 14.3, closed 20 September 2026).
 *
 * The maintainer approved A0. The tests are the three rules that went with it,
 * plus the property the whole scheme rests on: nothing this issues can ever
 * be a real station.
 */

import { describe, expect, it } from 'vitest';
import {
  TRAINING_PREFIX, describeIdentifier, exportableAsQso, isTrainingIdentifier,
  issueTrainingIdentifier, normalise, parseCallsign,
} from '../src/core/callsign';
import { seeded } from '../src/core/random';

describe('callsigns', () => {
  it('accepts the ordinary shapes and tidies them', () => {
    expect(parseCallsign('ep2mhb')).toEqual({ text: 'EP2MHB', kind: 'callsign' });
    expect(parseCallsign('A65XY')).toEqual({ text: 'A65XY', kind: 'callsign' });
    expect(parseCallsign('G4ABC/P')).toEqual({ text: 'G4ABC/P', kind: 'callsign' });
    expect(parseCallsign('2E0ABC')).toEqual({ text: '2E0ABC', kind: 'callsign' });
    expect(parseCallsign(' w1aw ')).toEqual({ text: 'W1AW', kind: 'callsign' });
  });

  it('rejects what is not shaped like one', () => {
    expect(parseCallsign('MOHAMMAD')).toBeNull();
    expect(parseCallsign('123')).toBeNull();
    expect(parseCallsign('')).toBeNull();
    expect(parseCallsign('A6')).toBeNull();
  });

  it('refuses a training identifier offered as a licensed callsign', () => {
    // Nobody holds A0 anything. Letting it through would put a training
    // identifier in the registry wearing a callsign's badge.
    expect(parseCallsign('A0MHB')).toBeNull();
    expect(parseCallsign('a0xyz')).toBeNull();
  });
});

describe('training identifiers', () => {
  it('are built from initials so a member recognises their own', () => {
    const id = issueTrainingIdentifier('Mohammad Bahrololoum', new Set(), seeded(1));
    expect(id).toEqual({ text: 'A0MBA', kind: 'training' });
    expect(issueTrainingIdentifier('Yuki', new Set(), seeded(1)).text).toBe('A0YUK');
    expect(issueTrainingIdentifier('Anna Maria Rossi', new Set(), seeded(1)).text).toBe('A0AMR');
  });

  it('fall back to random letters when the initials are taken', () => {
    const taken = new Set(['A0MBA']);
    const id = issueTrainingIdentifier('Mohammad Bahrololoum', taken, seeded(3));
    expect(id.kind).toBe('training');
    expect(id.text).not.toBe('A0MBA');
    expect(isTrainingIdentifier(id.text)).toBe(true);
  });

  it('never collide with anything already issued', () => {
    const taken = new Set<string>();
    const random = seeded(9);
    for (let i = 0; i < 500; i += 1) {
      const id = issueTrainingIdentifier('', taken, random);
      expect(taken.has(id.text)).toBe(false);
      taken.add(id.text);
    }
  });

  it('are always callsign-shaped and always A0', () => {
    const random = seeded(5);
    for (let i = 0; i < 200; i += 1) {
      const { text } = issueTrainingIdentifier('', new Set(), random);
      expect(text).toMatch(/^A0[A-Z]{3}$/);
      expect(text.startsWith(TRAINING_PREFIX)).toBe(true);
    }
  });

  it('are recognised however they are typed', () => {
    expect(isTrainingIdentifier('a0mba')).toBe(true);
    expect(isTrainingIdentifier('A0 MBA')).toBe(true);
    expect(isTrainingIdentifier('A65XY')).toBe(false);
    expect(isTrainingIdentifier('A0MB')).toBe(false);
    expect(normalise('a0-mba')).toBe('A0MBA');
  });
});

describe('the three rules', () => {
  it('rule 1: a training identifier always carries its label', () => {
    expect(describeIdentifier('A0MBA')).toEqual({ text: 'A0MBA', label: 'training', training: true });
    expect(describeIdentifier('EP2MHB')).toEqual({ text: 'EP2MHB', label: '', training: false });
  });

  it('rule 2: a contact with a training identifier on either side is not a QSO for export', () => {
    expect(exportableAsQso('EP2MHB', 'A65XY')).toBe(true);
    expect(exportableAsQso('EP2MHB', 'A0MBA')).toBe(false);
    expect(exportableAsQso('A0MBA', 'EP2MHB')).toBe(false);
    expect(exportableAsQso('A0MBA', 'A0YUK')).toBe(false);
  });

  it('rule 3 is a registry rule: a real callsign can be added beside a training one', () => {
    // The identifier is retired, not rewritten, so both can coexist in a
    // record — which means the parser must accept the one and keep refusing
    // the other, rather than treating a member as one identifier for life.
    expect(parseCallsign('A65XY')).not.toBeNull();
    expect(parseCallsign('A0MBA')).toBeNull();
  });
});
