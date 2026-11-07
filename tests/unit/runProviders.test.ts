import { describe, expect, it, vi } from 'vitest';
import { emptyRunState, reduceProgress } from '@/lib/pipeline/progress';
import { runProviders, type ProviderRunEvent } from '@/lib/pipeline/runProviders';
import { decideTarget } from '@/lib/pipeline/target';
import { DEFAULT_SETTINGS, mergeSettings } from '@/lib/storage/settings';

const INPUT = { kind: 'text' as const, text: 'The definition of insanity', pageUrl: 'https://p.example', pageTitle: 't' };
const ANSWER = 'Prose.\n\n```json\n{"verdict":{"label":"Supported","kind":"supported","confidence":"high","summary":"s"},"claims":[],"sources":[]}\n```';
const sse = (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

async function collect(gen: AsyncGenerator<ProviderRunEvent>) {
  const out: ProviderRunEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('decideTarget', () => {
  it('routes to the web, to setup, or to the ready providers in order', () => {
    expect(decideTarget({ ...DEFAULT_SETTINGS, defaultProvider: 'webmode' }).kind).toBe('webmode');
    expect(decideTarget(DEFAULT_SETTINGS).kind).toBe('setup');
    const s = mergeSettings(DEFAULT_SETTINGS, { fallback: true, providers: { gemini: { apiKey: 'k' }, anthropic: { apiKey: 'a' } } });
    expect(decideTarget(s)).toEqual({ kind: 'run', order: ['gemini', 'anthropic'] });
    expect(decideTarget(s, 'anthropic')).toEqual({ kind: 'run', order: ['anthropic'] });
  });
});

describe('reduceProgress', () => {
  it('folds stream events into the progress view without mutating', () => {
    const a = emptyRunState(INPUT, 'Gemini');
    const b = reduceProgress(a, { type: 'status', message: 'Asking…' });
    const c = reduceProgress(b, { type: 'searchQueries', queries: ['q1', 'q2'] });
    const d = reduceProgress(c, { type: 'delta', text: 'hi' });
    expect(a.statuses).toEqual([]);
    expect(c.statuses).toEqual(['Asking…', 'Searched · 2 queries']);
    expect(d.text).toBe('hi');
  });
});

describe('runProviders', () => {
  it('falls through to the next provider on a quota error when fallback is on, and reports the endpoint for local errors', async () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      fallback: true,
      defaultProvider: 'openai-compat',
      providers: { openaiCompat: { model: 'm' }, gemini: { apiKey: 'k' } },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('localhost:11434')) return new Response('{"error":{"message":"busy"}}', { status: 429 });
        return sse(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: ANSWER }] }, finishReason: 'STOP' }] })}\n\n`);
      }),
    );
    const events = await collect(runProviders(INPUT, s, ['openai-compat', 'gemini'], new AbortController().signal, {}));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('provider');
    const fb = events.find((e) => e.type === 'fallback');
    expect(fb?.type === 'fallback' && fb.error.code).toBe('quota');
    expect(fb?.type === 'fallback' && fb.error.endpoint).toBe('http://localhost:11434/v1');
    expect(types.filter((t) => t === 'provider')).toHaveLength(2);
    expect(types[types.length - 1]).toBe('result');
    vi.unstubAllGlobals();
  });
  it('stops at the first error when fallback is off', async () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { fallback: false, providers: { gemini: { apiKey: 'k' }, anthropic: { apiKey: 'a' } } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"message":"nope"}}', { status: 401 })),
    );
    const events = await collect(runProviders(INPUT, s, ['gemini', 'anthropic'], new AbortController().signal, {}));
    expect(events.filter((e) => e.type === 'provider')).toHaveLength(1);
    const last = events[events.length - 1]!;
    expect(last.type === 'failed' && last.error.code).toBe('auth');
    vi.unstubAllGlobals();
  });
  it('declines an image check on a text-only model up front', async () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { providers: { openaiCompat: { model: 'm', modelVision: false } } });
    const events = await collect(
      runProviders(
        { kind: 'image', srcUrl: 'https://i.example/a.png', pageUrl: 'https://p', pageTitle: '' },
        s,
        ['openai-compat'],
        new AbortController().signal,
        {},
      ),
    );
    const last = events[events.length - 1]!;
    expect(last.type === 'failed' && last.error.code).toBe('unsupported');
  });
});
