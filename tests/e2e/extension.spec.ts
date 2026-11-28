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

test.beforeEach(async ({ context, sw, extensionId }) => {
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
  // Settings as 1.3.0 and older stored them (storage.local, the key inside `settings`), so every test
  // also runs the migration into the settings database. The worker has already started (and found
  // nothing to migrate), so the database is put back to its state before the update first.
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
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('wys-settings');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(String(req.error)));
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete('settings');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(String(tx.error)));
    });
    db.close();
  });
  // The first extension page to load the settings migrates them.
  const opener = await context.newPage();
  await opener.goto(`chrome-extension://${extensionId}/options.html`);
  await expect
    .poll(() =>
      sw.evaluate(async () => {
        const all = await chrome.storage.local.get(null);
        return 'public' in all && !('settings' in all);
      }),
    )
    .toBe(true);
  await opener.close();
});

test('after the migration storage.local holds no key, no settings and no secrets', async ({ context, sw, extensionId }) => {
  const all = await sw.evaluate(async () => chrome.storage.local.get(null));
  expect(all).not.toHaveProperty('settings');
  expect(all).not.toHaveProperty('secrets');
  expect(JSON.stringify(all)).not.toContain('test-key');
  // The key is in the settings database, and an extension page still has it.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/options.html`);
  const key = await panel.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('wys-settings');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(String(req.error)));
    });
    const settings = await new Promise<any>((resolve, reject) => {
      const req = db.transaction('kv').objectStore('kv').get('settings');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(String(req.error)));
    });
    db.close();
    return settings?.providers?.gemini?.apiKey as string | undefined;
  });
  expect(key).toBe('test-key');
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

  // Nothing of ours stays in the page once the chip is dismissed: a later select-all or copy must
  // never be able to pick up an element the extension added.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-wys="chip"]')).toHaveCount(0);

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

// ---- Selection trust: the page must not choose what the chip sends, nor hide or kill the chip. ----

/** Drag-select the start of the paragraph the way a user would. */
async function selectWithMouse(page: import('@playwright/test').Page): Promise<void> {
  const box = (await page.locator('#p').boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 6, { steps: 6 });
  await page.mouse.up();
}

/** The chip lives in a closed shadow root; find it by hit-testing for its host. */
async function chipPoint(page: import('@playwright/test').Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-wys="chip"]');
    if (!host) return null;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = 0; y < innerHeight; y += 3)
      for (let x = 0; x < innerWidth; x += 3)
        if (document.elementFromPoint(x, y) === host) {
          xs.push(x);
          ys.push(y);
        }
    if (!xs.length) return null;
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  });
}

async function waitForChip(page: import('@playwright/test').Page): Promise<{ x: number; y: number }> {
  await expect.poll(() => chipPoint(page), { timeout: 5_000 }).not.toBeNull();
  await page.waitForTimeout(300); // past IntersectionObserver v2's 100 ms visibility delay
  return (await chipPoint(page))!;
}

/** Record every check the chip sends, as the background receives it. */
async function recordChipMessages(sw: Worker): Promise<() => Promise<{ type: string; input: { text: string } }[]>> {
  await sw.evaluate(() => {
    const g = globalThis as unknown as { __chip: unknown[] };
    g.__chip = [];
    chrome.runtime.onMessage.addListener((m: { type?: string }) => {
      if (m?.type === 'wys:check' || m?.type === 'wys:open-webmode') g.__chip.push(m);
    });
  });
  return () => sw.evaluate(() => (globalThis as unknown as { __chip: { type: string; input: { text: string } }[] }).__chip);
}

async function addPageChoice(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const s = document.createElement('span');
    s.id = 'pick';
    s.textContent = 'PAGE-CHOSEN: the bridge passed every inspection.';
    s.style.cssText = 'position:absolute;left:-9999px;top:0';
    document.body.append(s);
  });
}

