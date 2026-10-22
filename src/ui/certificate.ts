/**
 * The certificate for finishing the course (RFD A25).
 *
 * Everything on it is specific and checkable: the speed it was passed at, the
 * score, the date, a serial, and a QR square that scans back to the
 * own copy. A certificate that says only "well done" is worth nothing, and
 * one that overstates what it knows is worse than nothing — so this one says
 * plainly which software ran the course and that it is not a licence.
 *
 * Printed, it is A4 landscape and ink on white. The panel chassis is for the
 * screen; nobody wants to print a black page.
 */

import type { CertificateSheet, ExamResultBody, MemberInfo, PublicCertificate } from '../net/api';
import { clear, el } from './dom';

/**
 * Unambiguous in any country, which a certificate has to be.
 *
 * Exported because the account panel lists the same dates, and listed one
 * format while the sheet showed another: "10/11/2026" beside "11 October
 * 2026" for the same certificate. One date, one spelling.
 */
export const longDate = (when: Date): string =>
  when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export interface CertificateFacts {
  /** Who it is for: the full member when it is theirs, a callsign when scanned. */
  name: string | null;
  callsign: string;
  training: boolean;
  issuedAt: Date;
  correct: number;
  of: number;
  characterWpm: number;
  effectiveWpm: number;
  serial: string;
  /** The QR square as SVG, when the server supplied one. */
  qr: string | null;
}

export function factsFromResult(member: MemberInfo, result: ExamResultBody, issuedAt: Date): CertificateFacts {
  return {
    name: member.name,
    callsign: member.callsign,
    training: member.training,
    issuedAt,
    correct: result.correct,
    of: result.of,
    characterWpm: result.characterWpm,
    effectiveWpm: result.effectiveWpm,
    serial: result.serial ?? '',
    qr: result.qr,
  };
}

/**
 * One of your own certificates, listed in the account panel, turned back into
 * the sheet it was issued as.
 *
 * The sheet used to exist for one page view only \u2014 rendered in the moment
 * after passing and never again \u2014 so a member who closed the tab had no way
 * back to it. Unlike `factsFromPublic` this has the holder's own session
 * behind it, so the name goes on as it did the day it was issued, and the
 * server sends the QR square back with it.
 */
export function factsFromSheet(member: MemberInfo, c: CertificateSheet): CertificateFacts {
  return {
    name: member.name,
    callsign: member.callsign,
    training: member.training,
    issuedAt: new Date(c.issuedAt),
    correct: c.correct,
    of: c.of,
    characterWpm: c.characterWpm,
    effectiveWpm: c.effectiveWpm,
    serial: c.serial,
    qr: c.qr,
  };
}

export function factsFromPublic(c: PublicCertificate, qr: string | null = null): CertificateFacts {
  return {
    name: null,
    callsign: c.callsign,
    training: c.training,
    issuedAt: new Date(c.issuedAt),
    correct: c.correct,
    of: c.of,
    characterWpm: c.characterWpm,
    effectiveWpm: c.effectiveWpm,
    serial: c.serial,
    qr,
  };
}

/**
 * Put the certificate alone on one sheet of paper.
 *
 * Hiding the rest of the application with `visibility` was not enough: the
 * boxes stay in the layout, so the document is still as tall as the whole
 * app and the printer dutifully produces a second, blank page. Hiding it
 * with `display` instead takes the certificate's own ancestors with it, and
 * nothing inside a display:none parent can be brought back.
 *
 * So the certificate is lifted out to the body for the duration of the
 * print and put back afterwards. Deterministic, and it survives both the
 * button and the browser's own print command.
 */
function printAlone(node: HTMLElement): void {
  let home: { parent: Node; next: Node | null } | null = null;
  window.addEventListener('beforeprint', () => {
    if (node.parentNode === null || node.parentNode === document.body) return;
    home = { parent: node.parentNode, next: node.nextSibling };
    document.body.classList.add('printing-certificate');
    document.body.append(node);
  });
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing-certificate');
    if (home === null) return;
    home.parent.insertBefore(node, home.next);
    home = null;
  });
}

/**
 * The stamp: the QR square is the seal.
 *
 * Rather than a decorative medallion beside a separate code, the thing you
 * scan IS the thing that looks official — which is honest, because the only
 * authority this certificate has is that the server will confirm it.
 * The ring says what it is above and what to do with it below, set on arcs
 * so it reads as a stamp rather than a label.
 */
