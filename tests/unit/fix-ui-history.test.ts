import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { appendFollowUp, enforceSnapshotCap, getCheck, resetDbForTests, saveCheck, storageStats } from '@/lib/history/db';
import { localDay } from '@/lib/history/row';
import type { CheckResult, FollowUp } from '@/lib/pipeline/schema';
import { isDateOnly, localeDate } from '@/ui/components/EvidencePanel';
import { formatWhen } from '@/ui/components/InputCard';
import { dayLabel } from '@/ui/components/RecentList';
import { resultToMarkdown } from '@/ui/components/ResultView';

const result = (id: string, createdAt: number): CheckResult =>
  ({
    id,
    createdAt,
    input: { kind: 'text', text: `text ${id}`, pageUrl: 'https://a.example/', pageTitle: 'A' },
    verdict: { label: 'Accurate', kind: 'supported', confidence: 'high', summary: 's' },
    narrative: 'n',
    rawText: '',
    claims: [],
    sources: [],
    searchQueries: [],
    provider: { id: 'gemini', label: 'Gemini', model: 'm' },
  }) as unknown as CheckResult;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

describe('P5C4-01: overlapping snapshot-cap passes', () => {
  it('two passes started together remove only the excess', async () => {
    const html = 'x'.repeat(500); // 1000 bytes each
    for (let i = 0; i < 10; i++) await saveCheck(result(`c${i}`, 1000 + i), { url: 'https://a.example/', title: 't', html, capturedAt: 1 });
    // 10 000 bytes stored, cap 7 000: three pages need to go, the three oldest.
    const [a, b] = await Promise.all([enforceSnapshotCap(7000), enforceSnapshotCap(7000)]);
    expect(a + b).toBe(3);
    expect((await storageStats()).snapshots).toBe(7);
    expect((await getCheck('c0'))?.hasSnapshot).toBe(false);
    expect((await getCheck('c3'))?.hasSnapshot).toBe(true);
  });
});

describe('C9-05: the follow-up cap', () => {
  it('refuses past the cap instead of dropping the first', async () => {
    await saveCheck(result('f', 1));
    const fu = (n: number) =>
      ({ id: `q${n}`, createdAt: n, question: `q${n}`, answer: 'a', provider: { id: 'gemini', label: 'G', model: 'm' }, sources: [] }) as FollowUp;
    for (let i = 0; i < 3; i++) expect(await appendFollowUp('f', fu(i), 3)).toBe(true);
    expect(await appendFollowUp('f', fu(3), 3)).toBe(false);
    expect((await getCheck('f'))?.result.followUps?.map((x) => x.id)).toEqual(['q0', 'q1', 'q2']);
  });
});

describe('B2-01 / C9-06 / B2-10: dates west of UTC', () => {
  const tz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles';
    return () => {
      process.env.TZ = tz;
    };
  });
  it('shows a date-only value as that calendar date', () => {
    expect(isDateOnly('2024-05-01')).toBe(true);
    expect(isDateOnly('2024-05-01T00:00:00Z')).toBe(true);
    expect(isDateOnly('2024-05-01T13:45:00Z')).toBe(false);
    expect(localeDate('2024-05-01')).toMatch(/\b1\b/);
    expect(localeDate('2024-05-01')).not.toMatch(/30/);
    expect(formatWhen('2024-05-01')).not.toMatch(/30|:/);
  });
  it('dates files and the Markdown stamp by the local day', () => {
    const evening = new Date(2026, 10, 25, 21, 30).getTime(); // 21:30 local = next day in UTC
    expect(localDay(evening)).toBe('2026-11-25');
    expect(resultToMarkdown(result('m', evening))).toContain('2026-11-25 21:30');
  });
});

describe('R6-01: the Recent list names the day of older checks', () => {
  it('dayLabel', () => {
    const now = new Date(2026, 10, 25, 12, 0);
    expect(dayLabel(new Date(2026, 10, 25, 8).getTime(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 10, 24, 23).getTime(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 3).getTime(), now)).toMatch(/3/);
  });
});