test('a real click on the chip sends the selection the user made', async ({ context, sw }) => {
  const seen = await recordChipMessages(sw);
  const page = await context.newPage();
  await page.goto('http://example.test/article');
  await selectWithMouse(page);
  const at = await waitForChip(page);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await seen()).length).toBe(1);
  expect((await seen())[0]!.input.text).toContain('As Einstein put it');
});

test('a selection the page swaps in as the chip is pressed is not sent', async ({ context, sw }) => {
  const seen = await recordChipMessages(sw);
  const page = await context.newPage();
  await page.goto('http://example.test/article');
  await addPageChoice(page);
  await page.evaluate(() => {
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (!(e.target instanceof Element) || e.target.getAttribute('data-wys') !== 'chip') return;
        const r = document.createRange();
        r.selectNodeContents(document.getElementById('pick')!);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
      },
      true,
    );
  });
  await selectWithMouse(page);
  const at = await waitForChip(page);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(1_000);
  expect(await seen()).toHaveLength(0);
});

test('a selection the page swaps in while the chip is up takes the chip away', async ({ context, sw }) => {
  const seen = await recordChipMessages(sw);
  const page = await context.newPage();
  await page.goto('http://example.test/article');
  await addPageChoice(page);
  await selectWithMouse(page);
  const at = await waitForChip(page);
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('pick')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  });
  await expect.poll(() => chipPoint(page)).toBeNull();
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(800);
  expect(await seen()).toHaveLength(0);
});

test('a chip the page has faded from the root element sends nothing', async ({ context, sw }) => {
  const seen = await recordChipMessages(sw);
  const page = await context.newPage();
  await page.goto('http://example.test/article');
  await selectWithMouse(page);
  const at = await waitForChip(page);
  // The host is untouched; the root element it hangs from makes it all but invisible.
  await page.evaluate(() => document.documentElement.style.setProperty('filter', 'opacity(0.02)'));
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(1_000);
  expect(await seen()).toHaveLength(0);
});

test('a chip the page has moved sends nothing', async ({ context, sw }) => {
  const seen = await recordChipMessages(sw);
  const page = await context.newPage();
  await page.goto('http://example.test/article');
  await selectWithMouse(page);
  const at = await waitForChip(page);
  // Moved somewhere the user will click for another reason.
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-wys="chip"]')!.style.setProperty('translate', '0 200px', 'important'));
  await page.waitForTimeout(300);
  await page.mouse.click(at.x, at.y + 200);
  await page.waitForTimeout(1_000);
  expect(await seen()).toHaveLength(0);
});

test('a chip the page covers with a click-through overlay sends nothing', async ({ context, sw }) => {
  const seen = await recordChipMessages(sw);
  const page = await context.newPage();
  await page.goto('http://example.test/article');
  await selectWithMouse(page);
  const at = await waitForChip(page);
  // A top-layer popover paints above any z-index and lets the click fall through to the chip.
  await page.evaluate(({ x, y }) => {
    const d = document.createElement('div');
    d.popover = 'manual';
    d.textContent = 'Close';
    d.style.cssText = `margin:0;position:fixed;left:${x - 120}px;top:${y - 40}px;width:240px;height:80px;background:#fff;pointer-events:none;border:0`;
    document.body.append(d);
    d.showPopover();
  }, at);
  await page.waitForTimeout(400);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(1_000);
  expect(await seen()).toHaveLength(0);
});

test("a forged 'newer script started' event does not switch the chip off", async ({ context, sw, extensionId }) => {
  const seen = await recordChipMessages(sw);
  const page = await context.newPage();
  await page.goto('http://example.test/article');
  await page.evaluate((id) => {
    document.dispatchEvent(new CustomEvent(`${id}:content:wxt:content-script-started`, { detail: { contentScriptName: 'content', messageId: 'forged' } }));
  }, extensionId);
  await selectWithMouse(page);
  const at = await waitForChip(page);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await seen()).length).toBe(1);
});
