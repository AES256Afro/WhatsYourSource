import { z } from 'zod';

/**
 * Everything that crosses a process boundary (content script ↔ background ↔ side panel)
 * is validated with these schemas. Page-derived strings are never trusted beyond "it's a string".
 */

export const TextInputSchema = z.object({
  kind: z.literal('text'),
  text: z.string().min(1),
  pageUrl: z.string(),
  pageTitle: z.string(),
  /** A little context around the selection (same paragraph), to help disambiguate. */
  surrounding: z.string().optional(),
});

export const ImageInputSchema = z.object({
  kind: z.literal('image'),
  srcUrl: z.string(),
  pageUrl: z.string(),
  pageTitle: z.string(),
  alt: z.string().optional(),
  nearbyText: z.string().optional(),
});

export const PageInputSchema = z.object({
  kind: z.literal('page'),
  url: z.string(),
  title: z.string(),
  excerpt: z.string().optional(),
});

/** A social post (or any article-like block) extracted from under the cursor. */
export const PostInputSchema = z.object({
  kind: z.literal('post'),
  pageUrl: z.string(),
  pageTitle: z.string(),
  site: z.string(),
  permalink: z.string().optional(),
  author: z.string().optional(),
  postedAt: z.string().optional(),
  text: z.string().min(1),
  images: z.array(z.string()).max(6),
  links: z.array(z.string()).max(12),
});

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
  input: CheckInputSchema,
});
export type Job = z.infer<typeof JobSchema>;

export const SelectionInfoSchema = z.object({
  text: z.string(),
  pageUrl: z.string(),
  pageTitle: z.string(),
  surrounding: z.string().optional(),
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
