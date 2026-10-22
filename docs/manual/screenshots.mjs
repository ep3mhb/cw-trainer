// Screenshots for the user manual: every tab, desktop and phone, at 2x.
import { chromium } from 'playwright';
import fs from 'node:fs';
// Decoding the exam's own timing stream back into characters is how the
// server's test proves the stream is honest (server/tests/exam.test.ts). The
// same trick is the only way a harness can sit the exam: the characters are
// never sent, by design, so there is nothing else to read.
//
// It is bundled rather than imported directly. `decoder.ts` imports `./morse`
// and `./timing` without file extensions, which Vite and Vitest resolve and
// plain Node ESM does not — so `import ... from '../../src/core/decoder.ts'`
// fails with ERR_MODULE_NOT_FOUND no matter what flags are passed.
import { execFileSync } from 'node:child_process';
import os from 'node:os';
const DECODER = `${os.tmpdir()}/cw-decoder-${process.pid}.mjs`;
execFileSync(new URL('../../server/node_modules/.bin/esbuild', import.meta.url).pathname, [
  new URL('../../src/core/decoder.ts', import.meta.url).pathname,
  '--bundle', '--format=esm', '--platform=node', `--outfile=${DECODER}`, '--log-level=error',
]);
const { decode } = await import(DECODER);
const SIG = 'http://localhost:8080', APP = 'http://localhost:4173/';
const OUT = new URL('./shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

async function register(body) {
  const r = await fetch(`${SIG}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`register ${r.status}: ${await r.text()}`);
  return r.json();
}
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const letters = [...stamp].map((c) => String.fromCharCode(65 + (parseInt(c, 36) % 26))).join('').slice(0, 3);
const a = await register({ name: 'Anna Test', email: `anna-${stamp}@example.com`, password: 'a-good-long-password', callsign: `G4${letters}` });
const b = await register({ name: 'Bo Student', email: `bo-${stamp}@example.com`, password: 'a-good-long-password' });
// admin (T3ST) may already exist from an earlier run
let admin = null;
try { admin = await register({ name: 'Test Admin', email: 'admin-test@example.com', password: 'admin-test-password-1', callsign: 'T3ST' }); } catch {
  const l = await fetch(`${SIG}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin-test@example.com', password: 'admin-test-password-1' }) });
  admin = await l.json();
}

// A fourth account, deleted straight away, so the administration figure shows
// what 0.7.3 does with deleted placeholders: counted apart from the members
// and folded away under the list.
const gone = await register({ name: 'Former Member', email: `gone-${stamp}@example.com`, password: 'a-good-long-password', callsign: `M0${letters}` });
await fetch(`${SIG}/api/admin/members/${gone.member.id}/delete`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` },
  body: JSON.stringify({ reason: 'left the group' }),
});

// The two WebRTC flags matter. Chrome replaces host ICE candidates with mDNS
// .local names, which nothing resolves when both browsers are on one machine
// with no mDNS responder, so a contact sits on "connecting" for ever. The
// signalling server must also run with ICE_POLICY=all; its default is relay,
// and there is no TURN server in front of a local stack.
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE, args: [
  '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  '--disable-features=WebRtcHideLocalIpsWithMdns', '--force-webrtc-ip-handling-policy=default',
] });
const DESK = { width: 1180, height: 860 }, PHONE = { width: 390, height: 844 };

async function open(viewport, token, hash = '') {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: 'dark' });
  await context.addInitScript(([sig, tok]) => { localStorage.setItem('cw.sigOrigin', sig); if (tok) localStorage.setItem('cw.session', tok); }, [SIG, token]);
  const page = await context.newPage();
  await page.goto(`${APP}${hash}`);
  /*
   * RFD A38. Every context here is a fresh browser with no practice
   * history, which is exactly who the welcome page is for — so it is what
   * opens, the header is hidden with the rest of the furniture, and
   * "Enable sound" is not on the page at all. Before 0.10.0 this line was
   * the first thing every run did and it broke the whole set.
   *
   * Dismissed by its own primary action rather than by poking at the
   * flag, so this fails loudly if the action ever stops working.
   */
  // Wait for the application to have decided what it is showing. Checking
  // for the welcome page the instant goto() returns is a race: the page has
  // loaded but boot() has not finished, so the locator finds nothing and the
  // click below then lands on a header that is about to be hidden. Cost two
  // runs of the whole set before it was obvious (17 October 2026).
  await page.waitForFunction(
    () => document.querySelector('.landing-key') !== null
      || document.querySelector('nav.tabs button') !== null,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(400);
  const start = page.locator('.landing-key');
  if (await start.count() > 0) {
    await start.click();
    await page.waitForTimeout(400);
  }
  await page.locator('button:has-text("Enable sound")').click();
  await page.waitForTimeout(400);
  return page;
}

/*
 * The welcome page itself, before anything dismisses it (A38). Taken from
 * its own context so no earlier shot has left a history behind, and after
 * a pause so the band scope has drawn something worth looking at.
 */
{
  const context = await browser.newContext({ viewport: DESK, deviceScaleFactor: 2, colorScheme: 'dark' });
  await context.addInitScript((sig) => { localStorage.setItem('cw.sigOrigin', sig); }, SIG);
  const page = await context.newPage();
  await page.goto(APP);
  await page.waitForSelector('.landing-wordmark');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/landing.png`, fullPage: true });
  await context.close();
}
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
const part = (page, sel, name) => page.locator(sel).first().screenshot({ path: `${OUT}/${name}.png` });

