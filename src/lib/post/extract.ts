import type { PostInput } from '../messaging/protocol';

/**
 * Generic post extraction: from the element the user right-clicked, walk up to the nearest
 * post-like container and pull out its text, author, time, images and links. No per-site
 * adapters — the selectors below are hints that cover Reddit, X, Facebook, Mastodon, Bluesky
 * and ordinary articles, with a size-based fallback for everything else.
 */
const CONTAINER_SELECTOR = [
  'article',
  '[role="article"]',
  'shreddit-post',
  'shreddit-comment',
  '[data-testid="tweet"]',
  '[data-testid="post"]',
  '[data-pagelet^="FeedUnit"]',
  '.Post',
  '.status',
  '.post',
  '.comment',
  'li[data-id]',
  'section',
  'main',
].join(', ');

const AUTHOR_SELECTOR = [
  '[data-testid="User-Name"]',
  '[data-testid="authorName"]',
  'a[href^="/user/"]',
  'a[href^="/u/"]',
  'a[href*="/@"]',
  '[rel="author"]',
  '.author',
  '.username',
  '.display-name',
  'h3 a',
  'strong a',
].join(', ');

export function extractPost(target: Element | null, doc: Document = document): PostInput | null {
  const container = findContainer(target, doc);
  if (!container) return null;

  const text = visibleText(container);
  if (text.length < 10) return null;

  const site = location.hostname.replace(/^www\./, '');
  const authorEl = container.querySelector(AUTHOR_SELECTOR);
  const author =
    (container as HTMLElement).getAttribute('author') ??
    (authorEl?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) ??
    undefined;

  const timeEl = container.querySelector('time[datetime], time');
  const postedAt = timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? undefined;

  const permalink =
    absolute((container as HTMLElement).getAttribute('permalink')) ??
    absolute(timeEl?.closest('a')?.getAttribute('href')) ??
    absolute(container.querySelector('a[href*="/status/"], a[href*="/comments/"], a[href*="/posts/"], a[href*="/p/"], a[href*="/post/"], a.permalink, a[rel="bookmark"]')?.getAttribute('href')) ??
    undefined;

  const images: string[] = [];
  for (const img of Array.from(container.querySelectorAll('img'))) {
    const src = img.currentSrc || img.src;
    if (!src || !/^https?:/i.test(src)) continue;
    if (/avatar|profile|emoji|icon|logo|badge/i.test(src + ' ' + (img.alt ?? '') + ' ' + img.className)) continue;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if ((w && w < 120) || (h && h < 120)) continue;
    if (!images.includes(src)) images.push(src);
    if (images.length >= 6) break;
  }

  const links: string[] = [];
  for (const a of Array.from(container.querySelectorAll('a[href]'))) {
    const href = absolute(a.getAttribute('href'));
    if (!href || !/^https?:/i.test(href)) continue;
    let host = '';
    try {
      host = new URL(href).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (host === site || host.endsWith(`.${site}`)) continue; // internal navigation
    if (/t\.co|redd\.it|fb\.me|bit\.ly/i.test(host) && links.length > 0) continue;
    if (!links.includes(href)) links.push(href);
    if (links.length >= 12) break;
  }

  return {
    kind: 'post',
    pageUrl: location.href,
    pageTitle: doc.title,
    site,
    permalink,
    author: author || undefined,
    postedAt: postedAt || undefined,
    text: text.slice(0, 6000),
    images,
    links,
  };
}

function findContainer(target: Element | null, doc: Document): Element | null {
  let el: Element | null = target;
  // Walk up: the first ancestor matching a post-like selector that is not absurdly large.
  while (el && el !== doc.body) {
    if (el.matches(CONTAINER_SELECTOR)) {
      const len = (el.textContent ?? '').length;
      if (len >= 10 && len <= 20000) return el;
    }
    el = el.parentElement;
  }
  // Fallback: the nearest ancestor block with a reasonable amount of text.
  el = target;
  while (el && el !== doc.body) {
    const len = (el.textContent ?? '').replace(/\s+/g, ' ').trim().length;
    if (len >= 80 && len <= 6000) return el;
    el = el.parentElement;
  }
  return null;
}

function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const junk of Array.from(clone.querySelectorAll('script, style, noscript, svg, button, [aria-hidden="true"], [role="button"], nav, form'))) junk.remove();
  const raw = (clone as HTMLElement).innerText ?? clone.textContent ?? '';
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function absolute(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, location.href).toString();
  } catch {
    return undefined;
  }
}
