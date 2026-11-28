import { isPublicHttpUrl } from '../util/url';

/**
 * Fetch a page and reduce it to readable text for a model that can't browse.
 * Runs in the side panel (extension origin). Chromium lets the extension's pages read any site
 * because the content script matches all sites, so the browser does not enforce the user's grant:
 * the caller (the local model's tool loop) offers and runs this only when "Allow all sites" is
 * granted (hasAllUrls). Without the grant the model works from search snippets.
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
  // Hostnames compare without case and without the trailing dot ("Localhost." is the same host).
  const norm = (h: string) => h.toLowerCase().replace(/\.+$/, '');
  const host = norm(new URL(url).hostname);
  for (const b of policy.blockedHosts ?? []) {
    if (host === norm(b)) throw new FetchPolicyError('That host is one of your own endpoints and is off limits to the model.');
  }
}

export async function fetchPageText(url: string, signal?: AbortSignal, maxChars = 6000, policy: FetchPagePolicy = {}): Promise<FetchedPage> {
  assertFetchAllowed(url, policy);
  const timeout = AbortSignal.timeout(12_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  // Redirects are not followed: an extension page cannot read the Location header to vet the target,
  // and following blindly would send a request to wherever the page points (possibly inside the LAN).
  const res = await fetch(url, {
    signal: combined,
    redirect: 'manual',
    credentials: 'omit',
    headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
  });
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400))
    throw new Error('The page redirects elsewhere; search for its current address instead.');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.url && res.url !== url) assertFetchAllowed(res.url, policy);
  const type = res.headers.get('content-type') ?? '';
  const raw = await readCapped(res, MAX_BODY_BYTES);
  let title = '';
  let text: string;
  if (/html/i.test(type) || /^\s*</.test(raw)) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    title = typeof doc.title === 'string' ? doc.title.trim() : ''; // a page element named "title" shadows it
    for (const el of Array.from(doc.querySelectorAll('script, style, noscript, nav, footer, header, aside, iframe, svg, form'))) el.remove();
    const main = doc.querySelector('main, article, [role=main]') ?? doc.body;
    text = main ? readableText(main) : '';
  } else {
    text = raw.replace(/\s+/g, ' ').trim();
  }
  const truncated = text.length > maxChars;
  return { url: res.url || url, title, text: truncated ? text.slice(0, maxChars) : text, truncated };
}

const BLOCK = /^(P|DIV|LI|BR|H[1-6]|BLOCKQUOTE|PRE|TR|SECTION|ARTICLE|HEADER|FOOTER|UL|OL|TABLE|FIGCAPTION|FIGURE|DD|DT|DL|HR|MAIN|CAPTION|THEAD|TBODY|TFOOT)$/;

/**
 * Text with line breaks between blocks and " | " between table cells. `textContent` adds nothing
 * between elements, so minified markup glues words and numbers ("20181,204"). Same approach as the
 * post extractor's walker, iterative so a deeply nested page cannot overflow the stack.
 */
export function readableText(root: Node): string {
  const out: string[] = [];
  const stack: (Node | string)[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (typeof n === 'string') {
      out.push(n);
      continue;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      out.push(n.nodeValue ?? '');
      continue;
    }
    if (n.nodeType !== Node.ELEMENT_NODE && n.nodeType !== Node.DOCUMENT_NODE) continue;
    const tag = (n as Element).tagName ?? '';
    const block = BLOCK.test(tag);
    const after = block ? '\n' : tag === 'TD' || tag === 'TH' ? ' | ' : tag === 'SPAN' || tag === 'A' ? ' ' : '';
    if (after) stack.push(after);
    const kids = Array.from(n.childNodes);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    if (block) out.push('\n');
  }
  return out
    .join('')
    .split('\n')
    .map((l) =>
      l
        .replace(/\s+/g, ' ')
        .replace(/^[\s|]+|[\s|]+$/g, '')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
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
