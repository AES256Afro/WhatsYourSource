import type { ProviderId, Settings } from '../storage/settings';
import { GeminiProvider } from './gemini';
import type { LlmProvider } from './types';

/** Build the provider object for an id from the current settings. Returns null for ids that aren't LLMs (webmode). */
export function createProvider(id: ProviderId, s: Settings): LlmProvider | null {
  switch (id) {
    case 'gemini':
      return new GeminiProvider(s.providers.gemini);
    case 'openai-compat':
    case 'anthropic':
      // Added in M3.
      return null;
    case 'webmode':
      return null;
  }
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Google AI (Gemini)',
  'openai-compat': 'Local / OpenAI-compatible',
  anthropic: 'Anthropic (Claude)',
  webmode: 'Google AI Mode (web)',
};
