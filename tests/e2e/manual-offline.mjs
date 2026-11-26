// The web edition of the manual must never take the application's place
// offline (RFD A59).
//
//   npm run build && npx vite preview --port 4173 &   (or any static server on dist/)
//   PREVIEW=http://localhost:4173 node tests/e2e/manual-offline.mjs
//
// The service worker stores "the page" as ./index.html and serves it for any
// route offline. A manual chapter at /manual/<lang>/… matched that rule, so a
// member who had read a chapter and then went offline was given the manual in
// place of the application. Written after it was shown: with the old worker
// this prints the Persian manual's title for "/" and exits 1.

import { chromium } from 'playwright';

const BASE = process.env.PREVIEW ?? 'http://localhost:4173';
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE });
const context = await browser.newContext();
const page = await context.newPage();
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed += 1; };

await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: 'load' });
check(await page.evaluate(() => navigator.serviceWorker.controller !== null), 'the service worker controls the page');
const appTitle = await page.title();

for (const path of ['/manual/en/chapter-2.html', '/manual/fa/', '/manual/ar/chapter-6.html']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
}
await context.setOffline(true);

await page.goto(`${BASE}/`, { waitUntil: 'load' });
check(await page.title() === appTitle, `offline, "/" is still the application (${await page.title()})`);
await page.goto(`${BASE}/manual/en/chapter-2.html`, { waitUntil: 'load' });
check((await page.title()).startsWith('Chapter 2:'), 'offline, a chapter read before opens from the cache');

await browser.close();
process.exit(failed === 0 ? 0 : 1);
