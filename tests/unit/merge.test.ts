import { describe, expect, it } from 'vitest';
import { buildSources, resolveClaims, resolveOriginal } from '@/lib/pipeline/merge';
import type { ModelResult } from '@/lib/pipeline/schema';
import type { RawSource } from '@/lib/providers/types';

const raw: RawSource[] = [
  {
    url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
    title: 'quoteinvestigator.com',
    domain: 'quoteinvestigator.com',
    verified: true,
  },
  { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/def', title: 'en.wikiquote.org', domain: 'en.wikiquote.org', verified: true },
];

const model: ModelResult = {
  verdict: { label: 'Misattributed', kind: 'misattributed', confidence: 'high', summary: '' },
  originalSource: { title: 'NA Basic Text', url: 'https://archive.org/details/na-basic-text', publisher: 'NA', date: '1981', how: '' },
  claims: [
    { text: 'Einstein said it', status: 'disputed', note: 'no', sourceUrls: ['https://quoteinvestigator.com/2017/03/23/same/', 'https://example.org/nope'] },
  ],
  sources: [
    { title: 'Insanity Is Doing the Same Thing…', url: 'https://quoteinvestigator.com/2017/03/23/same/', date: '2017' },
    { title: 'Albert Einstein — Misattributed', url: 'https://en.wikiquote.org/wiki/Albert_Einstein', date: null },
    { title: 'NA Basic Text scan', url: 'https://archive.org/details/na-basic-text', date: '1981' },
  ],
  notes: null,
};

describe('buildSources', () => {
  it('keeps verified grounding entries, enriches titles from the model, and flags unknown domains', () => {
    const s = buildSources(model, raw);
    expect(s).toHaveLength(3);
    const qi = s.find((x) => x.domain === 'quoteinvestigator.com')!;
    expect(qi.verified).toBe(true);
    expect(qi.url).toContain('grounding-api-redirect'); // the link that always resolves
    expect(qi.title).toMatch(/Insanity/);
    expect(qi.date).toBe('2017');
    const ar = s.find((x) => x.domain === 'archive.org')!;
    expect(ar.verified).toBe(false);
  });
  it('works without a model result', () => {
    expect(buildSources(null, raw)).toHaveLength(2);
  });
  it('dedupes the same URL in different spellings', () => {
    const s = buildSources(
      {
        ...model,
        sources: [
          { title: 'a', url: 'https://www.example.com/p/?utm_source=x', date: null },
          { title: 'b', url: 'https://example.com/p', date: null },
        ],
      },
      [],
    );
    expect(s).toHaveLength(1);
  });
});

describe('resolveClaims / resolveOriginal', () => {
  it('maps claim URLs to source ids, dropping unknown ones', () => {
    const s = buildSources(model, raw);
    const claims = resolveClaims(model, s);
    expect(claims[0]?.sourceIds).toEqual([s.find((x) => x.domain === 'quoteinvestigator.com')!.id]);
  });
  it('links the original source to its entry', () => {
    const s = buildSources(model, raw);
    const o = resolveOriginal(model, s)!;
    expect(o.title).toBe('NA Basic Text');
    expect(o.sourceId).toBe(s.find((x) => x.domain === 'archive.org')!.id);
  });
});

describe('original source linking', () => {
  it('only links the original-source card on an exact URL match, never a same-domain redirect', () => {
    const s = buildSources(model, raw);
    const o = resolveOriginal(
      {
        ...model,
        originalSource: { title: 'Some other QI page', url: 'https://quoteinvestigator.com/2020/01/01/other/', publisher: 'QI', date: null, how: null },
      },
      s,
    )!;
    expect(o.url).toBe('https://quoteinvestigator.com/2020/01/01/other/');
    expect(o.sourceId).toBeUndefined();
  });
});
