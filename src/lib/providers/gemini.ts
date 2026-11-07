import { parseSse } from '../util/sse';
import { domainOf } from '../util/url';
import { estimateUsd } from './pricing';
import { ProviderError, errorFromResponse, toProviderError, type GenEvent, type GenerateRequest, type LlmProvider, type RawSource } from './types';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  grounding: boolean;
  urlContext: boolean;
}

const BASE = 'https://generativelanguage.googleapis.com';

interface GeminiChunk {
  error?: { message?: string; status?: string };
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    toolUsePromptTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
    groundingMetadata?: {
      webSearchQueries?: string[];
      searchEntryPoint?: { renderedContent?: string };
      groundingChunks?: { web?: { uri?: string; title?: string; domain?: string } }[];
    };
    urlContextMetadata?: {
      urlMetadata?: { retrievedUrl?: string; urlRetrievalStatus?: string }[];
    };
  }[];
}

export class GeminiProvider implements LlmProvider {
  id = 'gemini';
  label = 'Google AI (Gemini)';
  capabilities = { image: true, webSearch: true, urlContext: true };

  constructor(private cfg: GeminiConfig) {}

  get model() {
    return this.cfg.model;
  }

  async *generate(req: GenerateRequest, signal: AbortSignal): AsyncIterable<GenEvent> {
    if (!this.cfg.apiKey.trim()) throw new ProviderError('no-key', 'Add your Gemini API key in settings.');

    const tools: Record<string, unknown>[] = [];
    if (!req.plain) {
      if (req.wantSearch && this.cfg.grounding) tools.push({ googleSearch: {} });
      if (req.urls?.length && this.cfg.urlContext) tools.push({ urlContext: {} });
    }

    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [
        {
          role: 'user',
          parts: req.parts.map((p) => ('text' in p ? { text: p.text } : { inlineData: { mimeType: p.image.mime, data: p.image.dataBase64 } })),
        },
      ],
      ...(tools.length ? { tools } : {}),
      generationConfig: { temperature: 0.2 },
    };

    const searching = !req.plain && req.wantSearch && this.cfg.grounding;
    yield { type: 'status', message: searching ? 'Asking Google AI (with Google Search)…' : 'Asking Google AI…' };

    let res: Response;
    try {
      res = await fetch(`${BASE}/v1beta/models/${encodeURIComponent(this.cfg.model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.cfg.apiKey.trim() },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      throw toProviderError(e);
    }
    if (!res.ok || !res.body) throw errorFromResponse(res.status, await res.text().catch(() => ''));

    let queries: string[] = [];
    let sawText = false;
    let searchSuggestions: string | undefined;
    const seenSources = new Set<string>();
    let promptTokens = 0;
    let outputTokens = 0;

    for await (const evt of parseSse(res.body)) {
      let chunk: GeminiChunk;
      try {
        chunk = JSON.parse(evt.data) as GeminiChunk;
      } catch {
        continue;
      }
      if (chunk.error) throw new ProviderError('unknown', chunk.error.message ?? 'Gemini returned an error.');
      if (chunk.promptFeedback?.blockReason) {
        throw new ProviderError('blocked', `Google AI declined this request (${chunk.promptFeedback.blockReason}).`);
      }
      const cand = chunk.candidates?.[0];
      if (cand?.content?.parts) {
        for (const p of cand.content.parts) {
          if (typeof p.text === 'string' && p.text && !p.thought) {
            if (!sawText) {
              sawText = true;
              yield { type: 'status', message: 'Writing assessment…' };
            }
            yield { type: 'delta', text: p.text };
          }
        }
      }
      const gm = cand?.groundingMetadata;
      if (gm) {
        if (gm.webSearchQueries?.length) {
          const merged = Array.from(new Set([...queries, ...gm.webSearchQueries]));
          if (merged.length !== queries.length) {
            queries = merged;
            yield { type: 'searchQueries', queries };
          }
        }
        if (gm.groundingChunks?.length) {
          const fresh: RawSource[] = [];
          for (const c of gm.groundingChunks) {
            const uri = c.web?.uri;
            if (!uri || seenSources.has(uri)) continue;
            seenSources.add(uri);
            const domain = c.web?.domain || domainOf(c.web?.title ?? uri);
            fresh.push({ url: uri, title: c.web?.title, domain, verified: true });
          }
          if (fresh.length) yield { type: 'sources', sources: fresh };
        }
        if (gm.searchEntryPoint?.renderedContent && !searchSuggestions) {
          searchSuggestions = gm.searchEntryPoint.renderedContent;
          yield { type: 'searchSuggestions', html: searchSuggestions };
        }
      }
      const um = cand?.urlContextMetadata?.urlMetadata;
      if (um?.length) {
        const fresh: RawSource[] = [];
        for (const m of um) {
          const url = m.retrievedUrl;
          if (!url || seenSources.has(url)) continue;
          if (m.urlRetrievalStatus && !/SUCCESS/i.test(m.urlRetrievalStatus)) continue;
          seenSources.add(url);
          fresh.push({ url, domain: domainOf(url), verified: true });
        }
        if (fresh.length) yield { type: 'sources', sources: fresh };
      }
      if (chunk.usageMetadata) {
        promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens;
        outputTokens = (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0) || outputTokens;
      }
      if (cand?.finishReason && !['STOP', 'MAX_TOKENS'].includes(cand.finishReason)) {
        if (!sawText) throw new ProviderError('blocked', `Google AI stopped early (${cand.finishReason}).`);
      }
    }

    yield {
      type: 'usage',
      usage: {
        inputTokens: promptTokens,
        outputTokens,
        searches: queries.length,
        estUsd: estimateUsd(this.cfg.model, promptTokens, outputTokens, queries.length),
      },
    };
    yield { type: 'done' };
  }

  async validate(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    if (!this.cfg.apiKey.trim()) return { ok: false, error: 'No key entered.' };
    try {
      const res = await fetch(`${BASE}/v1beta/models?pageSize=100`, {
        headers: { 'x-goog-api-key': this.cfg.apiKey.trim() },
      });
      if (!res.ok) {
        const err = errorFromResponse(res.status, await res.text().catch(() => ''));
        return { ok: false, error: err.details ? `${err.message} ${err.details}` : err.message };
      }
      const j = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
      const models = (j.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter((n) => n.startsWith('gemini-'));
      return { ok: true, models };
    } catch (e) {
      const err = toProviderError(e);
      return { ok: false, error: err.message };
    }
  }
}
