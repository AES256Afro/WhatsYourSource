import { createSearchBackend } from '../search/backends';
import type { ProviderId, Settings } from '../storage/settings';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { OpenAICompatProvider } from './openaiCompat';
import type { LlmProvider } from './types';
import { openaiCompatLabel, presetFor, PROVIDER_LABELS } from './labels';

/**
 * Build the provider object for an id from the current settings. Returns null for ids that aren't
 * LLMs (webmode). `model` overrides the configured model (the claim-listing pass uses the cheapest).
 */
export function createProvider(id: ProviderId, s: Settings, override: { model?: string } = {}): LlmProvider | null {
  switch (id) {
    case 'gemini':
      return new GeminiProvider({ ...s.providers.gemini, model: override.model ?? s.providers.gemini.model }, PROVIDER_LABELS.gemini);
    case 'openai-compat': {
      const o = s.providers.openaiCompat;
      return new OpenAICompatProvider({
        baseUrl: o.baseUrl,
        apiKey: o.apiKey,
        model: override.model ?? o.model,
        search: createSearchBackend(o),
        searchBaseUrl: o.searchTool === 'searxng' ? o.searxngUrl : undefined,
        label: openaiCompatLabel(o.baseUrl),
        jsonMode: presetFor(o.baseUrl)?.jsonMode ?? false,
        // `false` only when the server told us so (Verify button); unknown models are allowed to try.
        vision: o.modelVision !== false,
        tools: o.modelTools !== false,
      });
    }
    case 'anthropic':
      return new AnthropicProvider({ ...s.providers.anthropic, model: override.model ?? s.providers.anthropic.model }, PROVIDER_LABELS.anthropic);
    case 'webmode':
      return null;
  }
}

/** The cheapest model each hosted provider offers, for the tool-less claim-listing pass. Local servers keep their model. */
export function cheapestModel(id: ProviderId): string | undefined {
  if (id === 'gemini') return 'gemini-3.1-flash-lite';
  if (id === 'anthropic') return 'claude-haiku-5-5';
  return undefined;
}

export * from './labels';
