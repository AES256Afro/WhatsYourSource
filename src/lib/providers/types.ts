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
  /** The model stopped before it finished (output limit, or another non-content stop); the text so far is incomplete. */
  | { type: 'truncated'; message: string }
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

/** Bodies that name the real cause whatever the status: Gemini answers a bad key with 400, Anthropic an empty balance with 400. */
const BAD_KEY = /API_KEY_INVALID|API_KEY_EXPIRED|API key not valid|API key expired|invalid x-api-key|invalid_api_key|Incorrect API key/i;
const NO_CREDIT = /credit balance is too low|insufficient_quota|insufficient credits|exceeded your current quota/i;

export function errorFromResponse(status: number, bodyText: string): ProviderError {
  let message = bodyText;
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string } | string; message?: string };
    message = (typeof j.error === 'object' && j.error?.message) || (typeof j.error === 'string' && j.error) || j.message || bodyText;
  } catch {
    /* plain text */
  }
  message = message.slice(0, 400);
  const body = bodyText.slice(0, 8000);
  if (BAD_KEY.test(body)) return new ProviderError('auth', 'The API key was rejected.', message);
  if (NO_CREDIT.test(body)) return new ProviderError('quota', 'Rate limit or quota exceeded.', message);
  if (status === 401 || status === 403) return new ProviderError('auth', 'The API key was rejected.', message);
  if (status === 402 || status === 429) return new ProviderError('quota', 'Rate limit or quota exceeded.', message);
  if (status === 408 || status >= 500) return new ProviderError('server', 'The provider had a server error.', message);
  if (status >= 400 && status < 500) return new ProviderError('bad-request', 'The provider rejected the request.', message);
  return new ProviderError('unknown', `Unexpected response (${status}).`, message);
}

/**
 * An error that arrives inside a 200 stream: Gemini `{code, status}`, OpenAI-style `{code, type}`
 * (OpenRouter sends the HTTP status as `code`), Anthropic `{type}`. Mapped like the HTTP status would
 * have been, so fallback and hints work the same.
 */
export function errorFromStreamPayload(
  err: { code?: unknown; status?: unknown; type?: unknown; message?: unknown } | undefined,
  fallback: string,
): ProviderError {
  const message = typeof err?.message === 'string' && err.message ? err.message : fallback;
  const body = JSON.stringify({ error: { message } });
  for (const v of [err?.code, err?.status]) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{3}$/.test(v) ? Number(v) : NaN;
    if (n >= 400 && n < 600) return errorFromResponse(n, body);
  }
  if (BAD_KEY.test(message)) return new ProviderError('auth', 'The API key was rejected.', message.slice(0, 400));
  if (NO_CREDIT.test(message)) return new ProviderError('quota', 'Rate limit or quota exceeded.', message.slice(0, 400));
  const tag = [err?.status, err?.type, err?.code]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  const details = message.slice(0, 400);
  if (/unauthenticated|permission_denied|authentication_error|permission_error|invalid_api_key/.test(tag))
    return new ProviderError('auth', 'The API key was rejected.', details);
  if (/resource_exhausted|rate_limit|insufficient_quota|billing_error/.test(tag)) return new ProviderError('quota', 'Rate limit or quota exceeded.', details);
  if (/unavailable|internal|deadline_exceeded|overloaded|api_error|server_error|timeout/.test(tag))
    return new ProviderError('server', 'The provider had a server error.', details);
  if (/invalid_argument|invalid_request|not_found|failed_precondition|request_too_large/.test(tag))
    return new ProviderError('bad-request', 'The provider rejected the request.', details);
  return new ProviderError('unknown', message.slice(0, 400));
}

/**
 * Any error from our own code. A TypeError here is a bug or an unexpected shape, not a network
 * problem; only `fetchFailure` (fetch and body reads) turns a TypeError into `network`.
 */
export function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof DOMException && e.name === 'AbortError') return new ProviderError('cancelled', 'Cancelled.');
  return new ProviderError('unknown', e instanceof Error ? e.message : String(e));
}

/** A rejection from `fetch` or from reading a response body: a TypeError there means the connection failed. */
export function fetchFailure(e: unknown): ProviderError {
  if (e instanceof TypeError) return new ProviderError('network', 'Could not reach the provider.', e.message);
  return toProviderError(e);
}

/** Iterate a response stream, classifying read failures (dropped connection) as network errors and nothing else. */
export async function* guardStream<T>(source: AsyncIterable<T>): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  try {
    for (;;) {
      let r: IteratorResult<T>;
      try {
        r = await it.next();
      } catch (e) {
        throw fetchFailure(e);
      }
      if (r.done) return;
      yield r.value;
    }
  } finally {
    await it.return?.();
  }
}

/** One line for a status row: the message, and the details when there are any. */
export function describeProviderError(e: { message: string; details?: string }): string {
  return e.details ? `${e.message} ${e.details}` : e.message;
}