// ---- Practice tabs, signed out, desktop
const d = await open(DESK, null);
await shot(d, 'home-receive', { fullPage: false });
await part(d, 'header', 'header-plate');
await part(d, 'nav.tabs', 'tabs');
// Receive: start a session so the drill UI shows
await d.locator('button:has-text("Start session")').click();
await d.waitForTimeout(2500);
await d.locator('input[aria-label*="copied"], input[placeholder*="copied"], .copy-input input, input').first().fill('KM').catch(() => undefined);
await d.keyboard.press('Enter').catch(() => undefined);
await d.waitForTimeout(600);
await shot(d, 'receive-session');
await d.locator('button:has-text("End session")').click().catch(() => undefined);
// Send
await d.locator('nav.tabs button:has-text("Send")').click(); await d.waitForTimeout(400);
await d.locator('button:has-text("Arm the key")').click().catch(() => undefined);
await d.locator('.paddle-pad').focus().catch(() => undefined);
for (let i = 0; i < 3; i++) for (const k of ['[', ']', '[', '[', ']']) { await d.keyboard.down(k); await d.waitForTimeout(45); await d.keyboard.up(k); await d.waitForTimeout(140); }
await d.waitForTimeout(500);
await d.locator('button:has-text("Analyse")').click().catch(() => undefined);
await d.waitForTimeout(600);
await shot(d, 'send-report', { fullPage: true });
// QSO
await d.locator('nav.tabs button:has-text("QSO")').click(); await d.waitForTimeout(400);
await shot(d, 'qso-start');
await d.locator('button:has-text("Listen for a CQ")').click().catch(() => undefined);
await d.waitForTimeout(6000);
await shot(d, 'qso-listening');
await d.locator('button:has-text("Give up")').click().catch(() => undefined);
// Progress
await d.locator('nav.tabs button:has-text("Progress")').click(); await d.waitForTimeout(400);
await shot(d, 'progress', { fullPage: true });
// Settings
await d.locator('nav.tabs button:has-text("Settings")').click(); await d.waitForTimeout(400);
await shot(d, 'settings', { fullPage: true });
// Help
await d.locator('nav.tabs button:has-text("Help")').click(); await d.waitForTimeout(400);
await shot(d, 'help');
// On air signed out
await d.locator('nav.tabs button:has-text("On air")').click(); await d.waitForTimeout(600);
await shot(d, 'air-signin');
await d.context().close();

// ---- On air, two members in contact
async function member(token, viewport) {
  const page = await open(viewport, token, '#air');
  await page.locator('.band-view h2:has-text("On the air")').waitFor({ timeout: 10_000 });
  await page.locator('.band-view .badge:has-text("Band") b:has-text("on the band")').waitFor({ timeout: 10_000 });
  return page;
}
const A = await member(a.token, DESK);
const B = await member(b.token, PHONE);
await A.waitForTimeout(600);
await shot(A, 'air-idle');
await part(A, '.vfo', 'vfo');
await part(A, '.knob', 'knob');
await A.locator('button:has-text("Find a clear spot")').click();
await A.locator('button:has-text("Call CQ here")').click();
await A.waitForTimeout(500);
await B.locator('button:has-text("◂ Next")').click(); await B.locator('button:has-text("Next ▸")').click().catch(() => undefined);
await B.locator(`.station-row:has-text("${a.member.callsign}")`).waitFor({ timeout: 8000 });
await B.waitForTimeout(300);
await shot(B, 'air-phone-heard', { fullPage: true });
await B.locator('.station-row button:has-text("Answer")').click();
await A.locator('.badge:has-text("Contact") b:has-text("connected")').waitFor({ timeout: 20_000 });
await B.locator('.badge:has-text("Contact") b:has-text("connected")').waitFor({ timeout: 20_000 });
await A.locator('.paddle-pad').focus();
const key = async (page, seq, reps) => {
  for (let i = 0; i < reps; i++) {
    for (const k of seq) { await page.keyboard.down(k); await page.waitForTimeout(40); await page.keyboard.up(k); await page.waitForTimeout(150); }
    await page.waitForTimeout(350);
  }
};
await key(A, ['[', ']', '[', '['], 7);
await A.waitForTimeout(80);
await shot(A, 'air-contact', { fullPage: true });
await part(A, '.band-scope', 'scope');
await part(A, '.band-view .panel:has(h3:has-text("Heard")), .heard', 'heard').catch(() => undefined);
await shot(B, 'air-phone-contact', { fullPage: true });
await part(B, '.paddle-pad', 'touch-pad').catch(() => undefined);
// hold: B waits, then keys
await B.waitForTimeout(2800);
await B.locator('.paddle-pad').focus();
await key(B, ['[', '['], 3);
await A.waitForTimeout(100);
await part(A, '.paddle-pad', 'pad-their-over').catch(() => undefined);
await A.waitForTimeout(3000);
await A.locator('button:has-text("End contact")').click();
await A.waitForTimeout(800);
await shot(A, 'air-after', { fullPage: true });
/*
 * RFD A43: the account moved to Settings, so its figure is taken there.
 * It used to be a fold-out at the foot of this tab, opened by clicking a
 * summary element that no longer exists.
 */
