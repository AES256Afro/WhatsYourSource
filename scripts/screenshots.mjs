// Store screenshots: the panel itself, as it runs, and nothing else. No scene, no captions.
// Run with the preview server up:
//   npm run preview   (in another terminal)   then   npm run screenshots
// Each image is 1280x800 (the Chrome Web Store / Edge size; AMO accepts it too): three captures of
// the 400 px panel side by side on a plain background. The two promo tiles are the icon and the name.
import { mkdir, readdir, rm } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const BASE = process.env.WYS_PREVIEW_URL ?? 'http://localhost:5174';
const OUT = 'store';
const BG = '#15171a';
const PANEL = { width: 400, height: 760 };

await mkdir(OUT, { recursive: true });
// Old images go: the folder holds exactly what this run produces.
for (const f of await readdir(OUT)) if (f.endsWith('.png')) await rm(`${OUT}/${f}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 440, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark' });
const page = await context.newPage();

async function open(query) {
  await page.goto(`${BASE}/?${query}`);
  await page.addStyleTag({
    content: `body{background:${BG}} .frame{width:${PANEL.width}px;height:${PANEL.height}px;margin:0 auto;border:1px solid #2b3036;background:#111;box-sizing:border-box}`,
  });
  await page.waitForSelector('#root [class]');
  await page.waitForTimeout(300);
}
/** One capture of the panel, as a PNG buffer. */
async function panel() {
  // Keyboard focus rings are right in the product; in a still image they read as a selected box.
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.waitForTimeout(150);
  return page.locator('#frame').screenshot();
}
/** Scroll the panel so the section with this heading starts at the top. */
async function scrollTo(heading) {
  await page.evaluate((text) => {
    const h = [...document.querySelectorAll('#root h1, #root h2')].find((x) => (x.textContent ?? '').trim().toLowerCase().startsWith(text.toLowerCase()));
    h?.scrollIntoView({ block: 'start' });
  }, heading);
  await page.waitForTimeout(250);
}
const checkSource = () =>
  page
    .getByRole('button', { name: /^Check source$/ })
    .first()
    .click();
const saved = () => page.getByText(/Saved (with page snapshot|to history)/).waitFor({ timeout: 30_000 });

/** Three panels side by side, 1280x800, nothing added. */
async function compose(name, shots) {
  const gap = (1280 - 3 * PANEL.width) / 4;
  await sharp({ create: { width: 1280, height: 800, channels: 3, background: BG } })
    .composite(shots.map((input, i) => ({ input, left: Math.round(gap + i * (PANEL.width + gap)), top: (800 - PANEL.height) / 2 })))
    .png()
    .toFile(`${OUT}/${name}.png`);
  console.log(`${OUT}/${name}.png`);
}

// 1. A fact-check: the home screen, the result, its claims and sources.
await open('scenario=home');
const home = await panel();
await checkSource();
await saved();
const result = await panel();
await scrollTo('Claims found');
const claims = await panel();
await compose('01-fact-check', [home, result, claims]);

// 2. A timeline: picked on the home screen, while it runs, the answer.
await open('scenario=home');
await page.getByRole('radio', { name: 'Timeline' }).click();
const pickTimeline = await panel();
await checkSource();
await page.getByText('Searched').first().waitFor({ timeout: 20_000 });
const checking = await panel();
await saved();
const timeline = await panel();
await compose('02-timeline', [pickTimeline, checking, timeline]);

// 3. Your own question, its answer, and the history of what was asked.
await open('scenario=home');
await page.getByRole('radio', { name: 'Ask your own' }).click();
await page.locator('#root textarea').fill('Who first said this, and how did it come to be credited to Einstein?');
await page.waitForTimeout(500);
const pickOwn = await panel();
await checkSource();
await saved();
const own = await panel();
await page.getByRole('button', { name: 'History' }).click();
await page.getByRole('heading', { name: 'History' }).waitFor();
await page.waitForTimeout(400);
const history = await panel();
await compose('03-your-question', [pickOwn, own, history]);

// 4. An image check, what was read from the file on the device, and a saved page.
await open('scenario=image');
await page.getByText('Provenance').first().waitFor({ timeout: 30_000 });
await saved();
const image = await panel();
await scrollTo('Provenance');
const provenance = await panel();
await page.getByRole('button', { name: 'History' }).click();
await page.getByRole('heading', { name: 'History' }).waitFor();
await page.locator('button.wys-card').nth(1).click();
await page.getByRole('tab', { name: /Saved page/ }).click();
await page.waitForTimeout(900);
const savedPage = await panel();
await compose('04-image-and-saved-page', [image, provenance, savedPage]);

// 5. Settings: the ways to check, the default question, and the first-run screen.
await open('scenario=local');
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByText('How checks are done').waitFor();
await page.waitForTimeout(300);
const providers = await panel();
await scrollTo('Question');
const question = await panel();
await open('scenario=fresh');
await page.getByText('Check the source of anything you read').waitFor();
const firstRun = await panel();
await compose('05-settings', [providers, question, firstRun]);

// Promo tiles: the icon and the name on the same plain background.
for (const [w, h, name] of [
  [440, 280, 'promo-440x280'],
  [1400, 560, 'promo-1400x560'],
]) {
  const tile = await browser.newPage({ viewport: { width: w, height: h } });
  const scale = w / 440;
  await tile.setContent(`<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;background:${BG};display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff">
    <div style="display:flex;align-items:center;gap:${18 * scale}px">
      <svg width="${56 * scale}" height="${56 * scale}" viewBox="0 0 24 24" fill="none" stroke="#8FC1F2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.8" cy="10.8" r="5.8"/><path d="M19.5 19.5l-4.2-4.2"/><path d="M8.4 10.9l1.7 1.7 3-3.4"/></svg>
      <div style="font-size:${30 * scale}px;font-weight:700;letter-spacing:-0.01em">WhatsYourSource</div>
    </div></body></html>`);
  await tile.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${OUT}/${name}.png`);
  await tile.close();
}

await browser.close();