function stamp(qr: string | null, serial: string): HTMLElement {
  const node = el('div', { class: 'cert-stamp' });
  // Two arcs, both drawn LEFT to RIGHT so the lettering sits upright on
  // each: the top one sweeping over (sweep-flag 1), the bottom one under
  // (sweep-flag 0). Getting that backwards prints the lower half upside
  // down, which is how the first attempt came out.
  //
  // The radii are NOT the same, and that is the whole alignment. Glyphs grow
  // upward from their baseline, and "up" on the top arc points away from the
  // centre while "up" on the bottom arc points into it. Equal radii therefore
  // throw the two bands apart by a cap height. The lettering belongs in the
  // band between the thin ring at 45 and the inner rule at 33, so the top
  // baseline sits at 37 and grows out to about 41, and the bottom baseline
  // sits at 41 and grows in to about 37. Same band, both ways round.
  //
  // Each arc subtends a FIXED angle and each string is given a length set
  // from that arc, so the span is geometry rather than font metrics: the top
  // legend occupies 120 degrees (ten o'clock to two), the lower one 90 (half
  // past seven to half past four), and they stay there whatever the browser's
  // idea of the width of "CW TRAINER" happens to be. Letting the type find
  // its own width put the top legend past the horizontal on both sides, which
  // reads as a spiral rather than a seal.
  //
  // The lengths are deliberately SHORT of the arcs they sit on. They used to
  // match exactly — 77.5 on a 77.5 path, 64.4 on a 64.4 path — which asks the
  // lettering to span the full path with nothing to spare. SVG renders no
  // glyph that falls past the end of its path, and it does not wrap or shrink
  // to avoid that; so a sub-pixel of rounding takes the last letter off, and
  // the seal read "KOCH COURS" and "SCAN TO VER" at some widths and not at
  // others. Nine tenths of the arc leaves the margin that rounding needs, and
  // centres the legend in its band besides. `spacingAndGlyphs` is the second
  // belt is the margin itself, not glyph distortion: `spacingAndGlyphs` was
  // tried and squeezed the letterforms to nine tenths of their width, which
  // reads as condensed type against every other letter on the sheet. Plain
  // `spacing` only opens or closes the gaps BETWEEN letters, and with the
  // arc nine tenths full there is room for it to do so without clipping.
  // The serial in the middle keeps spacingAndGlyphs \u2014 a serial is a code,
  // and it has to fit the circle more than it has to look like running
  // text.
  const ring = `<svg viewBox="0 0 100 100" aria-hidden="true" class="cert-stamp-ring">
    <defs>
      <path id="cert-arc-top" d="M 17.96,31.5 A 37,37 0 0 1 82.04,31.5" fill="none"/>
      <path id="cert-arc-bottom" d="M 21.01,78.99 A 41,41 0 0 0 78.99,78.99" fill="none"/>
    </defs>
    <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="0.6" opacity="0.6"/>
    <!-- A white disc behind the square: a QR needs a clear quiet zone, and
         the first version ran the inner rule straight through its corners,
         which killed the finder patterns and stopped it scanning at all.
         With no QR there is no square and no quiet zone to protect, so the
         disc goes: a seal printed round a blank white circle, still saying
         SCAN TO VERIFY, is what the verification page used to show. The
         serial takes the middle instead, the way a real seal carries a
         number, and the lower legend goes with the square it belonged to. -->
    ${qr === null ? '' : '<circle cx="50" cy="50" r="33" fill="#fff"/>'}
    <circle cx="50" cy="50" r="33" fill="none" stroke="currentColor" stroke-width="0.6" opacity="0.5"/>
    <text font-size="5.3" fill="currentColor" font-family="ui-sans-serif, system-ui, sans-serif">
      <textPath href="#cert-arc-top" startOffset="50%" text-anchor="middle"
        textLength="70" lengthAdjust="spacing">CW TRAINER \u00b7 KOCH COURSE</textPath>
    </text>
    ${qr === null ? `<text x="50" y="52.5" font-size="6" text-anchor="middle" fill="currentColor"
        textLength="54" lengthAdjust="spacingAndGlyphs">${serial}</text>` : `<text font-size="5.3" fill="currentColor" font-family="ui-sans-serif, system-ui, sans-serif">
      <textPath href="#cert-arc-bottom" startOffset="50%" text-anchor="middle"
        textLength="57" lengthAdjust="spacing">SCAN TO VERIFY</textPath>
    </text>`}
  </svg>`;
  node.innerHTML = ring;
  const inner = el('div', { class: 'cert-stamp-qr' });
  if (qr !== null) {
    // Built by the server and dropped in whole: a grid of rectangles, no
    // script and no external reference.
    inner.innerHTML = qr;
  }
  node.append(inner);
  return node;
}