await A.locator('nav.tabs button:has-text("Settings")').click();
await A.waitForTimeout(600);
await part(A, '.panel:has(h2:has-text("Your account"))', 'account').catch(() => undefined);
await A.locator('nav.tabs button:has-text("On air")').click();
await A.waitForTimeout(400);
await part(A, '.log-panel, .panel:has(h3:has-text("Your log"))', 'log').catch(() => undefined);
await A.context().close(); await B.context().close();

// ---- Admin
// Since 0.7.3 administration is a tab of its own, shown only once an
// administrator is signed in: sign in on On air first so the shell adds the
// tab, then switch to it.
const M = await member(admin.token, DESK);
await M.locator('nav.tabs button:has-text("ADMIN")').waitFor({ timeout: 10_000 });
await M.locator('nav.tabs button:has-text("ADMIN")').click();
await M.locator('.admin-panel .admin-row').first().waitFor({ timeout: 10_000 });
await M.locator('.admin-deleted > summary').click().catch(() => undefined);
await M.waitForTimeout(400);
await part(M, '.admin-panel', 'admin');
await M.context().close();

// ---- Phone: Send tab touch paddle
const P = await open(PHONE, null, '#send');
await P.locator('button:has-text("Arm the key")').click().catch(() => undefined);
await P.waitForTimeout(300);
await shot(P, 'send-phone', { fullPage: false });
await P.context().close();

// ---- The certificate (Chapter 4, figure 6)
//
// Driven through the API rather than the interface: the final exam is only
// offered after a 90% session at lesson 40, and nothing in the page exposes
// what is being sent. So Anna sits it the only way a script can — by decoding
// the timing the server sent her — and the browser is then used for what it
// is actually needed for, which is a picture of the real sheet.
let certSerial = null;
try {
  const started = await (await fetch(`${SIG}/api/exam/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.token}` },
    body: JSON.stringify({ characterWpm: 20, effectiveWpm: 12 }),
  })).json();
  const typed = [];
  for (const group of started.groups) {
    const transitions = [];
    for (const tone of group.tones) {
      transitions.push({ down: true, t: tone.atMs });
      transitions.push({ down: false, t: tone.atMs + tone.durationMs });
    }
    for (const c of decode(transitions, { tolerance: 0.3, referenceWpm: 20 }).text.replace(/\s+/g, '')) typed.push(c);
  }
  const result = await (await fetch(`${SIG}/api/exam/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.token}` },
    body: JSON.stringify({ examId: started.examId, typed }),
  })).json();
  if (!result.pass) throw new Error(`the decoder did not pass the exam: ${result.correct}/${typed.length}`);
  certSerial = result.serial ?? null;

  const c = await open(DESK, a.token);
  // A43: certificates live under Your account, which is on Settings now.
  await c.locator('nav.tabs button:has-text("Settings")').click();
  await c.waitForTimeout(800);
  await c.locator('button:has-text("View and print")').first().click();
  await c.waitForTimeout(600);
  await part(c, '.certificate', 'certificate-sheet');
  await c.close();
} catch (error) {
  // Loud, not silent: a missing figure must not be discovered in the PDF.
  console.error('certificate figure FAILED:', error.message);
  process.exitCode = 1;
}

await browser.close();
console.log(fs.readdirSync(OUT).join(' '));
