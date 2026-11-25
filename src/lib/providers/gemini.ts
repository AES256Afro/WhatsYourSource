import { parseSse } from '../util/sse';
import { domainOf } from '../util/url';
import { estimateUsd } from './pricing';
import {
  ProviderError,
  errorFromResponse,
  errorFromStreamPayload,
  fetchFailure,
  guardStream,
  type GenEvent,
  type GenerateRequest,
  type LlmProvider,
  type RawSource,
  describeProviderError,
} from './types';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  grounding: boolean;
  urlContext: boolean;
}

const BASE = 'https://generativelanguage.googleapis.com';

/**
 * Every call is capped: without a limit the output (and the bill) is bounded only by the model's
 * ceiling, which injected content can push towards. Enough for the narrative plus the JSON block.
 */
export const GEMINI_MAX_OUTPUT_TOKENS = 8192;

/** Finish reasons that are a content decision; anything else that is not STOP is a tool or server fault. */
const SAFETY_STOPS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY']);

interface GeminiChunk {
  error?: { code?: number; message?: string; status?: string };
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
  id = 'gemini' as const;
  label: string;
  capabilities = { image: true, webSearch: true, urlContext: true };

  constructor(
    private cfg: GeminiConfig,
    label = 'Gemini',
  ) {
    this.label = label;
  }

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
      // The repair pass has no tools, so native JSON mode is allowed there (grounding and JSON mode cannot be combined).
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        ...(req.plain ? { responseMimeType: 'application/json' } : {}),
      },
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
      throw fetchFailure(e);
    }
    if (!res.ok || !res.body) throw errorFromResponse(res.status, await res.text().catch(() => ''));

    let queries: string[] = [];
    let sawText = false;
    let searchSuggestions: string | undefined;
    const seenSources = new Set<string>();
    let promptTokens = 0;
    let outputTokens = 0;
    let finishReason: string | undefined;

    for await (const evt of guardStream(parseSse(res.body))) {
      let chunk: GeminiChunk;
      try {
        chunk = JSON.parse(evt.data) as GeminiChunk;
      } catch {
        continue;
      }
      if (chunk.error) throw errorFromStreamPayload(chunk.error, 'Gemini returned an error.');
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
            // Grounding URIs are vertexaisearch redirects; the chunk's `title` carries the real domain.
            const domain = c.web?.domain || domainOf(c.web?.title ?? uri);
            fresh.push({ url: uri, title: c.web?.title, domain });
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
          fresh.push({ url, domain: domainOf(url) });
        }
        if (fresh.length) yield { type: 'sources', sources: fresh };
      }
      if (chunk.usageMetadata) {
        promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens;
        outputTokens = (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0) || outputTokens;
      }
      if (cand?.finishReason) finishReason = cand.finishReason;
    }

    if (finishReason && SAFETY_STOPS.has(finishReason)) {
      throw new ProviderError('blocked', 'Google AI declined to finish this answer (a safety or recitation filter stopped it).', finishReason);
    }
    let truncated: string | undefined;
    if (finishReason && finishReason !== 'STOP' && finishReason !== 'FINISH_REASON_UNSPECIFIED') {
      if (finishReason === 'MAX_TOKENS') {
        if (sawText) truncated = 'Google AI reached its output limit before finishing, so the answer is cut off.';
      } else if (!sawText) {
        // Tool-call faults (MALFORMED_FUNCTION_CALL, TOO_MANY_TOOL_CALLS…) and OTHER are not a refusal of the content.
        throw new ProviderError('server', 'Google AI stopped early because of a search-tool or server problem.', finishReason);
      } else {
        truncated = 'Google AI stopped early because of a search-tool or server problem, so the answer may be incomplete.';
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
    if (truncated) yield { type: 'truncated', message: truncated };
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
        return { ok: false, error: describeProviderError(err) };
      }
      const j = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
      const models = (j.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter((n) => n.startsWith('gemini-'));
      return { ok: true, models };
    } catch (e) {
      const err = fetchFailure(e);
      return { ok: false, error: err.message };
    }
  }
}
