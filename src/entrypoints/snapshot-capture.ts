import { defineUnlistedScript } from '#imports';
import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { LIMITS } from '@/lib/messaging/limits';
import type { SnapshotPayload } from '@/lib/messaging/protocol';

/**
 * Injected into the checked tab by the side panel (`scripting.executeScript`) when a check runs, and
 * only then: this is where Readability and DOMPurify live, so the always-on content script stays
 * small. The return value of `main` is what `executeScript` hands back.
 */
export default defineUnlistedScript((): SnapshotPayload => captureSnapshot());

/**
 * Readability clones and scores every node synchronously; on a very long page (endless feeds,
 * chat logs) that can block the tab for seconds. Past this size the page copy is skipped and the
 * check is saved without one, rather than freezing the page the user is reading.
 */
const MAX_ELEMENTS = 25_000;
/** A huge log or text file is one <pre>: few elements, megabytes of text. */
const MAX_TEXT = 3_000_000;
/** `document.title` can be shadowed by a page element named "title". */
const docTitle = (): string => (typeof document.title === 'string' ? document.title : '');

function captureSnapshot(): SnapshotPayload {
  const base = { url: location.href.slice(0, LIMITS.url), title: docTitle().slice(0, LIMITS.title), capturedAt: Date.now() };
  if (document.getElementsByTagName('*').length > MAX_ELEMENTS || (document.body?.textContent?.length ?? 0) > MAX_TEXT)
    return { ...base, html: '', textLength: 0 };
  const clone = document.cloneNode(true) as Document;
  let article: ReturnType<Readability['parse']> = null;
  try {
    article = new Readability(clone, { keepClasses: false }).parse();
  } catch {
    article = null;
  }
  const rawHtml = article?.content ?? (document.querySelector('main, article') ?? document.body).innerHTML;
  // `data:` is allowed so inline images survive, but never as a link target.
  const dropDataLinks = (node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
    if (data.attrName === 'href' && /^\s*data:/i.test(data.attrValue)) data.keepAttr = false;
  };
  DOMPurify.addHook('uponSanitizeAttribute', dropDataLinks);
  let html: string;
  try {
    html = DOMPurify.sanitize(rawHtml, {
      FORBID_TAGS: [
        'script',
        'style',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'button',
        'video',
        'audio',
        'source',
        'link',
        'meta',
        'svg',
        'canvas',
        'math',
        // Image maps: an <area href> would navigate the saved-page frame itself to a live page.
        'map',
        'area',
      ],
      FORBID_ATTR: ['style', 'srcset', 'sizes', 'loading', 'onerror', 'onload', 'class', 'id', 'ping'],
      // DOMPurify tests nearly every attribute value against this, not only links: the second and third
      // alternatives (its own defaults) let plain values through (dir="rtl", colspan="2", start="5"),
      // which a bare scheme list silently stripped. Schemes are still limited to http(s) and data.
      ALLOWED_URI_REGEXP: /^(?:(?:https?|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    });
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute', dropDataLinks);
  }
  return {
    ...base,
    title: (article?.title || docTitle()).slice(0, LIMITS.title),
    html: html.slice(0, 1_500_000),
    textLength: article?.textContent?.length ?? 0,
  };
}
