import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckInput } from '@/lib/messaging/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Test-controlled behaviour of the mocked modules. */
const G = vi.hoisted(() => ({
  fail: false,
  hang: false,
  incognitoTab: false,
  snapshots: 0,
  orders: [] as string[][],
  lookupSignals: [] as AbortSignal[],
}));

vi.mock('@/lib/tabs', () => ({ getTargetTab: async () => ({ id: 1, windowId: 1, incognito: G.incognitoTab }) }));
vi.mock('@/lib/history/snapshot', () => ({
  captureFromTab: async (_t: unknown, highlight: string | undefined, url: string) => {
    G.snapshots++;
    return { url, title: 't', html: '<p>x</p>', capturedAt: 1, highlight };
  },
}));
vi.mock('@/lib/lookups', async (orig) => ({
  ...(await orig<typeof import('@/lib/lookups')>()),
  startLookups: (_i: unknown, _s: unknown, signal: AbortSignal) => {
    G.lookupSignals.push(signal);
    return { forPrompt: Promise.resolve(''), all: new Promise((r) => setTimeout(() => r({}), 60)) };
  },
  attachLookups: (r: unknown) => r,
  sourceRatings: async () => ({ credibility: {}, mixNotes: [] }),
  originalSourceCapture: async () => undefined,
}));
vi.mock('@/lib/pipeline/runProviders', () => ({
  async *runProviders(input: CheckInput, _s: unknown, order: string[], signal: AbortSignal) {
    G.orders.push(order);
    yield { type: 'provider', label: order[0] };
    for (let i = 0; i < 5; i++) yield { type: 'delta', text: 'x' };
    if (G.hang) {
      await new Promise((r) => signal.addEventListener('abort', r));
      return;
    }
    if (G.fail) {
      yield { type: 'failed', error: { code: 'server', message: `${order[0]} down`, provider: order[0] } };
      return;
    }
    yield {
      type: 'result',
      result: {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        input,
        verdict: { label: `V-${order[0]}`, kind: 'supported', confidence: 'high', summary: 's' },
        narrative: 'n',
        rawText: '',
        claims: [],
        sources: [],
        searchQueries: [],
        provider: { id: order[0], label: order[0], model: 'm' },
      },
    };
  },
}));

const wait = async (ms = 20, n = 10) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
};
const input: CheckInput = { kind: 'text', text: 'claim', pageUrl: 'https://a.example/', pageTitle: 'A' };

async function setup() {
  const { useCheckRun } = await import('@/ui/hooks/useCheckRun');
  const { DEFAULT_SETTINGS } = await import('@/lib/storage/settings');
  const s = structuredClone(DEFAULT_SETTINGS);
  s.onboarded = true;
  s.twoPass = false;
  s.providers.gemini.apiKey = 'k1';
  s.providers.anthropic.apiKey = 'k2';
  const hook: { current: ReturnType<typeof useCheckRun> | null } = { current: null };
  const navigations: string[] = [];
  function H() {
    hook.current = useCheckRun({
      settings: () => s,
      onPhase: (p) => navigations.push(p.phase),
      openGoogleAiMode: () => undefined,
      onOnboarded: () => undefined,
      onSaved: () => undefined,
    });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<H />));
  return { hook, navigations };
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  (await import('@/lib/history/db')).resetDbForTests();
  Object.assign(G, { fail: false, hang: false, incognitoTab: false, snapshots: 0, orders: [], lookupSignals: [] });
});

describe('Q3-03 / S3-01: checks from a private window are not saved', () => {
  it('a job from a private tab saves nothing and takes no page copy', async () => {
    const { hook } = await setup();
    await act(async () => void hook.current!.start(input, { incognito: true }));
    await wait();
    const p = hook.current!.phase;
    expect(p.phase === 'result' && p.save).toEqual({ status: 'private' });
    expect(G.snapshots).toBe(0);
    expect(await (await import('@/lib/history/db')).listChecks()).toHaveLength(0);
  });
  it('a check started in the panel looks the tab up', async () => {
    G.incognitoTab = true;
    const { hook } = await setup();
    await act(async () => void hook.current!.start(input));
    await wait();
    expect(hook.current!.phase.phase === 'result' && hook.current!.phase.save.status).toBe('private');
    expect(await (await import('@/lib/history/db')).listChecks()).toHaveLength(0);
  });
  it('an ordinary window still saves', async () => {
    const { hook } = await setup();
    await act(async () => void hook.current!.start(input));
    await wait();
    expect(hook.current!.phase.phase === 'result' && hook.current!.phase.save).toEqual({ status: 'saved', withSnapshot: true });
  });
});

describe('Q3-01: the view follows phase transitions only', () => {
  it('progress updates do not navigate', async () => {
    const { hook, navigations } = await setup();
    await act(async () => void hook.current!.start(input));
    await wait();
    expect(navigations).toEqual(['checking', 'result']);
  });
});

describe('P5B2-01: a failed or cancelled second opinion keeps what retrying needs', () => {
  const previous = { id: 'p', label: 'gemini (m) said', verdict: 'V-gemini' };
  it('on failure', async () => {
    G.fail = true;
    const { hook } = await setup();
    await act(async () => void hook.current!.start(input, { only: 'anthropic', previous }));
    await wait();
    const p = hook.current!.phase;
    expect(p.phase).toBe('error');
    expect(p.phase === 'error' && { only: p.only, previous: p.previous }).toEqual({ only: 'anthropic', previous });
    // "Try again" passes them back: the same provider runs.
    G.fail = false;
    if (p.phase === 'error') await act(async () => void hook.current!.start(p.input, { only: p.only, previous: p.previous }));
    await wait();
    expect(G.orders.at(-1)).toEqual(['anthropic']);
  });
  it('on cancel', async () => {
    G.hang = true;
    const { hook } = await setup();
    await act(async () => void hook.current!.start(input, { only: 'anthropic', previous }));
    await wait(10, 3);
    act(() => hook.current!.cancel());
    const p = hook.current!.phase;
    expect(p.phase === 'error' && { only: p.only, previous: p.previous, code: p.error.code }).toEqual({ only: 'anthropic', previous, code: 'cancelled' });
  });
});

describe('B1-08: a new run does not abort the previous result’s lookups', () => {
  it('keeps the shown result’s lookups running', async () => {
    const { hook } = await setup();
    await act(async () => void hook.current!.start(input));
    await wait(5, 4); // result shown, lookups still pending
    expect(hook.current!.phase.phase).toBe('result');
    await act(async () => void hook.current!.start({ ...input, text: 'another' }));
    expect(G.lookupSignals[0]!.aborted).toBe(false);
    await wait();
  });
  it('a cancelled run still stops its lookups', async () => {
    G.hang = true;
    const { hook } = await setup();
    await act(async () => void hook.current!.start(input));
    await wait(10, 3);
    act(() => hook.current!.cancel());
    expect(G.lookupSignals[0]!.aborted).toBe(true);
  });
});
