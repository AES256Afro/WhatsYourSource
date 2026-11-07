import { describe, expect, it } from 'vitest';
import { lookup, sourceMixNotes, type CredibilityEntry } from '@/lib/lookups/credibility';
import { factCheckQuery, parseFactChecks } from '@/lib/lookups/factcheck';
import { parseCdxTimestamp } from '@/lib/lookups/wayback';
import { lookupsForPrompt } from '@/lib/lookups';
import { buildRequest } from '@/lib/pipeline/prompts';
import { parseModelResult } from '@/lib/pipeline/schema';

describe('credibility', () => {
  const entries: CredibilityEntry[] = [
    { name: 'CNN', status: 'reliable', domains: ['cnn.com'], summary: 'Generally reliable.' },
    { name: 'The Sun', status: 'deprecated', domains: ['thesun.co.uk'], summary: 'Deprecated.' },
  ];
  const byDomain = new Map<string, CredibilityEntry>();
  for (const e of entries) for (const d of e.domains) byDomain.set(d, e);

  it('matches parent domains and full URLs', () => {
    expect(lookup(byDomain, 'edition.cnn.com')?.name).toBe('CNN');
    expect(lookup(byDomain, 'https://www.thesun.co.uk/news/1')?.status).toBe('deprecated');
    expect(lookup(byDomain, 'example.org')).toBeUndefined();
  });
  it('notes a one-outlet source list and unreliable outlets', () => {
    const ratings = { 'thesun.co.uk': { name: 'The Sun', status: 'deprecated' as const, statusLabel: 'Deprecated', summary: '' } };
    expect(sourceMixNotes(['thesun.co.uk', 'thesun.co.uk', 'thesun.co.uk'], ratings).join(' ')).toMatch(/Every source is from thesun.co.uk/);
    expect(sourceMixNotes(['thesun.co.uk', 'cnn.com'], ratings).join(' ')).toMatch(/rated unreliable/);
    expect(sourceMixNotes(['cnn.com', 'bbc.co.uk'], {})).toEqual([]);
  });
  it('ships a usable dataset', async () => {
    const data = (await import('@/data/reliable-sources.json')).default as { entries: CredibilityEntry[] };
    expect(data.entries.length).toBeGreaterThan(300);
    expect(data.entries.find((e) => e.domains.includes('snopes.com'))?.status).toBe('reliable');
  });
});

describe('fact checks', () => {
  it('parses ClaimReview results and drops ones without a link', () => {
    const out = parseFactChecks({
      claims: [
        {
          text: 'The moon is cheese',
          claimant: 'Someone',
          claimReview: [
            {
              publisher: { name: 'PolitiFact', site: 'politifact.com' },
              url: 'https://politifact.com/x',
              textualRating: 'Pants on Fire',
              reviewDate: '2024-01-02T00:00:00Z',
            },
          ],
        },
        { text: 'No link', claimReview: [{ publisher: { name: 'X' }, textualRating: 'False' }] },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ publisher: 'PolitiFact', rating: 'Pants on Fire', url: 'https://politifact.com/x' });
  });
  it('builds a short query from the first sentence', () => {
    expect(factCheckQuery('"The definition of insanity is doing the same thing over and over." Then more text that is not needed here at all.')).toBe(
      'The definition of insanity is doing the same thing over and over.',
    );
  });
});

describe('wayback', () => {
  it('reads the earliest capture timestamp', () => {
    expect(parseCdxTimestamp([['timestamp'], ['20190304120000']])).toBe('2019-03-04');
    expect(parseCdxTimestamp([['timestamp']])).toBeNull();
    expect(parseCdxTimestamp({})).toBeNull();
  });
});

describe('lookups in the prompt and the result', () => {
  it('are framed as data inside an untrusted block', () => {
    const text = lookupsForPrompt({
      factChecks: [{ claim: 'c', publisher: 'Snopes', url: 'https://snopes.com/a', rating: 'False', reviewDate: '2024-05-06T00:00:00Z' }],
      pageCapture: { url: 'https://x', firstCaptured: '2015-04-07' },
    });
    const req = buildRequest({ kind: 'text', text: 'claim', pageUrl: 'https://p.example', pageTitle: 't' }, { lookups: text });
    const all = req.parts.map((p) => ('text' in p ? p.text : '')).join('\n');
    expect(all).toContain('kind="lookups"');
    expect(all).toContain('Snopes rated "c" as "False" (2024-05-06)');
    expect(all).toContain('first archived by the Wayback Machine on 2015-04-07');
  });
  it('evidence fields parse leniently', () => {
    const r = parseModelResult(
      '{"verdict":{"label":"x","kind":"supported","confidence":"high","summary":"s"},"evidence":{"for":["a",null,""],"against":"nope"},"missingContext":null,"wouldChange":"a primary document"}',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.evidence?.for).toEqual(['a']);
      expect(r.value.evidence?.against).toEqual([]);
      expect(r.value.wouldChange).toBe('a primary document');
    }
  });
});
