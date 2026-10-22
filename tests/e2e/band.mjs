/**
 * Two browsers on the band (RFP §7), against a real signalling server.
 *
 * Not part of the smoke test: it needs the server running with PostgreSQL,
 * and it opens two browser contexts that find each other through it. Run:
 *
 *   SIG_ORIGIN=http://localhost:8080 APP_URL=http://localhost:4173/ node tests/e2e/band.mjs
 *
 * with the server started as ICE_POLICY=all APP_ORIGIN=http://localhost:4173
 * (relay-only needs a TURN server, which a laptop does not have).
 *
 * First run, 20 September 2026: 10/10 — two headless Chromiums registered,
 * one called CQ, the other scanned to it and answered, the data channel came
 * up both ways, the contact was logged for both marked not exportable (one
 * side a training identifier), and ending it closed the row.
 */
import { chromium } from 'playwright';

const SIG = process.env.SIG_ORIGIN ?? 'http://localhost:8080';
const APP = process.env.APP_URL ?? 'http://localhost:4173/';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function register(body) {
  const r = await fetch(`${SIG}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`register ${r.status}: ${await r.text()}`);
  return r.json();
}
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
// Three letters for the suffix: a callsign suffix has no digits.
const letters = [...stamp].map((c) => String.fromCharCode(65 + (parseInt(c, 36) % 26))).join('').slice(0, 3);
const a = await register({ name: 'Anna Test', email: `anna-${stamp}@example.com`, password: 'a-good-long-password', callsign: `G4${letters}` });
const b = await register({ name: 'Bo Student', email: `bo-${stamp}@example.com`, password: 'a-good-long-password' });
console.log(`members: ${a.member.callsign} and ${b.member.callsign}`);
check('a claimed callsign registers unconfirmed; a training identifier confirmed', a.member.verified === false && b.member.verified === true);

// The administrator (§8): the server's ADMIN_CALLSIGN (start it with
// ADMIN_CALLSIGN=T3ST for this test). Registered once; signed in after.
const ADMIN = process.env.ADMIN_CALLSIGN ?? 'T3ST';
const ADMIN_PW = 'admin-test-password-1';
async function adminSession() {
  const r = await fetch(`${SIG}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Test Admin', email: 'admin-test@example.com', password: ADMIN_PW, callsign: ADMIN }) });
  if (r.ok) return r.json();
  const l = await fetch(`${SIG}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin-test@example.com', password: ADMIN_PW }) });
  if (!l.ok) throw new Error(`admin login ${l.status}: ${await l.text()}`);
  return l.json();
}
const admin = await adminSession();
check('the configured administrator is confirmed and has the role', admin.member.role === 'admin' && admin.member.verified === true, JSON.stringify(admin.member.role));

const browser = await chromium.launch({
  ...(process.env['PW_EXECUTABLE'] ? { executablePath: process.env['PW_EXECUTABLE'] } : {}),
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

async function member(token) {
  const context = await browser.newContext();
  await context.addInitScript(([sig, tok]) => {
    localStorage.setItem('cw.sigOrigin', sig);
    localStorage.setItem('cw.session', tok);
  }, [SIG, token]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${APP}#air`);
  await page.locator('button:has-text("Enable sound")').click();
  await page.locator('.band-view h2:has-text("On the air")').waitFor({ timeout: 10_000 });
  await page.locator('.band-view .badge:has-text("Band") b:has-text("on the band")').waitFor({ timeout: 10_000 });
  return { page, errors };
}

const A = await member(a.token);
const B = await member(b.token);
check('both members reach the band', true);
check("A's own status says the callsign is unconfirmed", /unconfirmed/.test(await A.page.locator('.badge:has-text("You")').innerText()));
check('a member sees no administration panel', (await B.page.locator('.admin-panel').count()) === 0);

// The admin confirms A's callsign from the page (§8's first action).
const ADM = await member(admin.token);
ADM.page.on('dialog', (d) => void d.accept('checked in the callbook'));
await ADM.page.locator('.admin-panel').waitFor({ timeout: 10_000 });
const adminRow = ADM.page.locator(`.admin-row:has-text("${a.member.callsign}")`);
await adminRow.waitFor({ timeout: 10_000 });
check('the administrator sees the unconfirmed callsign flagged', /unconfirmed/.test(await adminRow.innerText()));
await adminRow.locator('button:has-text("Confirm callsign")').click();
await ADM.page.locator(`.admin-row:has-text("${a.member.callsign}"):has-text("Withdraw confirmation")`).waitFor({ timeout: 10_000 });
const confirmed = await (await fetch(`${SIG}/api/me`, { headers: { authorization: `Bearer ${a.token}` } })).json();
check('confirming from the page marks the callsign confirmed', confirmed.member.verified === true);
await ADM.page.close();

await A.page.locator('button:has-text("Find a clear spot")').click();
await A.page.locator('button:has-text("Call CQ here")').click();
await A.page.locator('button:has-text("Calling CQ here")').waitFor({ timeout: 5000 });
const dial = await A.page.locator('.dial-readout').innerText();
check('A is calling CQ', true, dial);

await B.page.locator('button:has-text("◂ Next")').click().catch(() => undefined);
await B.page.locator('button:has-text("Next ▸")').click().catch(() => undefined);
await B.page.locator(`.station-row:has-text("${a.member.callsign}")`).waitFor({ timeout: 8000 });
const row = await B.page.locator(`.station-row:has-text("${a.member.callsign}")`).innerText();
check('B finds A on the band with the CQ marked', /CQ/.test(row), row.replace(/\s+/g, ' ').slice(0, 120));
check('A is labelled as licensed, not training', !/training/.test(row));
check("A's confirmation shows on the band without a sign-out", !/unconfirmed/.test(row), row.replace(/\s+/g, ' ').slice(0, 60));
check("A's profile shows under the callsign (§8)", /Anna Test/.test(row), row.replace(/\s+/g, ' ').slice(0, 90));

// The band scope (§7: a tuning interface, not a list). A's bar is labelled
// with A's callsign and marked CQ; a drag across the scope tunes the dial.
const labels = await B.page.locator('.band-scope .band-mark-label').allInnerTexts();
check('the band scope names the station calling', labels.some((l) => l.startsWith(a.member.callsign)), labels.join(' / '));
check('and marks it as calling CQ', (await B.page.locator('.band-scope .band-mark-label.cq').count()) > 0);
const before = await B.page.locator('.dial-readout').innerText();
const scopeBox = await B.page.locator('.band-scope').boundingBox();
await B.page.mouse.move(scopeBox.x + scopeBox.width * 0.9, scopeBox.y + scopeBox.height / 2);
await B.page.mouse.down();
await B.page.mouse.move(scopeBox.x + scopeBox.width * 0.95, scopeBox.y + scopeBox.height / 2, { steps: 4 });
await B.page.mouse.up();
const after = await B.page.locator('.dial-readout').innerText();
check('dragging across the scope tunes the dial', after !== before && /7 03[6-9]/.test(after), `${before} → ${after}`);
await B.page.locator('.band-scope .band-mark:not(.me)').first().click();
check('pressing a station on the scope lands on it', (await B.page.locator('.dial-readout').innerText()) === dial);

await B.page.locator('.station-row button:has-text("Answer")').click();
await A.page.locator('.badge:has-text("Contact") b:has-text("connected")').waitFor({ timeout: 20_000 });
await B.page.locator('.badge:has-text("Contact") b:has-text("connected")').waitFor({ timeout: 20_000 });
check('the data channel connects both ways', true);
check("B's dial moved onto A", (await B.page.locator('.dial-readout').innerText()) === dial);

// Listen on B's loudspeaker. The test HEARS from here on: a change that reads
// as correct and goes out silent (0.4.2, 21 September 2026) is exactly what a
// pitch-number check cannot catch.
await B.page.evaluate(() => { window.__meter = window.__cwAudio.tap(); });
const loudness = async (page, ms) => page.evaluate(async (ms) => {
  let peak = 0;
  const until = performance.now() + ms;
  while (performance.now() < until) {
    peak = Math.max(peak, window.__meter());
    await new Promise((r) => setTimeout(r, 15));
  }
  return peak;
}, ms);
const quiet = await loudness(B.page, 300);
check('B\'s speaker is quiet before A keys', quiet < 0.02, `peak ${quiet.toFixed(4)}`);

// The band-conditions engine under live stations (§7: the §6 engine "as a
// toggle"). Poor conditions put a noise floor under the band with nobody
// keying; quiet takes it away again.
await B.page.locator('select[aria-label="Band conditions"]').selectOption('poor');
await B.page.waitForTimeout(300);
const noisy = await loudness(B.page, 400);
// A filtered noise floor is small next to a keyed tone (the meter is RMS of
// the whole output); what matters is that it is there, several times the
// silence, and well under the station.
check('poor band conditions put a noise floor under the band', noisy > Math.max(0.003, quiet * 4) && noisy < 0.1, `peak ${noisy.toFixed(4)} against ${quiet.toFixed(4)}`);
await B.page.locator('select[aria-label="Band conditions"]').selectOption('quiet');
await B.page.waitForTimeout(400);
const hushed = await loudness(B.page, 300);
check('quiet conditions take the noise back down', hushed < noisy / 3, `peak ${hushed.toFixed(4)}`);

// A keys a few dits. B, on frequency, should be playing them at her own
// sidetone pitch (600 Hz) and the link line should show nothing dropped.
async function dits(page, n) {
  await page.locator('.paddle-pad').focus();
  for (let i = 0; i < n; i += 1) {
    await page.keyboard.down('[');
    await page.waitForTimeout(90);
    await page.keyboard.up('[');
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(700);
}
const heardPromise = loudness(B.page, 1400);
await dits(A.page, 4);
const heard = await heardPromise;
check('B actually HEARS A keying (speaker level rises)', heard > 0.05, `peak ${heard.toFixed(4)}`);
const linkOn = await B.page.locator(`.station-row:has-text("${a.member.callsign}") .link-line`).innerText();
check('B hears A on frequency at her own pitch', /playing at 600 Hz/.test(linkOn), linkOn);
check('nothing late, dropped or missing on frequency', !/late|dropped|missing/.test(linkOn), linkOn);

// The member's report of 21 September 2026: tune a little off and the tone
// should MOVE, not turn into clicks. B tunes 200 Hz low; A should now sound
// 200 Hz high, and every transition should still arrive.
await B.page.locator('button:has-text("−100")').click();
await B.page.locator('button:has-text("−100")').click();
const heardOffPromise = loudness(B.page, 1400);
await dits(A.page, 4);
const heardOff = await heardOffPromise;
check('B still hears A after tuning (the cross-fade did not silence it)', heardOff > 0.05, `peak ${heardOff.toFixed(4)}`);

// Over to over (§7): while A is sending, B's key is held and the pad says
// so; once A has been quiet for the hold, it is free again.
const heldDuring = await B.page.locator('.paddle-pad.held').count();
const padTitle = await B.page.locator('.paddle-pad .pad-title').innerText();
check("B's key is held during and just after A's over", heldDuring === 1 && /Their over/.test(padTitle), padTitle);
check("B's status lamps whose over it is", /their over/.test(await B.page.locator('.turn-lamp').innerText()));
await B.page.locator('.paddle-pad:not(.held)').waitFor({ timeout: 6000 });
check("the hold lifts once A has been quiet", true, await B.page.locator('.turn-lamp').innerText());
const linkOff = await B.page.locator(`.station-row:has-text("${a.member.callsign}") .link-line`).innerText();
check('tuning 200 Hz low moves A to 800 Hz', /playing at 800 Hz/.test(linkOff), linkOff);
check('nothing dropped or missing after tuning', !/dropped|missing/.test(linkOff), linkOff);
const received = Number(/(\d+) received/.exec(linkOff)?.[1] ?? 0);
check('every transition arrived exactly once (8 dits = 16 transitions)', received === 16, `${received} received`);

// A report from inside the contact carries what B heard A send, decoded.
B.page.on('dialog', (d) => void d.accept('test report from the browser test'));
await B.page.locator('.station-row button:has-text("Report")').click();
await B.page.waitForTimeout(600);
const reports = await (await fetch(`${SIG}/api/admin/reports`, { headers: { authorization: `Bearer ${admin.token}` } })).json();
const mine = reports.reports.find((r) => r.reason === 'test report from the browser test' && r.byCallsign === b.member.callsign);
check('a report reaches the administrators with a transcript of what was heard', mine !== undefined && mine.transcript.length > 0,
  mine ? `"${mine.transcript.slice(0, 40)}"` : 'no report');

check('no errors during the contact', A.errors.length === 0 && B.errors.length === 0, [...A.errors, ...B.errors].join(' | '));

const log = await (await fetch(`${SIG}/api/me/contacts`, { headers: { authorization: `Bearer ${a.token}` } })).json();
check('the contact is logged for both', log.contacts.length === 1
  && log.contacts[0].aCallsign === a.member.callsign && log.contacts[0].bCallsign === b.member.callsign,
  JSON.stringify(log.contacts[0]));
check('a contact with a training identifier is not exportable', log.contacts[0]?.exportable === false);

await A.page.locator('button:has-text("End contact")').click();
await A.page.waitForTimeout(800);
const ended = await (await fetch(`${SIG}/api/me/contacts`, { headers: { authorization: `Bearer ${b.token}` } })).json();
check('ending the contact closes the log entry', ended.contacts[0]?.endedAt !== null);

// The log panel (§7: both sides get the contact; ADIF export). A's panel
// lists the contact with B marked training, and refuses to export it.
await A.page.waitForTimeout(1500);
const logRow = await A.page.locator('.log-row').first().innerText().catch(() => '');
check("the contact appears in A's log panel", logRow.includes(b.member.callsign) && /training/.test(logRow), logRow.replace(/\s+/g, ' '));
check('the export button is disabled when nothing may be exported',
  await A.page.locator('button:has-text("Export ADIF")').isDisabled());

// The exchange written into the log (§7): RST as sent on CW, stored as digits.
const rstSent = A.page.locator('.log-row').first().locator('input.rst').first();
await rstSent.fill('5nn');
await rstSent.press('Enter');
await A.page.locator('.log-row').first().locator('.log-status:has-text("saved")').waitFor({ timeout: 5000 });
check('RST typed as 5NN is saved and shown as 599', (await rstSent.inputValue()) === '599');
const noted = await (await fetch(`${SIG}/api/me/contacts`, { headers: { authorization: `Bearer ${a.token}` } })).json();
check('the report is in the log on the server', noted.contacts[0]?.rstSent === '599');

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
