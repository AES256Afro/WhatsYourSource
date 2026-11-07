import { z } from 'zod';

/** Inline (`data:`) images too big to carry in a job are replaced by this; the screenshot path locates the element. */
export const INLINE_IMAGE_SENTINEL = 'inline:oversize';
export const MAX_INLINE_IMAGE_URL = 1_500_000;

/**
 * Everything that crosses a process boundary (content script ↔ background ↔ side panel)
 * is validated with these schemas. Page-derived strings are never trusted beyond "it's a string".
 */

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

const url = z.string().max(LIMITS.url);
const httpUrl = url.refine((u) => /^https?:\/\//i.test(u), 'http(s) only');

export const TextInputSchema = z.object({
  kind: z.literal('text'),
  text: z.string().min(1).max(LIMITS.text),
  pageUrl: url,
  pageTitle: z.string().max(LIMITS.title),
  /** A little context around the selection (same paragraph), to help disambiguate. */
  surrounding: z.string().max(LIMITS.surrounding).optional(),
});

export const ImageInputSchema = z.object({
  kind: z.literal('image'),
  /** http(s), data: or blob: — whatever the page used — or INLINE_IMAGE_SENTINEL; only http(s) is ever linked. */
  srcUrl: z.string().max(MAX_INLINE_IMAGE_URL),
  pageUrl: url,
  pageTitle: z.string().max(LIMITS.title),
  alt: z.string().max(LIMITS.alt).optional(),
  nearbyText: z.string().max(LIMITS.nearby).optional(),
});

export const PageInputSchema = z.object({
  kind: z.literal('page'),
  url,
  title: z.string().max(LIMITS.title),
  excerpt: z.string().max(LIMITS.excerpt).optional(),
});

/** A social post (or any article-like block) extracted from under the cursor. */
export const PostInputSchema = z.object({
  kind: z.literal('post'),
  pageUrl: url,
  pageTitle: z.string().max(LIMITS.title),
  site: z.string().max(LIMITS.short),
  permalink: httpUrl.optional(),
  author: z.string().max(LIMITS.short).optional(),
  postedAt: z.string().max(LIMITS.short).optional(),
  text: z.string().min(1).max(LIMITS.text),
  images: z.array(httpUrl).max(6),
  links: z.array(httpUrl).max(12),
});

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

export const CheckInputSchema = z.discriminatedUnion('kind', [TextInputSchema, ImageInputSchema, PageInputSchema, PostInputSchema]);
export type CheckInput = z.infer<typeof CheckInputSchema>;
export type TextInput = z.infer<typeof TextInputSchema>;
export type ImageInput = z.infer<typeof ImageInputSchema>;
export type PageInput = z.infer<typeof PageInputSchema>;
export type PostInput = z.infer<typeof PostInputSchema>;

/** A job handed from the background to the side panel through storage.session. */
export const JobSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  tabId: z.number().optional(),
  /** The window whose panel should run it; other open panels ignore it. */
  windowId: z.number().optional(),
  input: CheckInputSchema,
});
export type Job = z.infer<typeof JobSchema>;

export const SelectionInfoSchema = z.object({
  text: z.string().max(LIMITS.text),
  pageUrl: url,
  pageTitle: z.string().max(LIMITS.title),
  surrounding: z.string().max(LIMITS.surrounding).optional(),
});
export type SelectionInfo = z.infer<typeof SelectionInfoSchema>;

export const SnapshotPayloadSchema = z.object({
  url: z.string(),
  title: z.string(),
  html: z.string(),
  textLength: z.number(),
  capturedAt: z.number(),
});
export type SnapshotPayload = z.infer<typeof SnapshotPayloadSchema>;

export const MessageSchema = z.discriminatedUnion('type', [
  /** content → background: the user clicked the floating chip. */
  z.object({ type: z.literal('wys:check'), input: CheckInputSchema }),
  /** content → background: the user's settings send page triggers to Google AI Mode; open it in a tab. */
  z.object({ type: z.literal('wys:open-webmode'), input: CheckInputSchema }),
  /** background/popup → content: give me the current selection. */
  z.object({ type: z.literal('wys:get-selection') }),
  /** popup → background: open the side panel for this window/tab. */
  z.object({ type: z.literal('wys:open-panel') }),
  /** side panel → content: capture the page for history. */
  z.object({ type: z.literal('wys:capture-snapshot'), highlight: z.string().optional() }),
  /** side panel → content: where is this image on screen? */
  z.object({ type: z.literal('wys:locate-image'), srcUrl: z.string() }),
  /** background → content: extract the post under the last right-click. */
  z.object({ type: z.literal('wys:extract-post') }),
]);
export type Message = z.infer<typeof MessageSchema>;

/** content → side panel: where an image sits on screen, for the screenshot fallback. */
export const LocateImageReplySchema = z.object({
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  dpr: z.number().positive(),
});
export type LocateImageReply = z.infer<typeof LocateImageReplySchema>;

export type MessageResponse = { ok: true } | { ok: false; error: string } | SelectionInfo | SnapshotPayload | LocateImageReply | null;
