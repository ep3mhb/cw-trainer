/**
 * Closing your own account, in a real browser, with the server stubbed.
 *
 * The server side is covered by unit tests; what only a browser can answer is
 * whether the control is reachable, whether the two guards actually stop a
 * mistaken click, what the request body looks like, and whether a success
 * really signs the member out. The API is intercepted rather than run, so no
 * PostgreSQL is needed.
 *
 * Run after a build:  node tests/e2e/delete-account.mjs
 * Needs a browser once:  npx playwright install chromium
 * Or point at an existing one:  PW_EXECUTABLE=/path/to/chrome node tests/e2e/delete-account.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', 'dist');
const PORT = Number(process.env['PORT'] ?? 4175);
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const file = join(ROOT, path === '/' ? 'index.html' : decodeURIComponent(path));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(PORT, r));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ ...(process.env['PW_EXECUTABLE'] !== undefined ? { executablePath: process.env['PW_EXECUTABLE'] } : {}) });
const page = await browser.newPage();

const MEMBER = {
  id: 7, callsign: 'G4ABC', training: false, name: 'Anna Rossi', email: 'a@example.com',
  role: 'member', profile: {}, muted: false, verified: true,
};

let deleteCalls = [];
let loggedOut = false;

await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url());
  const json = (body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname === '/api/me') return json({ member: MEMBER });
  if (url.pathname === '/api/me/contacts') return json({ contacts: [] });
  if (url.pathname === '/api/logout') { loggedOut = true; return json({}); }
  if (url.pathname === '/api/me/delete') {
    const body = route.request().postDataJSON();
    deleteCalls.push(body);
    if (body.password !== 'a-good-long-password') return json({ error: 'the password is not right' }, 403);
    return json({ deleted: true });
  }
  if (url.pathname === '/health') return json({ ok: true, version: '0.5.0', onBand: 0 });
  return json({});
});
// The band socket is not the subject here; let it fail and be retried.
await page.route('**/ws', (route) => route.abort());

await page.addInitScript(() => {
  window.localStorage.setItem('cw.session', 'a-fake-session-token');
  window.localStorage.setItem('cw.callsign', 'G4ABC');
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });

// Reach the On air tab.
await page.locator('nav.tabs >> text=On air').first().click({ timeout: 10000 });
await page.waitForTimeout(2500);

// Open "Your account".
const account = page.locator('details.account-details');
const found = await account.count();
check('the account panel is on the On air tab', found > 0);
if (found > 0) {
  await account.locator('summary').first().click();
  await page.waitForTimeout(300);
}

const closeBtn = page.locator('button', { hasText: 'Close my account' });
check('a "Close my account" button exists', (await closeBtn.count()) > 0);
check('it is drawn as destructive',
  (await closeBtn.first().getAttribute('class') ?? '').includes('destructive'));

const pwField = page.getByLabel('Password, to close your account');
const callField = page.getByLabel('Your callsign, to confirm');

// Guard 1: the callsign must be typed, and nothing is sent until it is.
await pwField.fill('a-good-long-password');
await callField.fill('G4ABD');
await closeBtn.first().click();
await page.waitForTimeout(300);
check('a wrong callsign sends nothing', deleteCalls.length === 0, `calls=${deleteCalls.length}`);
check('and says what to type', (await page.locator('text=Type G4ABC').count()) > 0);

// Guard 2: the confirm dialog. Dismiss it, and still nothing is sent.
page.once('dialog', (d) => void d.dismiss());
await callField.fill('g4abc');
await closeBtn.first().click();
await page.waitForTimeout(300);
check('a dismissed confirm sends nothing', deleteCalls.length === 0, `calls=${deleteCalls.length}`);

// The wrong password is refused by the server and surfaced in words.
page.once('dialog', (d) => void d.accept());
await pwField.fill('wrong-password-here');
await closeBtn.first().click();
await page.waitForTimeout(600);
check('a wrong password reaches the server once', deleteCalls.length === 1);
check('and its message is shown', (await page.locator('text=the password is not right').count()) > 0);
check('the member is still signed in',
  (await page.evaluate(() => window.localStorage.getItem('cw.session'))) !== null);

// The real thing.
page.once('dialog', (d) => void d.accept());
await pwField.fill('a-good-long-password');
await closeBtn.first().click();
await page.waitForTimeout(900);
check('the password is sent, and nothing else', deleteCalls.length === 2
  && JSON.stringify(Object.keys(deleteCalls[1]).sort()) === '["password"]');
check('the local session is cleared',
  (await page.evaluate(() => window.localStorage.getItem('cw.session'))) === null);
check('the stored callsign is cleared',
  (await page.evaluate(() => window.localStorage.getItem('cw.callsign'))) === null);
check('the view goes back to signing in',
  (await page.locator('details.account-details').count()) === 0);
check('no separate logout call was needed', loggedOut === false);

// The notice the control links to, as it ended up in the bundle.
const bundle = await readFile(join(ROOT, 'assets', (await readdir(join(ROOT, 'assets'))).find((f) => f.endsWith('.js'))), 'utf8');
check('the privacy link is absolute and cross-origin',
  bundle.includes('https://www.mikroutik.com/privacy.html'));
check('no same-origin /privacy.html path is left behind',
  !bundle.includes('"/privacy.html"') && !bundle.includes("'/privacy.html'"));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
