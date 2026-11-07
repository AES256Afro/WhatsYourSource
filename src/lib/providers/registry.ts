import { createSearchBackend } from '../search/backends';
import type { ProviderId, Settings } from '../storage/settings';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { OpenAICompatProvider } from './openaiCompat';
import type { LlmProvider } from './types';

export const OPENAI_COMPAT_PRESETS = [
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1' },
  { id: 'llamacpp', label: 'llama.cpp server (local)', baseUrl: 'http://localhost:8080/v1' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'custom', label: 'Custom endpoint', baseUrl: '' },
] as const;

export function openaiCompatLabel(baseUrl: string): string {
  const preset = OPENAI_COMPAT_PRESETS.find((p) => p.baseUrl && baseUrl.startsWith(p.baseUrl));
  if (preset?.id === 'openai') return 'OpenAI';
  if (preset) return preset.label.replace(' (local)', '');
  return /localhost|127\.0\.0\.1/.test(baseUrl) ? 'Local model' : 'Custom endpoint';
}

/** Build the provider object for an id from the current settings. Returns null for ids that aren't LLMs (webmode). */
export function createProvider(id: ProviderId, s: Settings): LlmProvider | null {
  switch (id) {
    case 'gemini':
      return new GeminiProvider(s.providers.gemini);
    case 'openai-compat': {
      const o = s.providers.openaiCompat;
      return new OpenAICompatProvider({
        baseUrl: o.baseUrl,
        apiKey: o.apiKey,
        model: o.model,
        search: createSearchBackend(o),
        fetchPages: true,
        searchBaseUrl: o.searchTool === 'searxng' ? o.searxngUrl : undefined,
        label: openaiCompatLabel(o.baseUrl),
      });
    }
    case 'anthropic':
      return new AnthropicProvider(s.providers.anthropic);
    case 'webmode':
      return null;
  }
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Google AI (Gemini)',
  'openai-compat': 'OpenAI-compatible',
  anthropic: 'Anthropic (Claude)',
  webmode: 'Google AI Mode (web)',
};

export function providerDisplayName(id: ProviderId, s: Settings): string {
  if (id === 'openai-compat') return openaiCompatLabel(s.providers.openaiCompat.baseUrl);
  return PROVIDER_LABELS[id];
}
