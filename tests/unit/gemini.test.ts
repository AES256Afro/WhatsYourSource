import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '@/lib/providers/gemini';
import { collectCheck } from '@/lib/pipeline/runCheck';
import { parseBlock } from '@/lib/util/sse';

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const ANSWER = `Quote Investigator traced it to 1981.

\`\`\`json
{"verdict":{"label":"Misattributed","kind":"misattributed","confidence":"high","summary":"Not Einstein."},
 "originalSource":{"title":"NA Basic Text","url":null,"publisher":"NA","date":"1981","how":"earliest print"},
 "claims":[{"text":"Einstein said it","status":"disputed","note":"no record","sourceUrls":["https://quoteinvestigator.com/2017/03/23/same/"]}],
 "sources":[{"title":"QI article","url":"https://quoteinvestigator.com/2017/03/23/same/","date":"2017"}],
 "notes":null}
\`\`\``;

describe('sse parseBlock', () => {
  it('joins multi-line data', () => {
    expect(parseBlock('event: x\ndata: a\ndata: b')).toEqual({ event: 'x', data: 'a\nb' });
    expect(parseBlock(': comment')).toBeNull();
  });
});

describe('GeminiProvider + runCheck', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('streams text, collects grounding sources and produces a structured result', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain('streamGenerateContent?alt=sse');
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
      const body = JSON.parse(String(init.body));
      expect(body.tools).toEqual([{ googleSearch: {} }]);
      return sse([
        { candidates: [{ content: { parts: [{ text: ANSWER.slice(0, 40) }] }, groundingMetadata: { webSearchQueries: ['einstein insanity quote origin'] } }] },
        {
          candidates: [
            {
              content: { parts: [{ text: ANSWER.slice(40) }] },
              groundingMetadata: {
                groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/1', title: 'quoteinvestigator.com' } }],
                searchEntryPoint: { renderedContent: '<div>chips</div>' },
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 300 },
        },
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', grounding: true, urlContext: true });
    const { result, error, events } = await collectCheck({ kind: 'text', text: 'The definition of insanity…', pageUrl: 'https://medium.com/x', pageTitle: 'T' }, provider);
    expect(error).toBeUndefined();
    expect(result).toBeDefined();
    expect(result!.verdict.kind).toBe('misattributed');
    expect(result!.narrative).toMatch(/^Quote Investigator/);
    expect(result!.searchQueries).toEqual(['einstein insanity quote origin']);
    expect(result!.searchSuggestionsHtml).toBe('<div>chips</div>');
    expect(result!.sources).toHaveLength(1);
    expect(result!.sources[0]!.verified).toBe(true);
    expect(result!.sources[0]!.title).toBe('QI article');
    expect(result!.claims[0]!.sourceIds).toEqual([1]);
    expect(result!.usage?.inputTokens).toBe(500);
    expect(result!.usage?.searches).toBe(1);
    expect(events.some((e) => e.type === 'delta')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps HTTP errors to provider error codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })));
    const provider = new GeminiProvider({ apiKey: 'bad', model: 'gemini-3.8-flash', grounding: true, urlContext: true });
    const { error } = await collectCheck({ kind: 'page', url: 'https://example.com', title: 'x' }, provider);
    expect(error?.code).toBe('bad-request');
    expect(error?.details).toContain('API key not valid');
  });

  it('refuses without a key', async () => {
    const provider = new GeminiProvider({ apiKey: '', model: 'gemini-3.8-flash', grounding: true, urlContext: true });
    const { error } = await collectCheck({ kind: 'page', url: 'https://example.com', title: 'x' }, provider);
    expect(error?.code).toBe('no-key');
  });

  it('runs a repair pass when the first answer has no JSON', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        if (calls === 1) return sse([{ candidates: [{ content: { parts: [{ text: 'Just prose, no block.' }] }, finishReason: 'STOP' }] }]);
        return sse([{ candidates: [{ content: { parts: [{ text: '```json\n{"verdict":{"label":"Unverified","kind":"unverified","confidence":"low","summary":"s"}}\n```' }] } }] }]);
      }),
    );
    const provider = new GeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', grounding: true, urlContext: true });
    const { result } = await collectCheck({ kind: 'page', url: 'https://example.com', title: 'x' }, provider);
    expect(calls).toBe(2);
    expect(result!.degraded).toBe(false);
    expect(result!.narrative).toBe('Just prose, no block.');
  });
});
