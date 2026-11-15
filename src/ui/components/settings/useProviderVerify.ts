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
  /**
   * Runs after a successful verify. May return the status text to show instead of the model count,
   * or that text with the configuration key the outcome now belongs to (when it changed the
   * configuration itself, e.g. filled in the first model).
   */
  onOk?: (models: string[]) => string | undefined | { text: string; key: string } | Promise<string | undefined | { text: string; key: string }>,
) {
  const [verified, setVerified] = useState<Status & { forKey: string }>({ kind: 'idle', forKey: key });
  const [models, setModels] = useState<string[]>([]);
  const status: Status = verified.forKey === key ? verified : { kind: 'idle' };
  const verify = async () => {
    const forKey = key;
    setVerified({ kind: 'checking', forKey });
    try {
      const r = await makeProvider().validate();
      if (r.ok) {
        const list = r.models ?? [];
        setModels(list);
        const out = await onOk?.(list);
        const text = typeof out === 'object' ? out.text : out;
        setVerified({
          kind: 'ok',
          text: text ?? `Works · ${list.length} model${list.length === 1 ? '' : 's'}`,
          forKey: typeof out === 'object' ? out.key : forKey,
        });
      } else setVerified({ kind: 'bad', text: r.error, forKey });
    } catch (e) {
      // Never leave the button stuck on "Connecting…".
      setVerified({ kind: 'bad', text: e instanceof Error ? e.message : String(e), forKey });
    }
  };
  return { status, models, verify };
}
