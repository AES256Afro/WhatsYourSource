import path from 'node:path';
import { chromium, expect, test as base, type BrowserContext, type Worker } from '@playwright/test';

/**
 * Loads .output/chrome-mv3 into Chromium and exercises the real wiring:
 * content script on a page, background ↔ content messaging, the job handoff through
 * storage.session, and the side panel running a (mocked) Gemini check end to end.
 */
const EXT_PATH = path.resolve('.output/chrome-mv3');

// Code inside sw.evaluate() runs in the extension's service worker, where `chrome` exists.

declare const chrome: any;

const ANSWER = `Quote Investigator traced it to 1981.

\`\`\`json
{"verdict":{"label":"Misattributed","kind":"misattributed","confidence":"high","summary":"Not Einstein."},
 "claims":[{"text":"Einstein said it","status":"disputed","note":"no record","sourceUrls":["https://quoteinvestigator.com/2017/03/23/same/"]}],
 "sources":[{"title":"QI article","url":"https://quoteinvestigator.com/2017/03/23/same/","date":"2017"}]}
\`\`\``;

function sse(chunks: unknown[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('');
}

const test = base.extend<{ context: BrowserContext; sw: Worker; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    // Playwright's own Chromium needs the VC++ runtime on Windows; fall back to an installed browser.
    const channels = process.env.WYS_E2E_CHANNEL ? [process.env.WYS_E2E_CHANNEL] : ['chromium', 'msedge', 'chrome'];
    let context: BrowserContext | null = null;
    let lastErr: unknown;
    for (const channel of channels) {
      try {
        context = await chromium.launchPersistentContext('', {
          channel,
          headless: true,
          args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
        });
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!context) throw lastErr;
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ sw }, use) => {
    await use(new URL(sw.url()).host);
  },
});

test.beforeEach(async ({ context, sw }) => {
  // A page the content script is allowed to run on.
  await context.route('http://example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>Why we keep repeating ourselves</title></head><body>
        <article><p id="p">As Einstein put it, "the definition of insanity is doing the same thing over and over again and expecting different results."</p></article>
      </body></html>`,
    }),
  );
  // Mocked Gemini.
  await context.route('https://generativelanguage.googleapis.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        {
          candidates: [
            {
              content: { parts: [{ text: ANSWER }] },
              groundingMetadata: {
                webSearchQueries: ['einstein insanity quote origin'],
                groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/1', title: 'quoteinvestigator.com' } }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        },
      ]),
    }),
  );
  await sw.evaluate(async () => {
    await chrome.storage.local.set({
      settings: {
        version: 1,
        onboarded: true,
        defaultProvider: 'gemini',
        providers: { gemini: { apiKey: 'test-key', model: 'gemini-3.8-flash', grounding: true, urlContext: true } },
        privacy: { snapshots: true, chip: true, disabledSites: [] },
      },
    });
  });
});

test('content script leaves the page alone until a real selection, then shows the chip and answers selection queries', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.goto('http://example.test/article');
  // Nothing is added to the DOM on load; the chip host appears on the first user-made selection.
  await expect(page.locator('[data-wys="chip"]')).toHaveCount(0);
  await page.mouse.move(10, 10);
  await page.mouse.down();
  await page.mouse.move(300, 60, { steps: 4 });
  await page.mouse.up();
  await page.locator('#p').dblclick();
  await expect(page.locator('[data-wys="chip"]')).toHaveCount(1);

  await page.evaluate(() => {
    // Select only the quote, so the surrounding paragraph is distinct from the selection.
    const textNode = document.getElementById('p')!.firstChild as Text;
    const start = textNode.data.indexOf('the definition');
    const r = document.createRange();
    r.setStart(textNode, start);
    r.setEnd(textNode, textNode.data.length - 1);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  });
  // No `tabs` permission, so URL filters don't work; the article page is the active tab.
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]!.id!);
  const reply = await sw.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'wys:get-selection' }), tabId);
  expect(reply).toMatchObject({ pageUrl: 'http://example.test/article', pageTitle: 'Why we keep repeating ourselves' });
  expect((reply as { text: string }).text).toContain('definition of insanity');
  expect((reply as { surrounding?: string }).surrounding ?? '').toContain('As Einstein put it');
});

test('a queued job runs in the side panel and lands in history', async ({ context, sw, extensionId }) => {
  const page = await context.newPage();
  await page.goto('http://example.test/article');
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]!.id!);

  await sw.evaluate(
    async ({ tabId }) => {
      await chrome.storage.session.set({
        pendingJob: {
          id: 'e2e-1',
          createdAt: Date.now(),
          tabId,
          input: {
            kind: 'text',
            text: 'the definition of insanity is doing the same thing over and over again',
            pageUrl: 'http://example.test/article',
            pageTitle: 'Why we keep repeating ourselves',
          },
        },
      });
    },
    { tabId },
  );

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByText('Misattributed', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText('QI article')).toBeVisible();
  await expect(panel.getByText(/Saved/)).toBeVisible();

  await panel.getByRole('button', { name: 'History' }).click();
  await expect(panel.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(panel.getByText('the definition of insanity', { exact: false }).first()).toBeVisible();
});

test('the popup offers both modes for the current selection', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto('http://example.test/article');
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('p')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('button', { name: /Check in side panel/ })).toBeEnabled();
  await expect(popup.getByRole('button', { name: /Open in Google AI Mode/ })).toBeEnabled();
});
