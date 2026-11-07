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

function captureSnapshot(): SnapshotPayload {
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
      ],
      FORBID_ATTR: ['style', 'srcset', 'sizes', 'loading', 'onerror', 'onload', 'class', 'id', 'ping'],
      ALLOWED_URI_REGEXP: /^(?:https?|data):/i,
    });
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute', dropDataLinks);
  }
  return {
    url: location.href.slice(0, LIMITS.url),
    title: (article?.title || document.title).slice(0, LIMITS.title),
    html: html.slice(0, 1_500_000),
    textLength: article?.textContent?.length ?? 0,
    capturedAt: Date.now(),
  };
}
