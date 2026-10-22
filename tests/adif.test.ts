/**
 * ADIF export (RFP §7). The format is simple and the readers are strict:
 * the length prefix is the only delimiter, dates are UTC, and a record that
 * should not be there (a training identifier) must not be.
 */

import { describe, expect, it } from 'vitest';
import {
  adifBand, adifDate, adifExport, adifFileName, adifFrequency, adifRecord, adifTime, type LoggedContact,
} from '../src/core/adif';

const NOW = new Date('2026-09-21T18:30:05Z');
const OPTIONS = { myCallsign: 'EP2MHB', programId: 'CW Trainer', programVersion: '0.5.0', now: NOW };

const real: LoggedContact = {
  aCallsign: 'G4ABC', bCallsign: 'EP2MHB', frequencyHz: 7_018_600,
  startedAt: '2026-09-21T17:02:10.000Z', endedAt: '2026-09-21T17:09:45.000Z', exportable: true,
};
const training: LoggedContact = { ...real, aCallsign: 'A0MBA', exportable: false, startedAt: '2026-09-21T16:00:00Z' };
const stillOpen: LoggedContact = { ...real, endedAt: null, startedAt: '2026-09-21T18:00:00Z' };

/** Parse `<NAME:len>value` fields back, checking each length as a reader would. */
function fields(record: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<([A-Z_]+):(\d+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(record)) !== null) {
    const len = Number(m[2]);
    const value = record.slice(m.index + m[0].length, m.index + m[0].length + len);
    expect([...value].length, `${String(m[1])} length`).toBe(len);
    out[m[1] as string] = value;
    re.lastIndex = m.index + m[0].length + len;
  }
  return out;
}

describe('the pieces', () => {
  it('writes dates and times in UTC', () => {
    const d = new Date('2026-09-21T23:59:59+04:00'); // 19:59:59Z
    expect(adifDate(d)).toBe('20260921');
    expect(adifTime(d)).toBe('195959');
  });

  it('writes the frequency in MHz to five places and names the band', () => {
    expect(adifFrequency(7_018_600)).toBe('7.01860');
    expect(adifFrequency(7_000_000)).toBe('7.00000');
    expect(adifBand(7_018_600)).toBe('40m');
    expect(adifBand(14_050_000)).toBe('20m');
    expect(adifBand(1_000_000)).toBeNull();
  });

  it('names the file by callsign and date', () => {
    expect(adifFileName('EP2MHB', NOW)).toBe('EP2MHB-cw-trainer-20260921.adi');
    expect(adifFileName('A65XY/P', NOW)).toBe('A65XY-P-cw-trainer-20260921.adi');
  });
});

describe('a record', () => {
  it('puts the other station in CALL and the member in STATION_CALLSIGN, whichever side they were', () => {
    const asB = fields(adifRecord(real, 'EP2MHB') ?? '');
    expect(asB['CALL']).toBe('G4ABC');
    expect(asB['STATION_CALLSIGN']).toBe('EP2MHB');
    const asA = fields(adifRecord(real, 'G4ABC') ?? '');
    expect(asA['CALL']).toBe('EP2MHB');
  });

  it('carries date, times, frequency, band and mode, and says what it was', () => {
    const f = fields(adifRecord(real, 'EP2MHB') ?? '');
    expect(f).toMatchObject({
      QSO_DATE: '20260921', TIME_ON: '170210', QSO_DATE_OFF: '20260921', TIME_OFF: '170945',
      FREQ: '7.01860', BAND: '40m', MODE: 'CW',
    });
    expect(f['COMMENT']).toMatch(/not an on-air QSO/);
    expect(adifRecord(real, 'EP2MHB')?.endsWith('<EOR>')).toBe(true);
  });

  it('carries the exchange when the member wrote it down, and nothing when not', () => {
    const bare = fields(adifRecord(real, 'EP2MHB') ?? '');
    expect(bare).not.toHaveProperty('RST_SENT');
    expect(bare).not.toHaveProperty('NOTES');
    const noted = fields(adifRecord({ ...real, rstSent: '599', rstRcvd: '579', note: 'first contact <on> the band' }, 'EP2MHB') ?? '');
    expect(noted).toMatchObject({ RST_SENT: '599', RST_RCVD: '579' });
    expect(noted['NOTES']).toBe('first contact  on  the band');
    expect(noted['COMMENT']).toMatch(/not an on-air QSO/);
  });

  it('refuses a training contact and one still open', () => {
    expect(adifRecord(training, 'EP2MHB')).toBeNull();
    expect(adifRecord(stillOpen, 'EP2MHB')).toBeNull();
  });
});

describe('the file', () => {
  it('has a header every reader expects, then one line per exportable contact, oldest first', () => {
    const later = { ...real, aCallsign: 'I2XYZ', startedAt: '2026-09-21T17:30:00Z', endedAt: '2026-09-21T17:35:00Z' };
    const out = adifExport([later, training, real, stillOpen], OPTIONS);
    const [head, body] = out.text.split('<EOH>\n');
    expect(fields(head ?? '')).toMatchObject({ ADIF_VER: '3.1.4', PROGRAMID: 'CW Trainer', PROGRAMVERSION: '0.5.0', CREATED_TIMESTAMP: '20260921 183005' });
    const lines = (body ?? '').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(fields(lines[0] ?? '')['CALL']).toBe('G4ABC');
    expect(fields(lines[1] ?? '')['CALL']).toBe('I2XYZ');
    expect(out).toMatchObject({ exported: 2, withheld: 1, open: 1 });
    expect(out.text).not.toContain('A0MBA');
  });

  it('is a valid, empty log when there is nothing to export', () => {
    const out = adifExport([training], OPTIONS);
    expect(out.exported).toBe(0);
    expect(out.text).toContain('<EOH>');
    expect(out.text).not.toContain('<EOR>');
  });
});
