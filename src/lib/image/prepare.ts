import type { ImageInput } from '../messaging/protocol';
import type { LocalProvenance } from '../pipeline/schema';
import { ImageFetchError, fetchImageBytes, prepareForModel, screenshotImage, type ImageBytes } from './bytes';
import { phashFromBitmap } from './phash';
import type { RunError } from '../pipeline/runCheck';
import { findTabShowing } from '../tabs';
import { isHttpUrl } from '../util/url';
import { provenanceFacts, provenanceMetadata, provenanceSummary, readProvenance } from './provenance';

export interface PreparedImage {
  base64: string;
  mime: string;
  provenance: LocalProvenance;
  provenanceSummary: string;
  provenanceFacts: string;
  provenanceMetadata: string;
  via: ImageBytes['via'];
}

export type PrepareStatus = (message: string) => void;

/**
 * Everything that has to happen before the model sees an image. Throws ImageFetchError('permission')
 * when the only way forward is asking the user for host access.
 */
async function prepareImage(input: ImageInput, tabId: number | undefined, status: PrepareStatus, signal: AbortSignal): Promise<PreparedImage> {
  status('Fetching the image…');
  let img: ImageBytes;
  try {
    img = await fetchImageBytes(input.srcUrl, signal, input.pageUrl);
  } catch (e) {
    // Cancelled: no screenshot of the tab after the user said stop.
    if (signal.aborted) throw new CancelledError();
    const err = e instanceof ImageFetchError ? e : new ImageFetchError('unknown', String(e));
    if (tabId == null) throw err;
    status('Direct download blocked — using a screenshot of the image instead');
    try {
      img = await screenshotImage(tabId, input.srcUrl);
    } catch {
      throw err;
    }
  }

  if (signal.aborted) throw new CancelledError();
  status('Reading metadata on your device…');
  const [provenance, model] = await Promise.all([readProvenance(img.bytes, img.mime), prepareForModel(img)]);
  // The decoded size, always: a width/height tag inside the file is a claim, not a measurement.
  provenance.width = model.width;
  provenance.height = model.height;
  try {
    // No hash for a flat image (all one colour, or fully transparent): it would match every other flat image.
    const phash = phashFromBitmap(model.bitmap);
    if (phash) provenance.phash = phash;
  } catch {
    /* canvas unavailable */
  } finally {
    model.bitmap.close(); // decoded pixels can be several MB; let them go now
  }
  if (img.via === 'screenshot') provenance.exif = undefined;
  const note = img.via === 'screenshot' ? '. Note: these are screenshot pixels, so file metadata is unavailable.' : '';
  return {
    base64: model.base64,
    mime: model.mime,
    provenance,
    provenanceSummary: provenanceSummary(provenance) + note,
    provenanceFacts: provenanceFacts(provenance) + note,
    provenanceMetadata: provenanceMetadata(provenance),
    via: img.via,
  };
}

class CancelledError extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'CancelledError';
  }
}

/**
 * Everything the check runner needs for an image, or the error to show. A re-check has no tab; an
 * inline/blob image can only be re-read from the page it was on, so that page is looked for first.
 */
export async function prepareImageForCheck(
  input: ImageInput,
  tabId: number | undefined,
  status: PrepareStatus,
  signal: AbortSignal,
): Promise<{ ok: true; image: PreparedImage } | { ok: false; error: RunError }> {
  const tab = tabId ?? (await findTabShowing(input.pageUrl));
  if (signal.aborted) return { ok: false, error: { code: 'cancelled', message: 'Cancelled.' } };
  if (tab == null && !isHttpUrl(input.srcUrl))
    return { ok: false, error: { code: 'image-page-closed', message: 'This image lives inside its page, which is not open.' } };
  try {
    return { ok: true, image: await prepareImage(input, tab, status, signal) };
  } catch (e) {
    if (e instanceof CancelledError || signal.aborted) return { ok: false, error: { code: 'cancelled', message: 'Cancelled.' } };
    const err = e instanceof ImageFetchError ? e : null;
    return {
      ok: false,
      error: {
        code: err?.kind === 'permission' ? 'image-permission' : 'image',
        message:
          err?.kind === 'permission'
            ? 'The image host blocked a direct download.'
            : err?.kind === 'not-image'
              ? 'That link is not an image.'
              : 'Could not load the image.',
        details: err?.message ?? String(e),
      },
    };
  }
}
