import type { CheckInput } from '../messaging/protocol';
import type { PreparedImage } from '../image/prepare';
import { createProvider, providerDisplayName } from '../providers/registry';
import type { ProviderId, Settings } from '../storage/settings';
import { runCheck, type CheckErrorCode, type CheckEvent, type RunError } from './runCheck';

/** Errors worth trying the next configured provider for (when the user turned fallback on). */
const FALLBACK_CODES: ReadonlySet<CheckErrorCode> = new Set<CheckErrorCode>([
  'no-key',
  'auth',
  'quota',
  'network',
  'server',
  'bad-request',
  'empty',
  'unsupported',
]);

export type ProviderRunEvent =
  | { type: 'provider'; id: ProviderId; label: string }
  | CheckEvent
  | { type: 'fallback'; from: ProviderId; error: RunError }
  | { type: 'failed'; error: RunError };

export interface RunExtras {
  image?: PreparedImage;
  lookups?: string;
  claims?: string;
}

/**
 * Try the providers in order until one produces a result. Yields the stream events of whichever
 * provider is running, a `provider` event when one starts, `fallback` when one is given up on, and
 * exactly one of `result` or `failed` at the end. No React, no storage: testable on its own.
 */
export async function* runProviders(
  input: CheckInput,
  s: Settings,
  order: ProviderId[],
  signal: AbortSignal,
  extras: RunExtras,
): AsyncGenerator<ProviderRunEvent> {
  let lastError: RunError | null = null;
  for (let i = 0; i < order.length; i++) {
    const id = order[i]!;
    const provider = createProvider(id, s);
    if (!provider) continue;
    yield { type: 'provider', id, label: `${providerDisplayName(id, s)} · ${provider.model}` };

    let failed: RunError | null = null;
    if (input.kind === 'image' && !provider.capabilities.image) {
      failed = { code: 'unsupported', message: `${provider.label} (${provider.model}) cannot look at images.`, provider: id };
    } else {
      for await (const ev of runCheck(input, provider, signal, { image: extras.image, lookups: extras.lookups, claims: extras.claims })) {
        if (ev.type === 'error') {
          failed = {
            code: ev.code,
            message: ev.message,
            details: ev.details,
            provider: id,
            endpoint: id === 'openai-compat' ? s.providers.openaiCompat.baseUrl : undefined,
          };
          break;
        }
        yield ev;
        if (ev.type === 'result') return;
      }
    }
    lastError = failed ?? { code: 'unknown', message: 'The check ended without a result.', provider: id };
    if (signal.aborted) break;
    const more = i < order.length - 1;
    if (more && s.fallback && FALLBACK_CODES.has(lastError.code)) {
      yield { type: 'fallback', from: id, error: lastError };
      continue;
    }
    break;
  }
  yield {
    type: 'failed',
    error: signal.aborted ? { code: 'cancelled', message: 'Cancelled.' } : (lastError ?? { code: 'unknown', message: 'Unknown error.' }),
  };
}
