/**
 * ADIF export of the contact log (RFP §7: "Log export in ADIF format, which
 * every logging program reads").
 *
 * ADIF 3 is a flat tagged text format: `<FIELD:length>value`, records ended
 * by `<EOR>`, a header ended by `<EOH>`. There is no escaping — the length
 * prefix is the delimiter — so the only care needed is to count characters
 * the way the readers do, which is as bytes for ASCII and as code points for
 * anything else. Callsigns and frequencies are ASCII; the comment is kept to
 * ASCII too, so the two agree.
 *
 * Two honesty rules, both from the RFD and both enforced here rather than
 * left to the member:
 *
 *   - A contact with a training identifier is not exported. A0xxx is not a
 *     callsign and no logging program should be handed it as one (amendment
 *     A13). The export says how many were left out.
 *   - Every record says what it was. These contacts happened between two
 *     browsers, not on the air; the COMMENT field states that, so a log that
 *     is later merged with a real one still tells the truth about each row.
 *
 * Pure: takes records, returns a string. The download is the caller's.
 */

/** What the server's contact log hands the client. */
export interface LoggedContact {
  aCallsign: string;
  bCallsign: string;
  frequencyHz: number;
  /** ISO 8601, as the API sends it. */
  startedAt: string;
  endedAt: string | null;
  exportable: boolean;
  /** The member's own account of the exchange; blank when not written. */
  rstSent?: string;
  rstRcvd?: string;
  note?: string;
}

export interface AdifOptions {
  /** The member the log belongs to; the other callsign becomes CALL. */
  myCallsign: string;
  programId: string;
  programVersion: string;
  /** Header timestamp; injected so the output is reproducible. */
  now: Date;
}

export interface AdifExport {
  text: string;
  /** Records written. */
  exported: number;
  /** Records left out because one side had a training identifier. */
  withheld: number;
  /** Records left out because the contact never ended (still open). */
  open: number;
}

const COMMENT = 'Practice contact on the CW Trainer virtual band, not an on-air QSO';

function field(name: string, value: string): string {
  return `<${name}:${String([...value].length)}>${value}`;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** YYYYMMDD in UTC, as ADIF requires. */
export function adifDate(d: Date): string {
  return `${String(d.getUTCFullYear())}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/** HHMMSS in UTC. */
export function adifTime(d: Date): string {
  return `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
}

/** Frequency in MHz with five decimals, e.g. 7018600 Hz → "7.01860". */
export function adifFrequency(hz: number): string {
  return (hz / 1_000_000).toFixed(5);
}

/** The ADIF band enumeration for a frequency, or null off any amateur band. */
export function adifBand(hz: number): string | null {
  const bands: [string, number, number][] = [
    ['160m', 1_800_000, 2_000_000], ['80m', 3_500_000, 4_000_000], ['60m', 5_060_000, 5_450_000],
    ['40m', 7_000_000, 7_300_000], ['30m', 10_100_000, 10_150_000], ['20m', 14_000_000, 14_350_000],
    ['17m', 18_068_000, 18_168_000], ['15m', 21_000_000, 21_450_000], ['12m', 24_890_000, 24_990_000],
    ['10m', 28_000_000, 29_700_000],
  ];
  for (const [name, lo, hi] of bands) if (hz >= lo && hz <= hi) return name;
  return null;
}

/** One record, or null when the contact is not one that may be exported. */
export function adifRecord(contact: LoggedContact, myCallsign: string): string | null {
  if (!contact.exportable || contact.endedAt === null) return null;
  const other = contact.aCallsign === myCallsign ? contact.bCallsign : contact.aCallsign;
  const on = new Date(contact.startedAt);
  const off = new Date(contact.endedAt);
  const band = adifBand(contact.frequencyHz);
  return [
    field('CALL', other),
    field('QSO_DATE', adifDate(on)),
    field('TIME_ON', adifTime(on)),
    field('QSO_DATE_OFF', adifDate(off)),
    field('TIME_OFF', adifTime(off)),
    field('FREQ', adifFrequency(contact.frequencyHz)),
    ...(band === null ? [] : [field('BAND', band)]),
    field('MODE', 'CW'),
    field('STATION_CALLSIGN', myCallsign),
    ...(contact.rstSent ? [field('RST_SENT', contact.rstSent)] : []),
    ...(contact.rstRcvd ? [field('RST_RCVD', contact.rstRcvd)] : []),
    ...(contact.note ? [field('NOTES', contact.note.replace(/[<>]/g, ' '))] : []),
    field('COMMENT', COMMENT),
    '<EOR>',
  ].join('');
}

/** The whole file: header, then one line per contact, oldest first. */
export function adifExport(contacts: readonly LoggedContact[], options: AdifOptions): AdifExport {
  const header = [
    `CW Trainer contact log for ${options.myCallsign}`,
    field('ADIF_VER', '3.1.4'),
    field('PROGRAMID', options.programId),
    field('PROGRAMVERSION', options.programVersion),
    field('CREATED_TIMESTAMP', `${adifDate(options.now)} ${adifTime(options.now)}`),
    '<EOH>',
  ].join('\n');

  const ordered = [...contacts].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const lines: string[] = [];
  let withheld = 0;
  let open = 0;
  for (const c of ordered) {
    if (!c.exportable) { withheld += 1; continue; }
    if (c.endedAt === null) { open += 1; continue; }
    const record = adifRecord(c, options.myCallsign);
    if (record !== null) lines.push(record);
  }
  return {
    text: `${header}\n${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`,
    exported: lines.length,
    withheld,
    open,
  };
}

/** A file name a logging program will recognise: callsign and date. */
export function adifFileName(myCallsign: string, now: Date): string {
  return `${myCallsign.replace(/[^A-Z0-9]/gi, '-')}-cw-trainer-${adifDate(now)}.adi`;
}
