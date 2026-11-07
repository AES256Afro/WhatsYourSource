import { browser } from 'wxt/browser';
import { SnapshotPayloadSchema } from '../messaging/protocol';
import { getTargetTab } from '../tabs';
import { normalizeUrl } from '../util/url';
import type { SnapshotInput, StoredSnapshot } from './db';

/**
 * Ask the page's content script for a sanitized copy of its main content, and try for a
 * visible-area screenshot. Both are best-effort: a restricted page, or one loaded before the
 * extension was installed, simply yields no snapshot.
 */
export async function captureFromTab(tabId: number | undefined, highlight?: string, expectedUrl?: string): Promise<SnapshotInput | null> {
  // Pasted text has no page; and a re-check or a popup-triggered check must never snapshot whatever
  // tab happens to be active (it could be the user's bank). Only the page that was checked.
  if (!expectedUrl || !/^https?:/i.test(expectedUrl)) return null;
  let id = tabId;
  let windowId: number | undefined;
  try {
    if (id == null) {
      const t = await getTargetTab();
      id = t?.id;
      windowId = t?.windowId;
    } else {
      windowId = (await browser.tabs.get(id)).windowId;
    }
  } catch {
    return null;
  }
  if (id == null) return null;

  let payload;
  try {
    const reply: unknown = await browser.tabs.sendMessage(id, { type: 'wys:capture-snapshot', highlight });
    const parsed = SnapshotPayloadSchema.safeParse(reply);
    if (!parsed.success) return null;
    if (normalizeUrl(parsed.data.url) !== normalizeUrl(expectedUrl)) return null;
    payload = parsed.data;
  } catch {
    return null;
  }

  let screenshot: Blob | undefined;
  try {
    if (windowId != null) {
      const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 });
      if (dataUrl) screenshot = await (await fetch(dataUrl)).blob();
    }
  } catch {
    /* no activeTab grant for this tab, or the tab isn't visible — fine */
  }

  return { url: payload.url, title: payload.title, html: payload.html, capturedAt: payload.capturedAt, highlight, screenshot };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Mark the element that contains the checked text. Picks the smallest element whose text contains
 * the first ~80 characters of the highlight, so a paragraph lights up rather than the whole article.
 */
export function markHighlight(doc: Document, highlight: string): boolean {
  const full = norm(highlight);
  if (full.length < 3) return false;
  for (const len of [80, 40, 20]) {
    const needle = full.slice(0, len);
    let best: Element | null = null;
    let bestLen = Infinity;
    const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const el = node as Element;
      const text = norm(el.textContent ?? '');
      if (text.length < bestLen && text.includes(needle)) {
        best = el;
        bestLen = text.length;
      }
      node = walker.nextNode();
    }
    if (best) {
      best.setAttribute('data-wys-mark', '');
      best.setAttribute('id', 'wys-highlight');
      return true;
    }
  }
  return false;
}

export interface SrcdocOptions {
  loadImages?: boolean;
}

/** Build the document shown in the sandboxed "Saved page" frame. No scripts, no network unless images are allowed. */
export function buildSnapshotSrcdoc(snapshot: Pick<StoredSnapshot, 'html' | 'title' | 'url' | 'capturedAt' | 'highlight'>, opts: SrcdocOptions = {}): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${snapshot.html}</body></html>`, 'text/html');
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    // The content script already sanitized; this is the second line in case an old snapshot predates it.
    if (!/^\s*https?:/i.test(a.getAttribute('href') ?? '')) {
      a.removeAttribute('href');
      continue;
    }
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  for (const el of Array.from(doc.querySelectorAll('script, style, iframe, object, embed, link, meta'))) el.remove();
  if (snapshot.highlight) markHighlight(doc, snapshot.highlight);
  const body = doc.body.innerHTML;
  const imgSrc = opts.loadImages ? 'data: https: http:' : 'data:';
  const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
  const captured = new Date(snapshot.capturedAt).toLocaleString();
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escapeHtml(snapshot.title)}</title><style>
body{margin:0;padding:16px 18px 32px;font:14px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#15181C;background:#fff;word-wrap:break-word}
img{max-width:100%;height:auto}
${opts.loadImages ? '' : 'img{display:inline-block;min-width:40px;min-height:24px;background:#F3F4F6;border:1px dashed #D6DAE0;color:#6B7280;font-size:11px}'}
h1,h2,h3{line-height:1.25}
pre{white-space:pre-wrap}
table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #E3E6EA;padding:4px 6px}
[data-wys-mark]{background:#FDE68A;box-shadow:0 0 0 4px #FDE68A;border-radius:3px}
.wys-head{font-size:11px;color:#4B5563;border-bottom:1px solid #E3E6EA;padding-bottom:8px;margin-bottom:14px}
.wys-head a{color:#0F5FA8}
</style></head><body><div class="wys-head">Snapshot of <a href="${escapeAttr(snapshot.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(snapshot.url)}</a> · captured ${escapeHtml(captured)} · read-only</div>${body}</body></html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
