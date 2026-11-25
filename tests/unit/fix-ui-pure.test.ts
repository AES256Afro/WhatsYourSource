import { describe, expect, it } from 'vitest';
import { customQuestionChanged, customTitle, menuItems } from '@/lib/menus';
import { jobIsForPanel, type Job } from '@/lib/jobs';
import { normalizeSiteEntry, siteAllowed } from '@/lib/storage/publicSettings';
import { DEFAULT_SETTINGS, withEndpoint } from '@/lib/storage/settings';
import { buildFollowUpRequest } from '@/lib/pipeline/followUp';
import type { CheckResult } from '@/lib/pipeline/schema';
import { usableHash } from '@/ui/hooks/useSeenBefore';

/** Regressions for the post-1.2.0 audit fixes in the panel, router and history (fix-ui). */

describe('C1-01 / B1-01: the menu is rebuilt when the custom question changes', () => {
  const stored = (custom?: string) => ({ ask: { default: 'factcheck', custom } });
  it('after a worker wake (nothing built yet) compares with the stored old value', () => {
    expect(customQuestionChanged({ oldValue: stored('Who pays?'), newValue: stored('') }, null)).toBe(true); // cleared
    expect(customQuestionChanged({ oldValue: stored('Who pays?'), newValue: stored('Who gains?') }, null)).toBe(true); // reworded
    expect(customQuestionChanged({ oldValue: stored('Who pays?'), newValue: stored('Who  pays? ') }, null)).toBe(false); // same words
    expect(customQuestionChanged({ oldValue: undefined, newValue: stored('Who pays?') }, null)).toBe(true);
  });
  it('compares with what the menu was built from when that is known', () => {
    expect(customQuestionChanged({ oldValue: stored('Who pays?'), newValue: stored('Who pays?') }, '')).toBe(true);
    expect(customQuestionChanged({ oldValue: stored('x'), newValue: stored('') }, '')).toBe(false);
  });
});

describe('B1-07 / B2-08: custom question menu titles', () => {
  it('shows & and %s as typed', () => {
    const t = customTitle('Who profits & who loses at 50%s?', 'selection');
    expect(t).toContain('profits && who');
    expect(t).not.toContain('%s');
  });
  it('never cuts through an emoji', () => {
    const t = customTitle('a'.repeat(46) + '😀' + 'b'.repeat(20), 'selection');
    expect(t.isWellFormed()).toBe(true);
    expect(menuItems('a'.repeat(46) + '😀 tail').every((i) => (i.title ?? '').isWellFormed())).toBe(true);
  });
});

describe('B7-01: a fallback window takes only jobs routed to it', () => {
  const job = (extra: Partial<Job> = {}): Job => ({
    id: 'j',
    createdAt: 0,
    windowId: 7,
    input: { kind: 'text', text: 'x', pageUrl: '', pageTitle: '' },
    ...extra,
  });
  it('the fallback window', () => {
    expect(jobIsForPanel(job({ surface: 'side' }), { fallback: true })).toBe(false);
    expect(jobIsForPanel(job({ surface: 'window' }), { fallback: true })).toBe(true);
    expect(jobIsForPanel(job(), { fallback: true })).toBe(true); // producer could not tell: never lost
  });
  it('a side panel takes its own window’s jobs, not the fallback window’s', () => {
    expect(jobIsForPanel(job({ surface: 'side' }), { fallback: false, windowId: 7 })).toBe(true);
    expect(jobIsForPanel(job({ surface: 'side' }), { fallback: false, windowId: 8 })).toBe(false);
    expect(jobIsForPanel(job({ surface: 'window' }), { fallback: false, windowId: 7 })).toBe(false);
  });
});

describe('C7-01: chip blocklist entries', () => {
  it('normalises entries to the host the page reports', () => {
    expect(
      ['Example.COM', 'https://www.Example.com:8080/path', 'example.com.', 'HTTP://example.com', 'bücher.de', ' ', 'http://'].map(normalizeSiteEntry),
    ).toEqual(['example.com', 'example.com', 'example.com', 'example.com', 'xn--bcher-kva.de', '', '']);
  });
  it('matches case-insensitively, subdomains included, also for entries saved by older builds', () => {
    expect(siteAllowed('news.example.com', ['Example.com'])).toBe(false);
    expect(siteAllowed('www.example.com', ['example.com'])).toBe(false);
    expect(siteAllowed('notexample.com', ['example.com'])).toBe(true);
    expect(siteAllowed('example.com', [''])).toBe(true);
  });
});

describe('P5S2-01 / P5C2-02: one rule for an endpoint change', () => {
  const o = {
    ...DEFAULT_SETTINGS.providers.openaiCompat,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-x',
    model: 'gpt-5-mini',
    modelVision: true,
    modelTools: true,
    modelContext: 400000,
  };
  it('a new host drops the key, the model and its flags', () => {
    const n = withEndpoint(o, 'http://192.168.1.5:8080/v1/');
    expect(n).toMatchObject({ baseUrl: 'http://192.168.1.5:8080/v1', apiKey: '', model: '', modelVision: null, modelTools: null, modelContext: null });
  });
  it('a new path on the same host keeps the key but not the model', () => {
    const n = withEndpoint(o, 'https://api.openai.com/v2');
    expect(n).toMatchObject({ apiKey: 'sk-x', model: '', modelVision: null });
  });
  it('the same address (a trailing slash) changes nothing', () => {
    expect(withEndpoint(o, 'https://api.openai.com/v1/ ')).toEqual(o);
  });
});

describe('R6-07 / O6-03: a follow-up does not re-send the original question’s output instructions', () => {
  const result = {
    id: 'r',
    createdAt: 0,
    input: { kind: 'text', text: 'The bridge opened in 1932.', pageUrl: 'https://a.example/', pageTitle: 'A', ask: { id: 'timeline' } },
    verdict: { label: 'Accurate', kind: 'supported', confidence: 'high', summary: 's' },
    narrative: 'n',
    rawText: '',
    claims: [],
    sources: [],
    searchQueries: [],
    provider: { id: 'gemini', label: 'Gemini', model: 'm' },
  } as unknown as CheckResult;
  it('keeps the content, restates the question once, drops the field instructions', () => {
    const text = (buildFollowUpRequest(result, 'When was it planned?').parts[0] as { text: string }).text;
    expect(text).toContain('The bridge opened in 1932.');
    expect(text).toContain('The original question was:');
    expect(text).not.toContain('"timeline" field');
    expect(text).toContain('When was it planned?');
  });
});

describe('phash: a missing or degenerate hash matches nothing', () => {
  it('usableHash', () => {
    expect(usableHash(undefined)).toBeNull();
    expect(usableHash(null)).toBeNull();
    expect(usableHash('0000000000000000')).toBeNull();
    expect(usableHash('8f3a00c1d2e4b5a6')).toBe('8f3a00c1d2e4b5a6');
  });
});
