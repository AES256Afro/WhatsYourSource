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

export const CheckInputSchema = z.discriminatedUnion('kind', [
  TextInputSchema,
  ImageInputSchema,
  PageInputSchema,
]);
export type CheckInput = z.infer<typeof CheckInputSchema>;
export type TextInput = z.infer<typeof TextInputSchema>;
export type ImageInput = z.infer<typeof ImageInputSchema>;
export type PageInput = z.infer<typeof PageInputSchema>;

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
  /** background/popup → content: give me the current selection. */
  z.object({ type: z.literal('wys:get-selection') }),
  /** popup → background: open the side panel for this window/tab. */
  z.object({ type: z.literal('wys:open-panel') }),
  /** side panel → content: capture the page for history. */
  z.object({ type: z.literal('wys:capture-snapshot'), highlight: z.string().optional() }),
  /** side panel → content: where is this image on screen? */
  z.object({ type: z.literal('wys:locate-image'), srcUrl: z.string() }),
]);
export type Message = z.infer<typeof MessageSchema>;

export type MessageResponse =
  | { ok: true }
  | { ok: false; error: string }
  | SelectionInfo
  | SnapshotPayload
  | { rect: { x: number; y: number; width: number; height: number }; dpr: number }
  | null;
