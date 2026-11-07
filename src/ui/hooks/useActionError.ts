import { useState } from 'react';

/** One error line for a view's actions: wraps a handler so a rejection becomes a short message instead of a silent failure. */
export function useActionError() {
  const [error, setError] = useState<string | null>(null);
  const guard = (label: string, fn: () => Promise<void> | void) => async () => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return { error, guard };
}
