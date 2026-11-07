import { useState } from 'react';
import type { LlmProvider } from '@/lib/providers/types';
import type { Status } from './primitives';

/**
 * Verify/Test for a provider card. The outcome is remembered with the configuration it was run for
 * (`key`), so editing the key or endpoint drops back to "not verified" instead of showing a stale tick.
 */
export function useProviderVerify(
  makeProvider: () => LlmProvider,
  key: string,
  /** Runs after a successful verify; may return the status text to show instead of the model count. */
  onOk?: (models: string[]) => string | undefined | Promise<string | undefined>,
) {
  const [verified, setVerified] = useState<Status & { forKey: string }>({ kind: 'idle', forKey: key });
  const [models, setModels] = useState<string[]>([]);
  const status: Status = verified.forKey === key ? verified : { kind: 'idle' };
  const verify = async () => {
    const forKey = key;
    setVerified({ kind: 'checking', forKey });
    const r = await makeProvider().validate();
    if (r.ok) {
      const list = r.models ?? [];
      setModels(list);
      const text = await onOk?.(list);
      setVerified({ kind: 'ok', text: text ?? `Works · ${list.length} model${list.length === 1 ? '' : 's'}`, forKey });
    } else setVerified({ kind: 'bad', text: r.error, forKey });
  };
  return { status, models, verify };
}
