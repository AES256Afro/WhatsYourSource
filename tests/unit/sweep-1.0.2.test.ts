import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { googleAiModeUrl } from '@/lib/googleAiMode';
import { getCheck, resetDbForTests, saveCheck, setNote, updateCheckResult, deleteCheck } from '@/lib/history/db';
import { aiHints } from '@/lib/image/provenance';
import { extractPost } from '@/lib/post/extract';
import type { CheckResult } from '@/lib/pipeline/schema';
import { isPublicHttpUrl, normalizeUrl, truncate } from '@/lib/util/url';

/** Regressions for the 1.0.2 sweeps (docs/SWEEPS.md, 2026-11-15). */
describe('text cut through an emoji', () => {
  it('never leaves half a surrogate pair', () => {
    const s = 'a'.repeat(898) + '😀' + 'b'.repeat(50);
    expect(truncate(s, 900).isWellFormed()).toBe(true);
  });
  it('builds a Google AI Mode address instead of throwing', () => {
    const text = 'a'.repeat(898) + '😀' + 'b'.repeat(50);
    expect(() => googleAiModeUrl({ kind: 'text', text, pageUrl: '', pageTitle: '' }, 'ai-mode')).not.toThrow();
    expect(() => googleAiModeUrl({ kind: 'text', text: 'lone \uD800 surrogate here', pageUrl: '', pageTitle: '' }, 'overview')).not.toThrow();
  });
});

describe('Google AI Mode query', () => {
  it('never carries a local file path or an extension page', () => {
    const u = googleAiModeUrl({ kind: 'page', url: 'file:///Users/someone/private.html', title: '' }, 'ai-mode');
    expect(decodeURIComponent(u)).not.toContain('file:');
    expect(decodeURIComponent(u)).not.toContain('someone');
  });
});

describe('normalizeUrl', () => {
  it('treats http and https, with and without www, as one page', () => {
    expect(normalizeUrl('http://example.org/x')).toBe(normalizeUrl('https://www.example.org/x'));
    expect(normalizeUrl('https://EXAMPLE.org/x')).toBe(normalizeUrl('https://example.org/x'));
  });
  it('keeps case-sensitive paths apart', () => {
    expect(normalizeUrl('https://youtu.be/AbC')).not.toBe(normalizeUrl('https://youtu.be/abc'));
  });
});

describe('isPublicHttpUrl', () => {
  it('rejects common private-network names', () => {
    for (const u of ['http://router.lan/', 'http://nas.home/', 'http://wiki.corp/', 'http://x.intranet/', 'http://pc.localdomain/'])
      expect(isPublicHttpUrl(u), u).toBe(false);
  });
});

describe('AI generator hints', () => {
  it('ignores captions, credits and names', () => {
    expect(aiHints({ Description: 'Imagen de archivo', Artist: 'Erika Klingler', Copyright: 'Fireflies at dusk, Runway Road' })).toEqual([]);
  });
  it('still reads what the tool wrote about itself', () => {
    expect(aiHints({ Software: 'Adobe Firefly' })).toContain('Adobe Firefly');
    expect(aiHints({ parameters: 'a cat\nSteps: 20, Sampler: Euler' }).length).toBeGreaterThan(0);
  });
});

describe('post links', () => {
  it('does not mistake ordinary sites for link shorteners', () => {
    document.body.innerHTML = `<article><p>${'Some post text that is long enough to count as a post. '.repeat(3)}</p>
      <a href="https://www.nytimes.com/a">one</a> <a href="https://www.washingtonpost.com/b">two</a> <a href="https://t.co/xyz">short</a></article>`;
    const r = extractPost(document.querySelector('p'))!;
    expect(r).not.toBeNull();
    expect(r.links).toContain('https://www.washingtonpost.com/b');
    expect(r.links).not.toContain('https://t.co/xyz');
  });
});

describe('late evidence update', () => {
  const result = (id: string): CheckResult =>
    ({
      id,
      createdAt: 1,
      input: { kind: 'text', text: 'a claim', pageUrl: 'https://example.com/', pageTitle: 't' },
      verdict: { label: 'Supported', kind: 'supported', confidence: 'high', summary: 's' },
      narrative: 'n',
      claims: [],
      sources: [],
      provider: { id: 'gemini', label: 'Gemini', model: 'm' },
    }) as unknown as CheckResult;
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetDbForTests();
  });
  it('keeps a note typed in the meantime', async () => {
    const r = result('a');
    await saveCheck(r, null);
    await setNote('a', 'my note');
    expect(await updateCheckResult({ ...r, narrative: 'with evidence' })).toBe(true);
    const c = await getCheck('a');
    expect(c?.note).toBe('my note');
    expect(c?.result.narrative).toBe('with evidence');
  });
  it('does not bring a deleted check back', async () => {
    const r = result('b');
    await saveCheck(r, null);
    await deleteCheck('b');
    expect(await updateCheckResult(r)).toBe(false);
    expect(await getCheck('b')).toBeUndefined();
  });
});
