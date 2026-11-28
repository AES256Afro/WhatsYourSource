import { describe, expect, it } from 'vitest';
import { googleAiModeUrl } from '@/lib/googleAiMode';
import { checkToStandaloneHtml } from '@/lib/history/export';
import { resultToRow, TABLE_COLUMNS } from '@/lib/history/row';
import type { StoredCheck } from '@/lib/history/db';
import { CheckInputSchema, clampInput, isDirectQuestion, MAX_DIRECT_QUESTION, type CheckInput } from '@/lib/messaging/protocol';
import { buildClaimsRequest, extractClaims, wantsClaimListing } from '@/lib/pipeline/claims';
import { buildFollowUpRequest, runFollowUp } from '@/lib/pipeline/followUp';
import { buildRequest, DIRECT_QUESTION_SYSTEM_PROMPT, searchHintFor } from '@/lib/pipeline/prompts';
import type { CheckResult } from '@/lib/pipeline/schema';
import type { GenerateRequest, GenEvent, LlmProvider } from '@/lib/providers/types';

const Q = 'Did the Eiffel Tower ever have a restaurant on the second floor?';
const direct = (text = Q): CheckInput => ({ kind: 'text', text, pageUrl: '', pageTitle: '', question: true, ask: { id: 'custom', custom: text } });
const textOf = (r: GenerateRequest) => [r.system, ...r.parts.map((p) => ('text' in p ? p.text : ''))].join('\n');
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const result = (input: CheckInput): CheckResult =>
  ({
    id: 'r1',
    createdAt: Date.UTC(2026, 10, 27, 12),
    input,
    provider: { id: 'gemini', label: 'Gemini', model: 'm' },
    title: 'Eiffel Tower second-floor restaurant',
    narrative: 'Yes: Le Jules Verne has been on the second floor since 1983.',
    verdict: { label: 'Well documented', kind: 'supported', confidence: 'high', summary: 'Le Jules Verne opened there in 1983.' },
    claims: [],
    sources: [{ id: 1, title: 'Le Jules Verne', url: 'https://www.toureiffel.paris/en/restaurants', domain: 'toureiffel.paris', verified: true }],
    rawText: '',
    searchQueries: [],
  }) as unknown as CheckResult;

function provider(events: GenEvent[], seen: GenerateRequest[] = []): LlmProvider {
  return {
    id: 'gemini',
    label: 'Gemini',
    model: 'm',
    capabilities: { image: true, webSearch: true, urlContext: true },
    async *generate(req) {
      seen.push(req);
      yield* events;
    },
    validate: async () => ({ ok: true }),
  };
}

describe('direct question: schema and limits', () => {
  it('accepts a direct question and recognises it', () => {
    const parsed = CheckInputSchema.parse(direct());
    expect(parsed).toMatchObject({ kind: 'text', question: true, ask: { id: 'custom', custom: Q } });
    expect(isDirectQuestion(parsed)).toBe(true);
  });

  it('rejects a direct question over the cap, and clampInput brings it within it', () => {
    const long = 'why '.repeat(200);
    expect(CheckInputSchema.safeParse({ ...direct(long), ask: { id: 'custom', custom: Q } }).success).toBe(false);
    const clamped = clampInput(direct(long));
    expect(clamped.kind === 'text' && clamped.text.length).toBe(MAX_DIRECT_QUESTION);
    expect(CheckInputSchema.safeParse(clamped).success).toBe(true);
  });

  it('clampInput drops any page, surrounding text or preset ask from a direct question', () => {
    const c = clampInput({ ...direct(), pageTitle: 'T', surrounding: 'around', ask: { id: 'flaws' } } as CheckInput);
    expect(c).toMatchObject({ pageUrl: '', pageTitle: '', ask: { id: 'custom', custom: Q } });
    expect(c.kind === 'text' && c.surrounding).toBeUndefined();
  });

  it('ignores the flag on text that has a web page, and on ordinary pasted text', () => {
    expect(isDirectQuestion({ ...direct(), pageUrl: 'https://example.com/' } as CheckInput)).toBe(false);
    expect(isDirectQuestion({ kind: 'text', text: Q, pageUrl: '', pageTitle: '' })).toBe(false);
  });
});

