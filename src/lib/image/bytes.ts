import { browser } from 'wxt/browser';
import { LocateImageReplySchema } from '../messaging/protocol';
import { hasHostAccess } from '../permissions';
import { isPublicHttpUrl } from '../util/url';
import { safeImageMime, UNRECOGNISED_FORMAT } from './provenance';

/**
 * Getting the pixels of "that image the user right-clicked" is the fiddly part of image checks:
 * CDNs may refuse cross-origin reads, URLs may be signed and expire, the image may be a CSS
 * background. Strategy: fetch (only from a site the user let the extension reach, see
 * imageDownloadGranted) → screenshot crop → the caller may offer to grant that site and check again.
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
    /** Set when the file was not downloaded because the user has not granted access to this host. */
    public noAccessHost?: string,
  ) {
    super(message);
    this.name = 'ImageFetchError';
  }
}

/** Bigger than any photo worth checking; bounds memory (bytes, then the decoded bitmap) on a hostile or huge file. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Decoded size cap: a few-KB PNG, GIF or BMP can declare 20000×20000 (1.6 GB of RGBA) and take the renderer down. */
export const MAX_IMAGE_PIXELS = 40_000_000;
/** A stalled image host must not hold "Fetching the image…" forever; on timeout the screenshot fallback runs. */
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

async function readBytesCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      got += value.byteLength;
      if (got > max) throw new ImageFetchError('not-image', `Image too large (over ${Math.round(max / 1048576)} MB)`);
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * The page decides the image address, and this request carries the extension's host permissions, so
 * the same rule as fetch_page applies: public http(s) hosts only. A page on a local or LAN host may
 * show its own images (a developer's localhost page), nothing else may point inside the network.
 */
export function imageFetchAllowed(srcUrl: string, pageUrl?: string): boolean {
  if (isPublicHttpUrl(srcUrl)) return true;
  if (!pageUrl || !/^https?:\/\//i.test(srcUrl) || !/^https?:\/\//i.test(pageUrl)) return false;
  try {
    const src = new URL(srcUrl);
    const page = new URL(pageUrl);
    if (src.username || src.password) return false;
    return src.hostname.toLowerCase().replace(/\.$/, '') === page.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return false;
  }
}

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/\.$/, '') : null;
  } catch {
    return null;
  }
};

