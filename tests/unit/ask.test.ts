import { describe, expect, it } from 'vitest';
import { googleAiModeUrl } from '@/lib/googleAiMode';
import { checksToCsv, checkToRow, resultToTsvRow, TABLE_COLUMNS } from '@/lib/history/export';
import type { StoredCheck } from '@/lib/history/db';
import type { CheckInput } from '@/lib/messaging/protocol';
import { CheckInputSchema } from '@/lib/messaging/protocol';
import { resolveTimeline } from '@/lib/pipeline/merge';
import { buildRequest, searchHintFor } from '@/lib/pipeline/prompts';
import { ASK_PRESETS, askLabel, normalizeAsk, questionFor } from '@/lib/pipeline/question';
import { parseModelResult, type CheckResult, type Source } from '@/lib/pipeline/schema';
import { DEFAULT_SETTINGS, defaultAsk, mergeSettings } from '@/lib/storage/settings';

const text: CheckInput = { kind: 'text', text: 'The moon landing was staged in 1969.', pageUrl: 'https://example.com/a', pageTitle: 'A' };
const userText = (input: CheckInput) =>
  buildRequest(input)
    .parts.map((p) => ('text' in p ? p.text : ''))
    .join('\n');

describe('the question is the user’s choice', () => {
  it('defaults to the fact-check question when nothing is chosen', () => {
    expect(normalizeAsk(undefined)).toEqual({ id: 'factcheck' });
    expect(userText(text)).toContain(ASK_PRESETS.factcheck.question.text);
  });

  it('puts each preset to the model, the system prompt and the search query', () => {
    for (const id of ['explain', 'timeline', 'flaws'] as const) {
      const input = { ...text, ask: { id } };
      const q = ASK_PRESETS[id].question.text;
      expect(userText(input)).toContain(q);
      expect(buildRequest(input).system).toContain(`"${q}"`);
      expect(searchHintFor(input).startsWith(q)).toBe(true);
      expect(decodeURIComponent(googleAiModeUrl(input, 'ai-mode'))).toContain(q);
    }
  });

  it('asks a custom question in the user’s words, after the untrusted content', () => {
    const input = { ...text, ask: { id: 'custom' as const, custom: '  Who benefits from\nthis claim?  ' } };
    const t = userText(input);
    expect(t).toContain('Who benefits from this claim?');
    expect(t.indexOf('</untrusted_content>')).toBeLessThan(t.indexOf('Who benefits'));
    expect(askLabel(input.ask)).toBe('Your question');
  });

  it('falls back to the fact-check when the custom question is empty', () => {
    expect(questionFor({ id: 'custom', custom: '   ' }, 'text')).toBe(ASK_PRESETS.factcheck.question.text);
  });

  it('uses the settings default only when the input carries no question of its own', () => {
    const settingsAsk = { id: 'timeline' as const };
    expect(decodeURIComponent(googleAiModeUrl(text, 'ai-mode', settingsAsk))).toContain(ASK_PRESETS.timeline.question.text);
    expect(decodeURIComponent(googleAiModeUrl({ ...text, ask: { id: 'flaws' } }, 'ai-mode', settingsAsk))).toContain(ASK_PRESETS.flaws.question.text);
  });

  it('survives the message schema and old settings', () => {
    expect(CheckInputSchema.parse({ ...text, ask: { id: 'timeline' } }).ask).toEqual({ id: 'timeline' });
    expect(CheckInputSchema.safeParse({ ...text, ask: { id: 'nope' } }).success).toBe(false);
    const old = mergeSettings(DEFAULT_SETTINGS, { version: 1, onboarded: true });
    expect(defaultAsk(old)).toEqual({ id: 'factcheck' });
    expect(defaultAsk(mergeSettings(DEFAULT_SETTINGS, { ask: { default: 'custom', custom: 'Why now?' } }))).toEqual({ id: 'custom', custom: 'Why now?' });
  });
});

