import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { hasHostAccess } from '@/lib/permissions';
import { fetchImageBytes, ImageFetchError, imageDownloadGranted } from '@/lib/image/bytes';
import { NO_PAGE_ACCESS_REPLY, OpenAICompatProvider } from '@/lib/providers/openaiCompat';
import { collectCheck } from '@/lib/pipeline/runCheck';

// Chromium lets the extension's pages read any site because the content script matches <all_urls>,
// so downloads of pages and image files are gated on the user's grant in code (P5S7-01).

const json = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': 'application/json' } });
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 10, 0, 0, 0, 10, 8, 6, 0, 0, 0]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A stand-in for permissions.contains: true when every asked origin is in the granted set. */
const fakeContains = (granted: Set<string>) => (p: { origins?: string[] }) => Promise.resolve((p.origins ?? []).every((o) => granted.has(o)));

describe('hasHostAccess', () => {
  it('is true for a granted site or all sites, false otherwise and on errors', async () => {
    const granted = new Set(['https://ok.example/*']);
    // The browser's contains() answers by the granted set (it never counts content-script matches).
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- the typings list the callback overload; the API returns a promise
    const contains = vi.spyOn(browser.permissions, 'contains').mockImplementation(fakeContains(granted));
    expect(await hasHostAccess('https://ok.example/a/b.png')).toBe(true);
    expect(await hasHostAccess('https://other.example/x')).toBe(false);
    granted.add('<all_urls>');
    expect(await hasHostAccess('https://other.example/x')).toBe(true);
    expect(await hasHostAccess('data:image/png;base64,AA')).toBe(false);
    contains.mockRejectedValue(new Error('boom'));
    expect(await hasHostAccess('https://ok.example/a')).toBe(false);
  });
});

describe('image downloads need a grant', () => {
  it('allows the page’s own host and local-on-local without asking, a third-party host only when granted', async () => {
    const no = vi.fn(async () => false);
    expect(await imageDownloadGranted('https://site.example/i.png', 'https://Site.example./page', no)).toBe(true);
    expect(await imageDownloadGranted('http://127.0.0.1:5173/i.png', 'http://localhost:5173/', no)).toBe(true);
    expect(no).not.toHaveBeenCalled();
    expect(await imageDownloadGranted('https://cdn.example/i.png', 'https://site.example/', no)).toBe(false);
    expect(await imageDownloadGranted('https://cdn.example/i.png', 'https://site.example/', async () => true)).toBe(true);
  });

  it('makes no request to an ungranted image host and names the host', async () => {
    const fetchMock = vi.fn(async () => new Response(png, { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    // The default gate asks the browser; the test browser has nothing granted (contains throws → no access).
    const err = await fetchImageBytes('https://cdn.example/i.png', undefined, 'https://site.example/').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageFetchError);
    expect((err as ImageFetchError).kind).toBe('permission');
    expect((err as ImageFetchError).noAccessHost).toBe('cdn.example');
    expect(fetchMock).not.toHaveBeenCalled();
    // The page's own host is fetched.
    expect((await fetchImageBytes('https://site.example/i.png', undefined, 'https://site.example/')).via).toBe('fetch');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetch_page needs "Allow all sites"', () => {
  const search = { id: 'searxng' as const, label: 'Fake', search: async () => [{ title: 'Hit', url: 'https://hit.example/p', snippet: 'snip' }] };
  const run = async (pageAccess?: () => Promise<boolean>) => {
    const bodies: { tools: { function: { name: string } }[]; messages: { role: string; content: string }[] }[] = [];
    const pages: string[] = [];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (!url.includes('/chat/completions')) {
          pages.push(url);
          return new Response('<title>t</title><main>page</main>', { headers: { 'content-type': 'text/html' } });
        }
        bodies.push(JSON.parse(String(init.body)));
        call++;
        if (call === 1)
          return json({
            choices: [
              { message: { content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'web_search', arguments: '{"query":"q"}' } }] } },
            ],
          });
        if (call === 2)
          return json({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [{ id: 'b', type: 'function', function: { name: 'fetch_page', arguments: '{"url":"https://hit.example/p"}' } }],
                },
              },
            ],
          });
        return json({ choices: [{ message: { content: 'done' } }] });
      }),
    );
    const p = new OpenAICompatProvider({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'm', search, ...(pageAccess ? { pageAccess } : {}) });
    await collectCheck({ kind: 'text', text: 'claim', pageUrl: 'https://origin.example/a', pageTitle: 't' }, p);
    return { bodies, pages };
  };

  it('without the grant: offers web_search only, never mentions reading pages, refuses a call, fetches nothing', async () => {
    const { bodies, pages } = await run(); // the default asks the browser, which has nothing granted
    expect(bodies[0]!.tools.map((t) => t.function.name)).toEqual(['web_search']);
    expect(bodies[0]!.messages[0]!.content).not.toMatch(/fetch_page|read the most promising/);
    expect(bodies[2]!.messages.filter((m) => m.role === 'tool').pop()!.content).toBe(NO_PAGE_ACCESS_REPLY);
    expect(pages).toEqual([]);
  });

  it('with the grant: offers fetch_page and reads the search result', async () => {
    const { bodies, pages } = await run(async () => true);
    expect(bodies[0]!.tools.map((t) => t.function.name)).toEqual(['web_search', 'fetch_page']);
    expect(pages).toEqual(['https://hit.example/p']);
  });
});
