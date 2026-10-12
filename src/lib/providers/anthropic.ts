import { parseSse } from '../util/sse';
import { domainOf } from '../util/url';
import { ProviderError, errorFromResponse, toProviderError, type GenEvent, type GenerateRequest, type LlmProvider, type RawSource } from './types';

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

const BASE = 'https://api.anthropic.com';
const VERSION = '2023-06-01';

/** Claude via the Messages API with the built-in web search tool, streamed. */
export class AnthropicProvider implements LlmProvider {
  id = 'anthropic';
  label = 'Anthropic (Claude)';
  capabilities = { image: true, webSearch: true, urlContext: false };

  constructor(private cfg: AnthropicConfig) {}

  get model() {
    return this.cfg.model;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.cfg.apiKey.trim(),
      'anthropic-version': VERSION,
      // The Messages API refuses browser-origin calls without this opt-in; the key is the user's own.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  async *generate(req: GenerateRequest, signal: AbortSignal): AsyncIterable<GenEvent> {
    if (!this.cfg.apiKey.trim()) throw new ProviderError('no-key', 'Add your Anthropic API key in settings.');
    const content = req.parts.map((p) =>
      'text' in p ? { type: 'text', text: p.text } : { type: 'image', source: { type: 'base64', media_type: p.image.mime, data: p.image.dataBase64 } },
    );
    const useSearch = !req.plain && req.wantSearch;
    const body = {
      model: this.cfg.model,
      max_tokens: 4096,
      system: req.system,
      messages: [{ role: 'user', content }],
      ...(useSearch ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }] } : {}),
      stream: true,
    };
    yield { type: 'status', message: useSearch ? 'Asking Claude (with web search)…' : 'Asking Claude…' };

    let res: Response;
    try {
      res = await fetch(`${BASE}/v1/messages`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    } catch (e) {
      throw toProviderError(e);
    }
    if (!res.ok || !res.body) throw errorFromResponse(res.status, await res.text().catch(() => ''));

    const blocks = new Map<number, { type: string; json: string }>();
    const seen = new Set<string>();
    const queries: string[] = [];
    let sawText = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let searches = 0;

    for await (const evt of parseSse(res.body)) {
      let d: AnthropicEvent;
      try {
        d = JSON.parse(evt.data) as AnthropicEvent;
      } catch {
        continue;
      }
      switch (d.type) {
        case 'error':
          throw new ProviderError(d.error?.type === 'overloaded_error' ? 'server' : 'unknown', d.error?.message ?? 'Claude returned an error.');
        case 'message_start':
          inputTokens = d.message?.usage?.input_tokens ?? 0;
          break;
        case 'content_block_start': {
          const b = d.content_block;
          if (!b) break;
          blocks.set(d.index ?? 0, { type: b.type, json: '' });
          if (b.type === 'web_search_tool_result') {
            const fresh: RawSource[] = [];
            for (const r of Array.isArray(b.content) ? b.content : []) {
              if (r.type !== 'web_search_result' || !r.url || seen.has(r.url)) continue;
              seen.add(r.url);
              fresh.push({ url: r.url, title: r.title, domain: domainOf(r.url), verified: true, snippet: r.page_age ? `(${r.page_age})` : undefined });
            }
            if (fresh.length) yield { type: 'sources', sources: fresh };
          }
          break;
        }
        case 'content_block_delta': {
          const delta = d.delta;
          const block = blocks.get(d.index ?? 0);
          if (!delta) break;
          if (delta.type === 'text_delta' && delta.text) {
            if (!sawText) {
              sawText = true;
              yield { type: 'status', message: 'Writing assessment…' };
            }
            yield { type: 'delta', text: delta.text };
          } else if (delta.type === 'input_json_delta' && block) {
            block.json += delta.partial_json ?? '';
          } else if (delta.type === 'citations_delta' && delta.citation?.url && !seen.has(delta.citation.url)) {
            seen.add(delta.citation.url);
            yield { type: 'sources', sources: [{ url: delta.citation.url, title: delta.citation.title, domain: domainOf(delta.citation.url), verified: true }] };
          }
          break;
        }
        case 'content_block_stop': {
          const block = blocks.get(d.index ?? 0);
          if (block?.type === 'server_tool_use' && block.json) {
            try {
              const q = (JSON.parse(block.json) as { query?: string }).query;
              if (q && !queries.includes(q)) {
                queries.push(q);
                searches++;
                yield { type: 'searchQueries', queries: [...queries] };
                yield { type: 'status', message: `Searching: ${q.slice(0, 60)}` };
              }
            } catch {
              /* partial json */
            }
          }
          break;
        }
        case 'message_delta':
          outputTokens = d.usage?.output_tokens ?? outputTokens;
          if (d.usage?.server_tool_use?.web_search_requests != null) searches = d.usage.server_tool_use.web_search_requests;
          if (d.delta?.stop_reason === 'refusal') throw new ProviderError('blocked', 'Claude declined this request.');
          break;
        case 'message_stop':
          break;
      }
    }
    yield { type: 'usage', usage: { inputTokens, outputTokens, searches } };
    yield { type: 'done' };
  }

  async validate(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    if (!this.cfg.apiKey.trim()) return { ok: false, error: 'No key entered.' };
    try {
      const res = await fetch(`${BASE}/v1/models?limit=100`, { headers: this.headers() });
      if (!res.ok) {
        const err = errorFromResponse(res.status, await res.text().catch(() => ''));
        return { ok: false, error: err.details ? `${err.message} ${err.details}` : err.message };
      }
      const j = (await res.json()) as { data?: Array<{ id?: string }> };
      return { ok: true, models: (j.data ?? []).map((m) => m.id ?? '').filter(Boolean) };
    } catch (e) {
      return { ok: false, error: toProviderError(e).message };
    }
  }
}

interface AnthropicEvent {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number } };
  content_block?: { type: string; content?: Array<{ type: string; url?: string; title?: string; page_age?: string }> };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
    citation?: { url?: string; title?: string };
  };
  usage?: { output_tokens?: number; server_tool_use?: { web_search_requests?: number } };
  error?: { type?: string; message?: string };
}
