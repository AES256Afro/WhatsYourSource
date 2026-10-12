import { formatHits } from '../search/backends';
import { fetchPageText } from '../search/fetchPage';
import type { SearchBackend, SearchHit } from '../search/types';
import { parseSse } from '../util/sse';
import { domainOf, truncate } from '../util/url';
import { ProviderError, errorFromResponse, toProviderError, type GenEvent, type GenerateRequest, type LlmProvider, type RawSource } from './types';

/**
 * Any OpenAI-style `chat/completions` endpoint: Ollama, LM Studio, llama.cpp, vLLM, OpenAI itself.
 * Models that can't search get a small tool loop (web_search / fetch_page) backed by the user's
 * chosen search backend; models without tool calling get the search results injected up front.
 */
export interface OpenAICompatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  search: SearchBackend | null;
  /** Let the model read pages (needs host permission for the sites). */
  fetchPages: boolean;
  label?: string;
}

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type Msg =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web. Returns titles, URLs and snippets. Use specific queries; search more than once if needed.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'The search query' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_page',
      description: 'Fetch a web page by URL and return its readable text (truncated). Use it to read a promising search result in full.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  },
] as const;

const MAX_ROUNDS = 6;

export class OpenAICompatProvider implements LlmProvider {
  id = 'openai-compat';
  label: string;
  capabilities = { image: true, webSearch: false, urlContext: false };

  constructor(private cfg: OpenAICompatConfig) {
    this.label = cfg.label ?? 'OpenAI-compatible';
    this.capabilities.webSearch = !!cfg.search;
  }

  get model() {
    return this.cfg.model;
  }

