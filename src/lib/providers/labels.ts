import type { ProviderId, Settings } from '../storage/settings';
import { localServer } from './localModels';

/**
 * Names and labels of the providers, apart from the providers themselves: the popup shows a label and
 * must not load every provider implementation to do it.
 */
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
