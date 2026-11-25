import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import type { CheckResult, FollowUp } from '@/lib/pipeline/schema';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const G = vi.hoisted(() => ({ listFailures: 0, downloads: [] as string[], tabs: [] as { id: number; resolve?: (v: unknown) => void }[] }));

vi.mock('@/lib/history/db', async (orig) => {
  const a = await orig<typeof import('@/lib/history/db')>();
  return {
    ...a,
    listChecks: (...args: Parameters<typeof a.listChecks>) => (G.listFailures-- > 0 ? Promise.reject(new Error('open failed')) : a.listChecks(...args)),
  };
});
vi.mock('@/lib/history/export', async (orig) => ({
  ...(await orig<typeof import('@/lib/history/export')>()),
  downloadText: (text: string) => void G.downloads.push(text),
}));
vi.mock('@/lib/tabs', () => ({ getTargetTab: async () => ({ id: G.tabs.at(-1)!.id, windowId: 1 }) }));

const wait = async (ms = 10, n = 8) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
};
const result = (id: string): CheckResult =>
  ({
    id,
    createdAt: Date.now(),
    input: { kind: 'text', text: 'The bridge opened in 1932.', pageUrl: 'https://a.example/', pageTitle: 'A' },
    verdict: { label: 'Accurate', kind: 'supported', confidence: 'high', summary: 's' },
    narrative: 'n',
    rawText: '',
    claims: [],
    sources: [],
    searchQueries: [],
    provider: { id: 'gemini', label: 'Gemini', model: 'm' },
  }) as unknown as CheckResult;

let root: Root;
let el: HTMLDivElement;
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  (await import('@/lib/history/db')).resetDbForTests();
  Object.assign(G, { listFailures: 0, downloads: [], tabs: [] });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  el.remove();
});

describe('C3-01 / B9-02: a failed history read is reported, with a retry', () => {
  it('History shows an error line instead of "Loading…" forever, and Try again reads again', async () => {
    const { saveCheck } = await import('@/lib/history/db');
    await saveCheck(result('h1'));
    G.listFailures = 1;
    const { HistoryView } = await import('@/ui/components/HistoryView');
    await act(async () => root.render(<HistoryView onOpen={() => undefined} />));
    await wait(40);
    expect(el.textContent).toContain('Couldn’t read your history');
    const retry = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!;
    await act(async () => retry.click());
    await wait(20);
    expect(el.textContent).not.toContain('Couldn’t read your history');
    expect(el.textContent).toContain('The bridge opened in 1932.');
  });
  it('Q-29 / Q-30: the JSON export says what it is', async () => {
    const { HistoryView } = await import('@/ui/components/HistoryView');
    await act(async () => root.render(<HistoryView onOpen={() => undefined} />));
    await wait();
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Export all (JSON)')!;
    expect(btn.title).toMatch(/Screenshots.*not included/);
  });
});

describe('C1-02 / B1-02: Export HTML includes follow-ups asked since the saved check was opened', () => {
  it('re-reads the row at export time', async () => {
    const { saveCheck, appendFollowUp } = await import('@/lib/history/db');
    await saveCheck(result('d1'));
    const { DetailView } = await import('@/ui/components/DetailView');
    await act(async () => root.render(<DetailView id="d1" onRecheck={() => undefined} onDeleted={() => undefined} webmodeVariant="ai-mode" />));
    await wait();
    const fu: FollowUp = {
      id: 'f',
      createdAt: 1,
      question: 'Who built it?',
      answer: 'A firm.',
      provider: { id: 'gemini', label: 'G', model: 'm' },
      sources: [],
    };
    await appendFollowUp('d1', fu);
    const btn = el.querySelector<HTMLButtonElement>('button[aria-label="Export this check as an HTML file"]')!;
    await act(async () => btn.click());
    await wait();
    expect(G.downloads[0]).toContain('Who built it?');
  });
});

describe('B1-03 / C1-06 and C9-05: follow-ups', () => {
  const thread = (over: object) => ({
    items: [],
    pending: null,
    error: null,
    ask: async () => true,
    stop: () => undefined,
    providerLabel: 'Gemini',
    full: false,
    ...over,
  });
  it('hides <think> reasoning while an answer streams', async () => {
    const { FollowUpList } = await import('@/ui/components/FollowUps');
    await act(async () =>
      root.render(<FollowUpList thread={thread({ pending: { question: 'Q?', text: '<think>private reasoning</think>The answer', status: '' } })} />),
    );
    expect(el.textContent).not.toContain('private reasoning');
    expect(el.textContent).toContain('The answer');
  });
  it('refuses a new question at the cap, visibly', async () => {
    const { FollowUpBox } = await import('@/ui/components/FollowUps');
    await act(async () => root.render(<FollowUpBox thread={thread({ full: true })} />));
    expect(el.querySelector('textarea')!.disabled).toBe(true);
    expect(el.textContent).toContain('the most it keeps');
  });
});

describe('P5B1-02 / P5C1-03: a superseded tab refresh does not win', () => {
  it('a late reply from the tab the user left is dropped', async () => {
    let onActivated: (() => void) | undefined;
    vi.spyOn(browser.tabs.onActivated, 'addListener').mockImplementation(((cb: () => void) => void (onActivated = cb)) as never);
    vi.spyOn(browser.tabs.onUpdated, 'addListener').mockImplementation(() => undefined);
    const held = (id: number): Promise<unknown> => {
      const entry = G.tabs.find((t) => t.id === id && !t.resolve)!;
      return new Promise((r) => (entry.resolve = r));
    };
    Object.assign(browser.tabs, { sendMessage: held });
    const { useTargetSelection } = await import('@/ui/hooks/useTargetSelection');
    const seen: { current: ReturnType<typeof useTargetSelection> | null } = { current: null };
    function H() {
      seen.current = useTargetSelection(true);
      return null;
    }
    G.tabs.push({ id: 1 });
    await act(async () => root.render(<H />));
    await wait(5, 3);
    const reply = (id: number) => ({ text: `selected on ${id}`, pageUrl: `https://site${id}.example/`, pageTitle: `T${id}` });
    // Switch to tab 2 while tab 1 has not answered yet; tab 2 answers first.
    G.tabs.push({ id: 2 });
    await act(async () => onActivated!());
    await wait(5, 3);
    await act(async () => G.tabs[1]!.resolve!(reply(2)));
    await act(async () => G.tabs[0]!.resolve!(reply(1)));
    await wait(5, 3);
    expect(seen.current!.tab?.id).toBe(2);
    expect(seen.current!.selection?.text).toBe('selected on 2');
  });
});
