import { isPublicHttpUrl } from '../util/url';

/**
 * Fetch a page and reduce it to readable text for a model that can't browse.
 * Runs in the side panel (extension origin), so it needs a host permission for the site;
 * without one the fetch fails with a TypeError and we report that honestly.
 *
 * The URL comes from the model, and the model has read untrusted page content, so this is the one
 * place a prompt injection could reach the network. Only public http(s) hosts are allowed: no
 * loopback, private ranges, link-local or `.local` names, and never the user's own provider or
 * search endpoints.
 */
export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export class FetchPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchPolicyError';
  }
}

export interface FetchPagePolicy {
  /** Hosts the model must never read (the user's own endpoints). */
  blockedHosts?: Iterable<string>;
}

export function assertFetchAllowed(url: string, policy: FetchPagePolicy = {}): void {
  if (!isPublicHttpUrl(url)) throw new FetchPolicyError('Only public http(s) pages can be read.');
  const host = new URL(url).hostname.toLowerCase();
  for (const b of policy.blockedHosts ?? []) {
    if (host === b.toLowerCase()) throw new FetchPolicyError('That host is one of your own endpoints and is off limits to the model.');
  }
}

export async function fetchPageText(url: string, signal?: AbortSignal, maxChars = 6000, policy: FetchPagePolicy = {}): Promise<FetchedPage> {
  assertFetchAllowed(url, policy);
  const timeout = AbortSignal.timeout(12_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const res = await fetch(url, {
    signal: combined,
    redirect: 'follow',
    credentials: 'omit',
    headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // A redirect may have landed somewhere we would not have fetched directly.
  if (res.url && res.url !== url) assertFetchAllowed(res.url, policy);
  const type = res.headers.get('content-type') ?? '';
  const raw = await readCapped(res, MAX_BODY_BYTES);
  let title = '';
  let text: string;
  if (/html/i.test(type) || /^\s*</.test(raw)) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    title = doc.title.trim();
    for (const el of Array.from(doc.querySelectorAll('script, style, noscript, nav, footer, header, aside, iframe, svg, form'))) el.remove();
    const main = doc.querySelector('main, article, [role=main]') ?? doc.body;
    text = (main?.textContent ?? '').replace(/\s+/g, ' ').trim();
  } else {
    text = raw.replace(/\s+/g, ' ').trim();
  }
  const truncated = text.length > maxChars;
  return { url: res.url || url, title, text: truncated ? text.slice(0, maxChars) : text, truncated };
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let got = 0;
  try {
    while (got < max) {
      const { value, done } = await reader.read();
      if (done) break;
      got += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return out + decoder.decode();
}
