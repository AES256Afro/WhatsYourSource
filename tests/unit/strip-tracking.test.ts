import { describe, expect, it } from 'vitest';
import { stripTracking } from '@/lib/util/url';
import { buildSources, resolveOriginal } from '@/lib/pipeline/merge';
import { upgradeStoredCheck, type StoredCheck } from '@/lib/history/db';

describe('stripTracking', () => {
  it('drops campaign, click and mail trackers and keeps every other key as written', () => {
    expect(stripTracking('https://news.example/a?id=7&utm_source=x&utm_medium=y&fbclid=Z&page=2')).toBe('https://news.example/a?id=7&page=2');
    expect(stripTracking('https://shop.example/p?gclid=1&msclkid=2&mc_eid=3&_hsenc=4&q=a%20b')).toBe('https://shop.example/p?q=a%20b');
    expect(stripTracking('https://a.example/x?utm_campaign=1')).toBe('https://a.example/x');
  });

  it('keeps ref, which selects content on many sites, and the fragment', () => {
    expect(stripTracking('https://github.com/o/r/blob/x?ref=main#L10')).toBe('https://github.com/o/r/blob/x?ref=main#L10');
  });

  it('drops share trackers only on the hosts that use them', () => {
    expect(stripTracking('https://youtu.be/abc?si=TRACK&t=42')).toBe('https://youtu.be/abc?t=42');
    expect(stripTracking('https://www.youtube.com/watch?v=abc&feature=share&si=x')).toBe('https://www.youtube.com/watch?v=abc');
    expect(stripTracking('https://docs.example/api?feature=search')).toBe('https://docs.example/api?feature=search');
  });

  it('unwraps redirect wrappers to the real address, then cleans it', () => {
    expect(stripTracking('https://www.google.com/url?q=https%3A%2F%2Fnews.example%2Fa%3Futm_source%3Dg&sa=D')).toBe('https://news.example/a');
    expect(stripTracking('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org%2Fstory%3Ffbclid%3Dabc&h=AT0')).toBe('https://example.org/story');
    expect(stripTracking('https://www.youtube.com/redirect?q=https%3A%2F%2Fexample.org%2F&v=x')).toBe('https://example.org/');
  });

  it('leaves non-http input and unknown redirects alone', () => {
    expect(stripTracking('mailto:a@b.example')).toBe('mailto:a@b.example');
    expect(stripTracking('https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCd')).toBe(
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCd',
    );
  });
});

describe('links in results are stored without trackers', () => {
  it('sources from search and from the model, and the original source', () => {
    const model = {
      sources: [{ url: 'https://other.example/b?utm_source=m', title: 'B' }],
      originalSource: { title: 'Orig', url: 'https://orig.example/c?gclid=9' },
    } as never;
    const sources = buildSources(model, [{ url: 'https://news.example/a?fbclid=1&id=2', title: 'A', domain: 'news.example' }]);
    expect(sources.map((s) => s.url)).toEqual(['https://news.example/a?id=2', 'https://other.example/b']);
    expect(resolveOriginal(model, sources)?.url).toBe('https://orig.example/c');
  });

  it('checks saved before 1.3.0 come back clean', () => {
    const stored = {
      id: 'x',
      createdAt: 1,
      note: '',
      title: '',
      site: '',
      providerLabel: 'Gemini',
      result: {
        input: { kind: 'post', pageUrl: 'https://s.example/p', pageTitle: '', site: 's', text: 't', images: [], links: ['https://l.example/?utm_medium=1'] },
        sources: [{ id: 1, title: 'A', url: 'https://a.example/?utm_source=1', domain: 'a.example', verified: true }],
        factChecks: [{ claim: 'c', publisher: 'P', url: 'https://fc.example/r?fbclid=2', rating: 'False' }],
        followUps: [{ question: 'q', answer: 'a', askedAt: 1, sources: [{ title: 'F', url: 'https://f.example/?gclid=3', domain: 'f.example' }] }],
      },
    } as unknown as StoredCheck;
    const r = upgradeStoredCheck(stored).result;
    expect(r.sources[0]?.url).toBe('https://a.example/');
    expect(r.factChecks?.[0]?.url).toBe('https://fc.example/r');
    expect(r.followUps?.[0]?.sources[0]?.url).toBe('https://f.example/');
    expect(r.input.kind === 'post' && r.input.links).toEqual(['https://l.example/']);
  });
});
