import { afterEach, describe, expect, it, vi } from 'vitest';
import { archiveLookupUrl, originalSourceCapture, startLookups } from '@/lib/lookups';
import { buildIndex, lookup, pickEntry, rateDomains, type CredibilityEntry } from '@/lib/lookups/credibility';
import { factCheckQuery } from '@/lib/lookups/factcheck';
import { assertFetchAllowed, fetchPageText } from '@/lib/search/fetchPage';
import { normalizeUrl } from '@/lib/util/url';
import type { Settings } from '@/lib/storage/settings';

afterEach(() => vi.unstubAllGlobals());

describe('S3-02: the Wayback lookup sends scheme, host and path only', () => {
  it('strips the fragment and tracking parameters, and sends nothing when the query identifies the page', () => {
    expect(archiveLookupUrl('https://news.example/a/b?utm_source=x&fbclid=y#reset-token')).toBe('https://news.example/a/b');
    expect(archiveLookupUrl('https://mail.example/inbox#thread-123')).toBe('https://mail.example/inbox');
    expect(archiveLookupUrl('https://docs.example/d?share=SECRET')).toBeUndefined();
    expect(archiveLookupUrl('http://192.168.1.2/x')).toBeUndefined();
  });
  it('is what the page and original-source lookups request', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        asked.push(decodeURIComponent(u));
        return new Response('[["timestamp"],["20190304120000"]]', { headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const settings = { lookups: { archive: true, factChecks: false, factCheckKey: '', credibility: false } } as unknown as Settings;
    const signal = new AbortController().signal;
    await startLookups({ kind: 'page', url: 'https://news.example/story?utm_medium=s#c-9', title: 't' }, settings, signal).all;
    await originalSourceCapture('https://orig.example/doc?utm_campaign=z#p2', settings, signal);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain('url=https://news.example/story&');
    expect(asked[1]).toContain('url=https://orig.example/doc&');
    for (const a of asked) expect(a).not.toMatch(/utm_|#/);
  });
});

describe('B8-01 / B2-06: fact-check query', () => {
  it('does not end the sentence at an abbreviation', () => {
    expect(factCheckQuery('According to the U.S. Census Bureau, crime fell by 31% in 2019. Other text follows here.')).toBe(
      'According to the U.S. Census Bureau, crime fell by 31% in 2019.',
    );
    expect(factCheckQuery('In Sept. 2020 the Univ. of Oxford and the F.D.A. said the vaccine works. More.')).toBe(
      'In Sept. 2020 the Univ. of Oxford and the F.D.A. said the vaccine works.',
    );
    expect(factCheckQuery('Dr. J. Smith said the moon is made of cheese. He was joking.')).toBe('Dr. J. Smith said the moon is made of cheese.');
  });
  it('cuts text without spaces by characters, without splitting an emoji', () => {
    const cjk = '据报道该市犯罪率在二零一九年下降了百分之三十一'.repeat(30);
    const q = factCheckQuery(cjk);
    expect(q.length).toBeLessThanOrEqual(200);
    expect(() => encodeURIComponent(factCheckQuery('😀'.repeat(150)))).not.toThrow();
    expect(factCheckQuery('该市犯罪率在二零一九年下降了百分之三十一，市长说。另一句话在这里。')).toBe('该市犯罪率在二零一九年下降了百分之三十一，市长说。');
  });
});

describe('C10-01 / C10-02 / B8-03: credibility keys and tie-breaks (real dataset)', () => {
  it('matches path-scoped keys on their host, most specific first', async () => {
    const r = await rateDomains([
      'https://www.rollingstone.com/politics/politics-news/some-story-123/',
      'https://www.forbes.com/advisor/banking/best-savings/',
      'https://www.dw.com/en/some-story/a-1',
      'https://www.astronautix.com/s/saturnv.html',
    ]);
    expect(r['rollingstone.com']?.status).toBe('unreliable');
    expect(r['forbes.com']?.status).toBe('unreliable');
    expect(r['dw.com']?.name).toBe('Deutsche Welle');
    expect(r['astronautix.com']?.name).toBe('Encyclopedia Astronautica');
    const music = await rateDomains(['https://www.rollingstone.com/music/music-news/x']);
    expect(music['rollingstone.com']?.name).toBe('Rolling Stone');
    expect(music['rollingstone.com']?.status).toBe('reliable');
  });
  it('prefers the current period, says other periods exist, and never depends on file order', async () => {
    const data = (await import('@/data/reliable-sources.json')).default as { entries: CredibilityEntry[] };
    const fwd = buildIndex(data.entries);
    const rev = buildIndex([...data.entries].reverse());
    for (const host of ['freebeacon.com', 'cnet.com', 'forbes.com', 'foxnews.com', 'geonames.usgs.gov', 'rollingstone.com']) {
      expect(lookup(rev, host), host).toEqual(lookup(fwd, host));
    }
    expect(lookup(fwd, 'freebeacon.com')?.name).toMatch(/2019-present/);
    expect(lookup(fwd, 'freebeacon.com')?.status).toBe('reliable');
    const cnet = lookup(fwd, 'https://www.cnet.com/reviews/x/');
    expect(cnet?.name).toMatch(/present/);
    expect(cnet?.summary).toMatch(/pre-October 2020/);
    expect(lookup(fwd, 'forbes.com')?.name).toBe('Forbes');
    expect(lookup(fwd, 'foxnews.com')?.name).toBe('Fox News');
    expect(lookup(fwd, 'geonames.usgs.gov')?.status).toBe('mixed');
  });
  it('pickEntry is order-independent for a tie', () => {
    const a: CredibilityEntry = { name: 'A part', status: 'reliable', domains: ['x.com'], summary: '' };
    const b: CredibilityEntry = { name: 'B part', status: 'unreliable', domains: ['x.com'], summary: '' };
    expect(pickEntry([a, b])).toEqual(pickEntry([b, a]));
    expect(pickEntry([a, b])?.status).toBe('mixed');
  });
});

describe('C4-02 / P5B4-04: normalizeUrl', () => {
  it('encodes the query the same whether or not a tracker was removed', () => {
    expect(normalizeUrl('https://a.example/p?q=a%20b&utm_source=x')).toBe(normalizeUrl('https://a.example/p?q=a%20b'));
    expect(normalizeUrl('https://a.example/p?q=a:b&ref=x')).toBe(normalizeUrl('https://a.example/p?q=a:b'));
  });
  it('is idempotent and leaves the query alone', () => {
    for (const u of [
      'http://a.example//',
      'http://www.www.e.example/x',
      'http://e.example../p/',
      'https://example.com/?next=/',
      'https://x.example/p/?utm_source=1',
    ])
      expect(normalizeUrl(normalizeUrl(u)), u).toBe(normalizeUrl(u));
    expect(normalizeUrl('https://example.com/?next=/')).not.toBe(normalizeUrl('https://example.com/?next='));
  });
});

describe('S4-02: own-endpoint block', () => {
  it('compares hosts without case or trailing dot', () => {
    expect(() => assertFetchAllowed('https://search.example.com./x', { blockedHosts: ['Search.Example.com'] })).toThrow(/own endpoints/);
    expect(() => assertFetchAllowed('https://SEARCH.example.com/x', { blockedHosts: ['search.example.com.'] })).toThrow(/own endpoints/);
  });
});

describe('P5C8-05: fetch_page keeps blocks and cells apart', () => {
  it('breaks between blocks and separates table cells', async () => {
    const html =
      '<html><head><title>Crime</title></head><body><main><h1>Crime in 2019</h1><p>Figures below.</p><table><tr><th>Year</th><th>Offences</th></tr><tr><td>2018</td><td>1,204</td></tr><tr><td>2019</td><td>831</td></tr></table><ul><li>Burglary down</li><li>Assault up</li></ul>Line one<br>Line two</main></body></html>';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html, { headers: { 'Content-Type': 'text/html' } })),
    );
    const page = await fetchPageText('https://stats.example/crime');
    expect(page.text).toContain('2018 | 1,204');
    expect(page.text).toContain('2019 | 831');
    expect(page.text).not.toMatch(/20181,204|2019Figures|downAssault|oneLine/);
    expect(page.text.split('\n')).toContain('Crime in 2019');
  });
});
