import type { CheckInput, SelectionInfo } from './protocol';

/**
 * Size limits and clamps for page-derived input. Kept zod-free so the always-on content script can
 * import them without pulling the schema library into every page.
 */
/** Inline (`data:`) images too big to carry in a job are replaced by this; the screenshot path locates the element. */
export const INLINE_IMAGE_SENTINEL = 'inline:oversize';
export const MAX_INLINE_IMAGE_URL = 1_500_000;

/**
 * Every string here is page-controlled. Lengths are bounded so a crafted page cannot stuff kilobytes
 * into the model's framing text; the producers (content script, extractor) truncate to these first.
 */
export const LIMITS = {
  text: 12_000,
  surrounding: 2_000,
  url: 2_048,
  title: 300,
  short: 120,
  alt: 400,
  nearby: 1_000,
  excerpt: 4_000,
} as const;

const cut = (s: string | undefined, n: number) => (s === undefined ? undefined : s.length > n ? s.slice(0, n) : s);
const httpOnly = (xs: string[], n: number) => xs.filter((u) => /^https?:\/\//i.test(u) && u.length <= LIMITS.url).slice(0, n);

/**
 * Bring any input within LIMITS so it never fails the schema later. Producers read titles and URLs
 * straight from the browser (tab titles on X run past 300 characters), so this is the one place that
 * guarantees the bounds.
 */
export function clampInput(input: CheckInput): CheckInput {
  switch (input.kind) {
    case 'text':
      return {
        ...input,
        text: input.text.slice(0, LIMITS.text),
        pageUrl: input.pageUrl.slice(0, LIMITS.url),
        pageTitle: input.pageTitle.slice(0, LIMITS.title),
        surrounding: cut(input.surrounding, LIMITS.surrounding),
      };
    case 'image':
      return {
        ...input,
        srcUrl: input.srcUrl.length > MAX_INLINE_IMAGE_URL ? INLINE_IMAGE_SENTINEL : input.srcUrl,
        pageUrl: input.pageUrl.slice(0, LIMITS.url),
        pageTitle: input.pageTitle.slice(0, LIMITS.title),
        alt: cut(input.alt, LIMITS.alt),
        nearbyText: cut(input.nearbyText, LIMITS.nearby),
      };
    case 'page':
      return { ...input, url: input.url.slice(0, LIMITS.url), title: input.title.slice(0, LIMITS.title), excerpt: cut(input.excerpt, LIMITS.excerpt) };
    case 'post':
      return {
        ...input,
        pageUrl: input.pageUrl.slice(0, LIMITS.url),
        pageTitle: input.pageTitle.slice(0, LIMITS.title),
        site: input.site.slice(0, LIMITS.short),
        permalink: input.permalink && /^https?:\/\//i.test(input.permalink) && input.permalink.length <= LIMITS.url ? input.permalink : undefined,
        author: cut(input.author, LIMITS.short),
        postedAt: cut(input.postedAt, LIMITS.short),
        text: input.text.slice(0, LIMITS.text),
        images: httpOnly(input.images, 6),
        links: httpOnly(input.links, 12),
      };
  }
}

export function clampSelection(s: SelectionInfo): SelectionInfo {
  return {
    text: s.text.slice(0, LIMITS.text),
    pageUrl: s.pageUrl.slice(0, LIMITS.url),
    pageTitle: s.pageTitle.slice(0, LIMITS.title),
    surrounding: cut(s.surrounding, LIMITS.surrounding),
  };
}
