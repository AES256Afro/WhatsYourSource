import { browser } from 'wxt/browser';
import { LocateImageReplySchema } from '../messaging/protocol';

/**
 * Getting the pixels of "that image the user right-clicked" is the fiddly part of image checks:
 * CDNs may refuse cross-origin reads, URLs may be signed and expire, the image may be a CSS
 * background. Strategy: fetch → (caller may request host permission and retry) → screenshot crop.
 */
export interface ImageBytes {
  bytes: Uint8Array;
  mime: string;
  /** How we got them; shown in the UI. */
  via: 'fetch' | 'screenshot';
}

export class ImageFetchError extends Error {
  constructor(
    public kind: 'permission' | 'http' | 'not-image' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'ImageFetchError';
  }
}

export async function fetchImageBytes(srcUrl: string, signal?: AbortSignal): Promise<ImageBytes> {
  if (srcUrl.startsWith('data:')) {
    const res = await fetch(srcUrl);
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, mime: sniffMime(buf) ?? res.headers.get('content-type') ?? 'image/png', via: 'fetch' };
  }
  let res: Response;
  try {
    res = await fetch(srcUrl, { signal, credentials: 'omit', redirect: 'follow' });
  } catch (e) {
    // A TypeError here is almost always CORS / missing host permission.
    throw new ImageFetchError('permission', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw new ImageFetchError('http', `HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const mime = sniffMime(buf) ?? res.headers.get('content-type')?.split(';')[0] ?? '';
  if (!mime.startsWith('image/')) throw new ImageFetchError('not-image', `Not an image (${mime || 'unknown type'})`);
  return { bytes: buf, mime, via: 'fetch' };
}

/** Screenshot the visible tab and crop to the image's on-screen box. Needs activeTab for that tab. */
export async function screenshotImage(tabId: number, srcUrl: string): Promise<ImageBytes> {
  const tab = await browser.tabs.get(tabId);
  const raw: unknown = await browser.tabs.sendMessage(tabId, { type: 'wys:locate-image', srcUrl });
  const reply = LocateImageReplySchema.safeParse(raw);
  if (!reply.success) throw new ImageFetchError('unknown', 'Could not find the image on the page.');
  // The capture is of the window's *active* tab; make sure that is still the job's tab.
  const [active] = await browser.tabs.query({ active: true, windowId: tab.windowId });
  if (active?.id !== tabId) throw new ImageFetchError('unknown', 'The page is no longer the active tab, so it cannot be screenshotted.');
  const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const full = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const { rect, dpr } = reply.data;
  // Only the part of the image that is actually on screen: intersect with the viewport before scaling.
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(full.width / dpr, rect.x + rect.width);
  const y1 = Math.min(full.height / dpr, rect.y + rect.height);
  const sx = Math.round(x0 * dpr);
  const sy = Math.round(y0 * dpr);
  const sw = Math.min(full.width - sx, Math.round((x1 - x0) * dpr));
  const sh = Math.min(full.height - sy, Math.round((y1 - y0) * dpr));
  if (sw < 8 || sh < 8) throw new ImageFetchError('unknown', 'The image is not visible on screen.');
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext('2d')!.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', via: 'screenshot' };
}

export interface ModelImage {
  base64: string;
  mime: string;
  width: number;
  height: number;
  bitmap: ImageBitmap;
}

/** Downscale for upload (long side ≤ 1536 px) and encode as JPEG, keeping PNG for small/transparent images. */
export async function prepareForModel(img: ImageBytes, maxSide = 1536): Promise<ModelImage> {
  const blob = new Blob([img.bytes as BlobPart], { type: img.mime });
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  const keepPng = img.mime === 'image/png' && img.bytes.length < 400_000 && scale === 1;
  const out = await canvas.convertToBlob(keepPng ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.86 });
  return { base64: bytesToBase64(new Uint8Array(await out.arrayBuffer())), mime: out.type, width: bitmap.width, height: bitmap.height, bitmap };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function sniffMime(b: Uint8Array): string | null {
  if (b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length < 12) return null;
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return 'image/webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (/avif|avis/.test(brand)) return 'image/avif';
    if (/heic|heix|mif1|msf1/.test(brand)) return 'image/heic';
  }
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return null;
}