/** The manifest's fixed local hosts (host_permissions), always granted. */
const FIXED_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * May the extension download this http(s) image file? Only from a site the user let it reach:
 * - a site granted per site or through "Allow all sites" (hasHostAccess), or
 * - the host of the page the check came from (the right-click or toolbar click grants that tab's origin), or
 * - localhost / 127.0.0.1 when the page itself is local (fixed in host_permissions).
 * Anything else goes to the screenshot of the image instead. data: and blob: are not downloads.
 */
export async function imageDownloadGranted(srcUrl: string, pageUrl: string | undefined, hasAccess: (url: string) => Promise<boolean>): Promise<boolean> {
  const src = hostOf(srcUrl);
  if (!src) return false;
  const page = pageUrl ? hostOf(pageUrl) : null;
  if (page && src === page) return true;
  if (FIXED_LOCAL_HOSTS.has(src) && page && FIXED_LOCAL_HOSTS.has(page)) return true;
  return hasAccess(srcUrl);
}

/** The format by fixed label: the sniffed bytes, else the declared type through the allowlist. */
function mimeFor(buf: Uint8Array, declared: string | null): string {
  return sniffMime(buf) ?? safeImageMime(declared);
}

export async function fetchImageBytes(
  srcUrl: string,
  signal?: AbortSignal,
  pageUrl?: string,
  hasAccess: (url: string) => Promise<boolean> = hasHostAccess,
): Promise<ImageBytes> {
  if (srcUrl.startsWith('data:')) {
    const res = await fetch(srcUrl);
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, mime: mimeFor(buf, res.headers.get('content-type') ?? 'image/png'), via: 'fetch' };
  }
  if (!imageFetchAllowed(srcUrl, pageUrl)) throw new ImageFetchError('unknown', 'The image is on a private or local address, so it is not downloaded.');
  // blob: URLs are the extension reading a page's in-memory object, not a download from a site.
  if (/^https?:/i.test(srcUrl) && !(await imageDownloadGranted(srcUrl, pageUrl, hasAccess))) {
    const host = hostOf(srcUrl) ?? srcUrl;
    throw new ImageFetchError('permission', `The extension has no access to ${host}, so the file is not downloaded.`, host);
  }
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Cancelled.', 'AbortError');
  const timeout = AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    // Redirects are not followed: the target cannot be vetted first (it could be inside the LAN).
    res = await fetch(srcUrl, { signal: combined, credentials: 'omit', redirect: 'manual' });
  } catch (e) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Cancelled.', 'AbortError');
    if (timeout.aborted) throw new ImageFetchError('http', 'The image host did not answer in time.');
    // A TypeError here is almost always CORS / missing host permission.
    throw new ImageFetchError('permission', e instanceof Error ? e.message : String(e));
  }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new ImageFetchError('http', 'The image address redirects elsewhere.');
  if (!res.ok) throw new ImageFetchError('http', `HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_IMAGE_BYTES) throw new ImageFetchError('not-image', `Image too large (${Math.round(declared / 1048576)} MB)`);
  const buf = await readBytesCapped(res, MAX_IMAGE_BYTES);
  const type = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!sniffMime(buf) && !type.startsWith('image/')) throw new ImageFetchError('not-image', 'Not an image.');
  return { bytes: buf, mime: mimeFor(buf, type), via: 'fetch' };
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
  if (sw < 8 || sh < 8) {
    full.close();
    throw new ImageFetchError('unknown', 'The image is not visible on screen.');
  }
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext('2d')!.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
  full.close(); // the whole-tab bitmap (tens of MB at DPR 2) is not needed once cropped
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
  assertDecodable(img);
  const blob = new Blob([img.bytes as BlobPart], { type: img.mime === UNRECOGNISED_FORMAT ? '' : img.mime });
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const keepPng = img.mime === 'image/png' && img.bytes.length < 400_000 && scale === 1;
  const g = canvas.getContext('2d')!;
  if (!keepPng) {
    // JPEG has no transparency: without a backdrop, a transparent chart becomes dark ink on black.
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
  }
  g.drawImage(bitmap, 0, 0, w, h);
  const out = await canvas.convertToBlob(keepPng ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.86 });
  return { base64: bytesToBase64(new Uint8Array(await out.arrayBuffer())), mime: out.type, width: bitmap.width, height: bitmap.height, bitmap };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

/**
 * Refuse to decode what would not fit: the size comes from the file header, before any pixels are
 * allocated. A format whose size cannot be read (other than SVG, which has no fixed pixel size) is
 * refused too, since its decoded size is unknown.
 */
export function assertDecodable(img: ImageBytes): void {
  const dims = imageDimensions(img.bytes);
  if (!dims) {
    if (img.mime === 'image/svg+xml') return;
    throw new ImageFetchError('unknown', 'The image format is not recognised, so its size cannot be checked before decoding it.');
  }
  if (dims.width * dims.height > MAX_IMAGE_PIXELS)
    throw new ImageFetchError('unknown', `The image is too large to decode safely (${dims.width}×${dims.height} pixels).`);
}

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u32le = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
const i32le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24);

type Dims = { width: number; height: number };
const dimsOrNull = (width: number, height: number): Dims | null => (width > 0 && height > 0 ? { width, height } : null);

/** Width and height from the file header (PNG, JPEG, WebP, GIF, BMP, ICO/CUR, AVIF/HEIC), or null when unknown. */
export function imageDimensions(b: Uint8Array): Dims | null {
  if (b.length < 10) return null;
  const mime = sniffMime(b);
  switch (mime) {
    case 'image/png':
      return b.length >= 24 && String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!) === 'IHDR' ? dimsOrNull(u32be(b, 16), u32be(b, 20)) : null;
    case 'image/jpeg':
      return jpegDims(b);
    case 'image/webp':
      return webpDims(b);
    case 'image/gif':
      return gifDims(b);
    case 'image/bmp':
      return bmpDims(b, 0);
    case 'image/x-icon':
      return icoDims(b);
    case 'image/avif':
    case 'image/heic':
      return ispeDims(b);
    default:
      return null;
  }
}

function jpegDims(b: Uint8Array): Dims | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end, or scan data before any frame header
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return dimsOrNull(u16be(b, i + 7), u16be(b, i + 5));
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

function webpDims(b: Uint8Array): Dims | null {
  if (b.length < 30) return null;
  const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (chunk === 'VP8X') return dimsOrNull(u24le(b, 24) + 1, u24le(b, 27) + 1);
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return dimsOrNull((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return dimsOrNull(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  return null;
}

/** The logical screen, grown by any frame that reaches past it (decoders size the canvas to fit both). */
function gifDims(b: Uint8Array): Dims | null {
  let width = u16le(b, 6);
  let height = u16le(b, 8);
  let i = 13;
  if (b[10]! & 0x80) i += 3 * (1 << ((b[10]! & 0x07) + 1));
  const skipSubBlocks = () => {
    while (i < b.length) {
      const n = b[i]!;
      i += 1 + n;
      if (n === 0) return;
    }
  };
  while (i < b.length) {
    const t = b[i]!;
    if (t === 0x3b) break; // trailer
    if (t === 0x21) {
      i += 2;
      skipSubBlocks();
    } else if (t === 0x2c) {
      if (i + 10 > b.length) break;
      width = Math.max(width, u16le(b, i + 1) + u16le(b, i + 5));
      height = Math.max(height, u16le(b, i + 3) + u16le(b, i + 7));
      const packed = b[i + 9]!;
      i += 10;
      if (packed & 0x80) i += 3 * (1 << ((packed & 0x07) + 1));
      i += 1; // LZW minimum code size
      skipSubBlocks();
    } else break;
  }
  return dimsOrNull(width, height);
}

/** A BMP file header at `at` (or a bare DIB header inside an ICO when `dibOnly`). */
function bmpDims(b: Uint8Array, at: number, dibOnly = false): Dims | null {
  const dib = dibOnly ? at : at + 14;
  if (dib + 12 > b.length) return null;
  const size = u32le(b, dib);
  if (size === 12) return dimsOrNull(u16le(b, dib + 4), u16le(b, dib + 6));
  if (dib + 12 > b.length || size < 40) return null;
  const h = Math.abs(i32le(b, dib + 8));
  // In an icon the DIB height covers the image and its AND mask.
  return dimsOrNull(Math.abs(i32le(b, dib + 4)), dibOnly ? Math.ceil(h / 2) : h);
}

/** The largest entry of an ICO/CUR: each entry's real size comes from its embedded PNG or DIB header. */
function icoDims(b: Uint8Array): Dims | null {
  const count = u16le(b, 4);
  let best: Dims | null = null;
  for (let k = 0; k < count; k++) {
    const e = 6 + 16 * k;
    if (e + 16 > b.length) return null;
    const off = u32le(b, e + 12);
    if (off + 24 > b.length) return null;
    const sub = b.subarray(off);
    const d = sniffMime(sub) === 'image/png' ? imageDimensions(sub) : bmpDims(b, off, true);
    if (!d) return null;
    if (!best || d.width * d.height > best.width * best.height) best = d;
  }
  return best;
}

/** AVIF/HEIC: the largest `ispe` (image spatial extents) property. */
function ispeDims(b: Uint8Array): Dims | null {
  let best: Dims | null = null;
  for (let i = 4; i + 16 <= b.length; i++) {
    if (b[i] !== 0x69 || b[i + 1] !== 0x73 || b[i + 2] !== 0x70 || b[i + 3] !== 0x65) continue; // "ispe"
    const d = dimsOrNull(u32be(b, i + 8), u32be(b, i + 12));
    if (d && (!best || d.width * d.height > best.width * best.height)) best = d;
  }
  return best;
}

export function sniffMime(b: Uint8Array): string | null {
  if (b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  // ICO (00 00 01 00) and CUR (00 00 02 00), with at least one directory entry.
  if (b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0 && b.length >= 22 && u16le(b, 4) > 0) return 'image/x-icon';
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