describe('timeline, title and topic in the answer', () => {
  it('are read leniently and linked to sources', () => {
    const parsed = parseModelResult(
      JSON.stringify({
        title: 'Moon landing hoax claim',
        topic: 'history',
        verdict: { label: 'Disputed', kind: 'disputed', confidence: 'high', summary: 's' },
        claims: [],
        sources: [{ title: 'NASA', url: 'https://nasa.gov/apollo11' }],
        timeline: [{ date: '20 July 1969', event: 'Apollo 11 lands.', sourceUrl: 'https://nasa.gov/apollo11' }, { event: '' }, 'junk'],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.title).toBe('Moon landing hoax claim');
    const sources: Source[] = [{ id: 1, title: 'NASA', url: 'https://nasa.gov/apollo11', domain: 'nasa.gov', verified: true }];
    expect(resolveTimeline(parsed.value, sources)).toEqual([{ date: '20 July 1969', event: 'Apollo 11 lands.', sourceId: 1 }]);
  });
  it('a bare year or an odd topic never sinks the whole answer', () => {
    const parsed = parseModelResult(
      JSON.stringify({
        topic: ['politics'],
        title: 7,
        verdict: { label: 'x', kind: 'supported', confidence: 'low', summary: '' },
        claims: [],
        sources: [{ url: 'https://a.example/', date: 1981 }],
        timeline: [{ date: 1981, event: 'It appears in print.' }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(resolveTimeline(parsed.value, [])).toEqual([{ date: '1981', event: 'It appears in print.', sourceId: undefined }]);
  });
  it('keeps the up-front search query within what search APIs accept', () => {
    const long = { ...text, ask: { id: 'custom' as const, custom: 'why '.repeat(75) } };
    const hint = searchHintFor(long);
    expect(hint.length).toBeLessThanOrEqual(380);
    expect(hint.split(' ').length).toBeLessThanOrEqual(50);
  });
  it('an answer without a timeline is still valid', () => {
    const parsed = parseModelResult(JSON.stringify({ verdict: { label: 'x', kind: 'supported', confidence: 'low', summary: '' }, claims: [], sources: [] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(resolveTimeline(parsed.value, [])).toBeUndefined();
  });
});

describe('spreadsheet export', () => {
  const check = (over: Partial<CheckResult> = {}, note = ''): StoredCheck => ({
    id: 'a',
    createdAt: Date.UTC(2026, 10, 15, 9, 30),
    kind: 'text',
    title: 'The moon landing was staged',
    site: 'example.com',
    verdictLabel: 'Disputed',
    verdictKind: 'disputed',
    providerLabel: 'Gemini',
    model: 'gemini-3.8-flash',
    hasSnapshot: false,
    note,
    result: {
      id: 'a',
      createdAt: 1,
      input: { ...text, ask: { id: 'flaws' } },
      provider: { id: 'gemini', label: 'Gemini', model: 'gemini-3.8-flash' },
      narrative: 'It was not staged.',
      verdict: { label: 'Disputed', kind: 'disputed', confidence: 'high', summary: 'Not staged, "per NASA".' },
      claims: [],
      sources: [
        { id: 1, title: 'NASA', url: 'https://nasa.gov/apollo11', domain: 'nasa.gov', verified: true },
        { id: 2, title: 'Blog', url: 'https://blog.example/x', domain: 'blog.example', verified: false },
      ],
      searchQueries: [],
      rawText: '',
      title: 'Moon landing hoax claim',
      topic: 'history',
      ...over,
    },
  });

  it('has one value per column', () => {
    expect(checkToRow(check())).toHaveLength(TABLE_COLUMNS.length);
  });
  it('files the check under its title, topic and question, with verified sources only', () => {
    const row = checkToRow(check());
    const col = (name: (typeof TABLE_COLUMNS)[number]) => row[TABLE_COLUMNS.indexOf(name)];
    expect(col('Title')).toBe('Moon landing hoax claim');
    expect(col('Topic')).toBe('History');
    expect(col('Question type')).toBe('Find the flaws');
    expect(col('Question')).toBe(ASK_PRESETS.flaws.question.text);
    expect(col('Answer')).toBe('It was not staged.');
    expect(col('Content type')).toBe('Text');
    expect(col('Sources')).toBe('https://nasa.gov/apollo11');
  });
  it('quotes cells and never emits a formula', () => {
    const csv = checksToCsv([check({}, '=HYPERLINK("http://evil","x")')]);
    expect(csv.startsWith('﻿"Date (local time)","Title"')).toBe(true);
    expect(csv).toContain('"Not staged, ""per NASA""."');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csv.trimEnd().split('\r\n')).toHaveLength(2);
  });
  it('gives one pasteable line per check, with no tabs or line breaks inside a value', () => {
    const line = resultToTsvRow(
      check({ timeline: [{ date: '1969', event: 'Landing.' }, { event: 'Hoax claims\tappear.' }], narrative: 'a\nb' }).result,
      '=SUM(A1)',
    );
    expect(line.split('\t')).toHaveLength(TABLE_COLUMNS.length);
    expect(line).not.toContain('\n');
    expect(line).toContain('1969: Landing. | Hoax claims appear.');
    expect(line.endsWith("'=SUM(A1)")).toBe(true);
  });
});

describe('bug sweep 3', () => {
  it('quotes a pasted cell that contains a double quote', () => {
    const input: CheckInput = { kind: 'text', text: '"We will win" he said, and "more', pageUrl: 'https://example.com/', pageTitle: '' };
    const line = resultToTsvRow({
      id: 'q',
      createdAt: 1,
      input,
      provider: { id: 'gemini', label: 'Gemini', model: 'm' },
      narrative: 'n',
      verdict: { label: 'Unverified', kind: 'unverified', confidence: 'low', summary: 's' },
      claims: [],
      sources: [],
      searchQueries: [],
      rawText: '',
    });
    const cells = line.split('\t');
    expect(cells).toHaveLength(TABLE_COLUMNS.length);
    expect(cells[TABLE_COLUMNS.indexOf('What was checked')]).toBe('"""We will win"" he said, and ""more"');
  });
});

describe('the chip names a non-default question', () => {
  it('mirrors the picker labels', async () => {
    const { PUBLIC_ASK_NAMES, readPublicSettings } = await import('@/lib/storage/publicSettings');
    const { askIdLabel } = await import('@/lib/pipeline/question');
    for (const id of ['explain', 'timeline', 'flaws'] as const) expect(PUBLIC_ASK_NAMES[id]).toBe(askIdLabel(id));
    const { CUSTOM_ASK_NAME } = await import('@/lib/pipeline/question');
    expect(PUBLIC_ASK_NAMES.custom).toBe(CUSTOM_ASK_NAME);
    expect(readPublicSettings({ ask: { default: 'timeline', custom: '' } }).askName).toBe('Timeline');
    expect(readPublicSettings({ ask: { default: 'factcheck', custom: '' } }).askName).toBe('');
    expect(readPublicSettings({ ask: { default: 'custom', custom: '  ' } }).askName).toBe('');
    expect(readPublicSettings({}).askName).toBe('');
  });
});
