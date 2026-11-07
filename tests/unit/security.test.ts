import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertFetchAllowed, FetchPolicyError, fetchPageText } from '@/lib/search/fetchPage';
import { isPublicHttpUrl } from '@/lib/util/url';
import { buildSnapshotSrcdoc } from '@/lib/history/snapshot';

describe('isPublicHttpUrl', () => {
  it('accepts ordinary public pages', () => {
    for (const u of ['https://example.com/a', 'http://news.example.org/x?y=1', 'https://8.8.8.8/', 'https://[2606:4700::1111]/'])
      expect(isPublicHttpUrl(u), u).toBe(true);
  });
  it('rejects anything that points inside the machine or the network', () => {
    const bad = [
      'http://localhost:11434/api/tags',
      'http://127.0.0.1:8888/search',
      'http://127.1/',
      'http://0.0.0.0/',
      'http://10.0.0.5/',
      'http://172.16.9.9/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://100.64.0.1/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://router.local/',
      'http://nas.internal/',
      'http://intranet/',
      'http://2130706433/',
      'http://0x7f000001/',
      'ftp://example.com/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'http://user:pw@example.com/',
      'not a url',
    ];
    for (const u of bad) expect(isPublicHttpUrl(u), u).toBe(false);
  });
});

describe('fetch_page policy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses private hosts and the user’s own endpoints before touching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPageText('http://localhost:11434/api/tags')).rejects.toBeInstanceOf(FetchPolicyError);
    await expect(fetchPageText('https://search.example.net/search?q=x', undefined, 6000, { blockedHosts: ['search.example.net'] })).rejects.toBeInstanceOf(
      FetchPolicyError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => assertFetchAllowed('https://example.com/')).not.toThrow();
  });

  it('refuses a redirect that lands on a private host', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const r = new Response('<html><title>t</title><body>secret</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
        Object.defineProperty(r, 'url', { value: 'http://192.168.0.10/admin' });
        return r;
      }),
    );
    await expect(fetchPageText('https://example.com/go')).rejects.toBeInstanceOf(FetchPolicyError);
  });

  it('extracts readable text and caps the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const r = new Response(
          '<html><head><title>Hello</title><script>x()</script></head><body><nav>menu</nav><main><p>Body text here.</p></main></body></html>',
          {
            status: 200,
            headers: { 'content-type': 'text/html' },
          },
        );
        Object.defineProperty(r, 'url', { value: 'https://example.com/p' });
        return r;
      }),
    );
    const page = await fetchPageText('https://example.com/p', undefined, 8);
    expect(page.title).toBe('Hello');
    expect(page.text).toBe('Body tex');
    expect(page.truncated).toBe(true);
  });
});

describe('snapshot rendering hardening', () => {
  it('drops non-http link targets from stored html', () => {
    const html = buildSnapshotSrcdoc({
      html: '<p><a href="data:text/html,<script>1</script>">d</a><a href="javascript:alert(1)">j</a><a href="https://ok.example/">ok</a></p>',
      title: 'T',
      url: 'https://x.y',
      capturedAt: 0,
    });
    expect(html).not.toContain('href="data:');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://ok.example/"');
  });
});
