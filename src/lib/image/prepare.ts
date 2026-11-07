import type { ImageInput } from '../messaging/protocol';
import type { LocalProvenance } from '../pipeline/schema';
import { ImageFetchError, fetchImageBytes, prepareForModel, screenshotImage, type ImageBytes } from './bytes';
import { phashFromBitmap } from './phash';
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
export async function prepareImage(input: ImageInput, tabId: number | undefined, status: PrepareStatus, signal: AbortSignal): Promise<PreparedImage> {
  status('Fetching the image…');
  let img: ImageBytes;
  try {
    img = await fetchImageBytes(input.srcUrl, signal);
  } catch (e) {
    const err = e instanceof ImageFetchError ? e : new ImageFetchError('unknown', String(e));
    if (tabId == null) throw err;
    status('Direct download blocked — using a screenshot of the image instead');
    try {
      img = await screenshotImage(tabId, input.srcUrl);
    } catch {
      throw err;
    }
  }

  status('Reading metadata on your device…');
  const provenance = await readProvenance(img.bytes, img.mime);
  const model = await prepareForModel(img);
  provenance.width ??= model.width;
  provenance.height ??= model.height;
  try {
    provenance.phash = phashFromBitmap(model.bitmap);
  } catch {
    /* canvas unavailable */
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
