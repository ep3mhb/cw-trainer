/**
 * End-to-end smoke test against a production build.
 *
 * The unit tests cover the timing engine and the decoder; this covers the
 * things only a real browser can answer — does audio start from a gesture,
 * does IndexedDB survive a reload, does the service worker actually serve
 * the app with the network cut, does an export re-import intact.
 *
 * Run:  npm run test:e2e
 *
 * Needs a browser once:  npx playwright install chromium
 * Or point at an existing one:  PW_EXECUTABLE=/path/to/chrome npm run test:e2e
 */

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', '..', 'dist');
const PORT = Number(process.env['PORT'] ?? 4173);
const EXPORT_FILE = join(HERE, '..', '..', 'dist', '.smoke-export.json');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const file = join(DIST, path === '/' ? 'index.html' : decodeURIComponent(path));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const flat = (text) => text.replace(/\s+/g, ' ').trim();

const browser = await chromium.launch({
  ...(process.env['PW_EXECUTABLE'] !== undefined ? { executablePath: process.env['PW_EXECUTABLE'] } : {}),
  args: [
    // Let the page start audio without a real click so the test can reach
    // the parts behind the gesture requirement. The gesture itself is still
    // exercised: the test clicks the button and asserts the state changed.
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--no-sandbox',
  ],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('dialog', (d) => void d.accept());

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('nav.tabs button', { timeout: 15000 });

  // Named rather than counted: adding a tab should be a deliberate edit here,
  // and a rename should fail loudly rather than silently still counting 5.
  // :visible, not every button: since 0.7.3 the bar carries an ADMIN tab
  // that is hidden unless an administrator is signed in. innerText falls
  // back to textContent for an element that is not rendered, so a hidden
  // tab would otherwise be counted as shown.
  const TABS = ['Receive', 'Send', 'QSO', 'On air', 'Progress', 'Settings', 'Help'];
  const tabs = await page.locator('nav.tabs button:visible').allInnerTexts();
  check('app boots with the expected tabs', JSON.stringify(tabs) === JSON.stringify(TABS), tabs.join(', '));
  check('the ADMIN tab is not shown to a browser that is not signed in',
    await page.locator('nav.tabs button:has-text("ADMIN")').isHidden());
  // ...and asking for it by hash does not open it either.
  await page.goto(`http://localhost:${PORT}/#admin`, { waitUntil: 'networkidle' });
  check('#admin does not open the administrator tab without an administrator',
    !/Administration/.test(await page.locator('#panel').innerText()));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('nav.tabs button', { timeout: 15000 });
  check('no console or page errors on load', errors.length === 0, errors.join(' | '));
  check('header reports speed and course', /WPM/.test(await page.locator('.top-status').innerText()));

  // Audio must not start until a gesture, and must start after one.
  check('audio is not running before a gesture', /not started/.test(await page.locator('.top-status').innerText()));
  await page.locator('button:has-text("Enable sound")').click();
  await page.waitForTimeout(400);
  check('audio starts from a user gesture', /running/.test(await page.locator('.top-status').innerText()));

  // Receiving.
  await page.locator('button:has-text("Start session")').click();
  await page.waitForTimeout(600);
  check(
    'a drill starts and is numbered from one',
    /1 \/ 10/.test(await page.locator('.panel:has-text("Receiving") .badge').first().innerText()),
  );
  await page.locator('input[aria-label="Your copy"]').fill('KMKMK');
  await page.locator('input[aria-label="Your copy"]').press('Enter');
  await page.waitForTimeout(400);
  check('the answer is marked character by character', (await page.locator('.readout.answer').innerText()).length > 0);

  // Leaving mid-session must not discard the work.
  await page.locator('nav.tabs button:has-text("Progress")').click();
  await page.waitForTimeout(700);
  check(
    'work survives switching tabs mid-session',
    /Sessions 1/.test(flat(await page.locator('.panel').first().innerText())),
  );
  check('the confusion matrix renders', (await page.locator('.matrix').count()) > 0);

  // Practising something other than your own lesson. Leaving the tab above
  // already finalised the session, which is what frees the picker: it is
  // deliberately locked while a session is in flight.
  await page.locator('nav.tabs button:has-text("Receive")').click();
  await page.waitForTimeout(500);
  const courseLine = async () =>
    flat(await page.locator('.panel:has-text("Receiving") .hint').first().innerText());
  await page.locator('fieldset:has-text("What to practise") label:has-text("Any lesson") input').click();
  const lessonRange = page.locator('label.field:has-text("Lesson") input[type=range]').first();
  await lessonRange.fill('12');
  await lessonRange.dispatchEvent('input');
  await page.waitForTimeout(250);
  check('any lesson can be practised, not only the unlocked one', /^Lesson 12: .*\(13 characters\)/.test(await courseLine()), await courseLine());
  check('practising ahead does not claim to advance the course', /does not move your course on/.test(await courseLine()));

  await page.locator('fieldset:has-text("What to practise") label:has-text("My own set") input').click();
  const ownSet = page.locator('label.field:has-text("Characters to drill") input');
  await ownSet.fill('C Q D E 7 3 #');
  await ownSet.dispatchEvent('input');
  await page.waitForTimeout(250);
  check('a set of your own is used for the drills', /^Your own set: C Q D E 7 3 /.test(await courseLine()), await courseLine());
  check(
    'characters with no Morse are reported rather than dropped in silence',
    /No Morse for #/.test(flat(await page.locator('.panel:has(fieldset:has-text("What to practise")) .hint').first().innerText())),
  );
  await ownSet.fill('C');
  await ownSet.dispatchEvent('input');
  await page.waitForTimeout(250);
  check('a set too small to drill falls back to the course, and says so', /at least 2 characters/.test(await courseLine()), await courseLine());
  // Back to the course, so the rest of the run sees the normal state.
  await page.locator('fieldset:has-text("What to practise") label:has-text("My course lesson") input').click();
  await page.waitForTimeout(250);

  // Sending: latency panel, then key "K" on a straight key.
  await page.locator('nav.tabs button:has-text("Send")').click();
  await page.waitForTimeout(300);
  const latency = flat(await page.locator('.panel:has-text("Latency check") .row').first().innerText());
  check('the latency meter reports press-to-sidetone', /Press to sidetone/.test(latency), latency);

  await page.locator('fieldset:has-text("Key type") label:has-text("Straight key") input').click();
  await page.locator('button:has-text("Arm the key")').click();
  await page.waitForTimeout(200);
  // Deliberately NOT clicking the pad: arming focuses it, and in straight-key
  // mode a click on the pad is itself a key press, which would put a spurious
  // element in front of what we are about to send.
  // Well-separated lengths so timing jitter in a headless browser cannot flip
  // a dah into a dit: 240 against 80 leaves a wide margin either side.
  for (const holdMs of [240, 80, 240]) {
    await page.keyboard.down('BracketLeft');
    await page.waitForTimeout(holdMs);
    await page.keyboard.up('BracketLeft');
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(200);
  await page.locator('button:has-text("Analyse")').click();
  await page.waitForTimeout(300);
  const decoded = (await page.locator('.readout.answer').innerText()).trim();
  check('straight-key sending decodes to K', decoded === 'K', `decoded "${decoded}"`);
  check(
    'timing quality is reported',
    /Weighting/.test(await page.locator('.panel:has-text("What you sent") .row').innerText()),
  );

  // Touch paddle: a finger has no buttons, so the pad is split — left half
  // dit, right half dah — and each finger is its own pointer. Driven through
  // CDP so the events arrive as real touches (pointerType "touch"), which a
  // mouse click cannot imitate. Dit then dah decodes to A.
  await page.locator('button:has-text("Disarm")').click().catch(() => undefined);
  await page.locator('fieldset:has-text("Key type") label:has-text("Iambic paddle") input').click();
  await page.locator('button:has-text("Arm the key")').click();
  await page.waitForTimeout(200);
  const padBox = await page.locator('.paddle-pad').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const touch = async (fracX, holdMs) => {
    const x = padBox.x + padBox.width * fracX;
    const y = padBox.y + padBox.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(holdMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await touch(0.25, 30);
  // Well inside one character: the keyer spaces the elements itself.
  await page.waitForTimeout(70);
  await touch(0.75, 30);
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Analyse")').click();
  await page.waitForTimeout(300);
  const touched = (await page.locator('.readout.answer').innerText()).trim();
  check('touch on the left and right halves of the pad keys dit and dah', touched === 'A', `decoded "${touched}"`);
  // Back to the straight key: the robot contact below keys with one.
  await page.locator('button:has-text("Disarm")').click().catch(() => undefined);
  await page.locator('fieldset:has-text("Key type") label:has-text("Straight key") input').click();

  // Robot QSO (RFP §6): a whole contact, through the band-conditions chain.
  // Wound right up first: a full exchange at the default 18 WPM runs for the
  // best part of a minute, and this test would spend most of its life waiting.
  await page.locator('nav.tabs button:has-text("Receive")').click();
  await page.waitForTimeout(200);
  await page.locator('input[aria-label="Character speed"]').fill('40');
  await page.locator('input[aria-label="Character speed"]').dispatchEvent('input');
  await page.locator('nav.tabs button:has-text("QSO")').click();
  await page.waitForTimeout(300);
  await page.locator('select[aria-label="Band conditions"]').selectOption('poor');
  await page.locator('fieldset:has-text("Length") label:has-text("Short") input').click();
  await page.locator('button:has-text("Listen for a CQ")').click();
  await page.waitForTimeout(2500);
  const firstLine = await page.locator('.qso-line').first().innerText();
  check('the robot calls CQ', /CQ/.test(firstLine), firstLine.replace(/\s+/g, ' ').slice(0, 70));

  const box = page.locator('input[aria-label="Your transmission"]');
  /** Wait until the robot has stopped sending and it is our turn. */
  const ourTurn = async () => {
    for (let i = 0; i < 120; i += 1) {
      if (!(await box.isDisabled())) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };
  const answerQso = async (text) => {
    await box.waitFor({ state: 'visible' });
    await ourTurn();
    await box.fill(text);
    await box.press('Enter');
    await page.waitForTimeout(400);
  };

  await answerQso('DE A65XY A65XY K');
  await page.waitForTimeout(400);
  const afterAnswer = await page.locator('.panel:has-text("Work a station") .badge').allInnerTexts();
  check('answering moves the contact to the exchange',
    afterAnswer.join(' ').includes('exchanging reports'), afterAnswer.join(' | '));

  // A repeat request must replay, not advance. Wait for our turn first: the
  // buttons are deliberately disabled while the other station is sending.
  check('the controls are disabled while the robot is sending',
    await page.locator('button:has-text("Ask for a repeat")').isDisabled() || !(await box.isDisabled()));
  await ourTurn();
  const before = await page.locator('.qso-line').count();
  await page.locator('button:has-text("Ask for a repeat")').click();
  await page.waitForTimeout(700);
  const stageAfterRepeat = await page.locator('.panel:has-text("Work a station") .badge').allInnerTexts();
  check('asking for a repeat replays rather than advancing',
    stageAfterRepeat.join(' ').includes('exchanging reports') &&
      (await page.locator('.qso-line').count()) > before);
  check('the repeat is marked as one', (await page.locator('.qso-text:has-text("(repeat)")').count()) > 0);

  // Short contact: exchange, then the signoff.
  await answerQso('DE A65XY = UR RST 579 = NAME MOHAMMAD = QTH DUBAI = HW? KN');
  await answerQso('DE A65XY = TNX 73 ES CUL SK');
  await ourTurn();
  await page.waitForTimeout(600);
  const finalBadges = (await page.locator('.panel:has-text("Work a station") .badge').allInnerTexts()).join(' ');
  check('the contact completes', /contact complete/.test(finalBadges), finalBadges.slice(0, 110));
  check('completion is logged to the transcript',
    (await page.locator('.transcript .notice').count()) > 0);

  // Giving up must silence the band, not just stop the transmission.
  // The start button reads "Listen for a CQ" again once a contact has ended.
  await page.locator('.panel:has-text("Work a station") button.primary').click();
  await page.waitForTimeout(1500);
  await page.locator('button:has-text("Give up")').click();
  await page.waitForTimeout(900);
  const quiet = await page.evaluate(() => {
    // A stopped chain leaves nothing scheduled; the tell is that the QSO view
    // no longer holds a running interval driving it.
    const badges = [...document.querySelectorAll('.panel .badge')].map((b) => b.textContent ?? '');
    return badges.join(' ');
  });
  check('giving up ends the contact', /abandoned/.test(quiet), quiet.slice(0, 90));
  check('no errors after giving up', errors.length === 0, errors.join(' | '));

  // The other direction: the student calls CQ and a station answers.
  await page.locator('fieldset:has-text("Who calls") label:has-text("I call CQ") input').click();
  await page.waitForTimeout(200);
  await page.locator('.panel:has-text("Work a station") button.primary').click();
  await page.waitForTimeout(800);
  const cqBadges = async () =>
    (await page.locator('.panel:has-text("Work a station") .badge').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
  check('the band opens with nobody on it', /nobody yet/.test(await cqBadges()), await cqBadges());
  check(
    'there is nothing to repeat before anyone has transmitted',
    await page.locator('button:has-text("Ask for a repeat")').isDisabled(),
  );
  await page.locator('button:has-text("Send CQ")').click();
  await page.waitForTimeout(2500);
  await ourTurn();
  const answerLine = flat(await page.locator('.qso-line.robot').last().innerText());
  check('a station comes back to the CQ', answerLine.length > 0, answerLine.slice(0, 70));
  check(
    'the answer is a callsign and not a report',
    !/RST/.test(answerLine) && /A65XY/.test(answerLine),
    answerLine.slice(0, 70),
  );
  check('the station is named once it has been heard', !/nobody yet/.test(await cqBadges()), await cqBadges());
  await answerQso('DE A65XY = UR RST 599 = NAME MOHAMMAD = QTH DUBAI = HW? KN');
  await page.waitForTimeout(600);
  check(
    'giving a report moves the contact to the exchange',
    /exchanging reports/.test(await cqBadges()),
    await cqBadges(),
  );
  await page.locator('button:has-text("Give up")').click();
  await page.waitForTimeout(700);
  check('no errors working the contact the other way round', errors.length === 0, errors.join(' | '));

  // Keying a reply into a contact, rather than typing it. The key type is
  // already straight from the sending section above.
  await page.locator('fieldset:has-text("Who calls") label:has-text("They call CQ") input').click();
  await page.locator('fieldset:has-text("How you reply") label:has-text("On my key") input').click();
  await page.waitForTimeout(300);
  check('choosing the key shows a pad and hides the typing box',
    (await page.locator('.panel:has-text("Work a station") .paddle-pad').isVisible()) &&
    !(await page.locator('input[aria-label="Your transmission"]').isVisible()));
  await page.locator('.panel:has-text("Work a station") button.primary').click();
  for (let i = 0; i < 120; i += 1) {
    if ((await page.locator('.panel:has-text("Work a station") .paddle-pad.armed').count()) > 0) break;
    await page.waitForTimeout(500);
  }
  check('the pad arms itself when it is our turn, and not before',
    (await page.locator('.panel:has-text("Work a station") .paddle-pad.armed').count()) > 0);
  for (const holdMs of [240, 80, 240]) {
    await page.keyboard.down('BracketLeft');
    await page.waitForTimeout(holdMs);
    await page.keyboard.up('BracketLeft');
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(500);
  const keyedLive = flat(await page.locator('.panel:has-text("Work a station") .readout.answer').first().innerText());
  check('what is keyed is decoded as it is sent', keyedLive === 'K', `showed "${keyedLive}"`);
  // Stopping is how a transmission ends, the same as on the air.
  await page.waitForTimeout(3000);
  const studentLines = await page.locator('.qso-line.student').allInnerTexts();
  check('stopping sends the transmission', studentLines.some((l) => /\bK\b/.test(l)),
    flat(studentLines.join(' | ')).slice(0, 70));
  await page.waitForTimeout(1200);
  check('the keyed reply moves the contact on',
    /exchanging reports/.test(flat((await page.locator('.panel:has-text("Work a station") .badge').allInnerTexts()).join(' '))));
  await page.locator('button:has-text("Give up")').click();
  await page.waitForTimeout(600);
  await page.locator('fieldset:has-text("How you reply") label:has-text("Typing") input').click();
  check('no errors keying a contact', errors.length === 0, errors.join(' | '));

  // On air (RFP §7). No server in this test, so the tab must land on the
  // sign-in form by itself and stay quiet — no errors from a missing session.
  errors.length = 0;
  await page.locator('nav.tabs button:has-text("On air")').click();
  await page.waitForTimeout(400);
  check('the band asks for a sign-in when there is no session',
    (await page.locator('.band-view h2').first().innerText()) === 'Sign in to the band');
  check('the sign-in form has the fields a member needs',
    (await page.locator('.band-view input[type="email"]').count()) >= 1
    && (await page.locator('.band-view input[type="password"]').count()) >= 1
    && (await page.locator('.band-view button:has-text("Create account")').count()) === 1);
  check('no errors opening the band without a server', errors.length === 0, errors.join(' | '));

  // Help page (RFP §12 deliverable: "Member-facing help page").
  await page.locator('nav.tabs button:has-text("Help")').click();
  await page.waitForTimeout(300);
  check('the help page renders its sections', (await page.locator('section.panel h2').count()) >= 10);
  const tiles = await page.locator('.morse-tile').count();
  check('the Morse chart covers the whole character set', tiles >= 60, `${tiles} characters`);
  check('the glossary is populated', (await page.locator('.glossary dt').count()) >= 15);
  await page.locator('.morse-tile').first().click();
  await page.waitForTimeout(200);
  check('a chart character plays without error', errors.length === 0, errors.join(' | '));

  // Export, wipe, re-import (acceptance criterion 8).
  await page.locator('nav.tabs button:has-text("Settings")').click();
  await page.waitForTimeout(300);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('button:has-text("Export everything")').click(),
  ]);
  await download.saveAs(EXPORT_FILE);
  const envelope = JSON.parse(await readFile(EXPORT_FILE, 'utf8'));
  check(
    'the export is a versioned envelope carrying the history',
    envelope.format === 'cw-trainer-export' && envelope.version === 1 &&
      envelope.sessions.length >= 1 && envelope.attempts.length > 0,
    `sessions=${envelope.sessions.length} attempts=${envelope.attempts.length}`,
  );

  await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('cw-trainer');
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('nav.tabs button:has-text("Progress")').click();
  await page.waitForTimeout(500);
  check(
    'clearing browser storage really empties it',
    /Sessions 0/.test(flat(await page.locator('.panel').first().innerText())),
  );

  await page.locator('nav.tabs button:has-text("Settings")').click();
  await page.waitForTimeout(200);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('button:has-text("Import a file")').click();
  await (await chooser).setFiles(EXPORT_FILE);
  await page.waitForTimeout(2500);
  await page.waitForSelector('nav.tabs button');
  await page.locator('nav.tabs button:has-text("Progress")').click();
  await page.waitForTimeout(600);
  check(
    're-import restores the history intact',
    /Sessions [1-9]/.test(flat(await page.locator('.panel').first().innerText())),
  );

  // Offline (acceptance criterion 7).
  const swState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration === undefined ? 'none' : registration.active ? 'active' : 'registered';
  });
  check('the service worker registers', swState !== 'none', `state: ${swState}`);

  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await page.waitForSelector('nav.tabs button', { timeout: 10000 }).catch(() => undefined);
  check('the app loads with the network disabled', (await page.locator('nav.tabs button:visible').count()) === TABS.length);
  await page.context().setOffline(false);

  // Phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('nav.tabs button');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('no horizontal overflow at phone width', overflow <= 1, `${overflow}px`);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