describe('direct question: prompts', () => {
  it('puts the question once, with no untrusted content block and no page attributes', () => {
    const req = buildRequest(direct());
    const all = textOf(req);
    expect(count(all, Q)).toBe(1);
    // The rules mention the tag; no block of it is opened.
    expect(all).not.toContain('<untrusted_content kind=');
    expect(all).not.toMatch(/\b(page|title)="/);
    expect(all).not.toContain('The user pasted this text');
    expect(req.system).toBe(DIRECT_QUESTION_SYSTEM_PROMPT);
    expect(req.system).toContain('no web page and no selected text');
    expect(req.pageUrl).toBeUndefined();
    expect(req.urls).toEqual([]);
    expect(searchHintFor(direct())).toBe(Q);
  });

  it('lookups supplied by the extension still go in as untrusted data', () => {
    const all = textOf(buildRequest(direct(), { lookups: 'Snopes: True' }));
    expect(all).toContain('<untrusted_content kind="lookups">');
    expect(count(all, Q)).toBe(1);
  });

  it('skips the claim-listing pass', async () => {
    expect(wantsClaimListing(direct())).toBe(false);
    expect(wantsClaimListing({ kind: 'text', text: Q, pageUrl: '', pageTitle: '' })).toBe(true);
    const seen: GenerateRequest[] = [];
    expect(
      await extractClaims(direct(), provider([{ type: 'delta', text: '```json\n{"claims":["x claim"]}\n```' }], seen), new AbortController().signal),
    ).toEqual([]);
    expect(seen).toHaveLength(0);
    // The builder itself is unchanged for other text.
    expect(textOf(buildClaimsRequest({ kind: 'text', text: 'A claim.', pageUrl: '', pageTitle: '' }))).toContain('A claim.');
  });
});

describe('direct question: follow-ups', () => {
  it('carries the direct-question framing into the follow-up request', () => {
    const req = buildFollowUpRequest(result(direct()), 'When did it open?');
    const all = textOf(req);
    expect(req.system).toContain('asked you a question directly');
    expect(req.system).not.toContain('piece of content');
    expect(count(all, Q)).toBe(1);
    expect(all).not.toContain('The check began with this content');
    expect(all).toContain('Verdict: Well documented');
    expect(all.endsWith('When did it open?')).toBe(true);
    expect(req.pageUrl).toBeUndefined();
  });

  it('stores follow-up sources without trackers, unwrapped and de-duplicated', async () => {
    const events: GenEvent[] = [
      { type: 'delta', text: 'In 1983.' },
      {
        type: 'sources',
        sources: [
          { url: 'https://example.org/jules-verne?utm_source=x&fbclid=abc&id=7', domain: 'example.org', title: 'A' },
          { url: 'https://example.org/jules-verne?id=7&gclid=zzz', domain: 'example.org', title: 'A again' },
        ],
      },
    ];
    let done: { url: string }[] = [];
    for await (const ev of runFollowUp(result(direct()), 'When?', provider(events), new AbortController().signal))
      if (ev.type === 'done') done = ev.followUp.sources;
    expect(done.map((s) => s.url)).toEqual(['https://example.org/jules-verne?id=7']);
  });
});

describe('direct question: Google AI Mode, rows and exports', () => {
  it('opens Google AI Mode with just the question', () => {
    const url = googleAiModeUrl(direct(), 'ai-mode', { id: 'flaws' });
    expect(url).toBe(`https://www.google.com/search?udm=50&q=${encodeURIComponent(Q)}`);
  });

  it('labels the table row as a question', () => {
    const row = resultToRow(result(direct()));
    const col = (name: (typeof TABLE_COLUMNS)[number]) => row[TABLE_COLUMNS.indexOf(name)];
    expect(col('Content type')).toBe('Question');
    expect(col('Question type')).toBe('Question');
    expect(col('Question')).toBe(Q);
    expect(col('What was checked')).toBe('');
    expect(row.join('\n')).not.toMatch(/Pasted|Your question/);
  });

  it('shows the question once in the HTML export, not as a quoted block', () => {
    const check = {
      id: 'r1',
      createdAt: 1,
      kind: 'text',
      title: Q,
      site: '',
      verdictLabel: 'Well documented',
      verdictKind: 'supported',
      providerLabel: 'Gemini',
      model: 'm',
      hasSnapshot: false,
      note: '',
      result: result(direct()),
    } as StoredCheck;
    const html = checkToStandaloneHtml(check);
    expect(html).toContain('<strong>Your question:</strong>');
    expect(html).not.toContain('<blockquote>');
  });
});
