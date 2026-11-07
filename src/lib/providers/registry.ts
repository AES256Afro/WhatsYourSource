import { createSearchBackend } from '../search/backends';
import type { ProviderId, Settings } from '../storage/settings';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { OpenAICompatProvider } from './openaiCompat';
import type { LlmProvider } from './types';

/**
 * Servers that speak the OpenAI chat API. `local` ones run on this machine; `jsonMode` marks hosted
 * APIs known to honour `response_format: json_object` (local servers vary, so they get the fenced
 * block + repair pass instead).
 */
export const OPENAI_COMPAT_PRESETS = [
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', local: true, jsonMode: false },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', local: true, jsonMode: false },
  { id: 'jan', label: 'Jan (local)', baseUrl: 'http://localhost:1337/v1', local: true, jsonMode: false },
  { id: 'llamacpp', label: 'llama.cpp server (local)', baseUrl: 'http://localhost:8080/v1', local: true, jsonMode: false },
  { id: 'vllm', label: 'vLLM (local)', baseUrl: 'http://localhost:8000/v1', local: true, jsonMode: false },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', local: false, jsonMode: true },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', local: false, jsonMode: true },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', local: false, jsonMode: true },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', local: false, jsonMode: true },
  { id: 'custom', label: 'Custom endpoint', baseUrl: '', local: false, jsonMode: false },
] as const;

export function presetFor(baseUrl: string) {
  return OPENAI_COMPAT_PRESETS.find((p) => p.baseUrl && baseUrl.startsWith(p.baseUrl));
}

export function openaiCompatLabel(baseUrl: string): string {
  const preset = presetFor(baseUrl);
  if (preset) return preset.label.replace(' (local)', '');
  return /localhost|127\.0\.0\.1/.test(baseUrl) ? 'Local model' : 'Custom endpoint';
}

/** Build the provider object for an id from the current settings. Returns null for ids that aren't LLMs (webmode). */
export function createProvider(id: ProviderId, s: Settings): LlmProvider | null {
  switch (id) {
    case 'gemini':
      return new GeminiProvider(s.providers.gemini, PROVIDER_LABELS.gemini);
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
        jsonMode: presetFor(o.baseUrl)?.jsonMode ?? false,
        // `false` only when the server told us so (Test button); unknown models are allowed to try.
        vision: o.modelVision !== false,
      });
    }
    case 'anthropic':
      return new AnthropicProvider(s.providers.anthropic, PROVIDER_LABELS.anthropic);
    case 'webmode':
      return null;
  }
}

/** The one name per provider that users see everywhere: onboarding, settings, home, results, history, Markdown. */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Gemini (your key)',
  'openai-compat': 'Local or OpenAI-style model',
  anthropic: 'Claude (your key)',
  webmode: 'Google AI Mode (web)',
};

export function providerDisplayName(id: ProviderId, s: Settings): string {
  if (id === 'openai-compat') return openaiCompatLabel(s.providers.openaiCompat.baseUrl);
  return PROVIDER_LABELS[id];
}