export function certificate(facts: CertificateFacts, options: { print?: boolean } = {}): HTMLElement {
  const accuracy = facts.of === 0 ? 0 : (facts.correct / facts.of) * 100;
  // "Training callsign" for a licensed member, because the whole course is
  // training and that is the wording asked for. An issued A0
  // identifier is still called an identifier: it is not a callsign at all,
  // and putting the word on a certificate could embarrass the holder.
  const idLabel = facts.training ? 'training identifier' : 'training callsign';

  const b = (text: string): HTMLElement => el('b', { text });

  /** Value on the line, label beneath it — the way a signed form reads. */
  const field = (label: string, value: string, mono = false): HTMLElement =>
    el('div', { class: 'cert-field' },
      el('span', { class: `cert-field-value${mono ? ' mono' : ''}`, text: value }),
      el('div', { class: 'cert-rule' }),
      el('span', { class: 'cert-field-label', text: label }));

  const sheet = el('div', { class: 'cert-sheet' },
    el('div', { class: 'cert-frame' },
      el('div', { class: 'cert-head' },
        el('h2', { class: 'cert-title', text: 'Certificate' }),
        el('p', { class: 'cert-sub', text: 'of completion' })),
      el('p', { class: 'cert-lead', text: 'This is to certify that' }),
      facts.name === null
        ? el('p', { class: 'cert-name', text: facts.callsign })
        : el('p', { class: 'cert-name', text: facts.name }),
      facts.name === null
        ? null
        : el('p', { class: 'cert-under' }, `under ${idLabel} `, el('b', { class: 'mono', text: facts.callsign })),
      el('p', { class: 'cert-statement' },
        'has passed the final examination of the Koch course, copying ',
        b(`${String(facts.correct)} of ${String(facts.of)}`),
        ` characters \u2014 ${accuracy.toFixed(1)}% \u2014 at `,
        b(`${String(facts.characterWpm)} WPM`), ' character speed, ',
        b(`${String(facts.effectiveWpm)} WPM`), ' effective, with every one of the forty characters '
        + 'copied correctly at least three times out of four in a mixed stream.'),
      el('div', { class: 'cert-sign' },
        field('Date', longDate(facts.issuedAt)),
        stamp(facts.qr, facts.serial || '\u2014'),
        field('Serial', facts.serial || '\u2014', true)),
      el('p', { class: 'cert-small', text:
        'Set and marked by the Trainer server at sig.mikroutik.com, and run at cw.mikroutik.com. '
        + 'This records a practice course: it is not a licence, and it is not an examination for one.' })),
  );

  const node = el('section', { class: 'certificate' }, sheet);
  if (options.print !== false) {
    const print = el('button', { class: 'btn primary no-print', text: 'Print or save as PDF' });
    print.addEventListener('click', () => { window.print(); });
    node.append(el('div', { class: 'row no-print' }, print));
  }
  printAlone(node);
  return node;
}

/**
 * The view a scanned QR square lands on: #certificate=SERIAL.
 *
 * Deliberately thin. Anyone holding the paper can open it, with no account,
 * and it shows only what is already printed on that paper.
 */
export function certificateLookup(serial: string, fetchOne: (s: string) => Promise<PublicCertificate>): HTMLElement {
  const node = el('section', { class: 'panel' },
    el('h2', { text: 'Certificate' }),
    el('p', { class: 'hint', text: `Looking up ${serial}…` }));
  void (async () => {
    try {
      const found = await fetchOne(serial);
      clear(node);
      node.append(certificate(factsFromPublic(found), { print: false }));
    } catch {
      clear(node);
      node.append(
        el('h2', { text: 'Certificate' }),
        el('p', { class: 'notice warn', text:
          `No certificate with the serial ${serial}. It may have been mistyped, or its holder may have `
          + 'withdrawn it.' }),
      );
    }
  })();
  return node;
}
