/**
 * A provider turns a GenerateRequest into a stream of GenEvents. The prompt, the result schema and
 * the merging of sources live in the pipeline. Providers with native search (Gemini, Anthropic) are
 * thin adapters; the OpenAI-style one also carries the search-tool loop a model without web access
 * needs (see providers/openaiCompat).
 */
import type { ProviderId } from '../storage/settings';

export type Part = { text: string } | { image: { mime: string; dataBase64: string } };

export interface GenerateRequest {
  system: string;
  parts: Part[];
  /** Ask the provider to use web search / grounding. */
  wantSearch: boolean;
  /** URLs the provider may read in full (Gemini URL context; tool loop `fetch`). */
  urls?: string[];
  /** The page the content came from: readable by the tool loop, but not pushed into Gemini's URL context. */
  pageUrl?: string;
  /** Hint for a repair/second pass: plain completion, no tools. */
  plain?: boolean;
  /** A ready-made search query for providers that must search before the model runs. */
  searchHint?: string;
}

/** A source the provider actually touched (search result, grounding chunk, fetched page). */
export interface RawSource {
  url: string;
  title?: string;
  domain: string;
  /** true when the URL came from the search/grounding machinery rather than the model's text. */
  verified: boolean;
  snippet?: string;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  searches?: number;
  estUsd?: number;
}

export type GenEvent =
  | { type: 'status'; message: string }
  | { type: 'delta'; text: string }
  | { type: 'searchQueries'; queries: string[] }
  | { type: 'sources'; sources: RawSource[] }
  | { type: 'searchSuggestions'; html: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'done' };

export type ProviderErrorCode = 'no-key' | 'auth' | 'quota' | 'network' | 'blocked' | 'bad-request' | 'server' | 'cancelled' | 'unsupported' | 'unknown';

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
    public details?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderCapabilities {
  image: boolean;
  webSearch: boolean;
  urlContext: boolean;
}

export interface LlmProvider {
  id: ProviderId;
  label: string;
  model: string;
  capabilities: ProviderCapabilities;
  generate(req: GenerateRequest, signal: AbortSignal): AsyncIterable<GenEvent>;
  validate(): Promise<{ ok: boolean; models?: string[]; error?: string }>;
}

export function errorFromResponse(status: number, bodyText: string): ProviderError {
  let message = bodyText;
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string } | string; message?: string };
    message = (typeof j.error === 'object' && j.error?.message) || (typeof j.error === 'string' && j.error) || j.message || bodyText;
  } catch {
    /* plain text */
  }
  message = message.slice(0, 400);
  if (status === 401 || status === 403) return new ProviderError('auth', 'The API key was rejected.', message);
  if (status === 429) return new ProviderError('quota', 'Rate limit or quota exceeded.', message);
  if (status === 400 || status === 404 || status === 422) return new ProviderError('bad-request', 'The provider rejected the request.', message);
  if (status >= 500) return new ProviderError('server', 'The provider had a server error.', message);
  return new ProviderError('unknown', `Unexpected response (${status}).`, message);
}

export function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof DOMException && e.name === 'AbortError') return new ProviderError('cancelled', 'Cancelled.');
  if (e instanceof TypeError) return new ProviderError('network', 'Could not reach the provider.', e.message);
  return new ProviderError('unknown', e instanceof Error ? e.message : String(e));
}