  private get base() {
    return this.cfg.baseUrl.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.apiKey.trim()) h.Authorization = `Bearer ${this.cfg.apiKey.trim()}`;
    return h;
  }

  async *generate(req: GenerateRequest, signal: AbortSignal): AsyncIterable<GenEvent> {
    if (!this.cfg.model.trim()) throw new ProviderError('bad-request', 'Pick a model in settings.');
    const userContent = toUserContent(req);
    const search = !req.plain && req.wantSearch ? this.cfg.search : null;

    if (!search) {
      if (!req.plain && req.wantSearch) yield { type: 'status', message: 'No search tool configured — answering from the model alone' };
      yield* this.streamAnswer([{ role: 'system', content: req.system }, { role: 'user', content: userContent }], signal);
      return;
    }

    yield { type: 'status', message: `Asking ${this.label} (search via ${search.label})…` };
    try {
      yield* this.toolLoop(req, userContent, search, signal);
    } catch (e) {
      const err = toProviderError(e);
      if (err.code === 'bad-request' && /tool/i.test(err.details ?? '')) {
        // The model doesn't do function calling: search once ourselves and hand the results over.
        yield { type: 'status', message: 'Model has no tool calling — searching up front instead' };
        yield* this.presearch(req, userContent, search, signal);
        return;
      }
      throw err;
    }
  }

  private async *toolLoop(req: GenerateRequest, userContent: Msg & { role: 'user' } extends infer U ? (U extends { content: infer C } ? C : never) : never, search: SearchBackend, signal: AbortSignal): AsyncGenerator<GenEvent> {
    const messages: Msg[] = [{ role: 'system', content: `${req.system}\n\n${TOOL_GUIDANCE}` }, { role: 'user', content: userContent }];
    const seen = new Set<string>();
    const queries: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await this.post('/chat/completions', { model: this.cfg.model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2, stream: false }, signal);
      const j = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      inputTokens += j.usage?.prompt_tokens ?? 0;
      outputTokens += j.usage?.completion_tokens ?? 0;
      const msg = j.choices?.[0]?.message;
      if (!msg) throw new ProviderError('unknown', 'The model returned no message.');
      const calls = msg.tool_calls ?? [];
      if (calls.length === 0 || round === MAX_ROUNDS - 1) {
        const text = (msg.content ?? '').trim();
        if (!text && calls.length) {
          // Out of rounds while the model still wants tools: ask for the answer plainly.
          messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
          for (const c of calls) messages.push({ role: 'tool', tool_call_id: c.id, content: 'Tool budget exhausted. Answer now with what you have.' });
          yield* this.streamAnswer(messages, signal, { inputTokens, outputTokens, searches: queries.length });
          return;
        }
        yield { type: 'status', message: 'Writing assessment…' };
        yield { type: 'delta', text };
        yield { type: 'usage', usage: { inputTokens, outputTokens, searches: queries.length } };
        yield { type: 'done' };
        return;
      }

      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
      for (const call of calls) {
        const args = parseArgs(call.function.arguments);
        let content: string;
        if (call.function.name === 'web_search') {
          const q = String(args.query ?? '').trim();
          if (!q) content = 'Empty query.';
          else {
            queries.push(q);
            yield { type: 'searchQueries', queries: [...queries] };
            yield { type: 'status', message: `Searching: ${truncate(q, 60)}` };
            try {
              const hits = await search.search(q, signal);
              content = formatHits(hits);
              const fresh = hitsToSources(hits, seen);
              if (fresh.length) yield { type: 'sources', sources: fresh };
            } catch (e) {
              content = `Search failed: ${e instanceof Error ? e.message : String(e)}`;
              yield { type: 'status', message: `Search failed (${search.label})` };
            }
          }
        } else if (call.function.name === 'fetch_page') {
          const url = String(args.url ?? '').trim();
          if (!this.cfg.fetchPages) content = 'Page fetching is disabled by the user. Rely on search snippets.';
          else if (!/^https?:\/\//i.test(url)) content = 'Invalid URL.';
          else {
            yield { type: 'status', message: `Reading ${domainOf(url)}` };
            try {
              const page = await fetchPageText(url, signal);
              content = `Title: ${page.title}\nURL: ${page.url}\n\n${page.text}${page.truncated ? '\n[truncated]' : ''}`;
              if (!seen.has(url)) {
                seen.add(url);
                yield { type: 'sources', sources: [{ url, title: page.title || domainOf(url), domain: domainOf(url), verified: true }] };
              }
            } catch (e) {
              content = `Could not fetch (${e instanceof Error ? e.message : String(e)}). The extension may lack permission for this site.`;
            }
          }
        } else {
          content = `Unknown tool ${call.function.name}.`;
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content });
      }
    }
  }

  private async *presearch(req: GenerateRequest, userContent: Msg & { role: 'user' } extends infer U ? (U extends { content: infer C } ? C : never) : never, search: SearchBackend, signal: AbortSignal): AsyncGenerator<GenEvent> {
    const q = (req.searchHint ?? '').trim();
    let block = 'Search was not possible.';
    if (q) {
      yield { type: 'searchQueries', queries: [q] };
      yield { type: 'status', message: `Searching: ${truncate(q, 60)}` };
      try {
        const hits = await search.search(q, signal);
        block = `Web search results for "${q}" (from ${search.label}):\n${formatHits(hits)}`;
        const fresh = hitsToSources(hits, new Set());
        if (fresh.length) yield { type: 'sources', sources: fresh };
      } catch (e) {
        block = `Search failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    const content = typeof userContent === 'string' ? `${userContent}\n\n${block}` : [...userContent, { type: 'text' as const, text: block }];
    yield* this.streamAnswer([{ role: 'system', content: req.system }, { role: 'user', content }], signal, { searches: q ? 1 : 0 });
  }

  private async *streamAnswer(messages: Msg[], signal: AbortSignal, usageBase: { inputTokens?: number; outputTokens?: number; searches?: number } = {}): AsyncGenerator<GenEvent> {
    const res = await this.post('/chat/completions', { model: this.cfg.model, messages, temperature: 0.2, stream: true, stream_options: { include_usage: true } }, signal);
    if (!res.body) throw new ProviderError('unknown', 'Empty response body.');
    let sawText = false;
    let inputTokens = usageBase.inputTokens ?? 0;
    let outputTokens = usageBase.outputTokens ?? 0;
    const ctype = res.headers.get('content-type') ?? '';
    if (!/event-stream/i.test(ctype)) {
      // Server ignored `stream`; treat it as one JSON reply.
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = j.choices?.[0]?.message?.content ?? '';
      yield { type: 'status', message: 'Writing assessment…' };
      yield { type: 'delta', text };
      yield { type: 'usage', usage: { inputTokens: inputTokens + (j.usage?.prompt_tokens ?? 0), outputTokens: outputTokens + (j.usage?.completion_tokens ?? 0), searches: usageBase.searches } };
      yield { type: 'done' };
      return;
    }
    for await (const evt of parseSse(res.body)) {
      if (evt.data.trim() === '[DONE]') break;
      let chunk: { choices?: Array<{ delta?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
      try {
        chunk = JSON.parse(evt.data);
      } catch {
        continue;
      }
      if (chunk.error) throw new ProviderError('unknown', chunk.error.message ?? 'The model returned an error.');
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) {
        if (!sawText) {
          sawText = true;
          yield { type: 'status', message: 'Writing assessment…' };
        }
        yield { type: 'delta', text };
      }
      if (chunk.usage) {
        inputTokens = (usageBase.inputTokens ?? 0) + (chunk.usage.prompt_tokens ?? 0);
        outputTokens = (usageBase.outputTokens ?? 0) + (chunk.usage.completion_tokens ?? 0);
      }
    }
    yield { type: 'usage', usage: { inputTokens, outputTokens, searches: usageBase.searches } };
    yield { type: 'done' };
  }

  private async post(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    } catch (e) {
      const err = toProviderError(e);
      if (err.code === 'network') err.details = `Could not reach ${this.base}. Is the server running, and does it allow requests from browser extensions (CORS)?`;
      throw err;
    }
    if (!res.ok) throw errorFromResponse(res.status, await res.text().catch(() => ''));
    return res;
  }

  async validate(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    try {
      const res = await fetch(`${this.base}/models`, { headers: this.headers() });
      if (!res.ok) {
        const err = errorFromResponse(res.status, await res.text().catch(() => ''));
        return { ok: false, error: err.details ? `${err.message} ${err.details}` : err.message };
      }
      const j = (await res.json()) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> };
      const models = (j.data ?? []).map((m) => m.id ?? '').filter(Boolean);
      if (!models.length && j.models) models.push(...j.models.map((m) => m.name ?? '').filter(Boolean));
      return { ok: true, models: models.sort() };
    } catch (e) {
      const err = toProviderError(e);
      return { ok: false, error: err.code === 'network' ? `Could not reach ${this.base}. Is the server running, and does it allow browser extensions (CORS)?` : err.message };
    }
  }
}

const TOOL_GUIDANCE = `You have two tools: web_search(query) and fetch_page(url). Search at least once before answering, read the most promising result with fetch_page when a snippet is not enough, and cite only URLs you actually received from the tools.`;

function toUserContent(req: GenerateRequest): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  const hasImage = req.parts.some((p) => 'image' in p);
  if (!hasImage) return req.parts.map((p) => ('text' in p ? p.text : '')).join('\n\n');
  return req.parts.map((p) => ('text' in p ? { type: 'text' as const, text: p.text } : { type: 'image_url' as const, image_url: { url: `data:${p.image.mime};base64,${p.image.dataBase64}` } }));
}

function parseArgs(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || '{}');
    return typeof v === 'object' && v ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function hitsToSources(hits: SearchHit[], seen: Set<string>): RawSource[] {
  const out: RawSource[] = [];
  for (const h of hits) {
    if (seen.has(h.url)) continue;
    seen.add(h.url);
    out.push({ url: h.url, title: h.title, domain: domainOf(h.url), verified: true, snippet: h.snippet });
  }
  return out;
}
