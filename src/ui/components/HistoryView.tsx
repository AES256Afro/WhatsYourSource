import { useEffect, useMemo, useRef, useState } from 'react';
import { clearHistory, eachCheck, exportAll, listChecks, storageStats, type StoredCheck } from '@/lib/history/db';
import { CSV_HEAD, csvLine, downloadBlob } from '@/lib/history/export';
import { localDay } from '@/lib/history/row';
import { dayLabel } from './RecentList';
import { useActionError } from '../hooks/useActionError';
import type { CheckInput } from '@/lib/messaging/protocol';
import { Label } from './common';
import { HistoryRow } from './HistoryRow';
import { Camera } from './Icons';

type KindFilter = CheckInput['kind'] | 'all';
const PAGE = 100;

export function HistoryView({ onOpen, refreshKey }: { onOpen: (id: string) => void; refreshKey?: number }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [withSnapshot, setWithSnapshot] = useState(false);
  const [items, setItems] = useState<StoredCheck[] | null>(null);
  // A failed read (the database could not open) shows a line with a retry, never "Loading…" forever.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const filterSeq = useRef(0);
  const [stats, setStats] = useState<{ checks: number; snapshotBytes: number } | null>(null);
  const [tick, setTick] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  // Typing should not scan the store on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 180);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let alive = true;
    filterSeq.current++;
    listChecks({ query: debouncedQuery, kind, withSnapshot, limit: PAGE + 1 }).then(
      (r) => {
        if (!alive) return;
        setLoadError(null);
        setHasMore(r.length > PAGE);
        setItems(r.slice(0, PAGE));
      },
      (e: unknown) => {
        console.warn('[wys] could not read history', e);
        if (alive) setLoadError('Couldn’t read your history.');
      },
    );
    return () => {
      alive = false;
    };
  }, [debouncedQuery, kind, withSnapshot, tick, refreshKey]);

  useEffect(() => {
    let alive = true;
    storageStats().then(
      (s) => alive && setStats(s),
      () => undefined, // the footer line is optional; the list reports a failed read
    );
    return () => {
      alive = false;
    };
  }, [tick, refreshKey]);

  const { error: actionError, guard } = useActionError();
  const loadMore = guard('Loading older checks', async () => {
    const last = items?.[items.length - 1];
    if (!last || loadingMore) return;
    const seq = filterSeq.current; // the filters this request belongs to
    setLoadingMore(true);
    try {
      const r = await listChecks({ query: debouncedQuery, kind, withSnapshot, limit: PAGE + 1, before: last.createdAt });
      if (seq !== filterSeq.current) return; // filters changed meanwhile; the effect replaced the list
      setHasMore(r.length > PAGE);
      setItems((cur) => [...(cur ?? []), ...r.slice(0, PAGE)]);
    } finally {
      setLoadingMore(false);
    }
  });

  const groups = useMemo(() => groupByDay(items ?? []), [items]);

  const [exported, setExported] = useState<string | null>(null);
  const clearAll = guard('Clear all', async () => {
    if (!confirm('Delete all saved checks and page snapshots? This cannot be undone.')) return;
    await clearHistory();
    setTick((t) => t + 1);
  });
  // The table follows the search box and the filter, so "everything about X" is one export away.
  const exportCsv = guard('Export', async () => {
    // A page at a time, 200 lines to a Blob: the heap never holds the whole history, and a few
    // dozen parts build faster than one per line.
    const parts: BlobPart[] = [CSV_HEAD];
    let n = 0;
    let batch = '';
    for await (const c of eachCheck({ query: debouncedQuery, kind, withSnapshot })) {
      batch += csvLine(c);
      if (++n % 200 === 0) {
        parts.push(new Blob([batch]));
        batch = '';
      }
    }
    if (batch) parts.push(new Blob([batch]));
    // Say so when the search or a filter narrowed it: the file looks the same either way.
    const filtered = !!debouncedQuery.trim() || kind !== 'all' || withSnapshot;
    downloadBlob(new Blob(parts, { type: 'text/csv;charset=utf-8' }), `whatsyoursource-checks${filtered ? '-filtered' : ''}-${localDay()}.csv`);
    setExported(
      filtered && stats
        ? `Exported ${n} matching check${n === 1 ? '' : 's'} (of ${stats.checks})`
        : `Exported ${n} check${n === 1 ? '' : 's'} as a spreadsheet`,
    );
    setTimeout(() => setExported(null), 4000);
  });
  const exportJson = guard('Export', async () => {
    downloadBlob(await exportAll(), `whatsyoursource-history-${localDay()}.json`);
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex grow flex-col gap-2.5 overflow-y-auto p-3.5">
        <div className="flex items-center gap-2">
          <h1 ref={heading} tabIndex={-1} className="m-0 text-[18px] font-bold outline-none">
            History
          </h1>
          <span className="grow" />
          {stats && (
            <span className="text-[12px] text-ink-2">
              {stats.checks} {stats.checks === 1 ? 'check' : 'checks'}
            </span>
          )}
        </div>
        <label htmlFor="wys-hsearch" className="wys-sr-only">
          Search history
        </label>
        <input id="wys-hsearch" type="search" className="wys-input" placeholder="Search checks…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind">
          {(
            [
              ['all', 'All'],
              ['text', 'Text'],
              ['image', 'Image'],
              ['post', 'Post'],
              ['page', 'Page'],
            ] as [KindFilter, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              aria-pressed={kind === k}
              className={`h-7 shrink-0 rounded-full border px-2.5 text-[12px] font-medium ${kind === k ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-paper text-ink-2'}`}
              onClick={() => setKind(k)}
            >
              {label}
            </button>
          ))}
          <button
            className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium ${withSnapshot ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-paper text-ink-2'}`}
            onClick={() => setWithSnapshot((v) => !v)}
            aria-pressed={withSnapshot}
          >
            <Camera size={12} /> With snapshot
          </button>
        </div>

        {loadError && items === null ? (
          <div role="alert" className="flex items-center gap-2 text-[13px] text-bad">
            <span className="grow">{loadError}</span>
            <button className="wys-btn h-8 px-3 text-[12px]" onClick={() => setTick((t) => t + 1)}>
              Try again
            </button>
          </div>
        ) : items === null ? (
          <div className="text-[13px] text-ink-2">Loading…</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong p-4 text-center text-[13px] text-ink-2">
            {debouncedQuery || kind !== 'all' || withSnapshot ? 'Nothing matches.' : 'No checks yet. Highlight some text and press Check source.'}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="flex flex-col gap-1.5">
              <Label>{g.label}</Label>
              {g.items.map((c) => (
                <HistoryRow key={c.id} check={c} onOpen={() => onOpen(c.id)} />
              ))}
            </div>
          ))
        )}
        {hasMore && (
          <button className="wys-btn" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Loading…' : 'Load older checks'}
          </button>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-line bg-paper px-3.5 py-2.5 text-[11px] text-ink-2">
        <span role="status" className={`min-w-0 basis-full truncate ${actionError || loadError ? 'text-bad' : ''}`}>
          {actionError ?? (items !== null ? loadError : null) ?? exported ?? (stats ? `${fmtBytes(stats.snapshotBytes)} of saved pages` : '')}
        </span>
        <span className="grow" />
        <button
          className="wys-btn h-8 px-3 text-[12px]"
          onClick={exportCsv}
          disabled={!items?.length}
          title="One row per check, for Excel, Google Sheets or Numbers. Exports the checks that match the search and filter above."
          aria-label="Export the matching checks as a spreadsheet (CSV)"
        >
          Spreadsheet
        </button>
        <button
          className="wys-btn h-8 px-3 text-[12px]"
          onClick={exportJson}
          disabled={!(stats?.checks ?? items?.length)}
          title="Every saved check, with the text of its saved page, as one JSON file. Screenshots and settings are not included, and the file can’t be imported back yet."
          aria-label="Export all checks as JSON"
        >
          Export all (JSON)
        </button>
        <button className="wys-btn h-8 px-3 text-[12px] text-bad" onClick={clearAll} disabled={!(stats?.checks ?? items?.length)}>
          Clear all
        </button>
      </div>
    </div>
  );
}

function groupByDay(items: StoredCheck[]): { label: string; items: StoredCheck[] }[] {
  const groups = new Map<string, StoredCheck[]>();
  for (const c of items) {
    const label = dayLabel(c.createdAt);
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }
  return Array.from(groups, ([label, items]) => ({ label, items }));
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
