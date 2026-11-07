// Store screenshots from the preview harness. Run with the preview server up:
//   npm run preview   (in another terminal)   then   npm run screenshots
// Writes 1280x800 PNGs (Chrome Web Store / Edge size; AMO accepts them too) and the promo tiles to store/.
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const BASE = process.env.WYS_PREVIEW_URL ?? 'http://localhost:5174';
const OUT = 'store';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

async function open(query) {
  await page.goto(`${BASE}/store.html?${query}`);
  await page.waitForSelector('#root [class]');
  await page.waitForTimeout(300);
}
async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 0, y: 0, width: 1280, height: 800 } });
  console.log(`${OUT}/${name}.png`);
}

// 1. Result card: run the canned check and wait for the verdict.
await open('scenario=home');
await page
  .getByRole('button', { name: /Check source/ })
  .first()
  .click();
await page.getByRole('heading', { name: 'Misattributed' }).waitFor({ timeout: 20_000 });
await page.getByText(/Saved/).waitFor();
await page.waitForTimeout(400);
await shot('01-result');

// 2. The chip on a highlighted quote, panel on the home view.
await open('scenario=home&chip=1');
await shot('02-chip');

// 3. Image check with provenance.
await open('scenario=image');
await page.getByText('Provenance').waitFor({ timeout: 20_000 });
await page.getByText(/Saved/).waitFor();
await page.waitForTimeout(400);
await shot('03-image');

// 4. History with the saved page open: run a text check in a fresh tab (it snapshots medium.com), then open it.
await open('scenario=home');
await page.getByRole('button', { name: /Check source/ }).first().click();
await page.getByText(/Saved with page snapshot/).waitFor({ timeout: 20_000 });
await page.getByRole('button', { name: 'History' }).click();
await page.getByRole('heading', { name: 'History' }).waitFor();
await page.locator('button.wys-card').first().click();
await page.getByRole('tab', { name: /Saved page/ }).click();
await page.waitForTimeout(800);
await shot('04-history');

// 5. Providers / settings.
await open('scenario=local');
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByText('Local or OpenAI-style model').first().waitFor();
await page.getByText('Local or OpenAI-style model').first().scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelector('#root .overflow-y-auto')?.scrollBy(0, -12));
await page.waitForTimeout(300);
await shot('05-providers');

// 6. Onboarding.
await open('scenario=fresh');
await page.getByText('Check the source of anything you read').waitFor();
await shot('06-onboarding');

// 7. Dark mode result, as a bonus screenshot.
await page.emulateMedia({ colorScheme: 'dark' });
await open('scenario=home&dark=1');
await page
  .getByRole('button', { name: /Check source/ })
  .first()
  .click();
await page.getByRole('heading', { name: 'Misattributed' }).waitFor({ timeout: 20_000 });
await page.waitForTimeout(400);
await shot('07-result-dark');
await page.emulateMedia({ colorScheme: 'light' });

// Promo tiles: logo + tagline, plain.
for (const [w, h, name] of [
  [440, 280, 'promo-440x280'],
  [1400, 560, 'promo-1400x560'],
]) {
  const tile = await browser.newPage({ viewport: { width: w, height: h } });
  const scale = w / 440;
  await tile.setContent(`<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;background:linear-gradient(135deg,#0F5FA8,#0A4A85);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff">
    <div style="display:flex;align-items:center;gap:${22 * scale}px;padding:0 ${30 * scale}px">
      <div style="width:${96 * scale}px;height:${96 * scale}px;border-radius:${22 * scale}px;background:#fff;display:flex;align-items:center;justify-content:center;flex:none">
        <svg width="${64 * scale}" height="${64 * scale}" viewBox="0 0 24 24" fill="none" stroke="#0F5FA8" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.8" cy="10.8" r="5.8"/><path d="M19.5 19.5l-4.2-4.2"/><path d="M8.4 10.9l1.7 1.7 3-3.4"/></svg>
      </div>
      <div><div style="font-size:${30 * scale}px;font-weight:700;letter-spacing:-0.01em">WhatsYourSource</div><div style="font-size:${15 * scale}px;opacity:.9;margin-top:${6 * scale}px">Is this true, and where’s the source?</div></div>
    </div></body></html>`);
  await tile.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${OUT}/${name}.png`);
  await tile.close();
}

await browser.close();
