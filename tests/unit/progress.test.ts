import { describe, expect, it } from 'vitest';
import { emptyRunState, reduceProgress } from '@/lib/pipeline/progress';
import { stripThinking } from '@/lib/pipeline/schema';
import type { CheckInput } from '@/lib/messaging/protocol';

const input: CheckInput = { kind: 'text', text: 'hello', pageUrl: 'https://x', pageTitle: '' };

describe('progress rows', () => {
  it('replaces repeating search and read rows instead of piling them up', () => {
    let s = emptyRunState(input, 'Local');
    s = reduceProgress(s, { type: 'status', message: 'Searching: a' });
    s = reduceProgress(s, { type: 'status', message: 'Reading a.com' });
    s = reduceProgress(s, { type: 'status', message: 'Searching: b' });
    s = reduceProgress(s, { type: 'status', message: 'Reading b.com' });
    expect(s.statuses).toEqual(['Searching: b', 'Reading b.com']);
  });
  it('keeps claims and earlier statuses when a provider takes over', () => {
    const s = { ...emptyRunState(input, 'Gemini', ['Listing the claims to check…'], ['claim one']) };
    const next = { ...emptyRunState(input, 'Claude', s.statuses, s.claims), startedAt: s.startedAt };
    expect(next.claims).toEqual(['claim one']);
    expect(next.statuses).toEqual(['Listing the claims to check…']);
    expect(next.startedAt).toBe(s.startedAt);
  });
});

describe('stripThinking', () => {
  it('removes closed and unclosed think blocks', () => {
    expect(stripThinking('<think>hmm</think>\nAnswer. ```json\n{}\n```')).toBe('Answer. ```json\n{}\n```');
    expect(stripThinking('Partial <think>still going')).toBe('Partial ');
    expect(stripThinking('No tags')).toBe('No tags');
  });
});
