/**
 * Fetch a page and reduce it to readable text for a model that can't browse.
 * Runs in the side panel (extension origin), so it needs a host permission for the site;
 * without one the fetch fails with a TypeError and we report that honestly.
 */
export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

export async function fetchPageText(url: string, signal?: AbortSignal, maxChars = 6000): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  signal?.addEventListener('abort', () => controller.abort());
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    let title = '';
    let text: string;
    if (/html/i.test(type) || /^\s*</.test(raw)) {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      title = doc.title?.trim() ?? '';
      for (const el of Array.from(doc.querySelectorAll('script, style, noscript, nav, footer, header, aside, iframe, svg, form'))) el.remove();
      const main = doc.querySelector('main, article, [role=main]') ?? doc.body;
      text = (main?.textContent ?? '').replace(/\s+/g, ' ').trim();
    } else {
      text = raw.replace(/\s+/g, ' ').trim();
    }
    const truncated = text.length > maxChars;
    return { url, title, text: truncated ? text.slice(0, maxChars) : text, truncated };
  } finally {
    clearTimeout(timer);
  }
}
