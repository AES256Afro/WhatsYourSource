import { createSearchBackend } from '../search/backends';
import type { ProviderId, Settings } from '../storage/settings';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { OpenAICompatProvider } from './openaiCompat';
import { localServer } from './localModels';
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
  const url = baseUrl.replace(/^http:\/\/127\.0\.0\.1(?=[:/]|$)/i, 'http://localhost');
  return OPENAI_COMPAT_PRESETS.find((p) => p.baseUrl && url.startsWith(p.baseUrl));
}

export function openaiCompatLabel(baseUrl: string): string {
  const preset = presetFor(baseUrl);
  if (preset) return preset.label.replace(' (local)', '');
  return localServer(baseUrl).isLocal ? 'Local model' : 'Custom endpoint';
}

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

/** The short name for badges: "Gemini", "Claude", or the server ("Ollama", "OpenAI"). */
export function providerShortName(id: ProviderId, s?: Settings): string {
  if (id === 'gemini') return 'Gemini';
  if (id === 'anthropic') return 'Claude';
  if (id === 'webmode') return 'Google AI Mode';
  return s ? openaiCompatLabel(s.providers.openaiCompat.baseUrl) : PROVIDER_LABELS['openai-compat'];
}

/** "Gemini · gemini-3.8-flash": the badge wording, the same on home, while checking and under a result. */
export function providerRunLabel(id: ProviderId, s: Settings): string {
  if (id === 'webmode') return PROVIDER_LABELS.webmode;
  const model = id === 'gemini' ? s.providers.gemini.model : id === 'anthropic' ? s.providers.anthropic.model : s.providers.openaiCompat.model || 'no model';
  return `${providerShortName(id, s)} · ${model}`;
}
