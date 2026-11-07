import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  clearHistory,
  deleteCheck,
  enforceSnapshotCap,
  getCheck,
  getSnapshot,
  listChecks,
  resetDbForTests,
  saveCheck,
  setNote,
  storageStats,
} from '@/lib/history/db';
import { buildSnapshotSrcdoc, markHighlight } from '@/lib/history/snapshot';
import { checkToStandaloneHtml } from '@/lib/history/export';
import type { CheckResult } from '@/lib/pipeline/schema';

function fakeResult(over: Partial<CheckResult> = {}): CheckResult {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    input: { kind: 'text', text: 'The definition of insanity is doing the same thing', pageUrl: 'https://medium.com/@a/b', pageTitle: 'Why' },
    provider: { id: 'gemini', label: 'Google AI', model: 'gemini-3.8-flash' },
    narrative: 'Quote Investigator traced it.',
    verdict: { label: 'Misattributed', kind: 'misattributed', confidence: 'high', summary: 'Not Einstein.' },
    claims: [{ text: 'Einstein said it', status: 'disputed', note: 'no', sourceIds: [1] }],
    sources: [{ id: 1, title: 'QI', url: 'https://quoteinvestigator.com/x', domain: 'quoteinvestigator.com', verified: true }],
    searchQueries: ['q'],
    rawText: '',
    ...over,
  };
}

describe('history db', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
    resetDbForTests();
  });

  it('saves, lists newest-first, filters and deletes', async () => {
    const a = await saveCheck(fakeResult({ createdAt: 1000 }), {
      url: 'https://medium.com/@a/b',
      title: 'Why',
      html: '<p>hello</p>',
      capturedAt: 1000,
      highlight: 'hello',
    });
    const b = await saveCheck(fakeResult({ createdAt: 2000, input: { kind: 'page', url: 'https://example.com', title: 'Example' } }));
    const all = await listChecks();
    expect(all.map((c) => c.id)).toEqual([b.id, a.id]);
    expect((await listChecks({ kind: 'text' })).map((c) => c.id)).toEqual([a.id]);
    expect((await listChecks({ withSnapshot: true })).map((c) => c.id)).toEqual([a.id]);
    expect((await listChecks({ query: 'example' })).map((c) => c.id)).toEqual([b.id]);
    expect((await getSnapshot(a.id))?.html).toBe('<p>hello</p>');
    await setNote(a.id, 'remember this');
    expect((await getCheck(a.id))?.note).toBe('remember this');
    await deleteCheck(a.id);
    expect(await getCheck(a.id)).toBeUndefined();
    expect(await getSnapshot(a.id)).toBeUndefined();
    await clearHistory();
    expect(await listChecks()).toHaveLength(0);
  });

  it('evicts the oldest snapshots first when over the cap, keeping the results', async () => {
    const big = 'x'.repeat(10_000);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await saveCheck(fakeResult({ createdAt: 1000 + i }), { url: 'u', title: 't', html: big, capturedAt: 1 });
      ids.push(c.id);
    }
    const before = await storageStats();
    expect(before.snapshots).toBe(4);
    const removed = await enforceSnapshotCap(before.snapshotBytes / 2);
    expect(removed).toBe(2);
    const after = await storageStats();
    expect(after.snapshots).toBe(2);
    expect(after.checks).toBe(4);
    expect((await getCheck(ids[0]!))?.hasSnapshot).toBe(false);
    expect((await getCheck(ids[3]!))?.hasSnapshot).toBe(true);
  });
});

describe('snapshot rendering', () => {
  it('marks the smallest element containing the highlight', () => {
    const doc = new DOMParser().parseFromString(
      '<article><p>Intro.</p><p>As Einstein put it, “the definition of insanity is doing the same thing over and over”.</p><p>Outro.</p></article>',
      'text/html',
    );
    expect(markHighlight(doc, 'the definition of insanity is doing the same thing')).toBe(true);
    const marked = doc.querySelectorAll('[data-wys-mark]');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.tagName).toBe('P');
    expect(marked[0]?.textContent).toContain('Einstein');
  });
  it('builds a sandboxed document with a CSP and no scripts', () => {
    const html = buildSnapshotSrcdoc({
      html: '<p>hi <script>alert(1)</script><a href="https://x.y/z">link</a><img src="https://x.y/i.png"></p>',
      title: 'T',
      url: 'https://x.y',
      capturedAt: 0,
      highlight: 'hi',
    });
    expect(html).toContain('Content-Security-Policy');
    expect(html).not.toContain('<script');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('data-wys-mark');
    expect(html).toContain('img-src data:;');
    expect(buildSnapshotSrcdoc({ html: '', title: 'T', url: 'u', capturedAt: 0 }, { loadImages: true })).toContain('img-src data: https: http:');
  });
  it('exports a standalone html file', async () => {
    indexedDB = new IDBFactory();
    resetDbForTests();
    const c = await saveCheck(fakeResult(), {
      url: 'https://medium.com/@a/b',
      title: 'Why',
      html: '<p>The definition of insanity is doing the same thing</p>',
      capturedAt: 1,
    });
    const html = checkToStandaloneHtml(c, (await getSnapshot(c.id)) ?? null);
    expect(html).toContain('Misattributed');
    expect(html).toContain('quoteinvestigator.com');
    expect(html).toContain('srcdoc=');
  });
});
