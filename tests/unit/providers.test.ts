import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '@/lib/providers/anthropic';
import { OpenAICompatProvider } from '@/lib/providers/openaiCompat';
import { collectCheck } from '@/lib/pipeline/runCheck';
import { createBrave, createSearxng, createTavily } from '@/lib/search/backends';
import type { SearchBackend } from '@/lib/search/types';

const ANSWER = `Quote Investigator traced it to 1981.

\`\`\`json
{"verdict":{"label":"Misattributed","kind":"misattributed","confidence":"high","summary":"Not Einstein."},
 "claims":[{"text":"Einstein said it","status":"disputed","note":"no record","sourceUrls":["https://quoteinvestigator.com/2017/03/23/same/"]}],
 "sources":[{"title":"QI article","url":"https://quoteinvestigator.com/2017/03/23/same/","date":"2017"}]}
\`\`\``;

const INPUT = { kind: 'text', text: 'The definition of insanity is doing the same thing', pageUrl: 'https://medium.com/x', pageTitle: 'T' } as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function sse(lines: string[]) {
  return new Response(lines.map((l) => `data: ${l}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const fakeSearch: SearchBackend = {
  id: 'searxng',
  label: 'Fake',
  search: vi.fn(async (q: string) => [{ title: 'QI article', url: 'https://quoteinvestigator.com/2017/03/23/same/', snippet: `about ${q}` }]),
};

describe('OpenAICompatProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs the tool loop: search → answer, and reports sources as verified', async () => {
    let call = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      call++;
      expect(url).toBe('http://localhost:11434/v1/chat/completions');
      const body = JSON.parse(String(init.body));
      if (call === 1) {
        expect(body.tools).toHaveLength(2);
        return json({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"query":"einstein insanity quote origin"}' } }],
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        });
      }
      // The tool result went back to the model.
      expect(body.messages.some((m: { role: string }) => m.role === 'tool')).toBe(true);
      return json({ choices: [{ message: { content: ANSWER } }], usage: { prompt_tokens: 300, completion_tokens: 200 } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const p = new OpenAICompatProvider({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen3:8b', search: fakeSearch, fetchPages: false });
    const { result, error } = await collectCheck(INPUT, p);
    expect(error).toBeUndefined();
    expect(fakeSearch.search).toHaveBeenCalledWith('einstein insanity quote origin', expect.anything());
    expect(result!.searchQueries).toEqual(['einstein insanity quote origin']);
    expect(result!.sources[0]).toMatchObject({ verified: true, domain: 'quoteinvestigator.com', title: 'QI article' });
    expect(result!.claims[0]!.sourceIds).toEqual([1]);
    expect(result!.usage).toMatchObject({ inputTokens: 400, outputTokens: 220, searches: 1 });
  });

  it('falls back to an up-front search when the server rejects tools', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        call++;
        const body = JSON.parse(String(init.body));
        if (call === 1) return json({ error: { message: 'this model does not support tools' } }, 400);
        expect(body.tools).toBeUndefined();
        expect(JSON.stringify(body.messages)).toContain('Web search results');
        return sse([JSON.stringify({ choices: [{ delta: { content: ANSWER } }] }), '[DONE]']);
      }),
    );
    const p = new OpenAICompatProvider({ baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'small', search: fakeSearch, fetchPages: false });
    const { result, error } = await collectCheck(INPUT, p);
    expect(error).toBeUndefined();
    expect(result!.verdict.kind).toBe('misattributed');
    expect(result!.sources[0]!.verified).toBe(true);
  });

  it('streams a plain answer when no search tool is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          JSON.stringify({ choices: [{ delta: { content: 'Half ' } }] }),
          JSON.stringify({ choices: [{ delta: { content: 'answer.' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }),
          '[DONE]',
        ]),
      ),
    );
    const p = new OpenAICompatProvider({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk', model: 'gpt', search: null, fetchPages: false });
    const { result, events } = await collectCheck(INPUT, p);
    expect(events.filter((e) => e.type === 'delta')).toHaveLength(2);
    expect(result!.narrative).toBe('Half answer.');
    expect(result!.degraded).toBe(true);
    expect(events.some((e) => e.type === 'status' && e.message.includes('No search tool'))).toBe(true);
  });

  it('explains unreachable servers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const p = new OpenAICompatProvider({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'm', search: null, fetchPages: false });
    const { error } = await collectCheck(INPUT, p);
    expect(error?.code).toBe('network');
    expect(error?.details).toContain('Is the server running');
  });
});

describe('AnthropicProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses the streamed web search events into queries, sources and text', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 120 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 't1', name: 'web_search', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"einstein ins' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'anity quote"}' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'web_search_tool_result',
          content: [{ type: 'web_search_result', url: 'https://quoteinvestigator.com/2017/03/23/same/', title: 'QI article', page_age: '2017' }],
        },
      },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: ANSWER.slice(0, 30) } },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: ANSWER.slice(30) } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 250, server_tool_use: { web_search_requests: 1 } } },
      { type: 'message_stop' },
    ];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      const h = init.headers as Record<string, string>;
      expect(h['x-api-key']).toBe('sk-ant');
      expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
      const body = JSON.parse(String(init.body));
      expect(body.tools[0].type).toBe('web_search_20250305');
      return sse(events.map((e) => JSON.stringify(e)));
    });
    vi.stubGlobal('fetch', fetchMock);
    const p = new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-sonnet-5-5' });
    const { result, error } = await collectCheck(INPUT, p);
    expect(error).toBeUndefined();
    expect(result!.searchQueries).toEqual(['einstein insanity quote']);
    expect(result!.sources[0]).toMatchObject({ verified: true, title: 'QI article' });
    expect(result!.verdict.kind).toBe('misattributed');
    expect(result!.usage).toMatchObject({ inputTokens: 120, outputTokens: 250, searches: 1 });
  });

  it('maps a 401 to an auth error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401)),
    );
    const { error } = await collectCheck(INPUT, new AnthropicProvider({ apiKey: 'bad', model: 'm' }));
    expect(error?.code).toBe('auth');
  });
});

describe('search backends', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('SearXNG', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toMatch(/^http:\/\/localhost:8888\/search\?q=hello%20world&format=json/);
        return json({ results: [{ title: 'A', url: 'https://a.example', content: 'snippet', publishedDate: '2024-01-01' }] });
      }),
    );
    const hits = await createSearxng('http://localhost:8888/').search('hello world');
    expect(hits).toEqual([{ title: 'A', url: 'https://a.example', snippet: 'snippet', date: '2024-01-01' }]);
  });
  it('Brave', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe('BSA1');
        return json({ web: { results: [{ title: 'B', url: 'https://b.example', description: '<strong>bold</strong> text', age: '2 days ago' }] } });
      }),
    );
    const hits = await createBrave('BSA1').search('q');
    expect(hits[0]).toEqual({ title: 'B', url: 'https://b.example', snippet: 'bold text', date: '2 days ago' });
  });
  it('Tavily', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tvly-1');
        return json({ results: [{ title: 'C', url: 'https://c.example', content: 'c', published_date: '2025' }] });
      }),
    );
    const hits = await createTavily('tvly-1').search('q');
    expect(hits[0]?.url).toBe('https://c.example');
  });
  it('reports missing configuration', async () => {
    await expect(createBrave('').search('q')).rejects.toThrow(/Brave/);
    await expect(createSearxng('').search('q')).rejects.toThrow(/SearXNG/);
  });
});

describe('empty model output', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is reported as an error instead of an empty verdict card', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse([JSON.stringify({ choices: [{ delta: { content: '' } }] }), '[DONE]'])),
    );
    const p = new OpenAICompatProvider({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'm', search: null, fetchPages: false });
    const { result, error } = await collectCheck(INPUT, p);
    expect(result).toBeUndefined();
    expect(error?.code).toBe('unknown');
    expect(error?.message).toMatch(/returned nothing/);
  });
});
