/*
 * Figure 5 — the exam offer panel.
 *
 * The panel only appears after a session that genuinely meets the >=90% over
 * >=50 characters rule, and nothing in the page exposes what is being sent:
 * `currentAnswer` is a closure variable, by design. So the drill content is
 * made reproducible instead of readable. `systemRandom()` seeds mulberry32
 * from Math.random(), so pinning Math.random in the page makes every session
 * generate the identical drill. One throwaway session reads the text off the
 * marked-copy line; a second, real session is then answered correctly and
 * earns the offer. What is photographed is a true qualifying session.
 */
import { chromium } from 'playwright';
const APP = 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const context = await browser.newContext({ viewport: { width: 1180, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await context.addInitScript(() => { Math.random = () => 0.42; });
const page = await context.newPage();
await page.goto(APP);
// RFD A38: a browser with no history opens on the welcome page, so the
// header — and "Enable sound" with it — is not on the page yet.
await page.waitForFunction(
  () => document.querySelector('.landing-key') !== null
    || document.querySelector('nav.tabs button') !== null,
  { timeout: 15_000 },
);
await page.waitForTimeout(400);
const landingStart = page.locator('.landing-key');
if (await landingStart.count() > 0) { await landingStart.click(); await page.waitForTimeout(400); }
await page.locator('button:has-text("Enable sound")').click();
await page.waitForTimeout(300);

const answerBox = page.locator('input, textarea').filter({ hasNot: page.locator('[type=range]') }).first();
const drillText = async () => (await page.locator('.feedback div, [hidden=false] div').nth(1).innerText().catch(() => '')).replace(/\s+/g, '');

// 1. throwaway session: submit nothing, read what was sent
await page.locator('button:has-text("Start session")').click();
await page.waitForTimeout(3500);
await answerBox.fill('');
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
const marked = await page.locator('div:has(> span.hit), div:has(> span.miss)').first().innerText();
const text = marked.replace(/\s+/g, '');
console.log('drill text learned:', JSON.stringify(text));
await page.locator('button:has-text("End session")').click().catch(() => undefined);
await page.waitForTimeout(500);

// 2. the real session, answered correctly
await page.locator('button:has-text("Start session")').click();
for (let i = 0; i < 10; i += 1) {
  await page.waitForTimeout(3200);
  await answerBox.fill(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const offer = await page.locator('.offer').count();
  if (offer > 0) break;
}
await page.locator('.offer').waitFor({ timeout: 20000 });
await page.waitForTimeout(400);
await page.locator('.offer').screenshot({ path: new URL('./shots/exam-offer.png', import.meta.url).pathname });
console.log('exam-offer.png captured');
await browser.close();
