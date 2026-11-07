import { useEffect, useState } from 'react';
import { listChecks, type StoredCheck } from '@/lib/history/db';
import { hammingDistance } from '@/lib/image/phash';
import type { CheckResult } from '@/lib/pipeline/schema';

/** Hamming distance between 64-bit pHashes under which two images are the same picture, give or take a resize or recompression. */
const SAME_IMAGE = 10;

/**
 * An earlier check of the same image, by perceptual hash: the fingerprint is computed on the device
 * for every image check, so a photo seen under a new caption is recognised without any network call.
 */
export function useSeenBefore(result: CheckResult): Pick<StoredCheck, 'id' | 'createdAt' | 'verdictLabel'> | null {
  const [hit, setHit] = useState<Pick<StoredCheck, 'id' | 'createdAt' | 'verdictLabel'> | null>(null);
  const phash = result.input.kind === 'image' ? result.provenance?.phash : undefined;
  useEffect(() => {
    if (!phash) return;
    let alive = true;
    void listChecks({ kind: 'image', limit: 300 })
      .then((rows) => {
        if (!alive) return;
        const match = rows.find((c) => c.id !== result.id && c.result.provenance?.phash && hammingDistance(c.result.provenance.phash, phash) <= SAME_IMAGE);
        setHit(match ? { id: match.id, createdAt: match.createdAt, verdictLabel: match.verdictLabel } : null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [phash, result.id]);
  return hit;
}
